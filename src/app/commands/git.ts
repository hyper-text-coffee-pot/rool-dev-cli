import { Command } from 'commander';
import * as p from '@clack/prompts';
import { colors } from '../ui/theme.js';
import { checkGitRepo, getRepoStatus, getCurrentBranch } from '../lib/git.js';

export const gitCommand = new Command('git').description('Git automation and repo tasks');

gitCommand
    .command('status')
    .description('Display styled Git repository status')
    .action(async () => {
        const isRepo = await checkGitRepo();
        if (!isRepo) {
            console.log(colors.error('Not a Git repository.'));
            return;
        }

        const status = await getRepoStatus();
        const branch = await getCurrentBranch();

        p.intro(colors.primary(`Git Repository Status [Branch: ${colors.accent(branch)}]`));

        console.log(
            `  ${colors.bold('Modified:')} ${status.modified.length} | ` +
            `${colors.bold('Created:')} ${status.created.length} | ` +
            `${colors.bold('Deleted:')} ${status.deleted.length} | ` +
            `${colors.bold('Ahead:')} ${status.ahead} | ` +
            `${colors.bold('Behind:')} ${status.behind}`
        );

        if (status.files.length > 0) {
            console.log('\n' + colors.bold('Changes:'));
            for (const file of status.files) {
                const color = file.working_dir === 'M' ? colors.warning : colors.success;
                console.log(`  ${color(file.working_dir || file.index)} ${file.path}`);
            }
        } else {
            console.log('\n' + colors.success('Working tree clean.'));
        }

        p.outro('Status check complete.');
    });
