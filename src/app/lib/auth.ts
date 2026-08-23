import { RoolClient } from '@rool-dev/sdk';
import { NodeAuth } from '@rool-dev/sdk/node';

let authInstance: NodeAuth | null = null;
let clientInstance: RoolClient | null = null;

export function getAuth(): NodeAuth {
    if (!authInstance) {
        authInstance = new NodeAuth();
    }
    return authInstance;
}

/**
 * Initializes local auth state. Returns true if the user is already authenticated.
 */
export async function isUserLoggedIn(): Promise<boolean> {
    const auth = getAuth();
    return await auth.initialize();
}

/**
 * Ensures user is authenticated. If not, triggers the browser login flow.
 */
export async function ensureAuthenticated(appName = 'Rool Dev CLI'): Promise<RoolClient> {
    const auth = getAuth();
    const initialized = await auth.initialize();

    if (!initialized) {
        await auth.login(appName);
    }

    if (!clientInstance) {
        clientInstance = new RoolClient({
            getTokens: auth.getTokens.bind(auth),
            onAuthInvalidated: auth.logout.bind(auth),
        });
    }

    return clientInstance;
}

/**
 * Returns an existing RoolClient instance if authenticated, or null.
 */
export async function getClient(): Promise<RoolClient | null> {
    const loggedIn = await isUserLoggedIn();
    if (!loggedIn) return null;

    if (!clientInstance) {
        const auth = getAuth();
        clientInstance = new RoolClient({
            getTokens: auth.getTokens.bind(auth),
            onAuthInvalidated: auth.logout.bind(auth),
        });
    }

    return clientInstance;
}
