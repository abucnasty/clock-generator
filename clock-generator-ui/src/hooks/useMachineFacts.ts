import { useEffect, useState } from 'react';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';

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

// The facts of every machine settings asked for so far; machines configured alike share them
const requests = new Map<string, Promise<SerializableMachineFacts | null>>();
const known = new Map<string, SerializableMachineFacts | null>();

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
    const key = JSON.stringify([recipe, productivity, crafting_speed, type ?? null, energy_consumption_bonus ?? null]);
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
