import { describe, expect, it } from 'vitest';
import { looksLikeSidecarExport, pickupCaptureWarningMessage, readSidecarExport, sideLoadedDropMessage, type SidecarExportProblem } from './sidecarExport';

const machine = { id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, type: 'machine' };
const inserter = { id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 1 };

const problemOf = (text: string) => {
    const read = readSidecarExport(text);
    return read.kind === 'problem' ? read.problem : null;
};

/** An export of machine 1 and the given fields */
const exportOf = (fields: object) => readSidecarExport(JSON.stringify({ machines: [machine], ...fields }));

describe('readSidecarExport', () => {
    it.each<[string, SidecarExportProblem, string[]]>([
        ['blank and whitespace text', 'empty', ['', '  \n\t ']],
        ['text that does not parse', 'not-json', ['just some words', '{ not json']],
        ['a number, a string, null and an object without machines', 'not-an-export', ['42', '"text"', '{}', 'null']],
        ['a build file, by its target output', 'build-file', [JSON.stringify({ target_output: { recipe: 'iron-gear-wheel' }, machines: [machine] })]],
        ['an export with nothing in it, machines that are not a list and an empty array', 'no-entities', [
            JSON.stringify({ machines: [], drills: { configs: [] }, inserters: [], belts: [], chests: [] }), JSON.stringify({ machines: 'none' }), '[]',
        ]],
    ])('reads %s as %s', (_what, problem, texts) => {
        expect(texts.map(problemOf)).toEqual(texts.map(() => problem));
    });

    it('reads the full export of an older sidecar, its mining productivity level as each drill\'s productivity', () => {
        expect(exportOf({
            sidecar_version: '0.7.0',
            suggested_target: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
            drills: { mining_productivity_level: 3, configs: [{ id: 1 }] },
            inserters: [inserter],
            belts: [],
            chests: [{ id: 1 }],
        })).toEqual({
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

    it.each([
        ['each drill\'s own productivity', { configs: [{ id: 1, productivity: 82 }, { id: 2, productivity: 490 }] }, [{ id: 1, productivity: 82 }, { id: 2, productivity: 490 }]],
        ['drills given as a bare list, without a mining level, at productivity 0', [{ id: 1 }, { id: 2, productivity: 10 }], [{ id: 1, productivity: 0 }, { id: 2, productivity: 10 }]],
    ])('reads %s', (_what, drills, read) => {
        const sidecar = exportOf({ drills });
        expect(sidecar.kind === 'export' && sidecar.drills).toEqual(read);
    });

    it('counts a list that is not an array as empty', () => {
        const read = exportOf({ inserters: 'many', belts: { a: 1 } });
        expect(read.kind === 'export' && [read.inserters, read.belts]).toEqual([[], []]);
    });

    it('reads a non-empty array as the first, machines-only export', () => {
        const read = readSidecarExport(JSON.stringify([machine]));
        expect(read).toMatchObject({ kind: 'export', legacy: true, machines: [machine], drills: [], inserters: [], belts: [], chests: [] });
    });

    it.each([
        ['supported capture-note reasons, ignoring invalid or out-of-range notes', [{}, {}], [
            { inserter_id: 1, reason: 'bend' }, { inserter_id: 2, reason: 'inline' },
            { inserter_id: 3, reason: 'splitter' }, { inserter_id: 0, reason: 'unsupported' },
            { inserter_id: 1, reason: 'arbitrary text' }, null,
        ], [{ inserter_id: 1, reason: 'bend' }, { inserter_id: 2, reason: 'inline' }]],
        ['a side-loaded note, ignoring the retired merge and supply-unknown reasons as any unknown reason', [{}, {}, {}], [
            { inserter_id: 1, reason: 'side-loaded' }, { inserter_id: 2, reason: 'merge' }, { inserter_id: 3, reason: 'supply-unknown' },
        ], [{ inserter_id: 1, reason: 'side-loaded' }]],
    ])('reads %s', (_what, inserters, pickup_warnings, warnings) => {
        const read = exportOf({ inserters, pickup_warnings });
        expect(read.kind === 'export' && read.pickupWarnings).toEqual(warnings);
    });
});

describe('looksLikeSidecarExport', () => {
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
    it.each([
        ['splitter', /^pickup is on a splitter\. /],
        ['side-loaded', /^another belt side-loads onto the pickup tile\. /],
    ] as const)('says a %s pickup is out of scope, naming what is, rather than waiting to be calibrated', (reason, start) => {
        expect(pickupCaptureWarningMessage(reason)).toMatch(start);
        expect(pickupCaptureWarningMessage(reason)).toContain('out of scope for the clock generator');
        expect(pickupCaptureWarningMessage(reason)).not.toContain('has not been calibrated');
    });

    it.each(['bend', 'inline', 'unsupported'] as const)('keeps a %s pickup unverified until its geometry is calibrated', reason => {
        expect(pickupCaptureWarningMessage(reason)).toContain('this geometry has not been calibrated');
        expect(pickupCaptureWarningMessage(reason)).not.toContain('out of scope');
    });
});

it('says of a drop that side-loads onto another belt in the approved wording, with the tiles of the mark', () => {
    expect(sideLoadedDropMessage(3)).toBe('drops onto a 3 tile belt buffer that side-loads onto another belt. Imported as an ordinary drop: '
        + 'where the other belt is busy, the game has less room than the clock generator assumes.');
    expect(sideLoadedDropMessage(1)).toContain('a 1 tile belt buffer');
});
