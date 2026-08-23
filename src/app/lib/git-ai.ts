import { git } from './git.js';
import { runAgentTask } from './rool-agent.js';

/**
 * Perform an AI Code Review of current uncommitted / staged changes
 */
export async function reviewCurrentChanges(): Promise<string> {
    const diff = await git.diff();
    if (!diff || diff.trim().length === 0) {
        return 'No changes detected in working tree to review.';
    }

    return await runAgentTask(
        'Please review this Git diff for bugs, performance issues, security concerns, and style improvements:',
        diff
    );
}

/**
 * Generate a smart commit message using Rool Mind
 */
export async function generateSmartCommit(): Promise<string> {
    const diff = await git.diff(['--cached']);
    const workingDiff = diff.length > 0 ? diff : await git.diff();

    if (!workingDiff) {
        throw new Error('No changes found to create a commit for.');
    }

    return await runAgentTask(
        'Write a concise, standard Conventional Commit message (e.g. feat:, fix:, refactor:) based on these changes. Only return the commit message.',
        workingDiff
    );
}
