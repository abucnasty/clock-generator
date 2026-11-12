import { describe, expect, it } from 'vitest';
import { asksCopyOffset } from './copyOffset';

describe('asksCopyOffset', () => {
    it('asks wherever the build has more than one copy, whether it states the gap or not', () => {
        expect(asksCopyOffset({ copies: 9 })).toBe(true);
        expect(asksCopyOffset({ copies: 1.5 })).toBe(true);
        expect(asksCopyOffset({ copies: 1 })).toBe(false);
        expect(asksCopyOffset({ copies: 0.5 })).toBe(false);
    });
});
