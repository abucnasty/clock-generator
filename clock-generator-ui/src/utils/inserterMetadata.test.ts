import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FactorioDataService } from 'clock-generator/browser';
import { effectiveInserterStackSize, inserterMetadataText, inserterStackSizeHelp } from './inserterMetadata';

FactorioDataService.initialize(JSON.parse(readFileSync(new URL('../../../clock-generator/resources/data-filtered.json', import.meta.url), 'utf8')));

describe('inserter metadata and Automatic stack size', () => {
    it.each(['stack-inserter', 'bulk-inserter', 'fast-inserter', 'long-handed-inserter', 'inserter'])('matches the engine data capacity for %s', prototype => {
        const spec = FactorioDataService.findInserterOrThrow(prototype);
        const research = FactorioDataService.inserterResearch();
        const expected = 1 + (spec.stack_size_bonus ?? 0)
            + (spec.bulk ? research.bulk_inserter_capacity_bonus : research.inserter_stack_size_bonus);
        expect(effectiveInserterStackSize({ prototype })).toBe(expected);
    });
    it('uses default stack capacity only when type is missing, and preserves explicit overrides', () => {
        expect(effectiveInserterStackSize({})).toBe(16);
        expect(effectiveInserterStackSize({ prototype: 'bulk-inserter' })).toBe(12);
        expect(effectiveInserterStackSize({ prototype: 'fast-inserter' })).toBe(4);
        expect(effectiveInserterStackSize({ prototype: 'bulk-inserter', stack_size: 16 })).toBe(16);
        expect(effectiveInserterStackSize({ prototype: 'unrecognized' })).toBeNaN();
        expect(effectiveInserterStackSize({ prototype: 'burner-inserter' })).toBeNaN();
    });
    it('shows read-only imported details and explains Automatic research', () => {
        expect(inserterMetadataText({ prototype: 'bulk-inserter', quality: 'normal' })).toBe('Bulk inserter · Normal quality');
        expect(inserterMetadataText({})).toBe('Stack inserter · Legendary quality');
        expect(inserterStackSizeHelp({ prototype: 'bulk-inserter' })).toBe('Automatic: 12 items, with all capacity research.');
    });
});
