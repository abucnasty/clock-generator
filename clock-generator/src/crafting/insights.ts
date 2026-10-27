import { SerializableMachineFacts } from "../data-types/machine-facts";
import { InserterStatus, MachineStatus } from "../state";
import { MAX_RECOVERY_PERIODS, type BackpressureLossVerdict } from "./backpressure-loss";
import { describeSharedItem, type SharedItemDeadlockRisk } from "./deadlock-risk";
import type { BlueprintGenerationResult } from "./generate-blueprint";
import { SerializableEntityStateTransitions, SerializableStateTransitionHistory } from "./sequence/state-transition-serializer";
import { DEFAULT_LOOP_SEED_ITEMS } from "./runner/cold-start";
import type { StartDependence } from "./start-dependence";
import { notTriedSentence, type SpareTime } from "./why-not-stable";
import { FactorioDataService } from "../data";
import { BELT_PICKUP_CALIBRATION, describeUncalibratedPickup, uncalibratedBeltPickups } from "../config/pickup-calibration";
import type { Config } from "../config/schema";
import { describeSideLoadedDrop, SIDE_LOADED_DROP_ADVICE, SIDE_LOADED_DROP_TITLE, sideLoadedDrops } from "../config/side-loaded-drop";
import { chestName } from "../common/entity-types";
import { chestDrillBecause } from "./chest-drill-windows";
import { describeDropSpacing, dropSpacing, dropSpacingTable } from "../config/drop-spacing";
import { lanesExactlyFull, lanesExactlyFullNote } from "../config/lane-capacity-validator";

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
    /** The spare-time insight's tightest machine, in numbers (see whyNotStable) */
    spare_time?: SpareTime;
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
        spare_time: { machine: tightest.entity.label, spare_ticks: tightest.spare, working_ticks: tightest.working,
            recovery_periods: MAX_RECOVERY_PERIODS },
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

