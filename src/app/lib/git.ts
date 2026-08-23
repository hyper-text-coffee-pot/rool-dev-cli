import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { colors } from '../ui/theme.js';

export const git: SimpleGit = simpleGit();

export async function checkGitRepo(): Promise<boolean> {
    return await git.checkIsRepo();
}

export async function getRepoStatus(): Promise<StatusResult> {
    const isRepo = await checkGitRepo();
    if (!isRepo) {
        throw new Error('Current directory is not a Git repository.');
    }
    return await git.status();
}

export async function getCurrentBranch(): Promise<string> {
    const branch = await git.branch();
    return branch.current;
}
