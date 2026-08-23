import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
 * Supports both <<<FILE: path>>> and standard ```lang File: path code fences.
 */
export function extractFileChanges(responseText: string, rootDir = process.cwd()): ProposedFileChange[] {
    const changes: ProposedFileChange[] = [];
    const processedPaths = new Set<string>();

    // Pattern 1: Structured <<<FILE: path>>> ... <<<END_FILE>>> (or EOF)
    const structuredRegex = /<<<FILE:\s*([^\n\r>]+)>>>\s*([\s\S]*?)(?:<<<END_FILE>>>|$)/g;
    let match: RegExpExecArray | null;

    while ((match = structuredRegex.exec(responseText)) !== null) {
        const rawPath = match[1].trim().replace(/\\/g, '/');
        let content = match[2].trim();
        if (!rawPath || processedPaths.has(rawPath)) continue;

        // Clean any trailing unclosed delimiter
        content = content.replace(/<<<END_FILE>>>/g, '').trimEnd() + '\n';

        const absolutePath = resolve(rootDir, rawPath);
        const isNew = !existsSync(absolutePath);
        const oldContent = isNew ? '' : readFileSync(absolutePath, 'utf-8');

        processedPaths.add(rawPath);
        changes.push({
            relativePath: rawPath,
            absolutePath,
            isNew,
            oldContent,
            newContent: content,
        });
    }

    // Pattern 2: Markdown header with code block fallback:
    // e.g. "### File: src/app/index.ts\n```ts\n...content...\n```"
    if (changes.length === 0) {
        const mdFileRegex = /(?:###?\s*File:\s*|`)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6})`?\s*\n+```[a-zA-Z]*\n([\s\S]*?)```/g;
        while ((match = mdFileRegex.exec(responseText)) !== null) {
            const rawPath = match[1].trim().replace(/\\/g, '/');
            const content = match[2].trimEnd() + '\n';
            if (processedPaths.has(rawPath)) continue;

            const absolutePath = resolve(rootDir, rawPath);
            const isNew = !existsSync(absolutePath);
            const oldContent = isNew ? '' : readFileSync(absolutePath, 'utf-8');

            processedPaths.add(rawPath);
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

    for (const change of changes) {
        const dir = dirname(change.absolutePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(change.absolutePath, change.newContent, 'utf-8');
        p.log.success(`Updated ${colors.accent(change.relativePath)}`);
    }

    return true;
}
