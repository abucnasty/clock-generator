import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATEST_SIDECAR_VERSION, type Config } from 'clock-generator/browser';
import { Option } from 'clock-generator/light';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import type { EngineAnswers, EngineQuery, WorkerRequest, WorkerResponse } from './types';
import { readConfigFile, readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { formLaneFactsOf } from '../utils/laneFacts';
import { applyPaste } from '../utils/pastePreview';
import { targetToFill } from '../utils/pasteTarget';
import { decodeShareLink, encodeShareLink, readShareHash } from '../utils/shareLink';
import { readSidecarExport } from '../utils/sidecarExport';

// Each way a build enters the form, through the real worker as the page asks it: the copy spacing and the facts the
// belts state of their lanes come out of the form as they went in, and nothing is added

let send: (data: WorkerRequest) => Promise<WorkerResponse>;

beforeEach(async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    send = async data => { await port.onmessage!({ data }); return posted.at(-1)!; };
    expect(await send({ type: 'initialize', factorioData })).toEqual({ type: 'initialized' });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function ask<K extends EngineQuery['kind']>(query: Extract<EngineQuery, { kind: K }>): Promise<EngineAnswers[K]> {
    const response = await send({ type: 'query', requestId: 3, query });
    if (response.type !== 'answer') throw new Error(`no answer: ${JSON.stringify(response)}`);
    return (response as unknown as { answer: EngineAnswers[K] }).answer;
}

const SAMPLE_FILES = import.meta.glob('../../../clock-generator/resources/config-samples/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
function sampleText(file: string): string {
    const key = Object.keys(SAMPLE_FILES).find(it => file.endsWith(it.replace(/^(\.\.\/)+clock-generator/, '')));
    if (key === undefined) throw new Error(`no sample ${file}`);
    return SAMPLE_FILES[key];
}
const samples = Object.entries(ConfigPaths) as [string, string][];

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

/** What a config states of the copy spacing and of its belts' lanes, each fact by where it is */
function statedLaneFacts(config: Pick<Config, 'setpoint' | 'belts'>): Record<string, unknown> {
    const facts: Record<string, unknown> = {};
    if (config.setpoint.copy_offset !== undefined) facts['setpoint copy_offset'] = config.setpoint.copy_offset;
    for (const belt of config.belts) {
        if (belt.flow_direction !== undefined) facts[`belt ${belt.id} flow_direction`] = belt.flow_direction;
        belt.lanes.forEach((lane, index) => {
            for (const field of ['lane_end', 'stack_size', 'supply_rate', 'sharing'] as const) {
                if (lane[field] !== undefined) facts[`belt ${belt.id} lane ${index + 1} ${field}`] = lane[field];
            }
        });
    }
    return plain(facts) as Record<string, unknown>;
}

/** A config file as Open configuration file and Try an example read it: the worker's 'config-file', then the form */
async function opened(text: string, prototypeSource?: 'sample'): Promise<ConfigFormData> {
    return configToFormData(await ask({ kind: 'config-file', config: readConfigFile(text) }), prototypeSource);
}

/**
 * An export of the Sidecar mod with the build of a config: its entities, and its setpoint as the suggested target, where
 * the mod puts the copy spacing
 */
function sidecarExportOf(config: Config): string {
    return JSON.stringify({ sidecar_version: LATEST_SIDECAR_VERSION, machines: config.machines, drills: { configs: config.drills?.configs ?? [] },
        inserters: config.inserters, belts: config.belts, chests: config.chests ?? [], suggested_target: config.setpoint });
}

/** Paste from Factorio of `text` into `current`, with the rows the confirm dialog ticks at first, and Import Selected */
async function pasted(current: ConfigFormData, text: string): Promise<ConfigFormData> {
    const read = readSidecarExport(text);
    if (read.kind === 'problem') throw new Error(read.problem);
    const validated = await ask({ kind: 'pasted-entities', machines: read.machines, drills: read.drills, inserters: read.inserters,
        belts: read.belts, chests: read.chests, sidecar_version: read.sidecarVersion, pickup_warnings: read.pickupWarnings,
        suggested_target: read.suggestedTarget });
    const suggestion = Option.toNullable(validated.suggested_target);
    const fill = suggestion ? targetToFill(suggestion) : null;
    const selections = { target: fill !== null && current.setpoint.recipe === '', machines: validated.machines.length > 0,
        drills: validated.drills.length > 0, inserters: validated.inserters.length > 0, belts: validated.belts.length > 0,
        chests: validated.chests.length > 0 };
    return applyPaste(current, validated, selections, selections.target ? fill ?? undefined : undefined);
}

const PATHS: Record<string, (text: string) => Promise<Config>> = {
    'a configuration file opened': async text => formDataToConfig(await opened(text)),
    'an example tried': async text => formDataToConfig(await opened(text, 'sample')),
    'a share link opened': async text => {
        const link = await encodeShareLink({ name: 'build', config: formDataToConfig(await opened(text)) }, 'https://example.invalid/');
        const hash = readShareHash(new URL(link).hash);
        if (hash.kind !== 'link') throw new Error('no link');
        const decoded = await decodeShareLink(hash);
        if (decoded.kind !== 'build') throw new Error(decoded.problem);
        return formDataToConfig(await opened(JSON.stringify(decoded.config)));
    },
    'a saved build reopened': async text => {
        const saved = readSavedConfig(serializeConfig(await opened(text)));
        const checked = await ask({ kind: 'saved-config', config: saved });
        if (checked.problem !== null) throw new Error(checked.problem);
        return formDataToConfig(checked.form as ConfigFormData);
    },
    'a Sidecar export pasted into a new build': async text => formDataToConfig(await pasted(createDefaultConfig(), sidecarExportOf(JSON.parse(text) as Config))),
};

describe.each(Object.keys(PATHS))('%s', path => {
    it.each(samples)('keeps the copy spacing and every lane fact of %s, and adds none', async (_name, file) => {
        const text = sampleText(file);
        const stated = statedLaneFacts(JSON.parse(text) as Config);
        expect(statedLaneFacts(await PATHS[path](text))).toEqual(stated);
    });
});

describe('a paste from Factorio', () => {
    /** One gear assembler fed from one belt lane, three copies five tiles apart, as the mod exports a selection of them */
    const exported = (belt: object, spacing?: { x: number; y: number }) => JSON.stringify({
        sidecar_version: LATEST_SIDECAR_VERSION,
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, prototype: 'assembling-machine-1' }],
        drills: { configs: [] },
        inserters: [
            { id: 1, source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, prototype: 'stack-inserter', quality: 'legendary' },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, prototype: 'stack-inserter', quality: 'legendary' },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', ...belt }],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }],
        suggested_target: { recipe: 'iron-gear-wheel', items_per_second: 0.5, copies: 1, ...(spacing && { copy_offset: spacing }) },
    });

    it('makes the copy spacing of the export the setpoint\'s, with the lane end and the flow direction it states', async () => {
        const config = formDataToConfig(await pasted(createDefaultConfig(), exported({ flow_direction: 4,
            lanes: [{ ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] }, { x: 5, y: 0 })));
        expect(config.setpoint).toEqual({ recipe: 'iron-gear-wheel', items_per_second: 0.5, copies: 1, copy_offset: { x: 5, y: 0 } });
        expect(plain(config.belts)).toEqual([{ id: 1, type: 'turbo-transport-belt', flow_direction: 4,
            lanes: [{ ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] }]);
    });

    it('writes no copy spacing where the export gives none', async () => {
        const config = formDataToConfig(await pasted(createDefaultConfig(), exported({ lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] })));
        expect(config.setpoint).toEqual({ recipe: 'iron-gear-wheel', items_per_second: 0.5, copies: 1 });
    });

    it('writes no lane end where the export states none, and the form shows the end the engine gives the lane by its role', async () => {
        const config = formDataToConfig(await pasted(createDefaultConfig(), exported({ lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] })));
        expect(plain(config.belts[0].lanes)).toEqual([{ ingredient: 'iron-plate', stack_size: 4 }]);
        const facts = formLaneFactsOf(config, await ask({ kind: 'lane-roles', config }));
        expect(facts?.of(1, 1)).toMatchObject({ role: 'input', end: 'dead_end' });
    });
});
