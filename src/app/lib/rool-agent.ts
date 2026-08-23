import * as p from '@clack/prompts';
import { RoolClient } from '@rool-dev/sdk';
import type { MachineRunEvent } from '@rool-dev/sdk';
import { ensureAuthenticated } from './auth.js';
import { store } from '../config.js';
import { colors } from '../ui/theme.js';

/**
 * Prompt user to select an active Rool Machine, caching the selection.
 */
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
 * Execute an agent task on the selected Rool Machine and stream results.
 */
export async function runAgentTask(promptText: string, contextPayload?: string): Promise<string> {
    const client = await ensureAuthenticated();
    const machineId = await getActiveMachine(client);
    const machine = client.machine(machineId);

    // 1. Get or list agents on the machine
    const agents = await machine.agents.list();
    const agent = agents.length > 0 ? agents[0] : await machine.agents.create('assistant', {
        system: 'You are a software engineering assistant helping the user develop applications via CLI.'
    });

    // 2. Create a conversation
    const conversation = await agent.createConversation({
        name: 'CLI Task Session',
        visibility: 'private',
    });

    const fullPrompt = contextPayload
        ? `${promptText}\n\n\`\`\`\n${contextPayload}\n\`\`\``
        : promptText;

    // 3. Send prompt
    await conversation.prompt(fullPrompt);

    // 4. Stream response to terminal
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

    console.log('\n'); // newline after streaming finishes
    return completeResponse;
}
