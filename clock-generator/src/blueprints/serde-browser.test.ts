import { describe, expect, it } from 'vitest';
import { FactorioBlueprintFile } from './blueprint';
import { decodeBlueprintFileBrowser, encodeBlueprintFileBrowser } from './serde-browser';

/** A repeatable stream of hex digits: deflate cannot shrink it much, so the string stays long */
function hexDigits(seed: number, length: number): string {
    let state = seed;
    let digits = '';
    while (digits.length < length) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        digits += state.toString(16).padStart(8, '0');
    }
    return digits.slice(0, length);
}

function blueprintOfEntities(count: number): FactorioBlueprintFile {
    const entities = Array.from({ length: count }, (_, i) => ({
        entity_number: i + 1,
        name: 'decider-combinator',
        position: { x: i, y: 0 },
        player_description: hexDigits(i + 1, 1000),
    }));
    return { blueprint: { item: 'blueprint', label: 'large', entities, icons: [], wires: [], version: 1 } } as unknown as FactorioBlueprintFile;
}

describe('the browser blueprint string', () => {
    it('round-trips a blueprint whose compressed bytes would overflow the stack as call arguments', () => {
        // about 1 MB of hex digits deflate to well over 200,000 bytes, more than the stack takes as the arguments of one call
        const blueprint = blueprintOfEntities(1000);

        const encoded = encodeBlueprintFileBrowser(blueprint);

        expect(encoded[0]).toBe('0');
        // base64 holds 3 bytes in 4 characters: this is more than 200,000 deflated bytes
        expect(encoded.length).toBeGreaterThan(200_000 * 4 / 3);
        expect(decodeBlueprintFileBrowser(encoded)).toEqual(blueprint);
    });

    it('round-trips a small blueprint', () => {
        const blueprint = blueprintOfEntities(2);
        expect(decodeBlueprintFileBrowser(encodeBlueprintFileBrowser(blueprint))).toEqual(blueprint);
    });
});
