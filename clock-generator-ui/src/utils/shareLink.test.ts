import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, type Config } from 'clock-generator/browser';
import { readConfigFile } from '../hooks/usePersistedConfigForm';
import { parseFormConfig } from '../worker/formConfig';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { copiesProblem } from './copiesProblem';
import {
    canShare,
    decodeShareLink,
    encodeShareLink,
    MAX_JSON_BYTES,
    MAX_LINK_CHARS,
    readShareHash,
    shareLinkNotice,
    sharedBuildSummary,
} from './shareLink';

const BASE = 'https://clock-generator.example/';

const smallBuild = (): Config => ({
    target_output: { recipe: 'iron-gear-wheel', items_per_second: 2.5, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1.25 }],
    inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 16 }],
    belts: [],
    chests: [{ type: 'buffer-chest', id: 1, storage_size: 2, item_filter: 'iron-gear-wheel' }],
} as unknown as Config);

const bigBuild = (): Config => ({
    target_output: { recipe: 'electronic-circuit', items_per_second: 30, copies: 4 },
    machines: [
        { id: 1, recipe: 'electronic-circuit', productivity: 0.5, crafting_speed: 2.5 },
        { id: 2, recipe: 'copper-cable', productivity: 0, crafting_speed: 2.5 },
    ],
    drills: {
        mining_productivity_level: 12,
        configs: [{ id: 1, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0.5, target: { type: 'machine', id: 2 } }],
    },
    inserters: [
        {
            source: { type: 'belt', id: 1 },
            sink: { type: 'machine', id: 1 },
            stack_size: 16,
            overrides: {
                enable_control: {
                    mode: 'CONDITIONAL',
                    rules: { operator: 'AND', conditions: [{ left: { type: 'INVENTORY_ITEM', entity: 'sink', item: 'copper-cable' }, operator: '<', right: { type: 'CONSTANT', value: 20 } }] },
                    latch: { release: { operator: 'AND', conditions: [{ left: { type: 'INVENTORY_ITEM', entity: 'sink', item: 'copper-cable' }, operator: '>=', right: { type: 'CONSTANT', value: 40 } }] } },
                },
            },
        },
        { source: { type: 'machine', id: 2 }, sink: { type: 'machine', id: 1 }, stack_size: 12, overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: 10, end: 90 }], period_duration_ticks: 600 } } },
    ],
    belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }],
    chests: [
        { type: 'buffer-chest', id: 1, storage_size: 2, item_filter: 'electronic-circuit' },
        { type: 'infinity-chest', id: 2, item_filter: [{ item_name: 'copper-plate', request_count: 100 }] },
    ],
    overrides: { lcm: 4, ignored_lcm_ingredients: ['copper-cable'] },
} as unknown as Config);

/** A build of `inserters` inserters, each with its own numbers, so it compresses as a real one does */
function generatedBuild(inserters: number): Config {
    const build = smallBuild();
    build.machines = Array.from({ length: Math.ceil(inserters / 2) }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', productivity: i * 0.01, crafting_speed: 1 + i * 0.037 }));
    build.inserters = Array.from({ length: inserters }, (_, i) => ({
        source: { type: 'machine', id: (i % build.machines.length) + 1 },
        sink: { type: 'chest', id: 1 },
        stack_size: (i % 16) + 1,
        overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: i * 7, end: i * 7 + 13 + (i % 5) }], period_duration_ticks: 600 + i } },
    })) as unknown as Config['inserters'];
    return build;
}

/** The `{ version, data }` of a link */
function partsOf(link: string) {
    const read = readShareHash(link.slice(link.indexOf('#')));
    if (read.kind !== 'link') throw new Error(`not a share link: ${link}`);
    return read;
}

async function deflatedBase64Url(text: string): Promise<string> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('share links: round trips', () => {
    const cases: [string, { name: string | null; config: Config }][] = [
        ['a small build', { name: null, config: smallBuild() }],
        ['drills, both chest types, a Conditional rule with a latch and a Clocked range', { name: 'Circuits', config: bigBuild() }],
        ['a name with unicode', { name: 'Grüne Schaltkreise ⚙', config: smallBuild() }],
    ];
    for (const [what, payload] of cases) {
        it(`carries ${what}`, async () => {
            const link = await encodeShareLink(payload, BASE);
            expect(link.startsWith(`${BASE}#build=1.`)).toBe(true);
            expect(await decodeShareLink(partsOf(link))).toEqual({ kind: 'build', name: payload.name, config: payload.config });
        });
    }

    it('writes base64url without padding, at every length', async () => {
        const lengths = new Set<number>();
        for (let extra = 0; extra < 12; extra++) {
            const link = await encodeShareLink({ name: 'x'.repeat(extra), config: smallBuild() }, BASE);
            const { data } = partsOf(link);
            expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(data).not.toContain('=');
            lengths.add(data.length % 4);
            expect(await decodeShareLink(partsOf(link))).toMatchObject({ kind: 'build', name: 'x'.repeat(extra) || null });
        }
        // 0, 2 and 3 mod 4: whole groups, and 1 and 2 bytes over
        expect([...lengths].sort()).toEqual([0, 2, 3]);
    });
});

