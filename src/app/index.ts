import { Command } from 'commander';
import * as p from '@clack/prompts';
import { colors } from './ui/theme.js';
import { pixelBanner } from './lib/pixel-banner.js';
import { authCommand } from './commands/auth.js';
import { gitCommand } from './commands/git.js';
import { isUserLoggedIn, ensureAuthenticated } from './lib/auth.js';
import { getRepoStatus, getCurrentBranch, checkGitRepo } from './lib/git.js';
import { promptOrConfirmWorkspace } from './lib/workspace.js';
import {
    runAgentTask,
    manageConversations,
    startNewConversation,
    getStoredConversationId
} from './lib/rool-agent.js';
import { reviewCurrentChanges, generateSmartCommit } from './lib/git-ai.js';
import { collectContextForPrompt, formatContextPayload } from './lib/context.js';
import { extractFileChanges, promptAndApplyChanges } from './lib/patcher.js';

const program = new Command();

program
    .name('rool-dev')
    .description('Rool Developer CLI — interactive workspace & code automation tool')
    .version('0.1.0');

program.addCommand(authCommand);
program.addCommand(gitCommand);

async function startInteractiveSession() {
    console.clear();
    console.log(pixelBanner('Rool Dev CLI', 'Interactive Workspace & Automation Shell'));

    const activeSessionId = getStoredConversationId();
    const sessionLabel = activeSessionId ? colors.accent(`[Session: ${activeSessionId.slice(0, 6)}...]`) : colors.muted('[New Session]');

    // 1. Always verify / select active workspace first
    await promptOrConfirmWorkspace();

    // 2. Main interactive loop
    while (true) {
        const loggedIn = await isUserLoggedIn();
        const branch = await getCurrentBranch().catch(() => 'unknown');
        const status = await getRepoStatus().catch(() => null);

        const dirtyInfo = status && status.files.length > 0
            ? colors.warning(`(${status.files.length} modified)`)
            : colors.success('(clean)');

        p.intro(
            `Workspace: ${colors.accent(process.cwd())}\n` +
            `Branch: ${colors.primary(branch)} ${dirtyInfo} | Auth: ${loggedIn ? colors.success('● In') : colors.warning('○ Out')}`
        );

        const action = await p.select({
            message: 'Choose an action:',
            options: [
                { value: 'ai-prompt', label: '🧠 Ask Rool Agent (Code modification, tasks, questions)' },
                { value: 'conv-manage', label: '💬 Switch / Resume Conversation History' },
                { value: 'conv-new', label: '🔄 Start Fresh Conversation (Clear Context)' },
                { value: 'ai-review', label: '🔍 AI Code Review (Inspect current diff & changes)' },
                { value: 'ai-commit', label: '📝 AI Smart Commit (Analyze diff & generate commit)' },
                { value: 'git-status', label: '📊 Inspect Local Git Status' },
                { value: 'switch-workspace', label: '📂 Switch Active Folder / Repository' },
                { value: 'rool-machines', label: '🤖 List Rool Machines' },
                { value: 'auth-manage', label: loggedIn ? '🔒 Manage Rool Auth (Logout/Relogin)' : '🔑 Login to Rool' },
                { value: 'exit', label: '❌ Exit Session' },
            ],
        });

        if (p.isCancel(action) || action === 'exit') {
            p.outro(colors.muted('Goodbye! 👋'));
            process.exit(0);
        }

        switch (action) {
            case 'switch-workspace': {
                await promptOrConfirmWorkspace();
                break;
            }

            case 'ai-prompt': {
                const promptInput = await p.text({
                    message: 'What would you like Rool Agent to do?',
                    placeholder: 'e.g. Add a neat text logo to index.ts',
                });
                if (p.isCancel(promptInput) || !promptInput) break;

                try {
                    // 1. Scan repo & gather relevant files
                    const context = await collectContextForPrompt(promptInput as string);
                    const formattedContext = formatContextPayload(context.files);

                    // 2. Stream agent thinking & reply
                    const fullResponse = await runAgentTask(promptInput as string, formattedContext);

                    // 3. Extract any proposed file edits and prompt user to apply
                    const changes = extractFileChanges(fullResponse);
                    if (changes.length > 0) {
                        await promptAndApplyChanges(changes);
                    } else {
                        p.log.info(colors.muted('No file modifications were proposed in this response.'));
                    }
                } catch (e: any) {
                    p.log.error(e.message);
                }
                break;
            }

            case 'ai-review': {
                try {
                    await reviewCurrentChanges();
                } catch (e: any) {
                    p.log.error(e.message);
                }
                break;
            }

            case 'ai-commit': {
                try {
                    await generateSmartCommit();
                } catch (e: any) {
                    p.log.error(e.message);
                }
                break;
            }

            case 'git-status': {
                if (!status) {
                    p.log.error('Could not get repository status.');
                    break;
                }
                if (status.files.length === 0) {
                    p.log.success('Working tree clean.');
                } else {
                    p.log.info(colors.bold(`Modified files (${status.files.length}):`));
                    status.files.forEach((f) => p.log.step(`  ${f.working_dir || f.index} ${f.path}`));
                }
                break;
            }

            case 'conv-manage': {
                await manageConversations();
                break;
            }

            case 'conv-new': {
                startNewConversation();
                break;
            }

            case 'rool-machines': {
                try {
                    const client = await ensureAuthenticated();
                    const s = p.spinner();
                    s.start('Fetching machines...');
                    const machines = await client.listMachines();
                    s.stop(`Found ${machines.length} machine(s):`);
                    machines.forEach((m: any) => p.log.info(` • ${colors.primary(m.name || m.id)} [${colors.muted(m.id)}]`));
                } catch (e: any) {
                    p.log.error(e.message);
                }
                break;
            }

            case 'auth-manage': {
                if (!loggedIn) {
                    await ensureAuthenticated();
                    p.log.success('Logged in successfully!');
                } else {
                    const confirmLogout = await p.confirm({ message: 'Are you sure you want to log out?' });
                    if (confirmLogout && !p.isCancel(confirmLogout)) {
                        const { getAuth } = await import('./lib/auth.js');
                        await getAuth().logout();
                        p.log.success('Logged out.');
                    }
                }
                break;
            }
        }

        console.log('');
    }
}

if (process.argv.length <= 2) {
    startInteractiveSession().catch(console.error);
} else {
    program.parse(process.argv);
}
