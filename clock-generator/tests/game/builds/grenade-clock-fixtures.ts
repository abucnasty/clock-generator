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
 * The grenade build (`GRENADE_240_FILLS_BELT_EXACTLY`, 240 grenades a second over 7 copies): a copy has four assembling machines, a
 * foundry that fills them with iron plates and four drills that drop coal into them; the grenades of a copy go onto one belt
 * line, and the seven copies, 12 tiles apart, put them on one belt whose two lanes are exactly full. The hand-made clock is in
 * the sample's blueprints: a counter of the clock signal that counts 0 to 111 (112 ticks) and six window deciders (see the
 * sample's README).
 *
 * Two clocks run on each of two builds, the sample's one copy and its full build of seven copies: the hand-made clock, kept as the
 * build came, and the generator's selected clock for the config, wired to the inserters and drills of every copy with the
 * hand-made clock's deciders taken out.
 */
export interface GrenadeClockCase {
    name: string;
    kind: "hand-made clock" | "generated clock";
    build: "one copy" | "full build";
}

export function grenadeClockCases(): GrenadeClockCase[] {
    return [
        {name: "hand-made-one-copy", kind: "hand-made clock", build: "one copy"},
        {name: "hand-made-full-build", kind: "hand-made clock", build: "full build"},
        {name: "generated-one-copy", kind: "generated clock", build: "one copy"},
        {name: "generated-full-build", kind: "generated clock", build: "full build"},
    ];
}

const FOLDER = path.dirname(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
const BUILDS = {
    "one copy": {file: "grenade-240-fills-belt-exactly-hand-clock.blueprint", clock: {counter: 87, period: 112, first_value: 0} as BuiltClock, copies: 1, share: 1 / 7},
    "full build": {file: "grenade-240-fills-belt-exactly-full-build.blueprint", clock: {counter: 1, period: 112, first_value: 0} as BuiltClock, copies: 7, share: 1},
} as const;

/** The id of the alternative the generated clock is: the 112-tick one, which the rule for hands in groups makes stable */
export const GENERATED_ALTERNATIVE = "round_robin_polling";

const scaffoldOf = (build: GrenadeClockCase["build"]) => fs.readFileSync(path.join(FOLDER, BUILDS[build].file), "utf8").trim();

/** The sha256 of the identity of the hand-made clock in a blueprint of the sample (`builtClockIdentity`): what its control names it by */
export function handMadeClockHash(build: GrenadeClockCase["build"]): string {
    return createHash("sha256").update(JSON.stringify(builtClockIdentity(scaffoldOf(build), BUILDS[build].clock))).digest("hex");
}

/** The machines of the build are those of the copies' config, and its inserters and drills the config's, once for every copy */
export function assertGrenadeHardware(recording: Recording, config: Config, copies: number): void {
    const machines: Record<string, number> = {};
    for (const {recipe, crafting_speed, productivity} of recording.config.machines as {recipe: string; crafting_speed: number; productivity: number}[]) {
        const key = `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`;
        machines[key] = (machines[key] ?? 0) + 1;
    }
    const per_copy: Record<string, number> = {};
    for (const {recipe, crafting_speed, productivity} of config.machines) {
        const key = `${recipe} ${crafting_speed.toFixed(4)} ${productivity}`;
        per_copy[key] = (per_copy[key] ?? 0) + copies;
    }
    expect(machines).toEqual(per_copy);
    expect(recording.inserters).toHaveLength(config.inserters.length * copies);
    expect((recording as unknown as {drills: unknown[]}).drills).toHaveLength((config.drills?.configs.length ?? 0) * copies);
}

export async function grenadeClockScenario(variant: GrenadeClockCase): Promise<PickupClockScenario> {
    const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    const generated = variant.kind === "generated clock";
    const {clock, copies, share} = BUILDS[variant.build];
    return {
        name: variant.name, speed: CLOCK_TEST_SPEEDS[0], backed: false,
        config: () => config,
        scaffold: () => scaffoldOf(variant.build),
        share,
        built_clock: clock,
        keep_built_clock: !generated,
        builtClockSha256: () => handMadeClockHash(variant.build),
        ...(generated && {alternative: GENERATED_ALTERNATIVE, copies}),
        probeFile: path.join(__dirname, "grenade-clock-probe.lua"),
        probe: {family: "grenade", stackSize: 4},
        controls: path.join(__dirname, "grenade-clock-controls.json"),
        assertHardware: recording => assertGrenadeHardware(recording, config, copies),
    };
}
