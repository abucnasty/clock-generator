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

    it('reads the full export of an older sidecar, its mining productivity level as each drill\'s productivity', () => {
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
            drills: [{ id: 1, productivity: 30 }],
            inserters: [inserter],
            belts: [],
            chests: [{ id: 1 }],
            sidecarVersion: '0.7.0',
            suggestedTarget: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
        });
    });

    it('reads each drill\'s own productivity', () => {
        const read = readSidecarExport(JSON.stringify({ sidecar_version: '0.12.0', machines: [machine],
            drills: { configs: [{ id: 1, productivity: 82 }, { id: 2, productivity: 490 }] } }));
        expect(read.kind === 'export' && read.drills).toEqual([{ id: 1, productivity: 82 }, { id: 2, productivity: 490 }]);
    });

    it('reads drills given as a bare list, without a mining level, at productivity 0', () => {
        const read = readSidecarExport(JSON.stringify({ machines: [machine], drills: [{ id: 1 }, { id: 2, productivity: 10 }] }));
        expect(read.kind === 'export' && read.drills).toEqual([{ id: 1, productivity: 0 }, { id: 2, productivity: 10 }]);
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

describe('pickup capture warnings', () => {
    it('reads a side-loaded note and ignores the retired merge and supply-unknown reasons as any unknown reason', () => {
        const read = readSidecarExport(JSON.stringify({ machines: [machine], inserters: [{}, {}, {}], pickup_warnings: [
            { inserter_id: 1, reason: 'side-loaded' }, { inserter_id: 2, reason: 'merge' }, { inserter_id: 3, reason: 'supply-unknown' },
        ] }));
        expect(read.kind).toBe('export');
        if (read.kind === 'export') expect(read.pickupWarnings).toEqual([{ inserter_id: 1, reason: 'side-loaded' }]);
    });

    it.each(['splitter', 'side-loaded'] as const)('says a %s pickup is out of scope rather than waiting to be calibrated', reason => {
        expect(pickupCaptureWarningMessage(reason)).toContain('out of scope for the clock generator');
        expect(pickupCaptureWarningMessage(reason)).not.toContain('has not been calibrated');
    });

    it('names what is out of scope', () => {
        expect(pickupCaptureWarningMessage('splitter')).toMatch(/^pickup is on a splitter\. /);
        expect(pickupCaptureWarningMessage('side-loaded')).toMatch(/^another belt side-loads onto the pickup tile\. /);
    });

    it.each(['bend', 'inline', 'unsupported'] as const)('keeps a %s pickup unverified until its geometry is calibrated', reason => {
        expect(pickupCaptureWarningMessage(reason)).toContain('this geometry has not been calibrated');
        expect(pickupCaptureWarningMessage(reason)).not.toContain('out of scope');
    });
});
