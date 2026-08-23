import { Command } from 'commander';
import * as p from '@clack/prompts';
import { colors, panel } from './ui/theme.js';
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
    getStoredConversation,
    getAccountUsage,
    type AccountUsage,
} from './lib/rool-agent.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewCurrentChanges, generateSmartCommit } from './lib/git-ai.js';
import { collectContextForPrompt, expandAtReferences, formatContextPayload } from './lib/context.js';
import { extractFileChanges, promptAndApplyChanges } from './lib/patcher.js';

const program = new Command();

program
    .name('rool-dev')
    .description('Rool Developer CLI — interactive workspace & code automation tool')
    .version('0.1.0');

program.addCommand(authCommand);
program.addCommand(gitCommand);

/**
 * At startup, if a conversation was stored from a previous run, ask the
 * user to resume it, pick another, or clear it and start fresh. Shows the
 * last session's name so it's clear which one would be continued.
 */
async function offerSessionResume(): Promise<void> {
    const stored = await getStoredConversation();
    if (!stored) return; // nothing cached to resume

    const nameLabel = stored.name ? colors.accent(stored.name) : colors.muted(stored.id);

    const choice = await p.select({
        message: `A previous session (${nameLabel}) was found. What would you like to do?`,
        options: [
            { value: 'resume', label: `▶️  Resume "${stored.name || 'last used session'}"` },
            { value: 'select', label: '🧭 Pick a different session' },
            { value: 'new', label: '🔄 Start a new session (clear memory)' },
        ],
    });

    if (p.isCancel(choice)) return;

    if (choice === 'resume') {
        p.log.success(`OK — resuming "${stored.name || 'last used session'}".`);
    } else if (choice === 'new') {
        startNewConversation();
    } else if (choice === 'select') {
        try {
            await manageConversations();
        } catch (e: any) {
            p.log.error(e.message);
        }
    }
}

/**
 * Print a short usage/credits line after an AI call completes, showing credits
 * consumed since `before` (captured at the top of this loop iteration) if available.
 */
async function printUsageFooter(before: AccountUsage | null): Promise<void> {
    const after = await getAccountUsage();
    if (!after) return;

    if (before) {
        const used = Math.max(0, before.creditsBalance - after.creditsBalance);
        p.log.info(colors.muted(
            `⚡ ${used.toLocaleString()} credit(s) used this call · ${after.creditsBalance.toLocaleString()} remaining (${after.plan})`,
        ));
    } else {
        p.log.info(colors.muted(`⚡ ${after.creditsBalance.toLocaleString()} credits remaining (${after.plan})`));
    }
}

