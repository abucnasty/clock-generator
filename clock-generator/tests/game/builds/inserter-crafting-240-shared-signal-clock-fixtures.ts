import {createHash} from "crypto";
import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {BuiltClock, builtClockIdentity} from "../../../src/harness/built-clock";
import {Recording} from "../../../src/verification/recording";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * The inserter build (`INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK`, 240 a second over three copies, 80 a second each) as
 * it was built: three copies in a row, the ore lines of the copies running on past the last into loaders and
 * void chests (drained and moving), the circuits and the product from chests and a loader. The hand-made clock is in it,
 * one for the three copies: a counter of the clock signal that counts 0 to 215 (a period of 216 ticks), and two window
 * combinators, an iron plate signal on ticks 1-33 and 109-138 for the 12 ore and 12 plate inserters and an iron gear
 * wheel signal on ticks 1-65 and 109-173 for the 3 gear inserters; the circuit and output inserters are not wired.
 *
 * Two clocks run on the one blueprint: the hand-made one, and the generator's selected clock for the config, wired to the same
 * inserters of each copy with the hand-made clock's three combinators taken out.
 */
export interface InserterCraftingClockCase {
    name: string;
    kind: "hand-made clock" | "generated clock";
    /** The alternative recorded, for the generated clock */
    alternative?: string;
}

export function inserterCraftingClockCases(): InserterCraftingClockCase[] {
    return [
        {name: "hand-made-clock-three-copies", kind: "hand-made clock"},
        {name: "generated-three-copies", kind: "generated clock", alternative: GENERATED_ALTERNATIVE},
    ];
}

const SCAFFOLD = path.join(__dirname, "inserter-crafting-240-shared-signal-clock-three-copies.scaffold");

/** The counter of the hand-made clock (entity 36 of the blueprint): 0 to 215 */
export const OWNER_CLOCK: BuiltClock = {counter: 36, period: 216, first_value: 0};

/** The sha256 of the identity of the hand-made clock in the blueprint (`builtClockIdentity`): what its control names it by */
export function handMadeClockHash(): string {
    return createHash("sha256").update(JSON.stringify(builtClockIdentity(fs.readFileSync(SCAFFOLD, "utf8").trim(), OWNER_CLOCK))).digest("hex");
}

/** The copies of the unit the blueprint holds */
export const COPIES = 3;

/** The clock recorded on the three copies (`swings-6`, 6 output swings): the generator's selected clock until the default dispatch changed, still made */
export const GENERATED_ALTERNATIVE = "swings-6";

/**
 * The copies are not alike, as they were built, and the config is the third (the eastern copy, with no overrides): the
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

export async function inserterCraftingClockScenario(variant: InserterCraftingClockCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
    const generated = variant.kind === "generated clock";
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => fs.readFileSync(SCAFFOLD, "utf8").trim(),
        built_clock: OWNER_CLOCK,
        keep_built_clock: !generated,
        builtClockSha256: handMadeClockHash,
        ...(generated && {alternative: variant.alternative, copies: COPIES}),
        probeFile: path.join(__dirname, "inserter-crafting-240-shared-signal-clock-probe.lua"),
        probe: {family: "inserter-crafting-240-shared-signal-clock", stackSize: 4},
        controls: path.join(__dirname, "inserter-crafting-240-shared-signal-clock-controls.json"),
        assertHardware: assertOwnClockHardware,
    };
}
