import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OverridesForm } from './OverridesForm';

function markup() {
    return renderToStaticMarkup(createElement(OverridesForm, { expanded: true, onExpandedChange: vi.fn(), setCount: 1,
        useFractionalSwings: true, searchForFewerWakeUps: false, onUpdate: vi.fn() }));
}

describe('Advanced input accessibility', () => {
    it('preserves switch semantics when MUI input slots receive persistent descriptions', () => {
        const html = markup();
        const switches = html.match(/<input\b[^>]*role="switch"[^>]*>/g) ?? [];
        expect(switches).toHaveLength(2);
        expect(switches.filter(input => /checked=""/.test(input))).toHaveLength(1);
        for (const input of switches) {
            const id = /aria-describedby="([^"]+)"/.exec(input)?.[1];
            expect(id).toBeTruthy(); expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('Spread fractional swings over multiple crafting cycles.');
        expect(html).toContain('Search even when a clock already holds the rate; generation takes longer.');
    });
    it('labels the actual output input and exposes descriptions before a help dialog opens', () => {
        const html = markup(), id = /<label\b[^>]*for="([^"]+)"[^>]*>Force Output Swings<\/label>/.exec(html)?.[1];
        expect(id).toBeTruthy();
        const input = (html.match(/<input\b[^>]*>/g) ?? []).find(input => input.includes(`id="${id}"`));
        expect(input).toContain('type="number"'); expect(input).toContain('aria-describedby=');
        expect(html).toContain('Total output swings per crafting cycle of each output machine');
        expect(html).toContain('aria-label="About Force Output Swings"');
        expect(html).toContain('aria-label="About Enable Fractional Swings"');
        expect(html).toContain('aria-label="About Search for fewer wake-ups"');
        expect(html).not.toContain('role="dialog"');
    });
});
