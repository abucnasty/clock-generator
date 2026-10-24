import { Config } from "../config";
import { crowdedText, dropLines, dropRoom, dropSpacing, type DropRoom } from "../config/drop-spacing";
import { Entity, handSizeFor } from "../entities";
import { computeMachineTargetRates } from "./machine-target-rates";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { buildOutputInsertersOf } from "./sequence/cycle/swing-counts";
import { TargetProductionRate } from "./target-production-rate";

// ============================================================================
// Whether the drops of the copies fit, before Generate
// ============================================================================
//
// The editor says it under "Next copy stands", for a period estimated from the config alone: the ticks one output hand takes at
// the rate the target asks of a machine, which is the clock planner's base cycle (`CraftingCyclePlan.create`). The clock's own
// period is that times the cycles in which every inserter moves whole hands, which only the plan knows, so the note says it is
// an estimate and the result (the drop-spacing insight) speaks of the clock's period.

const WHOLE_TICK_SLACK = 1e-6;

/**
 * The ticks one output hand takes at the target rate (times `overrides.lcm` where the config sets it), down to whole ticks and
 * at least one swing of the output inserter. None where it cannot be told: the machines making the target differ in rate or
 * hand, one of them has not exactly one inserter taking its product out, or the config is refused.
 */
export function estimatedPeriod(config: Config): number | null {
    try {
        const rates = computeMachineTargetRates(config);
        const registry = createEntityRegistryFromConfig(config);
        const item = TargetProductionRate.fromConfig(config.target_output).machine_production_rate.item;
        const machines = registry.getAll().filter(Entity.isMachine).filter(machine => machine.output.item_name === item);
        if (machines.length === 0) return null;
        const ticks = machines.map(machine => {
            const taking = buildOutputInsertersOf(machine, registry);
            const rate = rates.find(it => it.machine_id === machine.entity_id.number)?.output_rate_per_second;
            if (taking.length !== 1 || rate === undefined || !(rate > 0)) return null;
            return { ticks: handSizeFor(taking[0], item) * 60 / rate, swing: taking[0].animation.total.ticks };
        });
        if (ticks.some(it => it === null)) return null;
        const first = ticks[0]!;
        if (ticks.some(it => Math.abs(it!.ticks - first.ticks) > WHOLE_TICK_SLACK * first.ticks)) return null;
        const period = Math.floor(first.ticks * (config.overrides?.lcm ?? 1) + WHOLE_TICK_SLACK);
        return Math.max(period, first.swing);
    } catch {
        return null;
    }
}

export const DROP_ROOM_NOT_ESTIMATED = "The period of the clock cannot be estimated from these settings, so whether the hands of the copies fit between each other is shown in the result after Generate.";

const listed = (values: readonly (string | number)[]): string =>
    values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
const MAX_LISTED = 8;
const listedSpacings = (values: readonly number[]): string => values.length > MAX_LISTED ? `${values.slice(0, MAX_LISTED).join(", ")} and others` : listed(values);

/** What else fits, as the end of the note: the other spacings, and the spacing the config has with another distance between a copy's inserters */
function alsoFits(room: DropRoom): string[] {
    const pieces: string[] = [];
    const others = room.fits.filter(spacing => spacing !== room.gap_in_scan);
    if (others.length > 0) pieces.push(`the copies ${listedSpacings(others)} tiles apart`);
    const here = room.only_with.find(group => group.spacings.includes(room.gap_in_scan));
    if (here !== undefined) pieces.push(`${room.gap} tiles apart with the inserters of a copy ${listedSpacings(here.apart)} tiles apart`);
    return pieces;
}

/**
 * The note under "Next copy stands": whether the hands of the copies fit between each other at the estimated period, with the
 * inserters of a copy starting together, and the spacings that would. None where the copies share no belt, the gap between
 * them is not given, or no output inserter has a place (the note that asks for the gap is copyGapNeededNote).
 */
export function dropRoomNote(config: Config): string | null {
    const copies = config.target_output.copies;
    if (!(copies > 1) || config.target_output.copy_offset === undefined) return null;
    let lines;
    try {
        lines = dropLines(config);
    } catch {
        return null;
    }
    if (lines.length === 0) return null;
    const period = estimatedPeriod(config);
    if (period === null) return DROP_ROOM_NOT_ESTIMATED;
    const room = dropRoom(config, lines, period);
    if (room === null) return null;
    if (room.crowded !== null) return `At about ${period} ticks a period, ${crowdedText(room.crowded, copies).replace(/^T/, "t")}`;
    const together = new Map(lines.flatMap(line => line.inserters.map(inserter => [inserter.id, [0]] as const)));
    const spacing = dropSpacing(config, together, period);
    if (spacing === null) return null;
    const belts = [...new Set(spacing.lines.map(line => line.belt_id))].sort((a, b) => a - b);
    const belt = belts.length === 1 ? `belt ${belts[0]}` : `belts ${belts.join(", ")}`;
    const lead = `At about ${period} ticks a period (estimated from the target rate: one output hand at the machine's rate), the hands of the ${copies} copies`;
    const more = alsoFits(room);
    const plus = room.loop !== null ? `, and at any of these plus ${room.loop}` : "";
    if (spacing.lines.every(line => line.fits)) {
        return `${lead} fit between each other on ${belt}, if the inserters of a copy start together.${more.length > 0 ? ` They would also fit with ${more.join(", or ")}${plus}.` : ""}`;
    }
    return `${lead} land on each other on ${belt}, if the inserters of a copy start together, and some of them wait for room. `
        + (more.length > 0 ? `They would fit with ${more.join(", or ")}${plus}.`
            : `No spacing of the copies from ${room.low} to ${room.high} tiles fits${room.loop !== null ? `, nor any of these plus ${room.loop}` : ""}.`);
}