describe('share links: size', () => {
    it('makes a link for a 60-inserter build well under the limit', async () => {
        const link = await encodeShareLink({ name: null, config: generatedBuild(60) }, BASE);
        expect(link.length).toBeLessThan(MAX_LINK_CHARS);
    });

    it('says when a link is long for chats, or too long to make', () => {
        expect(shareLinkNotice(2_000)).toBe('ok');
        expect(shareLinkNotice(2_001)).toBe('long');
        expect(shareLinkNotice(64_000)).toBe('long');
        expect(shareLinkNotice(64_001)).toBe('too-long');
    });

    it('refuses a link that inflates past the limit, without inflating it all', async () => {
        const data = await deflatedBase64Url(JSON.stringify({ name: null, config: { padding: ' '.repeat(2_000_000) } }));
        const read = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read');
        expect(await decodeShareLink({ version: '1', data })).toEqual({ kind: 'problem', problem: 'too-big' });
        // stopped near MAX_JSON_BYTES: the chunks read add up to a little over it, not to 2 MB
        const chunks = await Promise.all(read.mock.results.map((result) => result.value as Promise<ReadableStreamReadResult<Uint8Array>>));
        const counted = chunks.reduce((sum, chunk) => sum + (chunk.value?.byteLength ?? 0), 0);
        expect(counted).toBeGreaterThan(MAX_JSON_BYTES);
        expect(counted).toBeLessThan(MAX_JSON_BYTES + 200_000);
    });

    it('refuses data over the longest link', async () => {
        expect(await decodeShareLink({ version: '1', data: 'A'.repeat(MAX_LINK_CHARS + 1) })).toEqual({ kind: 'problem', problem: 'too-big' });
    });
});

describe('share links: versions', () => {
    it('tells a newer version from a broken one', async () => {
        const { data } = partsOf(await encodeShareLink({ name: null, config: smallBuild() }, BASE));
        expect(await decodeShareLink({ version: '9', data })).toEqual({ kind: 'problem', problem: 'newer-version' });
        for (const version of ['0', '-1', '1.5', 'abc', '', '01']) {
            expect(await decodeShareLink({ version, data })).toEqual({ kind: 'problem', problem: 'broken' });
        }
    });
});

describe('share links: broken', () => {
    const broken = { kind: 'problem', problem: 'broken' };

    it('refuses a link cut short', async () => {
        const { data } = partsOf(await encodeShareLink({ name: null, config: bigBuild() }, BASE));
        expect(await decodeShareLink({ version: '1', data: data.slice(0, -12) })).toEqual(broken);
    });

    it('refuses characters outside base64url, and nothing at all', async () => {
        expect(await decodeShareLink({ version: '1', data: '@@@' })).toEqual(broken);
        expect(await decodeShareLink({ version: '1', data: 'abc=' })).toEqual(broken);
        expect(await decodeShareLink({ version: '1', data: 'a+b/' })).toEqual(broken);
        expect(await decodeShareLink({ version: '1', data: '' })).toEqual(broken);
    });

    it('refuses base64url that is not deflate', async () => {
        expect(await decodeShareLink({ version: '1', data: btoa('{"name":null}').replace(/=+$/, '') })).toEqual(broken);
    });

    it('refuses deflated text that is not JSON', async () => {
        expect(await decodeShareLink({ version: '1', data: await deflatedBase64Url('not json at all') })).toEqual(broken);
    });

    it('refuses JSON without a build', async () => {
        for (const text of ['{"name":"x"}', '{"name":"x","config":3}', '{"config":null}', '{"config":[]}', '[1]', '"text"']) {
            expect(await decodeShareLink({ version: '1', data: await deflatedBase64Url(text) })).toEqual(broken);
        }
    });

    it('reads a name that is not text as none', async () => {
        const data = await deflatedBase64Url(JSON.stringify({ name: 5, config: smallBuild() }));
        expect(await decodeShareLink({ version: '1', data })).toMatchObject({ kind: 'build', name: null });
    });
});

