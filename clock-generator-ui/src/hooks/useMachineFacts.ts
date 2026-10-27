import { useEffect, useMemo, useState } from 'react';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';
import { machinesMaxOf, type MachinesMax } from '../utils/targetRateLimit';
import type { TargetCounts } from '../utils/targetCounts';

interface UseMachineFactsParams {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    /** The machine's prototype, from which the engine works out how it is simulated */
    prototype?: string;
    energy_consumption_bonus?: number;
    fuel?: string;
}

interface UseMachineFactsResult {
    facts: SerializableMachineFacts | null;
    error: string | null;
    updating: boolean;
}

// Machines configured alike share pending work and resolved facts.
const requests = new Map<string, Promise<SerializableMachineFacts | null>>();
const known = new Map<string, SerializableMachineFacts | null>();

type FactsKey = [string, number, number, string | null, number | null, string | null];

function keyOf({ recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel }: UseMachineFactsParams): string {
    const key: FactsKey = [recipe, productivity, crafting_speed, prototype ?? null, energy_consumption_bonus ?? null, fuel ?? null];
    return JSON.stringify(key);
}

function paramsOf(key: string): UseMachineFactsParams {
    const [recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel] = JSON.parse(key) as FactsKey;
    return { recipe, productivity, crafting_speed, prototype: prototype ?? undefined, energy_consumption_bonus: energy_consumption_bonus ?? undefined, fuel: fuel ?? undefined };
}

function requestFacts(key: string, params: UseMachineFactsParams): Promise<SerializableMachineFacts | null> {
    // A request may finish between another consumer's render and its effect.
    if (known.has(key)) return Promise.resolve(known.get(key) ?? null);
    let request = requests.get(key);
    if (!request) {
        request = askEngine({ kind: 'machine-facts', params }).then(
            (facts) => {
                known.set(key, facts);
                requests.delete(key);
                return facts;
            },
            (error) => {
                requests.delete(key);
                throw error;
            },
        );
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
    const { recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel } = params;
    const key = keyOf(params);
    const [shown, setShown] = useState<{ key: string; facts: SerializableMachineFacts | null; error: string | null }>({ key: '', facts: null, error: null });

    useEffect(() => {
        if (!recipe || known.has(key)) {
            return;
        }
        let current = true;
        requestFacts(key, { recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel }).then(
            (facts) => {
                if (current) setShown({ key, facts, error: null });
            },
            (e) => {
                if (current) setShown({ key, facts: null, error: e instanceof Error ? e.message : 'Unknown error' });
            },
        );
        return () => {
            current = false;
        };
    }, [key, recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel]);

    if (!recipe) {
        return { facts: null, error: null, updating: false };
    }
    const facts = known.get(key);
    return known.has(key)
        ? { facts: facts ?? null, error: null, updating: false }
        : { facts: shown.facts, error: shown.error, updating: shown.key !== key };
}

interface MachineSettings extends UseMachineFactsParams {
    id: number;
    /** What the machine puts into its result target is taken back into it (see `resultComesBack`) */
    comesBack?: boolean;
}

/**
 * The most the machines making the target `recipe` can make together in one copy of the build (or, for a target that
 * counts the item destroyed, the most they destroy), from their Machine Facts (see `machinesMaxOf`). Null when none
 * makes it, and while the facts of a machine are still being worked out.
 */
export function useMachinesMax(recipe: string, machines: MachineSettings[], counts: TargetCounts = 'made'): MachinesMax | null {
    const withRecipe = recipe ? machines.filter((machine) => machine.recipe !== '') : [];
    const keys = withRecipe.map(keyOf);
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

    const max = machinesMaxOf(recipe, withRecipe.map((machine, index) => ({ id: machine.id, facts: known.get(keys[index]), comesBack: machine.comesBack })), counts);
    // the same object while the machines and their sum are the same, for what is worked out from it
    const ids = max?.machineIds.join(',') ?? null;
    const perCopy = max?.perCopy ?? null;
    const numerator = max?.perCopyRatio?.numerator ?? null;
    const denominator = max?.perCopyRatio?.denominator ?? null;
    return useMemo(
        () => (ids === null || perCopy === null ? null : {
            machineIds: ids.split(',').map(Number),
            perCopy,
            ...(numerator !== null && denominator !== null && { perCopyRatio: { numerator, denominator } }),
        }),
        [ids, perCopy, numerator, denominator],
    );
}
