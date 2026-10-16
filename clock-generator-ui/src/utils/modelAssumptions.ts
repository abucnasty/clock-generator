import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';
import { entityLabel } from './entityLabel';

/** Only actual outcomes count as evaluated; the requested flag and null are never successful checks. */
export function startCheckSummary(clocks: Pick<ClockAlternativeView, 'assessment'>[], generation: GenerationAssumptions | null): string {
    const partial = generation?.complete === false ? 'This generation is incomplete. ' : '';
    if (clocks.length === 0) return `${partial}No clocks were available to check.`;
    const evaluated = clocks.filter(clock => (clock.assessment.start_dependence?.starts.length ?? 0) > 0);
    const samples = evaluated.reduce((sum, clock) => sum + clock.assessment.start_dependence!.starts.length, 0);
    if (evaluated.length === 0) {
        return partial + (generation?.startDependenceRequested === false
            ? 'Other startup conditions were not checked.'
            : 'Other-start check results are unavailable.');
    }
    const missing = clocks.length - evaluated.length;
    return `${partial}${samples} sampled starts evaluated across ${evaluated.length} of ${clocks.length} clocks.`
        + (missing > 0 ? ` Other-start results are unavailable for ${missing}.` : '');
}

export const MODELED_START = 'Modeled cold start: full input supplies; empty machines, buffers and hands; clock phase 0.';
export const PLANNING_START = 'Planning uses a separate prepared build. Rates are assessed after model warm-up and checks; they do not promise the target in the first period or convergence from every live build state.';

export function modeledDetails(clock: ClockAlternativeView, itemLabel: (id: string) => string = (id) => id): string[] {
    const facts = clock.assumptions;
    if (!facts) return [];
    return [
        ...facts.loopSeeds.map(seed => {
            const id = /^machine:(\d+)$/.exec(seed.machineId);
            const machine = id ? entityLabel('machine', Number(id[1])) : seed.machineId;
            return `${machine} starts once with ${seed.items} ${itemLabel(seed.item)}. Losing that seed is a separate recovery question.`;
        }),
        ...facts.outputDrops.map(drop => drop.mode === 'shared-lanes'
            ? `${entityLabel('belt', drop.beltId)}: supplied output drop positions model shared lane spacing for ${drop.inserterIds.map(id => entityLabel('inserter', id)).join(', ')}.`
            : `${entityLabel('belt', drop.beltId)}: shared output-lane drop positions were not supplied; this run uses free-lane drop timing.`),
        ...facts.machineFuel.map(machine => `${entityLabel('machine', machine.machineId)}: imported fuel ${itemLabel(machine.fuel)}.`),
        ...(facts.overrides !== undefined ? [`Explicit run overrides: ${JSON.stringify(facts.overrides)}.`] : []),
    ];
}
