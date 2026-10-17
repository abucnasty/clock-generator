import { expect, it } from 'vitest';
import { craftingCycles, craftingCycleAt, craftingCycleIndex, craftingCycleRange } from './craftingCycles';

it('uses the Swing Plan definition: five 96-tick crafting cycles in a 480-tick clock', () => {
    const cycles = craftingCycles(96, 480)!;
    expect(cycles.count).toBe(5);
    expect(craftingCycleAt(cycles, 0)).toEqual({ start: 0, end: 96, partial: false });
    expect(craftingCycleAt(cycles, 1)).toEqual({ start: 96, end: 192, partial: false });
    expect(craftingCycleAt(cycles, 4)).toEqual({ start: 384, end: 480, partial: false });
    expect(craftingCycleAt(cycles, 5)).toBeNull();
    expect(craftingCycleIndex(cycles, 95)).toBe(0);
    expect(craftingCycleIndex(cycles, 96)).toBe(1);
    expect(craftingCycleIndex(cycles, 480)).toBe(4);
    expect(craftingCycleRange(craftingCycleAt(cycles, 1)!, 480)).toEqual({ start: 96, end: 192 });
});

it('retains fractional planned boundaries without rounding or allocating an array per cycle', () => {
    const cycles = craftingCycles(0.1, 0.3)!;
    expect(cycles.count).toBe(3);
    expect(craftingCycleAt(cycles, 2)?.start).toBeCloseTo(0.2);
    expect(craftingCycleAt(cycles, 2)?.end).toBeCloseTo(0.3);
    expect(craftingCycleAt(cycles, 2)?.partial).toBe(false);
    expect(craftingCycles(0.001, 24000)?.count).toBe(24_000_000);
});

it('handles bounded excerpts and missing saved metadata without inventing cycle lengths', () => {
    const cycles = craftingCycles(96, 200)!;
    expect(craftingCycleAt(cycles, 2)).toEqual({ start: 192, end: 200, partial: true });
    expect(craftingCycleAt(cycles, -1)).toBeNull();
    expect(craftingCycles(0, 480)).toBeNull();
    expect(craftingCycles(NaN, 480)).toBeNull();
    expect(craftingCycles(96, Infinity)).toBeNull();
});
