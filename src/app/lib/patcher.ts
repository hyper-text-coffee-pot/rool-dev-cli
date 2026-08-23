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
 * Extracts proposed file modifications from the agent's text response.
 */
export function extractFileChanges(responseText: string, rootDir = process.cwd()): ProposedFileChange[] {
    const fileBlockRegex = /<<<FILE:\s*([^\n\r>]+)>>>\s*([\s\S]*?)<<<END_FILE>>>/g;
    const changes: ProposedFileChange[] = [];

    let match: RegExpExecArray | null;
    while ((match = fileBlockRegex.exec(responseText)) !== null) {
        const rawPath = match[1].trim().replace(/\\/g, '/');
        const newContent = match[2].trimEnd() + '\n';
        const absolutePath = resolve(rootDir, rawPath);

        const isNew = !existsSync(absolutePath);
        const oldContent = isNew ? '' : readFileSync(absolutePath, 'utf-8');

        changes.push({
            relativePath: rawPath,
            absolutePath,
            isNew,
            oldContent,
            newContent,
        });
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

    const lines = patch.split('\n').slice(4); // strip standard diff header
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
        message: 'Would you like to apply these changes to your local workspace?',
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
