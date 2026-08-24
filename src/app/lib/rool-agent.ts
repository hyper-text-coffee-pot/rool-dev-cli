import * as p from '@clack/prompts';
import { randomUUID } from 'node:crypto';
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

Mode behavior:
- If ACTIVE MODE is "ask": Answer the user's question clearly and helpfully.
  Do NOT propose code edits and do NOT use the file-writing tag format described below.
- If ACTIVE MODE is "plan": Provide a step-by-step implementation plan, file-by-file
  outline of what changes are needed, trade-offs, ordering. Do NOT use the file-writing tag format described below.
- If ACTIVE MODE is "write": You MAY modify, add features, fix bugs, or create files,
  using the one-time file-writing tag format given to you separately in the
  "[FILE WRITE FORMAT]" section of this request. That format is randomly generated
  per request specifically so it cannot collide with tag-like text that may already
  exist inside a file you are editing (for example, this very prompt's own
  instructions, if you are asked to modify this CLI's own source code).

Rules:
- Always output the FULL updated file contents wrapped exactly as instructed in "[FILE WRITE FORMAT]".
- Never fabricate your own tag syntax, and never reuse a tag from a previous turn — always use
  the exact one-time tags supplied in the current request's "[FILE WRITE FORMAT]" section.
- If a file is large, still emit the complete contents — do not summarize, abbreviate, or use "// ... unchanged" placeholders.
- If multiple files need changes or new files need to be created, wrap each one separately using the same one-time tags.
- Output clean, modern code matching the user's TypeScript / ESM architecture.
- CRITICAL: Preserve the existing file byte-for-byte outside of the specific lines needed for the
  requested change. Do NOT reformat, reindent, reorder imports/members, change quote style, or
  touch whitespace/blank lines/comments elsewhere in the file "as a drive-by cleanup" — every
  incidental change makes the diff harder to review and increases risk. Only touch what the task requires.
`.trim();

export interface AccountUsage {
    plan: string;
    creditsBalance: number;
    totalCreditsUsed: number;
}

/**
 * Structured-output schema for "write" mode. If the backend honors `responseSchema`,
 * the model's reply arrives as a validated JSON object instead of free text wrapped in
 * homemade tags — sidestepping truncation/nested-delimiter parsing entirely. We still
 * keep the tag-based format in the prompt as a fallback in case this isn't honored.
 */
const FILE_EDIT_RESPONSE_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        summary: {
            type: 'string',
            description: 'A short, human-readable explanation of the changes, for display in a CLI.',
        },
        files: {
            type: 'array',
            description:
                'Every file being created or modified. Each entry holds the COMPLETE, updated file contents. ' +
                'Preserve the original file byte-for-byte outside the lines the task actually requires changing ' +
                '— no incidental reformatting, reordering, or whitespace/quote-style drive-by cleanups.',
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path relative to the project root, e.g. src/app/index.ts' },
                    content: { type: 'string', description: 'The full, complete file contents after the change.' },
                },
                required: ['path', 'content'],
                additionalProperties: false,
            },
        },
    },
    required: ['summary', 'files'],
    additionalProperties: false,
};

function parseStructuredFileEdits(value: unknown): { summary?: string; files: { path: string; content: string }[] } | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (!Array.isArray(obj.files)) return null;

    const files = obj.files.filter(
        (f: any): f is { path: string; content: string } => f && typeof f.path === 'string' && typeof f.content === 'string',
    );
    if (files.length === 0) return null;

    return { summary: typeof obj.summary === 'string' ? obj.summary : undefined, files };
}

/**
 * Fetch the current account's plan + credit balance for usage tracking in the CLI.
 * Returns null if it can't be fetched (e.g. not authenticated, offline).
 */
export async function getAccountUsage(): Promise<AccountUsage | null> {
    try {
        const client = await ensureAuthenticated();
        const account = await client.getAccount();
        return {
            plan: account.plan,
            creditsBalance: account.creditsBalance,
            totalCreditsUsed: account.totalCreditsUsed,
        };
    } catch {
        return null;
    }
}

/**
 * Get the cached active conversation ID for this project/machine
 */
export function getStoredConversationId(): string | undefined {
    return store.get('activeConversationId') as string | undefined;
}

/**
 * Retrieve metadata for the currently stored active session (if any).
 */
export async function getStoredConversation(): Promise<{ id: string; name?: string } | null> {
    const savedId = getStoredConversationId();
    if (!savedId) return null;

    try {
        const client = await ensureAuthenticated();
        const machineId = await getActiveMachine(client);
        const machine = client.machine(machineId);

        const agents = await machine.agents.list();
        if (!agents || agents.length === 0) return { id: savedId };

        const agent = agents[0];
        const conversations = await agent.listConversations();
        const found = conversations.find((c: any) => c.id === savedId);

        return {
            id: savedId,
            name: found?.name,
        };
    } catch {
        return { id: savedId };
    }
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
            { value: 'rename', label: '✏️  Rename this session' }
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
export async function runAgentTask(
    promptText: string,
    contextPayload?: string,
    options?: { mode?: 'agent' | 'ask' | 'plan' },
): Promise<{ text: string; fileTagNonce: string; structuredFiles: { path: string; content: string }[] | null; structuredSummary?: string }> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    const agents = await machine.agents.list();
    const agent = agents.length > 0
        ? agents[0]
        : await machine.agents.create('assistant', { system: AGENT_SYSTEM_PROMPT });

    const conversation = await getOrCreateConversation(agent);
    const projectOverview = await getProjectOverview();
    const activeMode = options?.mode === 'agent' ? 'write' : (options?.mode ?? 'write');

    // Generated fresh per request so it can never collide with tag-like text that
    // already exists inside a file being edited (e.g. this file's own instructions).
    const fileTagNonce = randomUUID().slice(0, 8);
    const fileWriteFormat = activeMode === 'write'
        ? [
            `[FILE WRITE FORMAT]`,
            `Wrap each complete, updated file EXACTLY like this, using this one-time tag (only valid for this request):`,
            `<<<FILE:${fileTagNonce}: relative/path/to/file.ts>>>`,
            `(full file contents here)`,
            `<<<END_FILE:${fileTagNonce}>>>`,
            `You MUST close every block with the exact <<<END_FILE:${fileTagNonce}>>> tag on its own line — a block missing it is treated as truncated and discarded, never written to disk.`,
        ].join('\n')
        : '';

    const formattedPrompt = [
        `[System Instructions]`,
        AGENT_SYSTEM_PROMPT,
        `\n[ACTIVE MODE]`,
        activeMode,
        fileWriteFormat ? `\n${fileWriteFormat}` : '',
        `\n[Project Architecture & File Tree]`,
        projectOverview,
        `\n[User Task]`,
        promptText,
        contextPayload ? `\n[Workspace Code Context]\n${contextPayload}` : '',
    ].filter(Boolean).join('\n\n');

    // Send prompt — in write mode, also ask for schema-validated structured output as a
    // more reliable alternative to the text-tag format (see FILE_EDIT_RESPONSE_SCHEMA).
    await conversation.prompt(
        formattedPrompt,
        activeMode === 'write' ? { responseSchema: FILE_EDIT_RESPONSE_SCHEMA } : undefined,
    );

    let completeResponse = '';
    let jsonValue: unknown = null;
    let finishReason: string | undefined;
    let streamError: string | undefined;
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
            } else if (event.type === 'output.delta' && event.content.type === 'json') {
                jsonValue = event.content.value;
            } else if (event.type === 'completed') {
                finishReason = event.finish;
            } else if (event.type === 'error') {
                streamError = event.detail;
            } else if (event.type === 'cancelled') {
                finishReason = 'cancelled';
            }
        },
    });

    if (firstDelta) {
        s.stop(jsonValue ? colors.success('Responding:') : colors.error('No response received.'));
    }

    // The run did not finish cleanly (hit the model's output token limit, errored,
    // was cancelled, or blocked). The buffered text is a partial/truncated file, not
    // a complete one — surface this loudly instead of letting callers treat it as final.
    if (streamError) {
        throw new Error(`Rool Mind stream failed: ${streamError}`);
    }
    if (finishReason && finishReason !== 'stop' && finishReason !== 'tool_calls') {
        const reasonMessages: Record<string, string> = {
            length: 'the response was truncated because it hit the model\'s max output length',
            cancelled: 'the response was cancelled before it finished',
            safety: 'the response was blocked by a safety filter',
            credits: 'the response stopped because the account ran out of credits',
            error: 'the response ended in an error',
        };
        p.log.warn(colors.error(
            `Response is incomplete: ${reasonMessages[finishReason] ?? finishReason}. ` +
            `Any proposed file changes are likely truncated and will NOT be applied.`,
        ));
        throw new Error(`Incomplete response (finish reason: ${finishReason}). Refusing to treat partial output as a complete file.`);
    }

    // Fallback: If streaming didn't catch everything, fetch the latest turn's content directly.
    // `content` is always an array of content parts (never a plain string), so scan it for
    // whichever parts we're missing rather than assuming a single string blob.
    try {
        const turns = await conversation.listTurns();
        if (turns && turns.length > 0) {
            const lastTurn = turns[turns.length - 1];
            if (lastTurn.role === 'assistant') {
                for (const part of lastTurn.content) {
                    if (part.type === 'text' && part.text.length > completeResponse.length) {
                        completeResponse = part.text;
                    } else if (part.type === 'json' && !jsonValue) {
                        jsonValue = part.value;
                    }
                }
            }
        }
    } catch { }

    const structured = parseStructuredFileEdits(jsonValue);

    console.log('\n');
    return {
        text: completeResponse,
        fileTagNonce,
        structuredFiles: structured?.files ?? null,
        structuredSummary: structured?.summary,
    };
}
