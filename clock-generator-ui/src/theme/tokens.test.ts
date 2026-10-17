import { describe, expect, it } from 'vitest';
import { AA, contrastRatio } from './contrast';
import { CONTROL, ROLE, SURFACE, TEXT, TOKEN_PAIRS, tokenPairsFor } from './tokens';

const has = (fg: string, bg: string) => TOKEN_PAIRS.some(pair => pair.fg === fg && pair.bg === bg);

describe('TOKEN_PAIRS', () => {
    it.each((['dark', 'light'] as const).flatMap(mode => tokenPairsFor(mode).map(pair => [`${mode}: ${pair.name}`, pair] as const)))('%s meets WCAG 2.2 AA', (_, pair) => {
        const ratio = contrastRatio(pair.fg, pair.bg);
        const needed = pair.kind === 'text' ? AA.text : AA.nonText;
        expect(ratio, `${pair.name}: ${ratio.toFixed(2)}:1, needs ${needed}:1`).toBeGreaterThanOrEqual(needed);
    });

    it('has primary and secondary text on every surface', () => {
        for (const surface of Object.values(SURFACE)) {
            expect(has(TEXT.primary, surface), surface).toBe(true);
            expect(has(TEXT.secondary, surface), surface).toBe(true);
        }
    });

    it('has each role\'s text on its main, dark and light shade, and its fill against a card', () => {
        for (const [role, { main, dark, light, on }] of Object.entries(ROLE)) {
            expect(has(on, main), `${role} main`).toBe(true);
            expect(has(on, dark), `${role} dark`).toBe(true);
            expect(has(on, light), `${role} light`).toBe(true);
            expect(TOKEN_PAIRS.some(pair => pair.fg === main && pair.bg === SURFACE.panel && pair.kind === 'nonText'), `${role} fill`).toBe(true);
        }
    });

    it('never puts green or red text straight on the page (the placement rule)', () => {
        const onPage = TOKEN_PAIRS.filter(pair => pair.kind === 'text' && pair.bg === SURFACE.page);
        expect(onPage.length).toBeGreaterThan(0);
        for (const pair of onPage) {
            expect([ROLE.green.main, ROLE.red.main], pair.name).not.toContain(pair.fg);
        }
    });

    it('measures the control lines and the focus ring on every surface', () => {
        for (const surface of Object.values(SURFACE)) {
            expect(has(CONTROL.border, surface), surface).toBe(true);
            expect(has(CONTROL.trackOff, surface), surface).toBe(true);
            expect(has(CONTROL.focus, surface), surface).toBe(true);
        }
    });
});
