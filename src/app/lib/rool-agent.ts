import * as p from '@clack/prompts';
import { RoolClient } from '@rool-dev/sdk';
import type { MachineRunEvent, MachineConversation } from '@rool-dev/sdk';
import { ensureAuthenticated } from './auth.js';
import { store } from '../config.js';
import { colors } from '../ui/theme.js';
import { getProjectOverview } from './context.js';

let activeConversation: MachineConversation | null = null;

export const AGENT_SYSTEM_PROMPT = `
You are an expert AI software engineer operating as the backend engine for a Developer CLI.
The user is running this CLI on their local machine.

CRITICAL CONTEXT RULES:
1. The codebase you are editing is on the user's local machine, provided in "[Workspace Code Context]".
2. DO NOT assume or inspect the cloud VM filesystem. The files provided in the prompt context represent the REAL and ONLY codebase.
3. When the user asks you to modify code, add features, fix bugs, or create new files, you MUST provide the complete, updated file content wrapped in this exact format:

<<<FILE: relative/path/to/file.ext>>>
// full updated file content here
<<<END_FILE>>>

Rules:
- Always output the FULL updated file contents between the <<<FILE: ...>>> tags so the CLI can reliably write it to disk.
- If multiple files need changes or new files need to be created, output multiple <<<FILE: ...>>> blocks.
- Output clean, modern code matching the user's TypeScript / ESM architecture.
`.trim();

/**
 * Get the cached active conversation ID for this project/machine
 */
export function getStoredConversationId(): string | undefined {
    return store.get('activeConversationId') as string | undefined;
}

/**
 * Clear the current active conversation to start fresh
 */
export function startNewConversation(): void {
    activeConversation = null;
    store.delete('activeConversationId');
    p.log.success('Started a new conversation session.');
}

/**
 * Start a new conversation with an optional custom name prompt
 */
