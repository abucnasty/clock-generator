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
        configs: [{ id: 1, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0.5, productivity: 120, target: { type: 'machine', id: 2 } }],
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

/** The `{ version, data }` of a link made for `config` */
const linkTo = async (config: Config, name: string | null = null) => partsOf(await encodeShareLink({ name, config }, BASE));

async function deflatedBase64Url(text: string): Promise<string> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Each inserter's prototype, quality and stack size, only those it has */
const metadataOf = (inserters: Record<string, unknown>[]) => inserters.map(ins =>
    Object.fromEntries(['prototype', 'quality', 'stack_size'].filter(field => Object.hasOwn(ins, field)).map(field => [field, ins[field]])));

afterEach(() => { vi.unstubAllGlobals(); });

describe('share links: round trips', () => {
    it.each<[string, string | null, Config]>([
        ['a small build', null, smallBuild()],
        ['drills, both chest types, a Conditional rule with a latch and a Clocked range', 'Circuits', bigBuild()],
        ['a name with unicode', 'Grüne Schaltkreise ⚙', smallBuild()],
    ])('carries %s', async (_, name, config) => {
        const link = await encodeShareLink({ name, config }, BASE);
        expect(link.startsWith(`${BASE}#build=1.`)).toBe(true);
        expect(await decodeShareLink(partsOf(link))).toEqual({ kind: 'build', name, config });
    });

    it('writes base64url without padding, at every length', async () => {
        const lengths = new Set<number>();
        for (let extra = 0; extra < 12; extra++) {
            const link = await linkTo(smallBuild(), 'x'.repeat(extra));
            expect(link.data).toMatch(/^[A-Za-z0-9_-]+$/);
            lengths.add(link.data.length % 4);
            expect(await decodeShareLink(link)).toMatchObject({ kind: 'build', name: 'x'.repeat(extra) || null });
        }
        // 0, 2 and 3 mod 4: whole groups, and 1 and 2 bytes over
        expect([...lengths].sort()).toEqual([0, 2, 3]);
    });

    it('reads a name that is not text as none', async () => {
        const data = await deflatedBase64Url(JSON.stringify({ name: 5, config: smallBuild() }));
        expect(await decodeShareLink({ version: '1', data })).toMatchObject({ kind: 'build', name: null });
    });
});

describe('share links: size', () => {
    it('makes a link for a 60-inserter build well under the limit', async () => {
        expect((await encodeShareLink({ name: null, config: generatedBuild(60) }, BASE)).length).toBeLessThan(MAX_LINK_CHARS);
    });

    it('says when a link is long for chats, or too long to make', () => {
        expect([2_000, 2_001, 64_000, 64_001].map(shareLinkNotice)).toEqual(['ok', 'long', 'long', 'too-long']);
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

describe('share links: versions and broken data', () => {
    const broken = { kind: 'problem', problem: 'broken' };
    const deflated = (...texts: string[]) => () => Promise.all(texts.map(deflatedBase64Url));

    it('tells a newer version from a broken one', async () => {
        const { data } = await linkTo(smallBuild());
        expect(await decodeShareLink({ version: '9', data })).toEqual({ kind: 'problem', problem: 'newer-version' });
        for (const version of ['0', '-1', '1.5', 'abc', '', '01']) expect(await decodeShareLink({ version, data })).toEqual(broken);
    });

    it.each<[string, () => string[] | Promise<string[]>]>([
        ['a link cut short', async () => [(await linkTo(bigBuild())).data.slice(0, -12)]],
        ['characters outside base64url, and nothing at all', () => ['@@@', 'abc=', 'a+b/', '']],
        ['base64url that is not deflate', () => [btoa('{"name":null}').replace(/=+$/, '')]],
        ['deflated text that is not JSON', deflated('not json at all')],
        ['JSON without a build', deflated('{"name":"x"}', '{"name":"x","config":3}', '{"config":null}', '{"config":[]}', '[1]', '"text"')],
    ])('refuses %s', async (_, datas) => {
        for (const data of await datas()) expect(await decodeShareLink({ version: '1', data })).toEqual(broken);
    });
});

describe('readShareHash', () => {
    it('reads only #build=<version>.<data>', () => {
        for (const hash of ['', '#', '#other=1']) expect(readShareHash(hash)).toEqual({ kind: 'none' });
        expect(readShareHash('#build=')).toEqual({ kind: 'link', version: '', data: '' });
        expect(readShareHash('#build=1.abc')).toEqual({ kind: 'link', version: '1', data: 'abc' });
        expect(readShareHash('#build=12.abc')).toEqual({ kind: 'link', version: '12', data: 'abc' });
    });
});

describe('share links: older browsers', () => {
    it('cannot share without CompressionStream, and says so when opening', async () => {
        const link = await linkTo(smallBuild());
        vi.stubGlobal('CompressionStream', undefined);
        expect(canShare()).toBe(false);
        expect(await decodeShareLink(link)).toEqual({ kind: 'problem', problem: 'unsupported' });
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
        const decoded = await decodeShareLink(await linkTo(config, 'Fractional build'));
        if (decoded.kind !== 'build') throw new Error(`Expected a decoded build, not ${decoded.problem}`);
        const file = readConfigFile(JSON.stringify(decoded.config));
        const parsed = parseFormConfig(ConfigSchema, file);
        expect(parsed.success).toBe(true);
        expect(ConfigSchema.safeParse(file).success).toBe(copiesProblem(copies) === null);
        const exported = JSON.parse(JSON.stringify(formDataToConfig(configToFormData(parsed.data!))));
        expect(exported.target_output.copies).toBe(copies);
        // Metadata is independent of the Copies refinement; keep its full presence/value matrix once.
        if (copies === 0.0625) expect(metadataOf(exported.inserters)).toStrictEqual(metadataOf(JSON.parse(original).inserters));
        expect(JSON.stringify(config)).toBe(original);
    });

    it('rejects malformed decoded config at the worker boundary even with editable Copies', async () => {
        const config = { ...smallBuild(), machines: 'broken', target_output: { ...smallBuild().target_output, copies: 0.0001 } };
        const decoded = await decodeShareLink({ version: '1', data: await deflatedBase64Url(JSON.stringify({ name: 'Broken', config })) });
        if (decoded.kind !== 'build') throw new Error(`Expected unknown decoded config, not ${decoded.problem}`);
        expect(parseFormConfig(ConfigSchema, readConfigFile(JSON.stringify(decoded.config))).success).toBe(false);
    });
});
