import { useMemo } from 'react';
import type { SerializableMachineFacts } from 'clock-generator/browser';

export interface UseMachineFactsParams {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    type?: 'machine' | 'furnace' | 'biochamber';
    energy_consumption_bonus?: number;
}

export interface UseMachineFactsResult {
    facts: SerializableMachineFacts | null;
    error: string | null;
}

// Dynamic import cache for the clock-generator module
let Machine: typeof import('clock-generator/browser').Machine | null = null;
let modulePromise: Promise<typeof import('clock-generator/browser')> | null = null;

async function loadModule() {
    if (!modulePromise) {
        modulePromise = import('clock-generator/browser');
    }
    const mod = await modulePromise;
    Machine = mod.Machine;
    return mod;
}

// Synchronous computation once module is loaded
function computeFactsSync(params: UseMachineFactsParams): SerializableMachineFacts | null {
    if (!Machine || !params.recipe) {
        return null;
    }
    try {
        return Machine.computeMachineFacts({
            recipe: params.recipe,
            productivity: params.productivity,
            crafting_speed: params.crafting_speed,
            type: params.type,
            energy_consumption_bonus: params.energy_consumption_bonus,
        });
    } catch {
        return null;
    }
}

/**
 * Hook to compute machine facts on-the-fly based on machine configuration.
 * Uses memoization to avoid recomputation when inputs haven't changed.
 * 
 * Note: This hook requires the clock-generator module to be loaded first.
 * Call `initializeMachineFacts()` during app initialization.
 */
export function useMachineFacts(params: UseMachineFactsParams): UseMachineFactsResult {
    const { recipe, productivity, crafting_speed, type, energy_consumption_bonus } = params;

    const result = useMemo(() => {
        if (!recipe) {
            return { facts: null, error: null };
        }

        if (!Machine) {
            return { facts: null, error: 'Module not loaded' };
        }

        try {
            const facts = computeFactsSync({ recipe, productivity, crafting_speed, type, energy_consumption_bonus });
            return { facts, error: null };
        } catch (e) {
            return { facts: null, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }, [recipe, productivity, crafting_speed, type, energy_consumption_bonus]);

    return result;
}

/**
 * Initialize the machine facts module. Call this once during app startup.
 */
export async function initializeMachineFacts(): Promise<void> {
    await loadModule();
}

/**
 * Check if the machine facts module is loaded.
 */
export function isMachineFactsReady(): boolean {
    return Machine !== null;
}