async function startInteractiveSession() {
    console.clear();
    console.log(pixelBanner('rOOL DEV CLI', 'Interactive Workspace & Automation Shell'));

    // 1. Always verify / select active workspace first
    await promptOrConfirmWorkspace();

    // 2. Offer to resume / select / clear any previously stored session
    await offerSessionResume();

    // 3. Main interactive loop
    while (true) {
        const loggedIn = await isUserLoggedIn();
        const branch = await getCurrentBranch().catch(() => 'unknown');
        const status = await getRepoStatus().catch(() => null);
        const usage = await getAccountUsage();

        const dirtyInfo = status && status.files.length > 0
            ? colors.warning(`(${status.files.length} modified)`)
            : colors.success('(clean)');
        const creditsLabel = usage
            ? colors.primary(`⚡ ${usage.creditsBalance.toLocaleString()} cr`)
            : colors.muted('⚡ usage unavailable');

        p.intro(
            `Workspace: ${colors.accent(process.cwd())}\n` +
            `Branch: ${colors.primary(branch)} ${dirtyInfo} | Auth: ${loggedIn ? colors.success('● In') : colors.warning('○ Out')} | ${creditsLabel}`
        );

        const action = await p.select({
            message: 'Choose an action:',
            options: [
                { value: 'ai-prompt', label: '🧠 Ask Rool (Code modification, tasks, questions)' },
                { value: 'ai-review', label: '🔍 AI Code Review (Inspect current diff & changes)' },
                { value: 'ai-commit', label: '📝 AI Smart Commit (Analyze diff & generate commit)' },
                { value: 'usage', label: '📊 Usage & Balance' },
                { value: 'git-status', label: '📊 Inspect Local Git Status' },
                { value: 'session-manage', label: '🧭 Resume / Select a conversation session' },
                { value: 'new-chat', label: '🔄 New Conversation (Clear Memory)' },
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

            case 'session-manage': {
                try {
                    await manageConversations();
                } catch (e: any) {
                    p.log.error(e.message);
                }
                break;
            }

            case 'new-chat': {
                startNewConversation();
                break;
            }

            case 'ai-prompt': {
                const promptInput = await p.text({
                    message: 'What would you like Rool Agent to do?',
                    placeholder: 'agent: <make changes> | ask: <question> | plan: <steps> (or @file/folder)',
                });
                if (p.isCancel(promptInput) || !promptInput) break;

                // --- Mode Detection (defaults to 'agent' / write mode) ---
                let mode: 'agent' | 'ask' | 'plan' = 'agent';
                let rawText = (promptInput as string).trim();
                const modeMatch = rawText.match(/^(agent|ask|plan):/i);
                if (modeMatch) {
                    mode = modeMatch[1].toLowerCase() as 'agent' | 'ask' | 'plan';
                    rawText = rawText.slice(modeMatch[0].length).trim();
                }

                try {
                    // 1. Expand explicit @-references (files + folders) with FRESH content
                    const { prompt: cleanPrompt, files: atFiles } = await expandAtReferences(rawText);

                    // 2. Scan remaining free-text mentions for other relevant files
                    const detection = await collectContextForPrompt(cleanPrompt);
                    const indexedFiles = detection.files ?? [];

                    // 3. Deduplicate and merge files
                    const mergedMap = new Map<string, { path: string; content: string }>();
                    for (const f of [...indexedFiles, ...atFiles]) {
                        mergedMap.set(f.path, f);
                    }

                    // 4. Force-reload every file to guarantee LIVE on-disk content
                    const liveFiles = Array.from(mergedMap.values()).map((f) => {
                        const abs = resolve(process.cwd(), f.path);
                        try {
                            return { path: f.path, content: readFileSync(abs, 'utf-8') };
                        } catch {
                            return f;
                        }
                    });
                    const formattedContext = formatContextPayload(liveFiles);

                    // 5. Stream agent reply (passes mode to the agent)
                    const { text: fullResponse, fileTagNonce } = await runAgentTask(cleanPrompt, formattedContext, { mode });

                    // 6. Only attempt file edits if in 'agent' (write) mode
                    if (mode === 'agent') {
                        const changes = extractFileChanges(fullResponse, process.cwd(), fileTagNonce);
                        if (changes.length > 0) {
                            await promptAndApplyChanges(changes);
                        } else {
                            p.log.info(colors.muted('No file modifications were proposed in this response.'));
                        }
                    } else {
                        p.log.info(colors.muted(`[${mode.toUpperCase()} mode] Completed without disk modifications.`));
                    }
                } catch (e: any) {
                    p.log.error(e.message);
                }
                await printUsageFooter(usage);
                break;
            }

            case 'ai-review': {
                try {
                    await reviewCurrentChanges();
                } catch (e: any) {
                    p.log.error(e.message);
                }
                await printUsageFooter(usage);
                break;
            }

            case 'ai-commit': {
                try {
                    await generateSmartCommit();
                } catch (e: any) {
                    p.log.error(e.message);
                }
                await printUsageFooter(usage);
                break;
            }

            case 'usage': {
                const s = p.spinner();
                s.start('Fetching usage & balance...');
                const live = await getAccountUsage();
                if (!live) {
                    s.stop('Could not fetch usage.');
                    p.log.error('Failed to retrieve account usage — check your connection or login status.');
                    break;
                }
                s.stop('Usage loaded.');
                console.log(panel('📊 Usage & Balance', [
                    `${colors.bold('Plan:')}                ${colors.primary(live.plan)}`,
                    `${colors.bold('Credits remaining:')}   ${colors.success(live.creditsBalance.toLocaleString())}`,
                    `${colors.bold('Total credits used:')}  ${colors.muted(live.totalCreditsUsed.toLocaleString())}`,
                ]));
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

            case 'rool-machines': {
                try {
                    const client = await ensureAuthenticated();
                    const s = p.spinner();
                    s.start('Fetching machines...');
                    const machines = await client.listMachines();
                    s.stop(`Found ${machines.length} machine(s):`);
                    machines.forEach((m: any) => p.log.info(`  ${colors.primary(m.name || m.id)} [${colors.muted(m.id)}]`));
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
