import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, laneFactsOfConfig, type Config } from 'clock-generator/browser';
import type { EngineAnswers, EngineQuery, WorkerRequest, WorkerResponse } from './types';
import { readConfigFile, readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import type { ConfigFormData } from '../utils/configForm/formData';
import { createDefaultConfig } from '../utils/configForm/formData';
import { decodeShareLink, encodeShareLink, readShareHash } from '../utils/shareLink';

FactorioDataService.initialize(JSON.parse(factorioData));

const SAMPLES = import.meta.glob('../../../clock-generator/resources/config-samples/science/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const BACKED = import.meta.glob('../../../clock-generator/scripts/sim-game-check/configs/*-backed.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const sample = (file: string) => SAMPLES[Object.keys(SAMPLES).find(key => key.endsWith(file))!];
/** The 9 examples of the page (scripts/game-data-plugin.ts) */
const EXAMPLES: [string, string][] = [
    ['logistic science', 'science/logistic/logistic-240.json'],
    ['automation science', 'science/automation/automation-240.json'],
    ['utility science', 'science/utility/utility-120.json'],
    ['chemical science', 'science/chemical/chemical-240-shared-foundry.json'],
    ['electromagnetic science', 'science/electromagnetic/electromagnetic-330.json'],
    ['military science', 'science/military/military-240.json'],
    ['production science', 'science/production/production-120-two-belts.json'],
    ['metallurgic science', 'science/metallurgic/metallurgic-45.json'],
    ['agriculture science', 'science/agricultural/agricultural-250.json'],
];

let posted: WorkerResponse[];
let send: (data: WorkerRequest) => Promise<WorkerResponse>;
beforeEach(async () => {
    vi.resetModules();
    posted = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    send = async data => { await port.onmessage!({ data }); return posted.at(-1)!; };
    expect(await send({ type: 'initialize', factorioData })).toEqual({ type: 'initialized' });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function ask<K extends EngineQuery['kind']>(query: Extract<EngineQuery, { kind: K }>): Promise<EngineAnswers[K]> {
    const response = await send({ type: 'query', requestId: 91, query });
    expect(response.type).toBe('answer');
    return (response as unknown as { answer: EngineAnswers[K] }).answer;
}

type Lane = { ingredient: string; lane_end?: { kind: string }; consumption_per_second?: number };
const lanesOf = (config: { belts: readonly { lanes: readonly unknown[] }[] }) => config.belts.flatMap(belt => belt.lanes as readonly Lane[]);
/** A config with every stated lane end taken out, as a build saved by the released page (0.28 had no lane ends) */
const withoutEnds = (config: Config): Config => ({ ...config, belts: config.belts.map(belt => ({ ...belt,
    lanes: (belt.lanes as readonly Lane[]).map(({ lane_end: _end, ...lane }) => { void _end; return lane; }) })) }) as Config;
const withSetting = (config: Config, value: boolean | undefined): Config => {
    const { backed_up_belts: _old, ...overrides } = config.overrides ?? {};
    void _old;
    return { ...config, overrides: value === undefined ? overrides : { ...overrides, backed_up_belts: value } };
};
/** Each lane's facts as the engine reads them, with its role */
const factsOf = (config: Config) => config.belts.flatMap(belt => laneFactsOfConfig(config).lanesOf(belt.id).map((facts, index) => ({
    lane: `belt ${belt.id} lane ${index + 1}`, role: facts.role, end: facts.lane_end.kind, supply: JSON.stringify(facts.supply_rate), sharing: facts.sharing })));

/** Where a measure copy of this test writes its lines; here nothing */
const record = (lines: string[]) => { void lines; };

describe('the conversion of the former belt setting', () => {
    it('keeps the engine\'s facts of every input and buffer lane; an output lane or a lane with no role goes to its role\'s end', async () => {
        const cases: [string, Config][] = [];
        for (const [name, file] of EXAMPLES) {
            const config = await ask({ kind: 'config-file', config: readConfigFile(sample(file)) });
            for (const value of [true, false]) {
                cases.push([`${name}, ${value}, stated ends kept`, withSetting(config, value)]);
                cases.push([`${name}, ${value}, stated ends taken out`, withSetting(withoutEnds(config), value)]);
            }
        }
        for (const [file, text] of Object.entries(BACKED)) cases.push([file.split('/').pop()!, JSON.parse(text) as Config]);
        expect(cases).toHaveLength(40);
        const counts: Record<string, number> = {};
        const lines: string[] = [];
        for (const [name, original] of cases) {
            const read = await ask({ kind: 'config-file', config: original });
            expect(read.overrides?.backed_up_belts, name).toBeUndefined();
            const before = factsOf(ConfigSchema.parse(original) as Config), after = factsOf(read);
            before.forEach((lane, index) => {
                const taken = lane.role === 'input' || lane.role === 'buffer';
                const expected = taken ? lane : { ...lane, end: 'infinite' };
                expect(after[index], `${name}: ${lane.lane}`).toEqual(expected);
                const key = `${lane.role ?? 'no role'} ${lane.end} -> ${after[index].end}`;
                counts[key] = (counts[key] ?? 0) + 1;
            });
            lines.push(`${name}: ${before.length} lanes; ${before.map((lane, index) => `${lane.role ?? 'none'} ${lane.end}->${after[index].end}`).join(', ')}`);
        }
        lines.push(`configs ${cases.length}; lanes by role and end, original -> converted: ${JSON.stringify(counts)}`);
        record(lines);
    }, 120_000);

    it('states nothing on a build that states no setting', async () => {
        const text = sample('science/automation/automation-240.json');
        const read = await ask({ kind: 'config-file', config: withSetting(withoutEnds(JSON.parse(text) as Config), undefined) });
        expect(lanesOf(read).every(lane => lane.lane_end === undefined)).toBe(true);
    });

    it('states Dead end on the input lanes of a build that stated true, Infinite on those of one that stated false, and says nothing of it', async () => {
        const automation = withoutEnds(JSON.parse(sample('science/automation/automation-240.json')) as Config);
        const backed = await ask({ kind: 'config-file', config: withSetting(automation, true) });
        expect(lanesOf(backed).map(lane => lane.lane_end?.kind)).toEqual(['dead_end', 'dead_end', undefined]);
        const moving = await ask({ kind: 'config-file', config: withSetting(automation, false) });
        expect(lanesOf(moving).map(lane => lane.lane_end?.kind)).toEqual(['infinite', 'infinite', undefined]);
        // the former spelling
        const older = await ask({ kind: 'config-file', config: { ...automation, overrides: { non_moving_belts: true } } });
        expect(lanesOf(older).map(lane => lane.lane_end?.kind)).toEqual(['dead_end', 'dead_end', undefined]);
        expect(older.overrides).toBeUndefined();
    });

    it('opens a share link and a saved build of the released page converted, and round-trips them with no setting', async () => {
        const automation = withoutEnds(JSON.parse(sample('science/automation/automation-240.json')) as Config);
        // a link made by the released page: Backed up stored `true`
        const link = await encodeShareLink({ name: 'old', config: withSetting(automation, true) }, 'https://example.invalid/');
        const hash = readShareHash(new URL(link).hash);
        if (hash.kind !== 'link') throw new Error('no link');
        const decoded = await decodeShareLink(hash);
        if (decoded.kind !== 'build') throw new Error('not a build');
        const opened = await ask({ kind: 'config-file', config: readConfigFile(JSON.stringify(decoded.config)) });
        expect(lanesOf(opened).map(lane => lane.lane_end?.kind)).toEqual(['dead_end', 'dead_end', undefined]);
        // a saved build of the released page, then saved and loaded again
        const savedText = serializeConfig({ ...configToFormData(automation), overrides: { backed_up_belts: true } } as ConfigFormData);
        const loaded = await ask({ kind: 'saved-config', config: readSavedConfig(savedText) });
        expect(loaded.problem).toBeNull();
        const form = loaded.form as ConfigFormData;
        expect(form.overrides?.backed_up_belts).toBeUndefined();
        const again = await ask({ kind: 'saved-config', config: readSavedConfig(serializeConfig(form)) });
        expect(formDataToConfig(again.form as ConfigFormData)).toEqual(formDataToConfig(form));
        expect(lanesOf(formDataToConfig(form)).map(lane => lane.lane_end?.kind)).toEqual(['dead_end', 'dead_end', undefined]);
        // a saved build of the released page answered Moving stated nothing, and stays so
        const moving = await ask({ kind: 'saved-config', config: readSavedConfig(serializeConfig(configToFormData(automation))) });
        expect(lanesOf(moving.form as ConfigFormData).every(lane => lane.lane_end === undefined)).toBe(true);
    });

    it('loads a half-filled old build with no error: a machine with no recipe leaves the other lanes their ends', async () => {
        const form = createDefaultConfig();
        form.machines[0].recipe = 'iron-gear-wheel';
        form.machines.push({ ...form.machines[0], id: 2, _uuid: 'm2', recipe: '' });
        form.belts = [
            { id: 1, _uuid: 'b1', type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] },
            { id: 2, _uuid: 'b2', type: 'turbo-transport-belt', lanes: [{ ingredient: 'copper-plate', stack_size: 4 }] },
        ] as ConfigFormData['belts'];
        form.inserters = [
            { id: 1, _uuid: 'i1', source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, _uuid: 'i2', source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 2 } },
        ] as ConfigFormData['inserters'];
        const saved = serializeConfig({ ...form, overrides: { backed_up_belts: true } });
        const loaded = await ask({ kind: 'saved-config', config: readSavedConfig(saved) });
        expect(loaded.problem).toBeNull();
        const lanes = lanesOf(loaded.form as ConfigFormData);
        // the iron plate lane feeds a machine with a recipe: an input lane; the copper plate lane's inserter feeds the
        // machine with no recipe, so it has no role yet: it states nothing and takes its role's end once it has one
        expect(lanes.map(lane => lane.lane_end?.kind)).toEqual(['dead_end', undefined]);
        expect((loaded.form as ConfigFormData).overrides?.backed_up_belts).toBeUndefined();
    });
});