/** Machines whose recipe makes one of its own ingredients, which the simulation starts already holding that ingredient */
function loopingRecipeInsight(result: BlueprintGenerationResult, entities: SerializableEntityStateTransitions[], loop_seed_items: number): ClockInsight | null {
    const rows = result.machine_facts.flatMap(machine => machine.facts.inputs
        .filter(input => FactorioDataService.findRecipeOrThrow(machine.facts.recipe).results.some(output => output.name === input.item_name))
        .map(input => ({
            machine: entities.find(it => it.entity_id === machine.entity_id)?.label ?? machine.entity_id,
            recipe: machine.facts.recipe,
            item: input.item_name,
            per_craft: input.amount_per_craft,
            started_with: loop_seed_items,
        })));
    if (rows.length === 0) {
        return null;
    }
    const example = rows[0];
    return {
        id: "looping-recipe",
        scope: "build",
        title: `The ${example.recipe} recipe needs ${example.item} to make ${example.item}`,
        what: "The modeled cold trial gives a one-time seed: "
            + rows.map(it => `${it.machine} starts with ${it.started_with} ${it.item}`).join("; ") + ". These recipes consume an item they also produce.",
        why: "A machine does not craft from what it has just made: its products go to the output, and the ingredient has to be "
            + "brought to it by an inserter. With none inside, the recipe never starts, and nothing is made to bring.",
        explanation: `Each modeled self-feeding machine is given this seed once at the cold trial start. Planning uses a separate `
            + `prepared state. A real build needs its own initial ${example.item}; this seed assumption does not establish recovery after it is lost.`,
        table: {
            columns: ["Machine", "Recipe", "Item", "In per craft", "Cold trial seed"],
            rows: rows.map(it => [it.machine, it.recipe, it.item, `${round(it.per_craft, 2)}`, `${it.started_with}`]),
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
    if (clock_only === undefined || (result.search?.kind === "shifted cycle" && result.search.picked !== null)) {
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
        title: "Swings land a few ticks off the plan, as the blueprint runs them",
        what: `The plan has ${example.label} drop at ticks ${ticksList(example.planned)}. Run by the clock alone, as in the game, `
            + `it drops at ticks ${ticksList(example.clocked)}.`
            + (differing.length > 1 ? ` ${differing.slice(1).map(it => it.label).join(" and ")} differ${differing.length === 2 ? "s" : ""} too.` : "")
            + " The clock still holds its rate.",
        why: "The plan lets each inserter wait for its machine. The blueprint has only the clock, which switches inserters on and "
            + "off. A window also stays on 2 ticks after the clock closes it, so an inserter that is back in time can start "
            + "another swing if a full hand is waiting, and one that finds less keeps what it picked up for a later window.",
        explanation: "The same number of items moves each period either way, but the swings can bunch together instead of landing "
            + "one to a window. The Timeline tab shows both runs; the exported clock is the one the blueprint follows.",
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

/** Inserters enabled for at least this share of the long run are named as (nearly) always enabled */
const MOSTLY_ENABLED_SHARE = 0.8;

/** How often the machines wake the inserters under this clock (goal 2 of GOALS.md), and which inserters most */
function wakeUpsInsight(result: BlueprintGenerationResult, entities: SerializableEntityStateTransitions[]): ClockInsight | null {
    const wake_ups = result.stability_check.as_built?.wake_ups;
    if (wake_ups === undefined || wake_ups.inserters.length === 0) {
        return null;
    }
    const percent = (share: number) => `${round(share * 100)}%`;
    const rows = wake_ups.inserters.map(it => {
        const entity = entities.find(entity => entity.entity_id === it.inserter_id);
        const ends = entity?.source && entity.sink ? `${entity.source.label} to ${entity.sink.label}` : "";
        return { ...it, label: entity?.label ?? it.inserter_id, ends };
    }).sort((a, b) => b.wake_ups_per_minute - a.wake_ups_per_minute);
    const most = rows[0];
    const mostly_enabled = rows.filter(it => it.enabled_share >= MOSTLY_ENABLED_SHARE && it.alarms_per_minute > 0);
    return {
        id: "wake-ups",
        scope: "clock",
        title: `Machines wake the inserters ${round(wake_ups.wake_ups_per_minute)} times a minute`,
        what: `In a long run of this clock the machines of one copy of the build woke its inserters ${round(wake_ups.wake_ups_per_minute)} `
            + `times a minute. ${most.label} is woken most, ${round(most.wake_ups_per_minute)} times a minute: it is on `
            + `${percent(most.enabled_share)} of the time and is on and waiting for ${percent(most.waiting_share)} of it.`
            + (mostly_enabled.length === 0 ? "" : ` On ${percent(MOSTLY_ENABLED_SHARE)} of the time or more: `
                + `${mostly_enabled.map(it => `${it.label} (${percent(it.enabled_share)})`).join(", ")}.`),
        why: "An enabled inserter with nothing to move sleeps on the wake-up list of the machine it waits on, and that machine "
            + "wakes it every time it finishes a craft. The inserter looks for something to move, finds nothing or part of a "
            + "hand, and sleeps again. An inserter its clock has disabled is on no list and is never woken. In game the debug "
            + "option show-wakeup-lists draws a line from a waiting inserter to its machine; a line that flickers is this.",
        explanation: "Each wake-up is a check that moves little or nothing, so among clocks that hold the target the one with the "
            + "fewest is the lightest on update time. An inserter that is enabled most of the time is woken at most of the crafts "
            + "of the machine it waits on, whether its windows are long, it is left always enabled in a loop of machines, or "
            + "the config sets it to always enabled.",
        table: {
            columns: ["Inserter", "Between", "Wake-ups a minute", "Most it could be woken a minute", "On", "On and waiting"],
            rows: rows.map(it => [it.label, it.ends, `${round(it.wake_ups_per_minute)}`, `${round(it.alarms_per_minute)}`,
                percent(it.enabled_share), percent(it.waiting_share)]),
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
        what: `Driven only by its clock windows, the build moved ${actual} of ${check.expected_output_items} items `
            + (as_built?.output_basis === "long-run mean" ? "a clock period on average over a long run" : "in a clock period")
            + (offset ? ` when the clock started ${offset} ticks later relative to the machines` : "") + `.${repeats}`,
        why: "A clock has to work from wherever the machines happen to be when it starts, so it is simulated from several start "
            + "points. A swing that arrives while its machine is at an insertion limit, out of ingredients or without a full hand "
            + "does nothing useful, and once a machine has waited longer than its spare time it cannot catch up.",
        explanation: "Use a potential clock marked Stable. If none is, lower the target rate, force fewer output swings (which gives "
            + "the machines more buffer between swings), or yell at abuc to go fix his algorithm.",
    };
}

/** Why a clock that reaches its target from some starts only is listed as unstable, with where it settles elsewhere */
export function startDependenceInsight(note: string, dependence: StartDependence): ClockInsight {
    return {
        id: "start-dependence",
        scope: "clock",
        title: dependence.verdict === "start-dependent" ? "This clock depends on how it is started"
            : dependence.verdict === "stable" ? "This clock reaches the target from every sampled start"
                : "This clock does not reach the target from any sampled start",
        what: note,
        why: "The simulator tried empty machines with initial clock phases and competing-taker orders: "
            + dependence.starts.map(start => start.label).join("; ") + ". These are cold starts, not filled or free-running builds.",
        explanation: "The sampled outcomes above show which starts reached the target. These samples do not cover every possible "
            + "state of a running build or every build order; inspect them before choosing the clock.",
    };
}

/** The insights for one potential clock, the ones about the whole build first */
/** Why a clock that holds its expected output is still not listed as stable (GOALS.md, "Backpressure Loss") */
export function backpressureLossInsight(verdict: BackpressureLossVerdict, expected_output_items: number): ClockInsight {
    const what = verdict.broken_by.length > 0
        ? `This clock moves its ${expected_output_items} items every clock period for as long as nothing runs out and nothing backs up. `
            + `It does not get back to them after a loss: ${verdict.broken_by.join("; ")}.${notTriedSentence(verdict.not_tried)}`
        : `The run the losses are tried on did not hold ${expected_output_items} items a clock period with nothing cut, so no loss says `
            + "anything about this clock.";
    return {
        id: "backpressure-loss",
        scope: "clock",
        title: "This clock does not survive backpressure loss",
        what,
        why: "When an item stops arriving, or the output is not taken away, the machines run dry or fill up. Once it is back, "
            + "every machine goes on from what it holds then, and the windows of this clock do not bring the build back from "
            + "there. Each loss is tried in the simulator: "
            + "cut at four places in the clock period, and for a quarter, a half, three quarters and all of the time the build "
            + "takes to stop.",
        explanation: "Such a build has to be restarted by hand after an input ran out or the output backed up. Use a potential "
            + "clock marked Stable. Where no clock of a build is, the build may not be able to survive a loss whatever the clock, "
            + "and its clocks are offered for what they are.",
    };
}

/** That the build can deadlock whatever its clock is, and which inserters it is about */
export function deadlockRiskInsight(risks: readonly SharedItemDeadlockRisk[]): ClockInsight {
    return {
        id: "deadlock-risk",
        scope: "build",
        title: "This build has a deadlock risk: two inserters bring the same item",
        what: risks.map(describeSharedItem).join(" "),
        why: "An inserter that starts picking an item up after the other has already put it in finds the item at its insertion "
            + "limit by the time its hand is ready, and holds the hand until the machine has used enough for it to drop. While it "
            + "holds it, it takes nothing else off the belt. If the machine then runs out of what only that inserter brings while "
            + "the shared item is still at its limit, the machine cannot craft, the item never goes down, and the inserter never "
            + "lets go.",
        explanation: "The build then stops for good, whatever the clock does afterwards, and has to be cleared by hand. Whether it "
            + "happens depends on the timing of the two inserters against each other. The trials for backpressure loss do not see "
            + "it, so on this build they do not decide which clock is selected: the clocks that hold the target rate are ranked "
            + "by their wake-ups. A build is free of the risk when each item is brought to a machine by one inserter only, or "
            + "when an inserter that shares an item brings nothing else.",
    };
}

/**
 * That belt pickups of the build are outside what belt pickup timing was calibrated on, and which: an item taken in
 * belt stacks other than 4 or with a hand other than 16 (follow-up F7). None when every belt pickup is inside it.
 */
export function beltPickupNotTestedInsights(config: Config): ClockInsight[] {
    const pickups = uncalibratedBeltPickups(config);
    if (pickups.length === 0) {
        return [];
    }
    return [{
        id: "belt-pickup-not-tested",
        scope: "build",
        title: "Not tested: belt pickup outside 16-item hands on 4-item belt stacks",
        what: pickups.map(describeUncalibratedPickup).join(" "),
        why: `${BELT_PICKUP_CALIBRATION}. At other belt stack sizes and hand sizes the simulator's pickup timing has not been `
            + "compared with the game.",
        explanation: "The clock may not match the game: its rate, stability and wake-ups are worked out from pickup timing "
            + "never checked there.",
    }];
}

/**
 * That drops of the build are marked as side-loading onto a belt downstream (Sidecar 0.13.0): a known limit, as the config
 * describes the belts as one belt. There is no separate why: the advice is the explanation. None when no drop is marked.
 */
export function sideLoadedDropInsights(config: Config): ClockInsight[] {
    const drops = sideLoadedDrops(config);
    if (drops.length === 0) {
        return [];
    }
    return [{
        id: "side-loaded-drop",
        scope: "build",
        title: SIDE_LOADED_DROP_TITLE,
        what: drops.map(describeSideLoadedDrop).join(" "),
        why: "",
        explanation: SIDE_LOADED_DROP_ADVICE,
    }];
}

/**
 * Where the drops of the output inserters onto a shared belt land, for the clock the result follows (config/drop-spacing.ts):
 * whether the hands of all the copies fit between each other or land on each other. None when the config does not say enough
 * (no places, copies without a gap) or no output inserter drops on a belt.
 */
export function dropSpacingInsights(result: Pick<BlueprintGenerationResult, "clock_only_run" | "serializable_state_transition_history">, config: Config): ClockInsight[] {
    const run = result.clock_only_run?.state_transition_history ?? result.serializable_state_transition_history;
    const starts = new Map<number, number[]>();
    config.inserters.forEach((inserter, index) => {
        const id = inserter.id ?? index + 1;
        if (inserter.sink.type === "belt") starts.set(id, dropTicks(run, `inserter:${id}`));
    });
    const spacing = dropSpacing(config, starts, run.total_duration_ticks);
    if (spacing === null) {
        return [];
    }
    const text = describeDropSpacing(spacing);
    return [{ id: "drop-spacing", scope: "clock", title: text.title, what: text.what, why: text.why, explanation: text.explanation, table: dropSpacingTable(spacing) }];
}

/** That the drops of the copies fill the lanes of a belt exactly, so that nothing is left over for a wait */
export function lanesExactlyFullInsights(config: Config): ClockInsight[] {
    let issues;
    try {
        issues = lanesExactlyFull(config);
    } catch {
        return [];
    }
    const note = lanesExactlyFullNote(issues);
    if (note === null) {
        return [];
    }
    const lanes = issues.map(issue => issue.lanes.length === 1 ? `lane ${issue.lanes[0]} of belt ${issue.belt_id}` : `both lanes of belt ${issue.belt_id}`).join(" and ");
    const title = `${lanes.charAt(0).toUpperCase()}${lanes.slice(1)} ${issues.length === 1 && issues[0].lanes.length === 1 ? "is" : "are"} exactly full`;
    return [{ id: "lanes-exactly-full", scope: "build", title, what: note, why: "", explanation: "" }];
}

export function clockInsights(result: BlueprintGenerationResult, holds: boolean, loop_seed_items = DEFAULT_LOOP_SEED_ITEMS): ClockInsight[] {
    // the run the blueprint follows; build-wide numbers are only read from a clock that holds the target
    const run = result.clock_only_run?.state_transition_history ?? result.serializable_state_transition_history;
    // an inserter that never moved in one run is only listed in the other
    const entities = [...run.entities, ...result.serializable_state_transition_history.entities];
    const insights: (ClockInsight | null)[] = [
        loopingRecipeInsight(result, entities, loop_seed_items),
        holds ? spareTimeInsight(result, run) : null,
        insertionLimitsInsight(result, entities),
        outputHandInsight(result, entities),
        holds ? null : unstableInsight(result),
        holds ? planVersusClockInsight(result) : null,
        wakeUpsInsight(result, entities),
    ];
    return insights.filter((it): it is ClockInsight => it !== null);
}

/**
 * What the clock gives each drill that drops into a chest (see chestDrillWindows): windows that keep the chest's takers
 * supplied just in time, or why it stays always enabled. None for a build without such a drill.
 */
export function chestDrillInsights(result: Pick<BlueprintGenerationResult, "chest_drills" | "simulation_duration">): ClockInsight[] {
    const drills = result.chest_drills ?? [];
    if (drills.length === 0) {
        return [];
    }
    const clocked = drills.filter(drill => drill.enabled_ticks !== null);
    const period = Number(result.simulation_duration.ticks.toFixed(2));
    return [{
        id: "chest-drill-windows",
        scope: "clock",
        title: clocked.length === drills.length ? "The drills into containers are enabled just in time"
            : clocked.length === 0 ? "The drills into containers are always enabled" : "Some drills into containers are always enabled",
        what: drills.map(drill => {
            const into = `Drill ${drill.drill_id} drops ${drill.item.replace(/-/g, " ")} into ${chestName(drill.chest_type, drill.chest_id)}`;
            if (drill.enabled_ticks === null) {
                return `${into} and is always enabled: ${drill.always_enabled_because === undefined ? "nothing times it" : chestDrillBecause(drill.always_enabled_because)}.`;
            }
            const ticks = Number(drill.enabled_ticks.toFixed(2));
            return `${into} and is enabled ${ticks} tick${ticks === 1 ? "" : "s"} of the ${period}-tick period, in ${drill.window_count} window${drill.window_count === 1 ? "" : "s"}.`;
        }).join(" "),
        why: "A drill mines into a hold of its own and, each tick it is enabled, first drops what it holds into the chest, as far "
            + "as the chest has room. What it mines in its last enabled tick stays in the hold while it is disabled and drops "
            + "first in its next window. Disabled, it keeps its hold and its progress.",
        explanation: "Each window ends the tick before an inserter takes from the chest, and is as long as the drill needs to mine "
            + "what is taken until its next window, checked by running the drill against the takes. The windows are not part of "
            + "the swing counts and do not change the inserters' windows; the clock-only check and the backpressure losses are run "
            + "with them. A clock that does not hold with them is made again with them a tick longer, then with the drill always "
            + "enabled. A drill stays always enabled where nothing times it: no inserter of the plan takes its item out of the "
            + "chest, something else fills the chest with the same item, or the config sets it so.",
    }];
}