describe('readShareHash', () => {
    it('reads only #build=<version>.<data>', () => {
        expect(readShareHash('')).toEqual({ kind: 'none' });
        expect(readShareHash('#')).toEqual({ kind: 'none' });
        expect(readShareHash('#other=1')).toEqual({ kind: 'none' });
        expect(readShareHash('#build=')).toEqual({ kind: 'link', version: '', data: '' });
        expect(readShareHash('#build=1.abc')).toEqual({ kind: 'link', version: '1', data: 'abc' });
        expect(readShareHash('#build=12.abc')).toEqual({ kind: 'link', version: '12', data: 'abc' });
    });
});

describe('share links: older browsers', () => {
    it('cannot share without CompressionStream, and says so when opening', async () => {
        const { data } = partsOf(await encodeShareLink({ name: null, config: smallBuild() }, BASE));
        vi.stubGlobal('CompressionStream', undefined);
        expect(canShare()).toBe(false);
        expect(await decodeShareLink({ version: '1', data })).toEqual({ kind: 'problem', problem: 'unsupported' });
    });
});

describe('sharedBuildSummary', () => {
    it('says the target and what the build holds, leaving out what it has none of', () => {
        const label = (id: string) => (id === 'iron-gear-wheel' ? 'Iron gear wheel' : id);
        expect(sharedBuildSummary(smallBuild(), label)).toBe('Iron gear wheel at 2.5/s · 1 copy · 1 machine, 1 inserter, 1 chest');
        expect(sharedBuildSummary(bigBuild(), (id) => id)).toBe('Electronic circuit at 30/s · 4 copies · 2 machines, 1 drill, 2 inserters, 1 belt, 2 chests');
        expect(sharedBuildSummary(smallBuild(), label, { withRecipe: false })).toBe('2.5/s · 1 copy · 1 machine, 1 inserter, 1 chest');
    });
});


describe('shared builds through the real file and worker boundary', () => {
    it.each([0.0625, 0.0001, 1 / 3])('preserves Copies %s and inserter metadata', async copies => {
        const config = smallBuild();
        config.target_output.copies = copies;
        config.inserters = [
            { prototype: 'bulk-inserter', quality: 'normal' },
            { prototype: 'fast-inserter', quality: 'normal' },
            { prototype: 'bulk-inserter', quality: 'normal', stack_size: 8 },
            { prototype: 'bulk-inserter', quality: 'normal', stack_size: 16 },
            { stack_size: 16 },
            {},
        ].map(metadata => ({ ...config.inserters[0], stack_size: undefined, ...metadata })) as Config['inserters'];
        const original = JSON.stringify(config);
        const decoded = await decodeShareLink(partsOf(await encodeShareLink({ name: 'Fractional build', config }, BASE)));
        expect(decoded.kind).toBe('build');
        if (decoded.kind !== 'build') throw new Error('Expected a decoded build');
        const file = readConfigFile(JSON.stringify(decoded.config));
        const parsed = parseFormConfig(ConfigSchema, file);
        expect(parsed.success).toBe(true);
        expect(ConfigSchema.safeParse(file).success).toBe(copiesProblem(copies) === null);
        const exported = JSON.parse(JSON.stringify(formDataToConfig(configToFormData(parsed.data!))));
        expect(exported.target_output.copies).toBe(copies);
        // Metadata is independent of the Copies refinement; keep its full presence/value matrix once.
        if (copies === 0.0625) {
            const before = JSON.parse(original);
            for (let i = 0; i < before.inserters.length; i++) {
                for (const field of ['prototype', 'quality', 'stack_size']) {
                    expect(Object.hasOwn(exported.inserters[i], field)).toBe(Object.hasOwn(before.inserters[i], field));
                    expect(exported.inserters[i][field]).toEqual(before.inserters[i][field]);
                }
            }
        }
        expect(JSON.stringify(config)).toBe(original);
    });

    it('rejects malformed decoded config at the worker boundary even with editable Copies', async () => {
        const config = { ...smallBuild(), machines: 'broken', target_output: { ...smallBuild().target_output, copies: 0.0001 } };
        const data = await deflatedBase64Url(JSON.stringify({ name: 'Broken', config }));
        const decoded = await decodeShareLink({ version: '1', data });
        expect(decoded.kind).toBe('build');
        if (decoded.kind !== 'build') throw new Error('Expected unknown decoded config');
        expect(parseFormConfig(ConfigSchema, readConfigFile(JSON.stringify(decoded.config))).success).toBe(false);
    });
});
