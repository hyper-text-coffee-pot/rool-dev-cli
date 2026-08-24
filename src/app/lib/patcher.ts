import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, normalize, relative, isAbsolute } from 'node:path';
import * as diff from 'diff';
import * as p from '@clack/prompts';
import { colors } from '../ui/theme.js';

/**
 * Rejects placeholder/ellipsis text (e.g. the model echoing its own "<<<FILE: ...>>>"
 * instructions) and paths that would escape rootDir, so we never write to a bogus
 * or arbitrary location on disk.
 */
function isPlausibleTargetPath(rawPath: string, rootDir: string): boolean {
    if (!rawPath) return false;
    // Reject paths made up of only dots/slashes/whitespace, e.g. "...", "..", "."
    if (/^[.\/\\\s]+$/.test(rawPath)) return false;

    const absolutePath = normalize(resolve(rootDir, rawPath));
    const rel = relative(rootDir, absolutePath);
    if (rel.startsWith('..') || isAbsolute(rel)) return false; // escapes the workspace root

    return true;
}

export interface ProposedFileChange {
    relativePath: string;
    absolutePath: string;
    isNew: boolean;
    oldContent: string;
    newContent: string;
    /** True if no <<<END_FILE>>> marker was found — content may be a truncated stream, not the full file. */
    isTruncated: boolean;
}

/**
 * Builds proposed changes directly from a model's structured (responseSchema) output,
 * bypassing text/regex parsing entirely. Still runs paths through the same plausibility
 * guard as the text-tag path, since the model could still return a bogus/unsafe path.
 */
export function structuredFilesToChanges(
    files: { path: string; content: string }[],
    rootDir = process.cwd(),
): ProposedFileChange[] {
    const changes: ProposedFileChange[] = [];
    const processedPaths = new Set<string>();

    for (const file of files) {
        const rawPath = file.path.trim().replace(/\\/g, '/');
        if (!rawPath || processedPaths.has(rawPath.toLowerCase())) continue;
        if (!isPlausibleTargetPath(rawPath, rootDir)) continue;

        const absolutePath = normalize(resolve(rootDir, rawPath));
        const isNew = !existsSync(absolutePath);
        let oldContent = '';
        if (!isNew) {
            try {
                oldContent = readFileSync(absolutePath, 'utf-8').replace(/\r\n/g, '\n');
            } catch { }
        }

        processedPaths.add(rawPath.toLowerCase());
        changes.push({
            relativePath: rawPath,
            absolutePath,
            isNew,
            oldContent,
            newContent: file.content.replace(/\r\n/g, '\n').trimEnd() + '\n',
            isTruncated: false,
        });
    }

    return changes;
}

/**
 * Extracts proposed file modifications from the agent's response text.
 * `fileTagNonce` must match the one-time nonce given to the model for this request
 * (see runAgentTask) — without it, structured <<<FILE>>> blocks are never trusted,
 * since a nonce-less tag could just be the model echoing generic instructions/example
 * text that happens to live inside a file it's editing (e.g. this CLI's own source).
 */
