import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import type { EngineAnswers, EngineQuery, WorkerRequest, WorkerResponse } from './types';
import { readConfigFile, readSavedBuild, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import type { ConfigFormData } from '../utils/configForm/formData';
import { decodeShareLink, encodeShareLink, readShareHash } from '../utils/shareLink';

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
        const saved = readSavedBuild(serializeConfig(await opened(text)));
        const checked = await ask({ kind: 'saved-config', config: saved });
        if (checked.problem !== null) throw new Error(checked.problem);
        return formDataToConfig(checked.form as ConfigFormData);
    },
};

describe.each(Object.keys(PATHS))('%s', path => {
    it.each(samples)('keeps the copy spacing and every lane fact of %s, and adds none', async (_name, file) => {
        const text = sampleText(file);
        const stated = statedLaneFacts(JSON.parse(text) as Config);
        expect(statedLaneFacts(await PATHS[path](text))).toEqual(stated);
    });
});
