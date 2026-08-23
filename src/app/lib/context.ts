import fg from 'fast-glob';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { colors } from '../ui/theme.js';
import * as p from '@clack/prompts';
import { git, checkGitRepo } from './git.js';

const IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/bin/**',          // .NET / C# binaries
    '**/obj/**',          // .NET / C# build cache
    '**/.vs/**',          // Visual Studio
    '**/__pycache__/**',  // Python bytecode
    '**/.venv/**',        // Python venv
    '**/target/**',       // Rust
    '**/vendor/**',       // Go / PHP
    '**/.gradle/**',      // Java / Kotlin
    '**/.idea/**',        // JetBrains
    '**/*.lock',
    '**/*lock.json',
];

// Common non-code/binary extensions to skip
const BINARY_EXTENSIONS = new Set([
    'dll', 'exe', 'pdb', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico',
    'woff', 'woff2', 'ttf', 'eot', 'zip', 'tar', 'gz', '7z', 'mp4', 'pdf'
]);

const MAX_FILE_SIZE_BYTES = 200 * 1024; // 200KB per file limit

export interface ResolvedContext {
    files: Array<{ path: string; content: string }>;
    cleanPrompt: string;
}

/**
 * Scan the prompt for @mentions, explicit paths, or any filename matching the local repository.
 */
export async function collectContextForPrompt(prompt: string, rootDir = process.cwd()): Promise<ResolvedContext> {
    const matchedFiles = new Map<string, string>();

    // 1. Index all valid repo files (fast, in-memory)
    const allRepoFiles = await fg('**/*', {
        cwd: rootDir,
        ignore: IGNORE_PATTERNS,
        absolute: true,
        onlyFiles: true,
    });

    // Map from basename (e.g. Program.cs, index.ts, main.py) -> full paths
    const fileMap = new Map<string, string[]>();
    for (const file of allRepoFiles) {
        const base = basename(file);
        const existing = fileMap.get(base) || [];
        existing.push(file);
        fileMap.set(base, existing);
    }

    // 2. Check for explicit @mentions (e.g. @src/app/index.ts or @Program.cs)
    const atMentionRegex = /@([a-zA-Z0-9_\-\.\/\\]+)/g;
    let match: RegExpExecArray | null;

    while ((match = atMentionRegex.exec(prompt)) !== null) {
        const rawPath = match[1].replace(/\\/g, '/');
        const resolvedPath = resolve(rootDir, rawPath);

        if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
            addFile(resolvedPath, rootDir, matchedFiles);
        } else {
            const base = basename(rawPath);
            const candidates = fileMap.get(base);
            if (candidates && candidates.length > 0) {
                addFile(candidates[0], rootDir, matchedFiles);
            }
        }
    }

    // 3. Universal File Token Regex (matches any `name.ext` where ext is 1-6 alphanumeric chars)
    const universalFileRegex = /\b([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{1,6})\b/gi;
    while ((match = universalFileRegex.exec(prompt)) !== null) {
        const fileName = match[1];
        const candidates = fileMap.get(fileName);

        if (candidates && candidates.length > 0) {
            const preferred = candidates.find((f) => f.includes('/src/') || f.includes('\\src\\')) || candidates[0];
            addFile(preferred, rootDir, matchedFiles);
        }
    }

    // 4. Relative Path Regex (matches paths like `src/app/index` or `Controllers/AuthController`)
    const pathRegex = /\b([a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\.\/]+)\b/g;
    while ((match = pathRegex.exec(prompt)) !== null) {
        const rawPath = match[1];
        const directPath = resolve(rootDir, rawPath);
        if (existsSync(directPath) && statSync(directPath).isFile()) {
            addFile(directPath, rootDir, matchedFiles);
        }
    }

    // 5. Fallback: If no files were explicitly found, automatically attach uncommitted / modified files from Git
    if (matchedFiles.size === 0) {
        try {
            const isRepo = await checkGitRepo();
            if (isRepo) {
                const status = await git.status();
                const modifiedAndCreated = [...status.modified, ...status.created, ...status.not_added];
                for (const f of modifiedAndCreated) {
                    addFile(resolve(rootDir, f), rootDir, matchedFiles);
                }
            }
        } catch { }
    }

    const files = Array.from(matchedFiles.entries()).map(([relPath, content]) => ({
        path: relPath,
        content,
    }));

    if (files.length > 0) {
        p.log.info(
            colors.bold('Attached local context:') + '\n' +
            files.map((f) => `  📄 ${colors.accent(f.path)} (${(f.content.length / 1024).toFixed(1)} KB)`).join('\n')
        );
    }

    return {
        files,
        cleanPrompt: prompt,
    };
}

function addFile(absolutePath: string, rootDir: string, map: Map<string, string>) {
    try {
        const ext = absolutePath.split('.').pop()?.toLowerCase() || '';
        if (BINARY_EXTENSIONS.has(ext)) return;

        const stat = statSync(absolutePath);
        if (stat.size > MAX_FILE_SIZE_BYTES) return; // Skip large files

        const rel = relative(rootDir, absolutePath).replace(/\\/g, '/');
        if (!map.has(rel)) {
            map.set(rel, readFileSync(absolutePath, 'utf-8'));
        }
    } catch { }
}

export function formatContextPayload(files: Array<{ path: string; content: string }>): string {
    if (files.length === 0) return '';
    return files
        .map((f) => {
            const ext = f.path.split('.').pop() || '';
            return `### File: ${f.path}\n\`\`\`${ext}\n${f.content}\n\`\`\``;
        })
        .join('\n\n');
}
