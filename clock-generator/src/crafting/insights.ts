import { SerializableMachineFacts } from "../data-types/machine-facts";
import { InserterStatus, MachineStatus } from "../state";
import type { BlueprintGenerationResult } from "./generate-blueprint";
import { SerializableEntityStateTransitions, SerializableStateTransitionHistory } from "./sequence/state-transition-serializer";

/** Facts of one machine of the build, for explaining what its limits allow */
export interface MachineFactsEntry {
    entity_id: string;
    facts: SerializableMachineFacts;
}

/**
 * Something the simulation found that is worth explaining to someone reading a potential clock, as a what, a why
 * and an explanation.
 */
export interface ClockInsight {
    id: string;
    /** "build" holds for every potential clock of the configuration, "clock" for the one it is listed under */
    scope: "build" | "clock";
    title: string;
    /** What the simulation found, with this build's numbers */
    what: string;
    /** Why the game behaves that way */
    why: string;
    /** What that means for the clock */
    explanation: string;
    /** The numbers behind the text */
    table?: { columns: string[]; rows: string[][] };
    /** Drop ticks of the plan and of the exported clock per inserter, for drawing them against each other */
    swing_comparison?: SwingComparison;
}

export interface SwingComparison {
    /** Length of the compared run in ticks */
    period: number;
    inserters: { label: string; planned: number[]; clocked: number[] }[];
}

/** Drop ticks further apart than this between the plan and the clock-only run count as a different swing */
const SAME_SWING_TOLERANCE_TICKS = 4;

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const ticksList = (ticks: number[]) => ticks.length === 0 ? "never" : ticks.join(", ");

function workingTicks(entity: SerializableEntityStateTransitions, period: number): number {
    const sorted = [...entity.transitions].sort((a, b) => a.tick - b.tick);
    const segments = [
        { status: entity.initial_status, start: 0, end: sorted[0]?.tick ?? period },
        ...sorted.map(it => ({ status: it.to_status, start: it.tick, end: it.tick + it.duration_ticks })),
    ];
    return segments
        .filter(it => it.status === MachineStatus.WORKING)
        .reduce((sum, it) => sum + Math.max(0, Math.min(it.end, period) - Math.max(it.start, 0)), 0);
}

function dropTicks(history: SerializableStateTransitionHistory, entity_id: string): number[] {
    return (history.entities.find(it => it.entity_id === entity_id)?.transitions ?? [])
        .filter(it => it.to_status === InserterStatus.DROP_OFF && it.from_status !== InserterStatus.TARGET_FULL)
        .map(it => it.tick)
        .sort((a, b) => a - b);
}

/** How much of each clock period the machines are not needed, the slack all timing has to fit in */
function spareTimeInsight(result: BlueprintGenerationResult, run: SerializableStateTransitionHistory): ClockInsight | null {
    const period = run.total_duration_ticks;
    const machines = run.entities.filter(it => it.entity_type === "machine").map(entity => {
        const working = workingTicks(entity, period);
        const facts = result.machine_facts.find(it => it.entity_id === entity.entity_id)?.facts;
        return { entity, working, spare: period - working, facts };
    });
    if (machines.length === 0) {
        return null;
    }
    const tightest = machines.reduce((a, b) => b.spare < a.spare ? b : a);
    const crafts = tightest.facts ? Math.round(tightest.working / tightest.facts.ticks_per_craft) : null;
    return {
        id: "spare-time",
        scope: "build",
        title: `${tightest.entity.label} has ${round(tightest.spare)} ticks to spare each clock period`,
        what: `${tightest.entity.label} crafts for ${round(tightest.working)} of the ${round(period, 3)} ticks in a clock period`
            + (crafts !== null && tightest.facts ? ` (${crafts} crafts of ${round(tightest.facts.ticks_per_craft)} ticks)` : "")
            + ` and is stopped for the other ${round(tightest.spare)}.`
            + (machines.length > 1 ? " It is the machine with the least time to spare." : ""),
        why: "At the target rate a machine is not needed the whole time. The ticks left over are the only slack it has: "
            + "every tick it waits for an ingredient, or stops because its output has not been taken, comes out of them.",
        explanation: `The swings can make ${tightest.entity.label} wait up to ${round(tightest.spare)} ticks per period. `
            + "Any more and it cannot catch up, so the build falls behind the target. The less there is to spare, the less room "
            + "there is to move swings around and the less a late belt pickup is forgiven.",
        table: {
            columns: ["Machine", "Crafting (ticks)", "Stopped (ticks)", "Ticks per craft"],
            rows: machines.map(it => [it.entity.label, `${round(it.working)}`, `${round(it.spare)}`,
                it.facts ? `${round(it.facts.ticks_per_craft)}` : ""]),
        },
    };
}

