import zlib from "zlib";
import { encodeBlueprintFile } from "../blueprints/serde";

/**
 * A clock the build came with, named by the test that records it, in place of a description the build need not have: the
 * harness finds the clock of a generated clock's blueprint by its description ("Clock for ...", see clockPeriodTicks), and
 * the recorder mod does too, but a clock built by hand has none.
 */
export interface BuiltClock {
    /** The entity number, in the blueprint, of the decider combinator that counts the clock on the clock signal */
    counter: number;
    /** Ticks the clock counts before it starts over */
    period: number;
    /** What the clock shows in the first tick of a period, 0 or 1 */
    first_value: 0 | 1;
}

/** The signal the recorder mod reads the clock from */
const CLOCK_SIGNAL = "signal-clock";
/** What the recorder mod and the harness mod find the clock by */
const CLOCK_DESCRIPTION_PREFIX = "Clock for";

interface Entity {
    entity_number: number;
    name: string;
    player_description?: string;
    control_behavior?: { decider_conditions?: { conditions?: { first_signal?: { name?: string }; comparator?: string; constant?: number }[]; outputs?: { signal?: { name?: string } }[] } };
}

/**
 * The blueprint with "Clock for " put before the description of the counter of the clock the build came with, so the
 * game finds it as it finds a generated clock: to record it, or, when another clock is put in its place, to remove it
 * with the combinators and wires that hang on it. The string the test gave is not changed. Throws when the entity is not
 * a counter of the clock signal, or when its constant is not the period asked for.
 */
export function blueprintWithNamedClock(blueprint: string, built_clock: BuiltClock): string {
    const file = JSON.parse(zlib.inflateSync(Buffer.from(blueprint.slice(1), "base64")).toString("utf-8"));
    const entities: Entity[] = file.blueprint?.entities ?? [];
    const counter = entities.find(entity => entity.entity_number === built_clock.counter);
    if (!counter) {
        throw new Error(`The blueprint has no entity ${built_clock.counter}, the counter of the clock the build came with`);
    }
    if (counter.name !== "decider-combinator") {
        throw new Error(`Entity ${built_clock.counter} is a ${counter.name}: the counter of a clock is a decider combinator`);
    }
    if (!Number.isInteger(built_clock.period) || built_clock.period < 1) {
        throw new Error(`The period of the clock is ${built_clock.period}: it is a whole number of ticks`);
    }
    const decider = counter.control_behavior?.decider_conditions;
    if (!(decider?.outputs ?? []).some(output => output.signal?.name === CLOCK_SIGNAL)) {
        throw new Error(`Decider ${built_clock.counter} does not output ${CLOCK_SIGNAL}: the recorder reads the clock from that signal`);
    }
    const counted = decider?.conditions?.[0];
    if (counted?.first_signal?.name === CLOCK_SIGNAL && (counted.comparator ?? "<") === "<" && typeof counted.constant === "number") {
        // it counts from first_value up to the constant, then starts over
        const counts = Math.trunc(counted.constant) + 1 - built_clock.first_value;
        if (counts !== built_clock.period) {
            throw new Error(`Decider ${built_clock.counter} counts ${built_clock.first_value} to ${Math.trunc(counted.constant)}, a period of ${counts} ticks, `
                + `not the ${built_clock.period} asked for`);
        }
    }
    const other = entities.find(entity => entity !== counter && entity.name === "decider-combinator"
        && (entity.player_description ?? "").startsWith(CLOCK_DESCRIPTION_PREFIX));
    if (other) {
        throw new Error(`Decider ${other.entity_number} is described as a clock of the generator as well: the build has two clocks to tell apart`);
    }
    counter.player_description = `${CLOCK_DESCRIPTION_PREFIX} the clock the build came with${counter.player_description ? `\n${counter.player_description}` : ""}`;
    return encodeBlueprintFile(file);
}

/**
 * The recording the recorder wrote, saying what the clock it followed is, so the recording is read and kept with it: a
 * clock that counts from 0 is a clock and no missing signal (see RecordedClockSchema). Throws when the recorder found no clock.
 */
export function recordingOfBuiltClock(written: { clock?: { values: unknown } }, built_clock: BuiltClock): object {
    if (!written.clock) {
        throw new Error("The recorder found no clock in the build, so the recording is not cut by the clock that was named");
    }
    return { ...written, clock: { ...written.clock, first_value: built_clock.first_value, period: built_clock.period } };
}
