import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';
import { entityInSentence, machineInSentence, nameInSentence, sentenceStart } from './entityLabel';

/** Only actual outcomes count as evaluated; the requested flag and null are never successful checks. */
export function startCheckSummary(clocks: Pick<ClockAlternativeView, 'assessment'>[], generation: GenerationAssumptions | null): string {
    const partial = generation?.complete === false ? 'This generation is incomplete. ' : '';
    if (clocks.length === 0) return `${partial}No clocks were available to check.`;
    const evaluated = clocks.filter(clock => (clock.assessment.start_dependence?.starts.length ?? 0) > 0);
    const samples = evaluated.reduce((sum, clock) => sum + clock.assessment.start_dependence!.starts.length, 0);
    if (evaluated.length === 0) {
        return partial + (generation?.startDependenceRequested === false
            ? 'Other starting states were not tried.'
            : 'Results for other starting states are unavailable.');
    }
    const missing = clocks.length - evaluated.length;
    return `${partial}Tried from ${samples} other starting states, across ${evaluated.length} of ${clocks.length} clocks.`
        + (missing > 0 ? ` Results for other starting states are unavailable for ${missing}.` : '');
}

/** The cold start every clock is tested from, for the card's details */
export const COLD_START = 'Tested in the simulator from a cold start: full input, empty machines and inserters, the clock at its first tick. Rates are read at steady state.';
/** The same, with what it does not promise, for the Overview */
export const MODELED_START = 'Tested from a cold start: full input, empty machines and inserters, the clock at its first tick. The clock is planned on a separate copy of the build, and rates are read at steady state, so they do not promise the setpoint in the first window cycle, or from every state a running build can be in.';
/** What the tests do not cover, last in the Overview's list */
export const START_LIMITS = 'None of this covers every stock of items in a running build, the order you build it in, how much a real belt carries, or recovery in the game.';
/** How many other places in its window cycle the clock was tried from */
export const phaseChecksText = (checked: number | undefined): string => checked === undefined
    ? 'How many other places in its window cycle the clock was tried from is unavailable.'
    : `The clock was also tried from ${checked} other places in its window cycle. More starting states can be sampled separately.`;

/** Where the output inserters drop onto a belt was not given: what the simulator does instead */
export const freeLaneDropText = (belt: string): string =>
    `Where the output inserters drop onto ${belt} was not given, so each is treated as dropping onto its own stretch of empty belt; two that share a belt in the game could get in each other's way.`;

/** What the model assumed of the selected clock's build; a machine by its kind and recipe in the game's names (machineInSentence) */
export function modeledDetails(clock: ClockAlternativeView, itemLabel: (id: string) => string = (id) => id,
    recipeLabel: (id: string) => string = (id) => id): string[] {
    const facts = clock.assumptions;
    if (!facts) return [];
    const machine = (id: number | string) => sentenceStart(machineInSentence(id, facts.machines, { itemLabel, recipeLabel }));
    return [
        ...facts.kickStarts.map(seed =>
            `${machine(seed.machineId)} gets a kick start of ${seed.items} ${nameInSentence(itemLabel(seed.item))}. Losing those items is a separate recovery question.`),
        ...facts.outputDrops.map(drop => drop.mode === 'shared-lanes'
            ? `${sentenceStart(entityInSentence('belt', drop.beltId, facts.entityNames))}: the drop positions you gave are used to space the drops of `
                + `${drop.inserterIds.map(id => entityInSentence('inserter', id, facts.entityNames)).join(', ')} on the belt.`
            : freeLaneDropText(entityInSentence('belt', drop.beltId, facts.entityNames))),
        ...facts.machineFuel.map(fuel => `${machine(fuel.machineId)}: imported fuel ${nameInSentence(itemLabel(fuel.fuel))}.`),
        ...(facts.overrides !== undefined ? [`Explicit run overrides: ${JSON.stringify(facts.overrides)}.`] : []),
    ];
}

/** What the clocks assumed of the inserters because the build does not say; one sentence when it says everything */
export function assumptionsText({ count, missingType, missingQuality, automatic, unavailable }: {
    count: number; missingType: number; missingQuality: number; automatic: number; unavailable: number;
}): string {
    const have = (n: number) => `${n} ${n === 1 ? 'inserter has' : 'inserters have'}`;
    const parts = [
        missingType > 0 ? `${have(missingType)} no type set, so stack inserter timing is assumed.` : null,
        missingQuality > 0 ? `${have(missingQuality)} no quality set, so legendary timing is assumed.` : null,
        automatic > 0
            ? `Hand sizes: ${count - automatic} are set in your build and ${automatic} follow your research${unavailable > 0 ? ` (${unavailable} unavailable: supported types assume full research)` : ''}.`
            : null,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? 'Inserter types, qualities and hand sizes are all set in your build; none were assumed.' : parts.join(' ');
}
