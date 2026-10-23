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
            ? 'Other starting states were not tried.'
            : 'Results for other starting states are unavailable.');
    }
    const missing = clocks.length - evaluated.length;
    return `${partial}Tried from ${samples} other starting states, across ${evaluated.length} of ${clocks.length} clocks.`
        + (missing > 0 ? ` Results for other starting states are unavailable for ${missing}.` : '');
}

/** The cold start every clock is tested from, for the card's details */
export const COLD_START = 'Tested in the simulator from a cold start: full input, empty machines and inserters, the clock at its first tick. Rates are read once the machines have warmed up.';
/** The same, with what it does not promise, for the Overview */
export const MODELED_START = 'Tested from a cold start: full input, empty machines and inserters, the clock at its first tick. The clock is planned on a separate copy of the build, and rates are read once the machines have warmed up, so they do not promise the target in the first period, or from every state a running build can be in.';
/** What the tests do not cover, last in the Overview's list */
export const START_LIMITS = 'None of this covers every stock of items in a running build, the order you build it in, how much a real belt carries, or recovery in the game. Belt slack is a rule of thumb, not a check of what the belt carries.';
/** How many other places in its period the clock was tried from */
export const phaseChecksText = (checked: number | undefined): string => checked === undefined
    ? 'How many other places in its period the clock was tried from is unavailable.'
    : `The clock was also tried from ${checked} other places in its period. More starting states can be sampled separately.`;

/** Where the output inserters drop onto a belt was not given: what the simulator does instead */
export const freeLaneDropText = (belt: string): string =>
    `Where the output inserters drop onto ${belt} was not given, so each is treated as dropping onto its own stretch of empty belt; two that share a belt in the game could get in each other's way.`;

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
            ? `${entityLabel('belt', drop.beltId)}: the drop positions you gave are used to space the drops of ${drop.inserterIds.map(id => entityLabel('inserter', id)).join(', ')} on the belt.`
            : freeLaneDropText(entityLabel('belt', drop.beltId))),
        ...facts.machineFuel.map(machine => `${entityLabel('machine', machine.machineId)}: imported fuel ${itemLabel(machine.fuel)}.`),
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
