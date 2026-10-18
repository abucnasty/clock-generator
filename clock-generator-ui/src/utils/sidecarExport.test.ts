import { pickupCaptureWarningMessage } from './sidecarExport';
import { describe, expect, it } from 'vitest';
import { looksLikeSidecarExport, readSidecarExport } from './sidecarExport';

const machine = { id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, type: 'machine' };
const inserter = { id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 1 };

const problemOf = (text: string) => {
    const read = readSidecarExport(text);
    return read.kind === 'problem' ? read.problem : null;
};

describe('readSidecarExport', () => {
    it('reads blank and whitespace text as empty', () => {
        expect(problemOf('')).toBe('empty');
        expect(problemOf('  \n\t ')).toBe('empty');
    });

    it('reads text that does not parse as not JSON', () => {
        expect(problemOf('just some words')).toBe('not-json');
        expect(problemOf('{ not json')).toBe('not-json');
    });

    it('reads a number, a string and an object without machines as not an export', () => {
        expect(problemOf('42')).toBe('not-an-export');
        expect(problemOf('"text"')).toBe('not-an-export');
        expect(problemOf('{}')).toBe('not-an-export');
        expect(problemOf('null')).toBe('not-an-export');
    });

    it('tells a build file apart by its target output', () => {
        expect(problemOf(JSON.stringify({ target_output: { recipe: 'iron-gear-wheel' }, machines: [machine] }))).toBe('build-file');
    });

    it('reads the full export, with drills as { mining_productivity_level, configs }', () => {
        const read = readSidecarExport(JSON.stringify({
            sidecar_version: '0.7.0',
            suggested_target: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
            machines: [machine],
            drills: { mining_productivity_level: 3, configs: [{ id: 1 }] },
            inserters: [inserter],
            belts: [],
            chests: [{ id: 1 }],
        }));
        expect(read).toEqual({
            kind: 'export',
            legacy: false,
            machines: [machine],
            drills: [{ id: 1 }],
            miningProductivityLevel: 3,
            inserters: [inserter],
            belts: [],
            chests: [{ id: 1 }],
            sidecarVersion: '0.7.0',
            suggestedTarget: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
        });
    });

    it('reads drills given as a bare list, without a mining level', () => {
        const read = readSidecarExport(JSON.stringify({ machines: [machine], drills: [{ id: 1 }, { id: 2 }] }));
        expect(read.kind === 'export' && read.drills).toHaveLength(2);
        expect(read.kind === 'export' && read.miningProductivityLevel).toBeUndefined();
    });

    it('counts a list that is not an array as empty', () => {
        const read = readSidecarExport(JSON.stringify({ machines: [machine], inserters: 'many', belts: { a: 1 } }));
        expect(read.kind === 'export' && [read.inserters, read.belts]).toEqual([[], []]);
    });

    it('reads an export with nothing in it as no entities', () => {
        expect(problemOf(JSON.stringify({ machines: [], drills: { configs: [] }, inserters: [], belts: [], chests: [] }))).toBe('no-entities');
        expect(problemOf(JSON.stringify({ machines: 'none' }))).toBe('no-entities');
    });

    it('reads a non-empty array as the first, machines-only export', () => {
        const read = readSidecarExport(JSON.stringify([machine]));
        expect(read).toMatchObject({ kind: 'export', legacy: true, machines: [machine], drills: [], inserters: [], belts: [], chests: [] });
    });

    it('reads an empty array as no entities', () => {
        expect(problemOf('[]')).toBe('no-entities');
    });
});

describe('looksLikeSidecarExport', () => {
    it('reads supported capture-note reasons and ignores invalid or out-of-range notes', () => {
        const read = readSidecarExport(JSON.stringify({ machines: [machine], inserters: [{}, {}], pickup_warnings: [
            { inserter_id: 1, reason: 'bend' }, { inserter_id: 2, reason: 'inline' },
            { inserter_id: 3, reason: 'splitter' }, { inserter_id: 0, reason: 'unsupported' },
            { inserter_id: 1, reason: 'arbitrary text' }, null,
        ] }));
        expect(read.kind).toBe('export');
        if (read.kind === 'export') expect(read.pickupWarnings).toEqual([{ inserter_id: 1, reason: 'bend' }, { inserter_id: 2, reason: 'inline' }]);
    });

    it('is true for an export and for an array', () => {
        expect(looksLikeSidecarExport(JSON.stringify({ machines: [machine] }))).toBe(true);
        expect(looksLikeSidecarExport(JSON.stringify([machine]))).toBe(true);
    });

    it('is false for a build file and for text that is not JSON', () => {
        expect(looksLikeSidecarExport(JSON.stringify({ target_output: {}, machines: [machine] }))).toBe(false);
        expect(looksLikeSidecarExport('{ not json')).toBe(false);
        expect(looksLikeSidecarExport('{}')).toBe(false);
    });
});


it('retains supply diagnostics even when geometry is classified', () => {
    const read = readSidecarExport(JSON.stringify({machines: [{}], inserters: [{}, {}], pickup_warnings: [
        {inserter_id: 1, reason: 'merge'}, {inserter_id: 2, reason: 'supply-unknown'},
    ]}));
    expect(read.kind).toBe('export');
    if (read.kind === 'export') expect(read.pickupWarnings?.map(warning => warning.reason)).toEqual(['merge', 'supply-unknown']);
});

it('explains supply warnings without claiming that pickup geometry is unknown', () => {
    expect(pickupCaptureWarningMessage('merge')).toContain('outside the supported turbo two-stream');
    expect(pickupCaptureWarningMessage('supply-unknown')).toContain('Supply entry is unspecified');
    expect(pickupCaptureWarningMessage('merge')).not.toContain('pickup type unspecified');
});
