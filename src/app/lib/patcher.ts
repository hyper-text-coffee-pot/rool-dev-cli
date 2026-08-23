import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, normalize } from 'node:path';
import * as diff from 'diff';
import * as p from '@clack/prompts';
import { colors } from '../ui/theme.js';

export interface ProposedFileChange {
    relativePath: string;
    absolutePath: string;
    isNew: boolean;
    oldContent: string;
    newContent: string;
}

/**
 * Extracts proposed file modifications from the agent's response text.
 */
export function extractFileChanges(responseText: string, rootDir = process.cwd()): ProposedFileChange[] {
    const changes: ProposedFileChange[] = [];
    const processedPaths = new Set<string>();

    // Clean Windows and carriage returns first
    const normalizedResponse = responseText.replace(/\r\n/g, '\n');

    // Pattern 1: Structured <<<FILE: path>>> ... <<<END_FILE>>> (or EOF)
    const structuredRegex = /<<<FILE:\s*([^\n\r>]+)>>>\s*([\s\S]*?)(?:<<<END_FILE>>>|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = structuredRegex.exec(normalizedResponse)) !== null) {
        const rawPath = match[1].trim().replace(/\\/g, '/');
        let content = match[2];
        if (!rawPath || processedPaths.has(rawPath.toLowerCase())) continue;

        // Strip unclosed tags or trailing delimiters
        content = content.replace(/<<<END_FILE>>>/gi, '').trimEnd() + '\n';

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
        });
    }

    // Pattern 2: Fallback for markdown codeblocks with filename header
    if (changes.length === 0) {
        const mdFileRegex = /(?:###?\s*File:\s*|`)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6})`?\s*\n+```[a-zA-Z]*\n([\s\S]*?)```/gi;
        while ((match = mdFileRegex.exec(normalizedResponse)) !== null) {
            const rawPath = match[1].trim().replace(/\\/g, '/');
            const content = match[2].trimEnd() + '\n';
            if (processedPaths.has(rawPath.toLowerCase())) continue;

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
        for (const change of changes) {
            const dir = dirname(change.absolutePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(change.absolutePath, change.newContent, 'utf-8');
            p.log.success(`Wrote: ${colors.accent(change.relativePath)} -> ${colors.muted(change.absolutePath)}`);
        }
        s.stop(colors.success(`Successfully applied ${changes.length} file update(s)!`));
        return true;
    } catch (err: any) {
        s.stop(colors.error('Failed to write changes to disk.'));
        p.log.error(err.message || String(err));
        return false;
    }
}
