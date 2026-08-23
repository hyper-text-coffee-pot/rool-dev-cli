import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, checkGitRepo, getCurrentBranch } from './git.js';
import { colors } from '../ui/theme.js';

/**
 * Ensures the CLI is operating on an intended, valid Git workspace.
 */
export async function promptOrConfirmWorkspace(): Promise<string> {
    while (true) {
        const currentDir = process.cwd();
        const isRepo = await checkGitRepo();

        if (isRepo) {
            let branchName = 'unknown';
            try {
                branchName = await getCurrentBranch();
            } catch { }

            const confirm = await p.select({
                message: `Active Workspace: ${colors.accent(currentDir)} [Branch: ${colors.primary(branchName)}]`,
                options: [
                    { value: 'keep', label: '✅ Continue with this Git repository' },
                    { value: 'switch', label: '📂 Switch to a different folder' },
                    { value: 'exit', label: '❌ Exit' },
                ],
            });

            if (p.isCancel(confirm) || confirm === 'exit') {
                p.outro(colors.muted('Goodbye! 👋'));
                process.exit(0);
            }

            if (confirm === 'keep') {
                return currentDir;
            }
        } else {
            p.log.warn(`Current folder is NOT a Git repository: ${colors.muted(currentDir)}`);

            const choice = await p.select({
                message: 'How would you like to set up your project workspace?',
                options: [
                    { value: 'switch', label: '📂 Navigate to an existing project folder' },
                    { value: 'init', label: '🌱 Initialize a new Git repo in this folder' },
                    { value: 'clone', label: '📥 Clone a remote repository here' },
                    { value: 'exit', label: '❌ Exit' },
                ],
            });

            if (p.isCancel(choice) || choice === 'exit') {
                p.outro(colors.muted('Goodbye! 👋'));
                process.exit(0);
            }

            if (choice === 'init') {
                await git.init();
                p.log.success('Initialized new Git repository in ' + currentDir);
                return currentDir;
            }

            if (choice === 'clone') {
                const repoUrl = await p.text({ message: 'Enter remote Git repository URL:' });
                if (p.isCancel(repoUrl) || !repoUrl) continue;

                const s = p.spinner();
                s.start('Cloning repository...');
                try {
                    await git.clone(repoUrl as string, '.');
                    s.stop('Cloned repository successfully!');
                    return currentDir;
                } catch (err: any) {
                    s.stop('Clone failed.');
                    p.log.error(err.message);
                    continue;
                }
            }
        }

        // Switch directory flow
        const targetDir = await p.text({
            message: 'Enter relative or absolute path to your project:',
            validate: (val) => {
                if (!val || !existsSync(resolve(val))) return 'Folder does not exist. Please check the path.';
                return undefined;
            },
        });

        if (p.isCancel(targetDir)) continue;

        try {
            process.chdir(resolve(targetDir as string));
            p.log.info(`Switched active folder to: ${colors.accent(process.cwd())}`);
        } catch (e: any) {
            p.log.error(`Could not access directory: ${e.message}`);
        }
    }
}
