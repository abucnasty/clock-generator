import { useEffect, useMemo, useState } from 'react';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';
import { machinesMaxOf, type MachinesMax } from '../utils/targetRateLimit';

interface UseMachineFactsParams {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    type?: 'machine' | 'furnace' | 'biochamber';
    energy_consumption_bonus?: number;
}

interface UseMachineFactsResult {
    facts: SerializableMachineFacts | null;
    error: string | null;
}

// The facts of every machine setting asked for so far; machines configured alike share them
const requests = new Map<string, Promise<SerializableMachineFacts | null>>();
const known = new Map<string, SerializableMachineFacts | null>();

type FactsKey = [string, number, number, UseMachineFactsParams['type'] | null, number | null];

function keyOf({ recipe, productivity, crafting_speed, type, energy_consumption_bonus }: UseMachineFactsParams): string {
    const key: FactsKey = [recipe, productivity, crafting_speed, type ?? null, energy_consumption_bonus ?? null];
    return JSON.stringify(key);
}

function paramsOf(key: string): UseMachineFactsParams {
    const [recipe, productivity, crafting_speed, type, energy_consumption_bonus] = JSON.parse(key) as FactsKey;
    return { recipe, productivity, crafting_speed, type: type ?? undefined, energy_consumption_bonus: energy_consumption_bonus ?? undefined };
}

function requestFacts(key: string, params: UseMachineFactsParams): Promise<SerializableMachineFacts | null> {
    let request = requests.get(key);
    if (!request) {
        request = askEngine({ kind: 'machine-facts', params }).then((facts) => {
            known.set(key, facts);
            return facts;
        });
        // a failed request is asked again the next time
        request.catch(() => requests.delete(key));
        requests.set(key, request);
    }
    return request;
}

/**
 * Hook to compute machine facts on-the-fly based on the machine's settings.
 *
 * The engine's worker computes them. Facts computed before are at hand at once; while new ones are computed, the
 * last ones stay shown, so the form does not flicker.
 */
export function useMachineFacts(params: UseMachineFactsParams): UseMachineFactsResult {
    const { recipe, productivity, crafting_speed, type, energy_consumption_bonus } = params;
    const key = keyOf(params);
    const [shown, setShown] = useState<UseMachineFactsResult>({ facts: null, error: null });

    useEffect(() => {
        if (!recipe || known.has(key)) {
            return;
        }
        let current = true;
        requestFacts(key, { recipe, productivity, crafting_speed, type, energy_consumption_bonus }).then(
            (facts) => {
                if (current) setShown({ facts, error: null });
            },
            (e) => {
                if (current) setShown({ facts: null, error: e instanceof Error ? e.message : 'Unknown error' });
            },
        );
        return () => {
            current = false;
        };
    }, [key, recipe, productivity, crafting_speed, type, energy_consumption_bonus]);

    if (!recipe) {
        return { facts: null, error: null };
    }
    const facts = known.get(key);
    return facts !== undefined ? { facts, error: null } : shown;
}

interface MachineSettings extends UseMachineFactsParams {
    id: number;
}

/**
 * The most the machines making `recipe` can make together in one copy of the build, from their Machine Facts. Null
 * when none makes it, and while the facts of one of them are still being worked out (or could not be).
 */
export function useMachinesMax(recipe: string, machines: MachineSettings[]): MachinesMax | null {
    const making = recipe ? machines.filter((machine) => machine.recipe === recipe) : [];
    const keys = making.map(keyOf);
    const wanted = JSON.stringify(keys.filter((key) => !known.has(key)));
    // counts the facts that have come in, so that the page is drawn again with them
    const [, setArrived] = useState(0);

    useEffect(() => {
        let current = true;
        for (const key of JSON.parse(wanted) as string[]) {
            requestFacts(key, paramsOf(key)).then(
                () => {
                    if (current) setArrived((count) => count + 1);
                },
                // facts that fail leave the sum unknown: no problem found, rather than one from a sum that is too low
                () => {},
            );
        }
        return () => {
            current = false;
        };
    }, [wanted]);

    const max = machinesMaxOf(making.map((machine, index) => ({
        id: machine.id,
        maxRate: known.get(keys[index])?.output_rate_per_second,
    })));
    // the same object while the machines and their sum are the same, for what is worked out from it
    const ids = max?.machineIds.join(',') ?? null;
    const perCopy = max?.perCopy ?? null;
    return useMemo(
        () => (ids === null || perCopy === null ? null : { machineIds: ids.split(',').map(Number), perCopy }),
        [ids, perCopy],
    );
}
