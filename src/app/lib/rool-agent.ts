import * as p from '@clack/prompts';
import { RoolClient } from '@rool-dev/sdk';
import type { MachineRunEvent, MachineConversation } from '@rool-dev/sdk';
import { ensureAuthenticated } from './auth.js';
import { store } from '../config.js';
import { colors } from '../ui/theme.js';

// Cache the active conversation across turns during this CLI session
let activeConversation: MachineConversation | null = null;

export const AGENT_SYSTEM_PROMPT = `
You are an expert AI software engineer operating as the backend engine for a Developer CLI.
When the user asks you to modify code, add features, fix bugs, or create new files, you MUST provide the complete, updated file content wrapped in this exact format:

<<<FILE: relative/path/to/file.ext>>>
// full updated file content here
<<<END_FILE>>>

Rules:
1. Always output the FULL updated file contents between the <<<FILE: ...>>> tags so the CLI can reliably write it to disk.
2. If multiple files need changes or new files need to be created, output multiple <<<FILE: ...>>> blocks.
3. Before or after the file blocks, provide a concise summary explaining what you changed and why.
4. Maintain existing code style, imports, and architecture.
`.trim();

/**
 * Reset conversation if user wants a clean slate
 */
export function resetConversation(): void {
    activeConversation = null;
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
 * Execute or continue a conversation with Rool Agent with persistent multi-turn memory.
 */
export async function runAgentTask(promptText: string, contextPayload?: string): Promise<string> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    // 1. Reuse existing conversation or create a new one if this is turn 1
    if (!activeConversation) {
        const agents = await machine.agents.list();
        const agent = agents.length > 0
            ? agents[0]
            : await machine.agents.create('assistant', { system: AGENT_SYSTEM_PROMPT });

        activeConversation = await agent.createConversation({
            name: `CLI Session (${new Date().toLocaleTimeString()})`,
            visibility: 'private',
        });
    }

    // 2. Format prompt
    const isFirstTurn = true; // or track turns
    const formattedPrompt = [
        `[System Instructions]`,
        AGENT_SYSTEM_PROMPT,
        `\n[User Task]`,
        promptText,
        contextPayload ? `\n[Workspace Code Context]\n${contextPayload}` : '',
    ].filter(Boolean).join('\n\n');

    // 3. Send prompt to the continuous conversation
    await activeConversation.prompt(formattedPrompt);

    // 4. Stream response to terminal
    let completeResponse = '';
    const s = p.spinner();
    s.start(colors.primary('Rool Mind thinking...'));

    let firstDelta = true;
    await activeConversation.follow({
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

    console.log('\n');
    return completeResponse;
}
