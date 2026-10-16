import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';

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

export function modeledDetails(clock: ClockAlternativeView): string[] {
    const facts = clock.assumptions;
    if (!facts) return [];
    return [
        ...facts.loopSeeds.map(seed => `${seed.machineId} starts once with ${seed.items} ${seed.item}. Losing that seed is a separate recovery question.`),
        ...facts.outputDrops.map(drop => drop.mode === 'shared-lanes'
            ? `Belt ${drop.beltId}: supplied output drop positions model shared lane spacing for inserters ${drop.inserterIds.join(', ')}.`
            : `Belt ${drop.beltId}: shared output-lane drop positions were not supplied; this run uses free-lane drop timing.`),
        ...facts.machineFuel.map(machine => `Machine ${machine.machineId}: imported fuel ${machine.fuel}.`),
        ...(facts.overrides !== undefined ? [`Explicit run overrides: ${JSON.stringify(facts.overrides)}.`] : []),
    ];
}
