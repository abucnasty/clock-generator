import { describe, expect, it } from 'vitest';
import { isBuildFile } from './sidecarExport';

const machine = { id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, prototype: 'assembling-machine-3' };

describe('isBuildFile', () => {
    it('is true for JSON with a setpoint or a target output', () => {
        expect(isBuildFile({ setpoint: {}, machines: [machine] })).toBe(true);
        expect(isBuildFile({ target_output: {}, machines: [machine] })).toBe(true);
    });

    it('is false for an export of the mod, an array and anything else', () => {
        expect(isBuildFile({ sidecar_version: '0.16.0', machines: [machine] })).toBe(false);
        expect(isBuildFile([machine])).toBe(false);
        expect(isBuildFile({})).toBe(false);
        expect(isBuildFile('text')).toBe(false);
        expect(isBuildFile(null)).toBe(false);
    });
});
