import { Command } from 'commander';
import * as p from '@clack/prompts';
import { colors, banner } from './ui/theme.js';
import { authCommand } from './commands/auth.js';
import { gitCommand } from './commands/git.js';
import { isUserLoggedIn, ensureAuthenticated } from './lib/auth.js';
import { getRepoStatus, getCurrentBranch, checkGitRepo } from './lib/git.js';

const program = new Command();

program
    .name('rool-dev')
    .description('Rool Developer CLI — interactive workspace & code automation tool')
    .version('0.1.0');

// Register direct subcommands for scriptability (e.g. `rool-dev auth login`)
program.addCommand(authCommand);
program.addCommand(gitCommand);

/**
 * Main Interactive Session Loop
 */
async function startInteractiveSession() {
    console.clear();
    console.log(banner('ROOL DEVELOPER CLI', 'Interactive Workspace & Automation Shell'));

    const loggedIn = await isUserLoggedIn();
    const isRepo = await checkGitRepo();

    // Status badges
    const authStatus = loggedIn ? colors.success('● Authenticated') : colors.warning('○ Not Authenticated');
    let gitStatus = colors.muted('○ No Git Repo');

    if (isRepo) {
        try {
            const branch = await getCurrentBranch();
            const status = await getRepoStatus();
            const dirty = status.files.length > 0 ? colors.warning(`(${status.files.length} modified)`) : colors.success('(clean)');
            gitStatus = `${colors.accent(branch)} ${dirty}`;
        } catch { }
    }

    p.intro(`Session Ready | Rool: ${authStatus} | Git: ${gitStatus}`);

    // Continuous interaction loop
    while (true) {
        const action = await p.select({
            message: 'What would you like to do?',
            options: [
                { value: 'git-status', label: '📊 Inspect Git Status & Changes' },
                { value: 'git-commit', label: '🚀 Quick Smart Commit & Push' },
                { value: 'rool-machines', label: '🤖 List Rool Machines & Agents' },
                { value: 'auth-manage', label: loggedIn ? '🔒 Manage Rool Auth (Logout/Relogin)' : '🔑 Login to Rool' },
                { value: 'task-runner', label: '⚡ Run Automated Code Task' },
                { value: 'exit', label: '❌ Exit Session' },
            ],
        });

        if (p.isCancel(action) || action === 'exit') {
            p.outro(colors.muted('Goodbye! 👋'));
            process.exit(0);
        }

        // Handle interactive selections
        switch (action) {
            case 'git-status': {
                if (!isRepo) {
                    p.log.error('Current directory is not a Git repository.');
                    break;
                }
                const status = await getRepoStatus();
                if (status.files.length === 0) {
                    p.log.success('Working directory clean. No uncommitted changes.');
                } else {
                    p.log.info(colors.bold(`Modified files (${status.files.length}):`));
                    status.files.forEach((f) => p.log.step(`  ${f.working_dir || f.index} ${f.path}`));
                }
                break;
            }

            case 'auth-manage': {
                if (!loggedIn) {
                    const s = p.spinner();
                    s.start('Opening browser for authentication...');
                    try {
                        await ensureAuthenticated();
                        s.stop('Logged in successfully!');
                    } catch (e: any) {
                        s.stop('Failed to log in.');
                        p.log.error(e.message);
                    }
                } else {
                    const confirmLogout = await p.confirm({ message: 'Are you sure you want to log out?' });
                    if (confirmLogout && !p.isCancel(confirmLogout)) {
                        const { getAuth } = await import('./lib/auth.js');
                        await getAuth().logout();
                        p.log.success('Logged out successfully.');
                    }
                }
                break;
            }

            case 'rool-machines': {
                const client = await ensureAuthenticated();
                const s = p.spinner();
                s.start('Fetching machines...');
                try {
                    const machines = await client.listMachines();
                    s.stop(`Found ${machines.length} machine(s):`);
                    machines.forEach((m) => p.log.info(` • ${colors.primary(m.name || m.id)} [${m.id}]`));
                } catch (e: any) {
                    s.stop('Failed to list machines.');
                    p.log.error(e.message);
                }
                break;
            }

            case 'task-runner': {
                p.log.info(colors.accent('Task runner ready — select or input task to execute.'));
                // We will wire custom task scripts here
                break;
            }
        }

        console.log(''); // newline between actions
    }
}

// If user provided command line arguments (e.g. `rool-dev auth status`), parse them.
// Otherwise, start the interactive loop!
if (process.argv.length <= 2) {
    startInteractiveSession().catch(console.error);
} else {
    program.parse(process.argv);
}