/** Per ingredient: when the machine takes it, how much comes per hand and how many hands a period needs */
function insertionLimitsInsight(result: BlueprintGenerationResult, entities: SerializableEntityStateTransitions[]): ClockInsight | null {
    const rows: { machine: string; item: string; per_craft: number; limit: number; inserter: string; hand: number; hands: number }[] = [];
    for (const planned of result.serializable_transfer_plan.entities) {
        const inserter = entities.find(it => it.entity_id === planned.entity_id);
        const machine = result.machine_facts.find(it => it.entity_id === inserter?.sink?.entity_id);
        if (planned.entity_type !== "inserter" || inserter === undefined || machine === undefined) {
            continue;
        }
        for (const transfer of planned.item_transfers) {
            const input = machine.facts.inputs.find(it => it.item_name === transfer.item_name);
            if (input === undefined) {
                continue;
            }
            rows.push({
                machine: inserter.sink!.label,
                item: transfer.item_name,
                per_craft: input.amount_per_craft,
                limit: input.automated_insertion_limit,
                inserter: inserter.label,
                hand: planned.stack_size,
                hands: transfer.numerator / transfer.denominator * result.used_lcm,
            });
        }
    }
    if (rows.length === 0) {
        return null;
    }
    // the ingredient with the most hands per period is the one whose hands have to be spaced by the limit
    const example = rows.reduce((a, b) => b.hands > a.hands ? b : a);
    return {
        id: "insertion-limits",
        scope: "build",
        title: "Each machine only takes an ingredient while it is below its insertion limit",
        what: `${example.machine} takes ${example.item} only while it holds fewer than ${example.limit}. `
            + `${example.inserter} brings ${example.hand} at a time and the clock period needs ${round(example.hands, 2)} `
            + `hand${example.hands === 1 ? "" : "s"} of it.`,
        why: "An inserter puts an item into a machine only while the machine holds less of it than the insertion limit: the amount "
            + "for one craft times a multiplier that grows with the machine's crafting speed. A hand that starts under the limit goes "
            + "in whole, even past the limit, but the next hand has to wait until crafting has used enough.",
        explanation: "A window only does something while its machine is under the limit. An inserter enabled too early sits idle until "
            + "enough has been crafted, and its window can close before that. An ingredient that needs several hands per period "
            + "cannot have them back to back once the machine holds the limit or more.",
        table: {
            columns: ["Machine", "Ingredient", "Per craft", "Insertion limit", "Brought by", "Per hand", "Hands per period"],
            rows: rows.map(it => [it.machine, it.item, `${it.per_craft}`, `${it.limit}`, it.inserter, `${it.hand}`, `${round(it.hands, 2)}`]),
        },
    };
}

/** How long a machine takes to make a full hand for the inserter that empties it */
function outputHandInsight(result: BlueprintGenerationResult, entities: SerializableEntityStateTransitions[]): ClockInsight | null {
    const rows: { machine: string; item: string; inserter: string; hand: number; per_craft: number; crafts: number; ticks: number }[] = [];
    for (const planned of result.serializable_transfer_plan.entities) {
        const inserter = entities.find(it => it.entity_id === planned.entity_id);
        const machine = result.machine_facts.find(it => it.entity_id === inserter?.source?.entity_id);
        if (planned.entity_type !== "inserter" || inserter === undefined || machine === undefined || machine.facts.output_per_craft <= 0) {
            continue;
        }
        const crafts = planned.stack_size / machine.facts.output_per_craft;
        rows.push({
            machine: inserter.source!.label,
            item: machine.facts.output_item,
            inserter: inserter.label,
            hand: planned.stack_size,
            per_craft: machine.facts.output_per_craft,
            crafts,
            ticks: crafts * machine.facts.ticks_per_craft,
        });
    }
    if (rows.length === 0) {
        return null;
    }
    const example = rows.reduce((a, b) => b.ticks > a.ticks ? b : a);
    return {
        id: "output-hand",
        scope: "build",
        title: `A full hand of ${example.item} takes ${round(example.ticks)} ticks to make`,
        what: `${example.machine} makes ${round(example.per_craft, 2)} ${example.item} per craft (productivity included), so the `
            + `${example.hand} that ${example.inserter} carries take ${round(example.crafts)} crafts, about ${round(example.ticks)} ticks.`,
        why: "A stack inserter leaves with a full hand. If it finds less, it picks up what is there and waits, and when its clock "
            + "window closes it keeps holding those items until the next window.",
        explanation: `A swing that comes sooner than ${round(example.ticks)} ticks after the last one finds a partial hand unless the machine `
            + "had items left over. That is not a problem by itself: the held items leave the machine's output free so it keeps "
            + "crafting, and the swing completes in a later window. It does mean drops need not line up one to one with windows.",
        table: {
            columns: ["Machine", "Item", "Taken by", "Hand", "Per craft", "Crafts per hand", "Ticks per hand"],
            rows: rows.map(it => [it.machine, it.item, it.inserter, `${it.hand}`, `${round(it.per_craft, 2)}`, `${round(it.crafts)}`, `${round(it.ticks)}`]),
        },
    };
}

