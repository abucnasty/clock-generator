import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {BuiltClock} from "../../../src/harness/built-clock";
import {recordedClockPeriod, Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario, pickupClockInterventions} from "./pickup-clock-capture";

/**
 * The owner's inserter build (`LOGISTIC_SCIENCE_INSERTER_CRAFTING`, 240 a second over three copies, 80 a second each) as
 * the owner built it: three copies in a row, the ore lines of the copies running on past the last into loaders and
 * void chests (drained and moving), the circuits and the product from chests and a loader. The owner's clock is in it,
 * one for the three copies: a counter of the clock signal that counts 0 to 215 (a period of 216 ticks), and two window
 * combinators, an iron plate signal on ticks 1-33 and 109-138 for the 12 ore and 12 plate inserters and an iron gear
 * wheel signal on ticks 1-65 and 109-173 for the 3 gear inserters; the circuit and output inserters are not wired.
 *
 * Two clocks run on the one blueprint: the owner's, and the generator's selected clock for the config, wired to the same
 * inserters of each copy with the owner's three combinators taken out.
 */
export interface OwnClockCase {
    name: string;
    kind: "owner's clock" | "generated clock";
    /** The alternative recorded, for the generated clock */
    alternative?: string;
}

export function ownClockCases(): OwnClockCase[] {
    return [
        {name: "own-clock-three-copies", kind: "owner's clock"},
        {name: "generated-three-copies", kind: "generated clock", alternative: GENERATED_ALTERNATIVE},
    ];
}

const SCAFFOLD = path.join(__dirname, "own-clock-three-copies-scaffold.txt");

/** The counter of the owner's clock (entity 36 of the blueprint): 0 to 215 */
export const OWNER_CLOCK: BuiltClock = {counter: 36, period: 216, first_value: 0};

/** The copies of the unit the blueprint holds */
export const COPIES = 3;

/** The period of the generator's clock for the config (`swings-2`, 2 output swings): the selected one */
export const GENERATED_ALTERNATIVE = "swings-2";

/**
 * The copies are not alike, as the owner built them, and the config is the third (the eastern copy, with no overrides): the
 * first two have a gear assembler at 44.921875 where the third has 40.3125, and the first has a fourth furnace at 91.875 in
 * place of the config's machine 5 (86.1655). All three make 80 a second unclocked.
 */
function machinesOfCopies(config: Config): string[] {
    const row = (machine: Config["machines"][number], speed = machine.crafting_speed) => `${machine.recipe} ${speed.toFixed(4)} ${machine.productivity}`;
    const copy = (gear_speed: number | null, fifth_speed: number | null) => config.machines.map(machine =>
        machine.recipe === "iron-gear-wheel" && gear_speed !== null ? row(machine, gear_speed)
            : machine.id === 5 && fifth_speed !== null ? row(machine, fifth_speed) : row(machine));
    return [...copy(44.921875, 91.875), ...copy(44.921875, null), ...copy(null, null)];
}

/** The machines of the build are the three copies', and the inserters between machines and belts are the config's, three times over */
export function assertOwnClockHardware(recording: Recording, config: Config): void {
    const machines = (recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[])
        .map(({recipe, crafting_speed, productivity}) => `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`).sort();
    expect(machines).toEqual(machinesOfCopies(config).sort());
    const pairs = (inserters: {source: {type: string}; sink: {type: string}}[]) => {
        const counts: Record<string, number> = {};
        for (const {source, sink} of inserters) {
            if (source.type !== "chest" && sink.type !== "chest") counts[`${source.type}>${sink.type}`] = (counts[`${source.type}>${sink.type}`] ?? 0) + 1;
        }
        return counts;
    };
    const per_copy = pairs(config.inserters);
    expect(pairs(recording.inserters)).toEqual(Object.fromEntries(Object.entries(per_copy).map(([pair, count]) => [pair, count * COPIES])));
}

export async function ownClockScenario(variant: OwnClockCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING);
    const generated = variant.kind === "generated clock";
    return {
        name: variant.name, speed: BELT_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(SCAFFOLD, "utf8").trim(),
        built_clock: OWNER_CLOCK,
        keep_built_clock: !generated,
        ...(generated && {alternative: variant.alternative}),
        // the family's protocol: 64 untouched periods, the ore cut at 66-68, the output blocked at 84-88, the circuits cut at 104-106
        interventions: pickupClockInterventions(),
        probeFile: path.join(__dirname, "own-clock-probe.lua"),
        probe: {family: "own-clock", stackSize: 4},
        controls: path.join(__dirname, "own-clock-controls.json"),
        assertHardware: (recording, hardware_config) => {
            assertOwnClockHardware(recording, hardware_config);
            // the recording is cut by the clock that ran: 216 ticks the owner's, the generated clock's own
            if (!generated) expect(recordedClockPeriod(recording)).toBe(OWNER_CLOCK.period);
        },
    };
}
