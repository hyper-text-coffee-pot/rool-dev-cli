// ============================================================
// src/app/lib/pixel-banner.ts
//
// Renders the CLI startup banner as a blocky 5x5 pixel-map built
// from block characters. No external font assets required.
// ============================================================
import chalk from 'chalk';

/**
 * Each glyph is a 5x5 bitmap: 5 strings, each exactly 5 characters,
 * where "█" is an "on" pixel and a space is "off".
 * Fonts defined only for the glyphs we need (ROOLDEVCLI + space);
 * unknown characters fall back to a blank space.
 */
const PIXEL_FONT: Record<string, string[]> = {
    R: ['█████', '█   █', '█   █', '█   █', '██  █'],
    O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
    L: ['█    ', '█    ', '█    ', '█    ', '█████'],
    D: ['████ ', '█   █', '█   █', '█   █', '████ '],
    E: ['█████', '█    ', '████ ', '█    ', '█████'],
    V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
    C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
    I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
    ' ': ['     ', '     ', '     ', '     ', '     '],
};

/** Resolve a single character to its five bitmap rows (default: space). */
function rowsFor(ch: string): string[] {
    return PIXEL_FONT[ch.toUpperCase()] ?? PIXEL_FONT[' '];
}

/**
 * Render `text` as a blocky pixel matrix (always 5 rows tall).
 * Glyphs are joined horizontally with a single-space gap for definition.
 */
export function render(text: string): string[] {
    const glyphs = [...text].map(rowsFor);
    const rows: string[] = [];
    for (let r = 0; r < 5; r++) {
        rows.push(glyphs.map((g) => g[r]).join(' '));
    }
    return rows;
}

/**
 * Boils the full startup banner: `title` rendered as a two-tone
 * pixel-map with `subtitle` centered beneath it.
 */
export function pixelBanner(title: string, subtitle: string): string {
    const rows = render(title);
    const titleWidth = Math.max(...rows.map((r) => r.length));

    // Alternate a bold bright tone and a deeper tone for a retro LED look.
    const block = rows
        .map((row, i) => (i % 2 === 0 ? chalk.bold.cyan(row) : chalk.blueBright(row)))
        .join('\n');

    const subtitleLine = subtitle.padStart(Math.floor((titleWidth + subtitle.length) / 2));

    return ['', block, '', chalk.gray(subtitleLine), ''].join('\n');
}