export function extractFileChanges(responseText: string, rootDir = process.cwd(), fileTagNonce?: string): ProposedFileChange[] {
    const changes: ProposedFileChange[] = [];
    const processedPaths = new Set<string>();

    // Clean Windows and carriage returns first
    const normalizedResponse = responseText.replace(/\r\n/g, '\n');

    // Pattern 1: Structured <<<FILE:{nonce}: path>>> ... <<<END_FILE:{nonce}>>> (or EOF)
    if (fileTagNonce) {
        const nonce = fileTagNonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const closeTag = `<<<END_FILE:${nonce}>>>`;
        const structuredRegex = new RegExp(`<<<FILE:${nonce}:\\s*([^\\n\\r>]+)>>>\\s*([\\s\\S]*?)(${closeTag}|$)`, 'gi');
        let match: RegExpExecArray | null;

        while ((match = structuredRegex.exec(normalizedResponse)) !== null) {
            const rawPath = match[1].trim().replace(/\\/g, '/');
            let content = match[2];
            const isTruncated = match[3] !== closeTag;
            if (!rawPath || processedPaths.has(rawPath.toLowerCase())) continue;
            if (!isPlausibleTargetPath(rawPath, rootDir)) continue;

            // Strip unclosed tags or trailing delimiters
            content = content.replace(new RegExp(closeTag, 'gi'), '').trimEnd() + '\n';

            const absolutePath = normalize(resolve(rootDir, rawPath));
            const isNew = !existsSync(absolutePath);
            let oldContent = '';
            if (!isNew) {
                try {
                    oldContent = readFileSync(absolutePath, 'utf-8').replace(/\r\n/g, '\n');
                } catch { }
            }

            processedPaths.add(rawPath.toLowerCase());
            changes.push({
                relativePath: rawPath,
                absolutePath,
                isNew,
                oldContent,
                newContent: content,
                isTruncated,
            });
        }
    }

    // Pattern 2: Fallback for markdown codeblocks with filename header
    if (changes.length === 0) {
        const mdFileRegex = /(?:###?\s*File:\s*|`)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6})`?\s*\n+```[a-zA-Z]*\n([\s\S]*?)```/gi;
        let match: RegExpExecArray | null;
        while ((match = mdFileRegex.exec(normalizedResponse)) !== null) {
            const rawPath = match[1].trim().replace(/\\/g, '/');
            const content = match[2].trimEnd() + '\n';
            if (processedPaths.has(rawPath.toLowerCase())) continue;
            if (!isPlausibleTargetPath(rawPath, rootDir)) continue;

            const absolutePath = normalize(resolve(rootDir, rawPath));
            const isNew = !existsSync(absolutePath);
            let oldContent = '';
            if (!isNew) {
                try {
                    oldContent = readFileSync(absolutePath, 'utf-8').replace(/\r\n/g, '\n');
                } catch { }
            }

            processedPaths.add(rawPath.toLowerCase());
            changes.push({
                relativePath: rawPath,
                absolutePath,
                isNew,
                oldContent,
                newContent: content,
                isTruncated: false,
            });
        }
    }

    return changes;
}

/**
 * Display a colorized unified diff in the terminal.
 */
export function displayDiffPreview(change: ProposedFileChange): void {
    const header = change.isNew
        ? colors.success(`[NEW FILE] ${change.relativePath}`)
        : colors.primary(`[MODIFIED] ${change.relativePath}`);

    console.log('\n' + colors.bold(header));
    if (change.isTruncated) {
        console.log(colors.error(`⚠ No <<<END_FILE>>> marker found — this content looks like a truncated/cut-off stream, not a complete file. It will be skipped.`));
    }

    const patch = diff.createPatch(
        change.relativePath,
        change.oldContent,
        change.newContent,
        'Current',
        'Proposed'
    );

    const lines = patch.split('\n').slice(4);
    for (const line of lines) {
        if (line.startsWith('+')) {
            console.log(colors.success(line));
        } else if (line.startsWith('-')) {
            console.log(colors.error(line));
        } else if (line.startsWith('@')) {
            console.log(colors.accent(line));
        } else {
            console.log(colors.muted(line));
        }
    }
}

/**
 * Prompt user to apply changes and write them to disk.
 */
export async function promptAndApplyChanges(changes: ProposedFileChange[]): Promise<boolean> {
    if (changes.length === 0) return false;

    p.log.info(colors.bold(`Rool Agent proposed changes for ${changes.length} file(s):`));

    for (const change of changes) {
        displayDiffPreview(change);
    }

    // Never allow truncated/incomplete blocks to reach disk, even if the user says "apply".
    const safeChanges = changes.filter((c) => !c.isTruncated);
    const truncatedChanges = changes.filter((c) => c.isTruncated);
    if (truncatedChanges.length > 0) {
        p.log.warn(colors.error(
            `Skipping ${truncatedChanges.length} truncated file(s) (no <<<END_FILE>>> marker): ` +
            truncatedChanges.map((c) => c.relativePath).join(', '),
        ));
    }
    if (safeChanges.length === 0) {
        p.log.warn('No complete file changes to apply.');
        return false;
    }

    const action = await p.select({
        message: 'Apply these changes to your local files?',
        options: [
            { value: 'apply', label: '✅ Apply all changes to disk' },
            { value: 'reject', label: '❌ Reject and discard changes' },
        ],
    });

    if (p.isCancel(action) || action === 'reject') {
        p.log.warn('Changes discarded.');
        return false;
    }

    const s = p.spinner();
    s.start('Writing changes to disk...');

    try {
        for (const change of safeChanges) {
            const dir = dirname(change.absolutePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(change.absolutePath, change.newContent, 'utf-8');
            p.log.success(`Wrote: ${colors.accent(change.relativePath)} -> ${colors.muted(change.absolutePath)}`);
        }
        s.stop(colors.success(`Successfully applied ${safeChanges.length} file update(s)!`));
        return true;
    } catch (err: any) {
        s.stop(colors.error('Failed to write changes to disk.'));
        p.log.error(err.message || String(err));
        return false;
    }
}
