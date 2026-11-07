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
import {assertFeedBacksUp, PickupClockScenario} from "./pickup-clock-capture";

/**
 * The inserter build (`INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK`, 240 a second over three copies, 80 a second each) as
 * it was built: three copies in a row, the ore lines of the copies running on past the last into loaders and
 * void chests (drained and moving), the circuits and the product from chests and a loader. The hand-made clock is in it,
 * one for the three copies: a counter of the clock signal that counts 0 to 215 (a window cycle of 216 ticks), and two window
 * combinators, an iron plate signal on ticks 1-33 and 109-138 for the 12 ore and 12 plate inserters and an iron gear
 * wheel signal on ticks 1-65 and 109-173 for the 3 gear inserters; the circuit and output inserters are not wired.
 *
 * Two clocks run on the one blueprint: the hand-made one, and the generator's selected clock for the config, wired to the same
 * inserters of each copy with the hand-made clock's three combinators taken out.
 *
 * A third run is the sample's own scaffold, one copy with its ore lines and circuit belts closed (they back up, in the game), under the
 * clock the generator selects for the config with `backed_up_belts` on (#442).
 */
export interface InserterCraftingClockCase {
    name: string;
    kind: "hand-made clock" | "generated clock";
    /** The alternative recorded, for the generated clock */
    alternative?: string;
    /** The config has its belts backed up (`overrides.backed_up_belts`) and the sample's scaffold of one copy is the build */
    backed_up_one_copy?: boolean;
}

export function inserterCraftingClockCases(): InserterCraftingClockCase[] {
    return [
        {name: "hand-made-clock-three-copies", kind: "hand-made clock"},
        {name: "generated-three-copies", kind: "generated clock", alternative: GENERATED_ALTERNATIVE},
        {name: "generated-backed-up-one-copy", kind: "generated clock", alternative: GENERATED_ALTERNATIVE, backed_up_one_copy: true},
    ];
}

const SCAFFOLD = path.join(__dirname, "inserter-crafting-240-shared-signal-clock-three-copies.scaffold");
/** The sample's scaffold: one copy of the unit, the ore lines and the circuit belts ending at the last inserter that takes from them */
const ONE_COPY_SCAFFOLD = path.join(path.dirname(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK), "inserter-crafting-240-shared-signal-clock.scaffold");

/** The counter of the hand-made clock (entity 36 of the blueprint): 0 to 215 */
export const OWNER_CLOCK: BuiltClock = {counter: 36, period: 216, first_value: 0};

/** The sha256 of the identity of the hand-made clock in the blueprint (`builtClockIdentity`): what its control names it by */
export function handMadeClockHash(): string {
    return createHash("sha256").update(JSON.stringify(builtClockIdentity(fs.readFileSync(SCAFFOLD, "utf8").trim(), OWNER_CLOCK))).digest("hex");
}

/** The copies of the unit the blueprint holds */
export const COPIES = 3;

/**
 * The clock recorded on the three copies (`swings-6`, 6 output swings): the generator's selected clock until the default dispatch changed, still
 * made; with the belts backed up it is the selected clock now
 */
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

/** The machines of the one copy are the config's, and so are the inserters between machines and belts */
export function assertOneCopyHardware(recording: Recording, config: Config): void {
    const machines = (list: {recipe: string; crafting_speed: number; productivity: number}[]) =>
        list.map(({recipe, crafting_speed, productivity}) => `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`).sort();
    expect(machines(recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[])).toEqual(machines(config.machines));
    const pairs = (inserters: {source: {type: string}; sink: {type: string}}[]) => {
        const counts: Record<string, number> = {};
        for (const {source, sink} of inserters) {
            if (source.type !== "chest" && sink.type !== "chest") counts[`${source.type}>${sink.type}`] = (counts[`${source.type}>${sink.type}`] ?? 0) + 1;
        }
        return counts;
    };
    expect(pairs(recording.inserters)).toEqual(pairs(config.inserters));
}

export async function inserterCraftingClockScenario(variant: InserterCraftingClockCase): Promise<PickupClockScenario> {
    const loaded = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
    const generated = variant.kind === "generated clock";
    if (variant.backed_up_one_copy) {
        const config = {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}};
        return {
            name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: true,
            config: () => config,
            scaffold: () => fs.readFileSync(ONE_COPY_SCAFFOLD, "utf8").trim(),
            share: 1 / COPIES, copies: 1,
            alternative: variant.alternative,
            probeFile: path.join(__dirname, "inserter-crafting-240-shared-signal-clock-probe.lua"),
            probe: {family: "inserter-crafting-240-shared-signal-clock", stackSize: 4, assemblers: 1},
            controls: path.join(__dirname, "inserter-crafting-240-shared-signal-clock-controls.json"),
            assertHardware: recording => assertOneCopyHardware(recording, config),
            validateReport: assertFeedBacksUp,
        };
    }
    const config = loaded;
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
