// ============================================================
// src/app/lib/pixel-banner.ts
//
// Renders the CLI startup banner as a blocky 5x5 pixel-map built
// from block characters. No external font assets required.
// Case is preserved on render, so lowercase glyphs render as
// lowercase (used for the "rool" wordmark).
// ============================================================
import chalk from 'chalk';

/**
 * Each glyph is a 5x5 bitmap: 5 strings, each exactly 5 characters,
 * where "█" is an "on" pixel and a space is "off".
 * Both uppercase and lowercase variants are provided for the glyphs
 * the wordmark uses; any missing character falls back to a blank space.
 */
const PIXEL_FONT: Record<string, string[]> = {
    // Uppercase
    R: ['█████', '█   █', '█████', '█  █ ', '█   █'],
    O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
    L: ['█    ', '█    ', '█    ', '█    ', '█████'],
    D: ['████ ', '█   █', '█   █', '█   █', '████ '],
    E: ['█████', '█    ', '████ ', '█    ', '█████'],
    V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
    C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
    I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],

    // Lowercase — used by the "rool dev cli" wordmark.
    r: ['███  ', '█  █ ', '█    ', '█    ', '█    '],
    o: [' ██  ', '█  █ ', '█  █ ', '█  █ ', ' ██  '],
    l: ['  █  ', '  █  ', '  █  ', '  █  ', '█████'],
    d: ['   █ ', '   █ ', ' ███ ', '█  █ ', ' ███ '],
    e: [' ███ ', '█    ', '█████', '█    ', ' ███ '],
    v: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
    c: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
    i: [' ██  ', '     ', '  █  ', '  █  ', '  █  '],

    ' ': ['     ', '     ', '     ', '     ', '     '],
};

/** Resolve a single character to its five bitmap rows (case preserved; default: space). */
function rowsFor(ch: string): string[] {
    return PIXEL_FONT[ch] ?? PIXEL_FONT[' '];
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
 * Builds the full startup banner: `title` rendered as a two-tone
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
