import { describe, expect, it } from 'vitest';
import { AA, contrastRatio, parseColor } from '../theme/contrast';
import { TILE_GRID_SHADE } from '../theme/tileGrid';
import { SURFACE } from '../theme/tokens';
import { beltColour } from './layoutColours';

/** The lighter square of the ground: the shared checker's shade over the dark square, to whole channel values */
function lighterSquare(): string {
    const shade = parseColor(TILE_GRID_SHADE);
    const under = parseColor(SURFACE.inset);
    const mix = (over: number, below: number) => Math.round(over * shade.a + below * (1 - shade.a));
    return `rgb(${mix(shade.r, under.r)}, ${mix(shade.g, under.g)}, ${mix(shade.b, under.b)})`;
}

describe('the belt colours of the Layout view', () => {
    const squares = [
        ['the dark square', SURFACE.inset],
        ['the lighter square', lighterSquare()],
    ];

    it.each(squares)('reach 3 to 1 on %s of the ground, every one of the eight', (_name, square) => {
        for (let id = 0; id < 8; id++) {
            expect(contrastRatio(beltColour(id), square), `belt ${id} ${beltColour(id)}`).toBeGreaterThanOrEqual(AA.nonText);
        }
    });

    it('are eight different colours, and repeat after the eighth', () => {
        expect(new Set(Array.from({ length: 8 }, (_, id) => beltColour(id))).size).toBe(8);
        expect(beltColour(8)).toBe(beltColour(0));
    });
});
