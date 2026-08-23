import { Command } from 'commander';
import * as p from '@clack/prompts';
import { colors, banner } from '../ui/theme.js';
import { getAuth, ensureAuthenticated, isUserLoggedIn } from '../lib/auth.js';

export const authCommand = new Command('auth').description('Manage Rool authentication');

authCommand
    .command('login')
    .description('Sign in to Rool via browser')
    .action(async () => {
        console.log(banner('Rool CLI', 'Browser Authentication'));

        p.intro(colors.primary('Authenticating with Rool'));

        const isAlreadyLoggedIn = await isUserLoggedIn();
        if (isAlreadyLoggedIn) {
            p.outro(colors.success('You are already authenticated with Rool!'));
            return;
        }

        const spinner = p.spinner();
        spinner.start('Opening browser for authentication...');

        try {
            await ensureAuthenticated('Rool Dev CLI');
            spinner.stop('Browser authorization successful!');
            p.outro(colors.success('Successfully logged in!'));
        } catch (err: any) {
            spinner.stop('Authentication failed.');
            p.outro(colors.error(`Login error: ${err?.message || err}`));
        }
    });

authCommand
    .command('logout')
    .description('Sign out and remove local Rool session')
    .action(async () => {
        const auth = getAuth();
        await auth.logout();
        p.outro(colors.success('Successfully logged out of Rool.'));
    });

authCommand
    .command('status')
    .description('Check current authentication status')
    .action(async () => {
        const loggedIn = await isUserLoggedIn();
        if (loggedIn) {
            console.log(colors.success('✓ Authenticated with Rool'));
        } else {
            console.log(colors.warning('✗ Not authenticated. Run `rool-dev auth login` to sign in.'));
        }
    });
