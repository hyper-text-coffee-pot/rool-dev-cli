import Conf from 'conf';

export interface CliConfig {
    apiKey?: string;
    apiUrl?: string;
    userEmail?: string;
    activeMachineId?: string;       // <--- Add this
    activeConversationId?: string;  // <--- Add this
}

export const store = new Conf<CliConfig>({
    projectName: 'rool-dev-cli',
    defaults: {
        apiUrl: 'https://api.rool.dev',
    },
});

export function getAuth(): { apiKey?: string; userEmail?: string } {
    return {
        apiKey: store.get('apiKey'),
        userEmail: store.get('userEmail'),
    };
}

export function saveAuth(apiKey: string, userEmail?: string): void {
    store.set('apiKey', apiKey);
    if (userEmail) store.set('userEmail', userEmail);
}

export function clearAuth(): void {
    store.delete('apiKey');
    store.delete('userEmail');
    store.delete('activeMachineId');
    store.delete('activeConversationId');
}