export async function startNewConversationPrompt(agent: any): Promise<MachineConversation> {
    const sessionNameInput = await p.text({
        message: 'Enter a name for this new session (optional):',
        placeholder: 'e.g. Pixel Banner Refactor, Fix Auth Bug',
    });

    if (p.isCancel(sessionNameInput)) {
        throw new Error('Cancelled.');
    }

    const sessionName = (sessionNameInput as string)?.trim() ||
        `CLI Session (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

    const conv = await agent.createConversation({
        name: sessionName,
        visibility: 'private',
    });

    store.set('activeConversationId', conv.id);
    activeConversation = conv;
    p.log.success(`Created & switched to session: ${colors.accent(sessionName)}`);
    return conv;
}

/**
 * Rename the currently active conversation
 */
export async function renameActiveSession(): Promise<void> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    const savedId = getStoredConversationId();
    if (!savedId) {
        p.log.warn('No active conversation to rename. Start or select one first.');
        return;
    }

    const agents = await machine.agents.list();
    const agent = agents.length > 0
        ? agents[0]
        : await machine.agents.create('assistant', { system: AGENT_SYSTEM_PROMPT });

    const conversation = agent.conversation(savedId);

    const newName = await p.text({
        message: 'Enter new session name:',
        placeholder: 'e.g. Feature: Git Automation',
        validate: (val) => (!val || !val.trim() ? 'Name cannot be empty.' : undefined),
    });

    if (p.isCancel(newName) || !newName) return;

    const s = p.spinner();
    s.start('Renaming session in Rool...');
    try {
        await conversation.rename(newName.trim());
        s.stop(`Session renamed to: ${colors.accent(newName.trim())}`);
    } catch (err: any) {
        s.stop('Failed to rename session.');
        p.log.error(err.message);
    }
}

/**
 * Pick, switch, rename, or delete conversations from the Rool Machine
 */
export async function manageConversations(): Promise<void> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    const agents = await machine.agents.list();
    const agent = agents.length > 0
        ? agents[0]
        : await machine.agents.create('assistant', { system: AGENT_SYSTEM_PROMPT });

    const s = p.spinner();
    s.start('Fetching conversations from Rool...');
    const conversations = await agent.listConversations();
    s.stop(`Found ${conversations.length} conversation(s).`);

    const currentId = getStoredConversationId();

    const choice = await p.select({
        message: 'Select conversation session:',
        options: [
            { value: '__NEW__', label: '➕ Start a brand new named conversation' },
            ...conversations.map((c: any) => ({
                value: c.id,
                label: `${c.name || 'Untitled session'} (${colors.muted(c.id)})${c.id === currentId ? colors.success(' [ACTIVE]') : ''}`,
            })),
        ],
    });

    if (p.isCancel(choice)) return;

    if (choice === '__NEW__') {
        try {
            await startNewConversationPrompt(agent);
        } catch { }
        return;
    }

    const selectedConvId = choice as string;
    const selectedConv = agent.conversation(selectedConvId);

    const actionChoice = await p.select({
        message: `Manage session [${colors.accent(selectedConvId)}]:`,
        options: [
            { value: 'resume', label: '▶️  Resume this session' },
            { value: 'rename', label: '✏️  Rename this session' },
            { value: 'delete', label: '🗑️  Delete this session' },
        ],
    });

    if (p.isCancel(actionChoice)) return;

    if (actionChoice === 'resume') {
        store.set('activeConversationId', selectedConvId);
        activeConversation = selectedConv;
        p.log.success(`Resumed conversation: ${colors.accent(selectedConvId)}`);
    } else if (actionChoice === 'rename') {
        const newName = await p.text({
            message: 'Enter new name:',
            validate: (v) => (!v || !v.trim() ? 'Name cannot be empty' : undefined),
        });
        if (!p.isCancel(newName) && newName) {
            await selectedConv.rename(newName.trim());
            p.log.success(`Renamed to "${newName.trim()}"`);
        }
    } else if (actionChoice === 'delete') {
        const confirm = await p.confirm({ message: 'Are you sure you want to delete this session?' });
        if (confirm && !p.isCancel(confirm)) {
            await selectedConv.delete();
            if (currentId === selectedConvId) {
                store.delete('activeConversationId');
                activeConversation = null;
            }
            p.log.success('Session deleted.');
        }
    }
}

export async function getActiveMachine(client: RoolClient): Promise<string> {
    const cached = store.get('activeMachineId');
    if (cached) return cached as string;

    const s = p.spinner();
    s.start('Fetching your Rool Machines...');
    const machines = await client.listMachines();
    s.stop('Machines loaded.');

    if (!machines || machines.length === 0) {
        throw new Error('No Rool Machines found. Create one in your Rool Workspace first.');
    }

    const selected = await p.select({
        message: 'Select a Rool Machine to connect to:',
        options: machines.map((m: any) => ({
            value: m.id,
            label: `${m.name || m.id} (${m.id})`,
        })),
    });

    if (p.isCancel(selected)) {
        throw new Error('Machine selection cancelled.');
    }

    store.set('activeMachineId', selected);
    return selected as string;
}

/**
 * Get or resume conversation handle
 */
async function getOrCreateConversation(agent: any): Promise<MachineConversation> {
    if (activeConversation) {
        return activeConversation;
    }

    const savedId = getStoredConversationId();
    if (savedId) {
        try {
            const conv = agent.conversation(savedId);
            activeConversation = conv;
            return conv;
        } catch {
            store.delete('activeConversationId');
        }
    }

    // Create new session if none exists
    const conv = await agent.createConversation({
        name: `CLI Session (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        visibility: 'private',
    });

    store.set('activeConversationId', conv.id);
    activeConversation = conv;
    return conv;
}

/**
 * Execute or continue conversation with Rool Mind
 */
export async function runAgentTask(promptText: string, contextPayload?: string): Promise<string> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    const agents = await machine.agents.list();
    const agent = agents.length > 0
        ? agents[0]
        : await machine.agents.create('assistant', { system: AGENT_SYSTEM_PROMPT });

    const conversation = await getOrCreateConversation(agent);
    const projectOverview = await getProjectOverview();

    const formattedPrompt = [
        `[System Instructions]`,
        AGENT_SYSTEM_PROMPT,
        `\n[Project Architecture & File Tree]`,
        projectOverview,
        `\n[User Task]`,
        promptText,
        contextPayload ? `\n[Workspace Code Context]\n${contextPayload}` : '',
    ].filter(Boolean).join('\n\n');

    // Send prompt
    await conversation.prompt(formattedPrompt);

    let completeResponse = '';
    const s = p.spinner();
    s.start(colors.primary('Rool Mind thinking...'));

    let firstDelta = true;
    await conversation.follow({
        onEvent: (event: MachineRunEvent) => {
            if (event.type === 'output.delta' && event.content.type === 'text') {
                if (firstDelta) {
                    s.stop(colors.success('Responding:'));
                    firstDelta = false;
                }
                process.stdout.write(event.content.text);
                completeResponse += event.content.text;
            }
        },
    });

    // Fallback: If streaming didn't catch everything, fetch the latest turn's content directly
    try {
        const turns = await conversation.listTurns();
        if (turns && turns.length > 0) {
            const lastTurn = turns[turns.length - 1];
            const content = lastTurn.content as unknown;
            if (lastTurn.role === 'assistant' && typeof content === 'string' && content.length > completeResponse.length) {
                completeResponse = content;
            }
        }
    } catch { }

    console.log('\n');
    return completeResponse;
}