/** Inserters that drop at other ticks when only the clock drives them than they did in the plan */
function planVersusClockInsight(result: BlueprintGenerationResult): ClockInsight | null {
    const clock_only = result.clock_only_run?.state_transition_history;
    // shifted swings were moved off the plan on purpose; their own insight says where to
    if (clock_only === undefined || result.shifted_cycle !== undefined) {
        return null;
    }
    const plan = result.serializable_state_transition_history;
    const differing = plan.entities.filter(it => it.entity_type === "inserter").map(entity => ({
        label: entity.label,
        planned: dropTicks(plan, entity.entity_id),
        clocked: dropTicks(clock_only, entity.entity_id),
    })).filter(({ planned, clocked }) => planned.length !== clocked.length
        || planned.some((tick, index) => Math.abs(tick - clocked[index]) > SAME_SWING_TOLERANCE_TICKS));
    if (differing.length === 0) {
        return null;
    }
    const example = differing[0];
    return {
        id: "plan-versus-clock",
        scope: "clock",
        title: "The exported clock does not swing exactly as planned",
        what: `Driven only by its clock windows, ${example.label} drops at ticks ${ticksList(example.clocked)} `
            + `where the plan had ${ticksList(example.planned)}.`
            + (differing.length > 1 ? ` ${differing.length - 1} more inserter${differing.length === 2 ? " differs" : "s differ"} too.` : ""),
        why: "The plan decides each swing by looking at what the machines hold. The blueprint only has the clock. In game a window "
            + "also stays on a couple of ticks longer than the decider (circuit latency), so an inserter that is back before it "
            + "closes can start another swing if a full hand is waiting, and one that finds less keeps what it picked up for a "
            + "later window.",
        explanation: "When the clock is stable the same number of items moves per period either way, but the drops can bunch together "
            + "instead of landing one batch per window. The Timelines tab shows both runs; the exported clock is the one the "
            + "blueprint follows.",
        table: {
            columns: ["Inserter", "Plan drops at", "Exported clock drops at"],
            rows: differing.map(it => [it.label, ticksList(it.planned), ticksList(it.clocked)]),
        },
        swing_comparison: {
            period: Math.max(plan.total_duration_ticks, clock_only.total_duration_ticks),
            inserters: differing.map(({ label, planned, clocked }) => ({ label, planned, clocked })),
        },
    };
}

/** Why a clock that misses the expected output is listed as unstable */
function unstableInsight(result: BlueprintGenerationResult): ClockInsight {
    const check = result.stability_check;
    const as_built = check.as_built;
    const actual = as_built?.actual_output_items ?? check.actual_output_items;
    const repeats = as_built?.repeat_periods !== undefined && as_built.repeat_output_items !== undefined
        ? ` The build repeats every ${as_built.repeat_periods} periods and moves ${as_built.repeat_output_items} of `
            + `${check.expected_output_items * as_built.repeat_periods} items over them.`
        : "";
    const offset = as_built?.failed_start_offset;
    return {
        id: "unstable",
        scope: "clock",
        title: "This clock does not hold the target rate",
        what: `Driven only by its clock windows, the build moved ${actual} of ${check.expected_output_items} items in a clock period`
            + (offset ? ` when the clock started ${offset} ticks later relative to the machines` : "") + `.${repeats}`,
        why: "A clock has to work from wherever the machines happen to be when it starts, so it is simulated from several start "
            + "points. A swing that arrives while its machine is at an insertion limit, out of ingredients or without a full hand "
            + "does nothing useful, and once a machine has waited longer than its spare time it cannot catch up.",
        explanation: "Use a potential clock marked Stable. If none is, lower the target rate, force fewer output swings (which gives "
            + "the machines more buffer between swings), or yell at abuc to go fix his algorithm.",
    };
}

/** The insights for one potential clock, the ones about the whole build first */
export function clockInsights(result: BlueprintGenerationResult, is_stable: boolean): ClockInsight[] {
    // the run the blueprint follows; build-wide numbers are only read from a clock that holds the target
    const run = result.clock_only_run?.state_transition_history ?? result.serializable_state_transition_history;
    // an inserter that never moved in one run is only listed in the other
    const entities = [...run.entities, ...result.serializable_state_transition_history.entities];
    const insights: (ClockInsight | null)[] = [
        is_stable ? spareTimeInsight(result, run) : null,
        insertionLimitsInsight(result, entities),
        outputHandInsight(result, entities),
        is_stable ? null : unstableInsight(result),
        is_stable ? planVersusClockInsight(result) : null,
    ];
    return insights.filter((it): it is ClockInsight => it !== null);
}
