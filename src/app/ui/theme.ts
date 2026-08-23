import chalk from 'chalk';
import boxen from 'boxen';

export const colors = {
    primary: chalk.hex('#6366F1'),    // Indigo
    accent: chalk.hex('#EC4899'),     // Pink
    success: chalk.hex('#10B981'),    // Emerald
    warning: chalk.hex('#F59E0B'),    // Amber
    error: chalk.hex('#EF4444'),      // Red
    muted: chalk.hex('#6B7280'),      // Gray
    bold: chalk.bold,
};

export function banner(title: string, subtitle?: string): string {
    const content = `${colors.primary.bold(title)}${subtitle ? '\n' + colors.muted(subtitle) : ''
        }`;
    return boxen(content, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: '#6366F1',
    });
}
