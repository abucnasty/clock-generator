import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, backpressureLossOf, clockFromWindows, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {GENERATED_ALTERNATIVE, grenadeClockCases} from "../../tests/game/builds/grenade-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";
import {GROUP_GAP_TILES} from "./turn-groups";

// the grenade build (REAL_OWNER_GRENADE): the generated clock pinned beside the in-game recording of it on one copy
// and on the full build of seven, and the hand-made clock judged by the simulator
const controls = readControls("grenade-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    generated = generateClockAlternatives(config, {logger: quiet});
});

test("grenade: every inserter and drill a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("grenade: the 112-tick clock holds the target and is selected; the longer ones, planned the same way, do not", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe(GENERATED_ALTERNATIVE);
    expect(selected.verdict).toBe("stable");
    expect(selected.assessment.items_per_second).toBe(240);
    expect(selected.result.simulation_duration.ticks).toBe(112);
    // two groups of two machines, half a period apart: the foundry cannot serve four at once. The machines of one row of the belt
    // (inserters 1 and 2, and 3 and 4 that fill them) are one group, the machines of the other row (7 and 8; 5 and 6) the other
    const windows = selected.result.clock_windows;
    expect([windows["inserter:3"], windows["inserter:4"]]).toEqual([[{start: 2, end: 43}], [{start: 2, end: 43}]]);
    expect([windows["inserter:5"], windows["inserter:6"]]).toEqual([[{start: 58, end: 99}], [{start: 58, end: 99}]]);
    expect([windows["inserter:1"], windows["inserter:2"]]).toEqual([[{start: 0, end: 0}], [{start: 0, end: 0}]]);
    expect([windows["inserter:7"], windows["inserter:8"]]).toEqual([[{start: 56, end: 56}], [{start: 56, end: 56}]]);
    // the drills of a group share one window, two ticks: 160 coal a period against the 125 to 134 a tick the drills mine (two drill deciders, as the hand-made clock has)
    expect([windows["drill:1"], windows["drill:2"]]).toEqual([[{start: 2, end: 3}], [{start: 2, end: 3}]]);
    expect([windows["drill:3"], windows["drill:4"]]).toEqual([[{start: 58, end: 59}], [{start: 58, end: 59}]]);
    expect(generated.alternatives.filter(it => it.id !== GENERATED_ALTERNATIVE).every(it => it.verdict === "unstable")).toBe(true);
});

type Entities = ClockAlternativesResult["alternatives"][number]["result"]["blueprint"]["entities"];
const tagged = (entities: Entities, kind: "inserters" | "drills", ids: number[]) =>
    entities.find(entity => JSON.stringify(entity.tags?.clock_generator?.[kind]) === JSON.stringify(ids))!;
/** The networks of one colour of a blueprint, as the sorted sets of connectors ("entity number:connector") its wires join */
const networks = (wires: number[][], green: boolean): string[] => {
    const parent = new Map<string, string>();
    const find = (node: string): string => {
        if (!parent.has(node)) parent.set(node, node);
        const up = parent.get(node)!;
        if (up === node) return node;
        const root = find(up);
        parent.set(node, root);
        return root;
    };
    for (const [from, from_connector, to, to_connector] of wires) {
        if ((from_connector % 2 === 0) === green) parent.set(find(`${from}:${from_connector}`), find(`${to}:${to_connector}`));
    }
    const sets = new Map<string, string[]>();
    for (const node of Array.from(parent.keys())) sets.set(find(node), [...(sets.get(find(node)) ?? []), node]);
    return Array.from(sets.values()).map(members => members.sort().join(",")).sort();
};

test("grenade: the selected clock stands its combinators in two groups, a gap between them, each in the order of its turn", () => {
    const {blueprint} = generated.alternatives[generated.selected_index].result;
    const at = (kind: "inserters" | "drills", ids: number[]) => tagged(blueprint.entities, kind, ids).position.x;
    // the machines of one row of the belt are a group: the output swings (1 and 2), the plate inserters (3 and 4), the coal drills (1 and 2)
    const north = [at("inserters", [1, 2]), at("inserters", [3, 4]), at("drills", [1, 2])];
    const south = [at("inserters", [7, 8]), at("inserters", [5, 6]), at("drills", [3, 4])];
    expect(north).toEqual([north[0], north[0] + 1, north[0] + 2]);
    expect(south).toEqual([south[0], south[0] + 1, south[0] + 2]);
    // the empty tiles between the groups, and nothing else out of place along the row
    expect(south[0] - north[2] - 1).toBe(GROUP_GAP_TILES);
    // the clock, its lock and its filter stand before both
    const row = blueprint.entities.filter(entity => entity.name === "decider-combinator").map(entity => entity.position.x).sort((a, b) => a - b);
    expect(row.slice(0, 2)).toEqual([0.5, 1.5]);
    expect(row[2]).toBe(north[0]);
    expect(new Set(row).size).toBe(row.length);
});

test("grenade: the first combinator of each group says which turn is its, and no other combinator does", () => {
    const {blueprint} = generated.alternatives[generated.selected_index].result;
    const lines = (entity: Entities[number]) => (entity.player_description ?? "").split("\n");
    const groupLines = blueprint.entities.flatMap(entity => lines(entity).filter(line => line.startsWith("Group ")).map(line => [entity, line] as const));
    expect(groupLines.map(([entity, line]) => [entity.tags?.clock_generator?.inserters, line])).toEqual([
        [[1, 2], "Group 1 of 2: takes its turn in ticks 1–44 of the 112-tick period. Its combinators stand together, in the order of the turn."],
        [[7, 8], "Group 2 of 2: takes its turn in ticks 57–100 of the 112-tick period. Its combinators stand together, in the order of the turn."],
    ]);
    // after the lines that say what the combinator switches on and when, which stay the first two
    for (const [entity] of groupLines) expect(lines(entity)[2]).toMatch(/^Group /);
    expect(lines(tagged(blueprint.entities, "inserters", [1, 2]))[0]).toBe("2 inserters, each [entity=assembling-machine-3] → [entity=turbo-transport-belt] [item=grenade] (1, 2)");
    expect(lines(tagged(blueprint.entities, "inserters", [1, 2]))[1]).toBe("1 swing each in 1 window per 112-tick period: open 1");
});

test("grenade: laying the combinators out by group changes nothing else: the same entities in the same order, conditions, outputs, tags and networks", async () => {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    const selected = generated.alternatives[generated.selected_index].result;
    // the same windows as a clock that is not in groups: one row in the order of the entity ids
    const flat = clockFromWindows({...config, overrides: {...config.overrides, terminal_swing_count: 1}}, selected.clock_windows, 112, quiet);
    const [grouped, plain] = [selected.blueprint, flat.blueprint];
    expect(plain.entities.some(entity => (entity.player_description ?? "").includes("Group "))).toBe(false);
    expect(grouped.entities.map(entity => entity.position.x)).not.toEqual(plain.entities.map(entity => entity.position.x));
    const withoutPlace = (entities: Entities) => entities.map(({position, player_description, ...rest}) => ({...rest, first_lines: (player_description ?? "").split("\n").slice(0, 2)}));
    expect(withoutPlace(grouped.entities)).toEqual(withoutPlace(plain.entities));
    expect(selected.schedule).toEqual(flat.schedule);
    // the same networks: every window combinator on the one network the filter's output makes, the lock on the same red network
    expect(networks(grouped.wires, true)).toEqual(networks(plain.wires, true));
    expect(networks(grouped.wires, false)).toEqual(networks(plain.wires, false));
    // and every wire within the reach of a copper wire
    const place = (entity_number: number) => grouped.entities.find(entity => entity.entity_number === entity_number)!.position;
    for (const [from, , to] of grouped.wires) {
        expect(Math.hypot(place(from).x - place(to).x, place(from).y - place(to).y)).toBeLessThanOrEqual(8);
    }
    // the clock is another clock to the game, for what it is placed where: its identity (position and wires are part of it) moves, its schedule does not
    expect(clockIdentity(selected).blueprint).not.toBe(clockIdentity(flat).blueprint);
});

test("grenade: every alternative says the lanes of the belt are exactly full, and the selected clock's hands fit between each other", () => {
    for (const alternative of generated.alternatives) {
        expect(alternative.insights.find(it => it.id === "lanes-exactly-full")?.title).toBe("Both lanes of belt 1 are exactly full");
        expect(alternative.insights.find(it => it.id === "drop-spacing")).toBeDefined();
    }
    // the two inserters of a row start in the same tick: the 14 hands of a row land on 14 tiles of the belt's cycle of 14
    const selected = generated.alternatives[generated.selected_index];
    const spacing = selected.insights.find(it => it.id === "drop-spacing")!;
    expect(spacing.title).toBe("Drops onto belt 1 fit between each other");
    expect(spacing.table?.rows).toEqual([["1 and 2", "14", "12", "14", "0", "0"], ["7 and 8", "14", "12", "14", "0", "0"]]);
    // and which spacings of the copies, and distances between a copy's inserters, would fit as well
    expect(spacing.explanation).toContain("The belt moves 14 tiles a period, so each hand lands on one of 14 tiles. With inserters 1 and 2 as they stand (3 tiles apart), "
        + "the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; 13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. "
        + "The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks after inserter 1 also fits (a tile every 8 ticks).");
});

test("grenade: copies a tile closer put hands on each other, and the insight says so", async () => {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    const closer = {...config, target_output: {...config.target_output, copy_offset: {x: 11, y: 0}}};
    const made = generateClockAlternatives(closer, {logger: quiet});
    const selected = made.alternatives[made.selected_index];
    const insight = selected.insights.find(it => it.id === "drop-spacing")!;
    expect(insight.title).toBe("Drops onto belt 1 land on each other");
    expect(insight.explanation).toContain("With inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; "
        + "13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14.");
});

test("grenade: the hand-made clock, as windows, holds in the simulator and gets back after every loss", async () => {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    const range = (start: number, end: number) => [{start, end}];
    // counted 0 to 111; a window decider reads the counter, so its first value is the window's first tick
    const windows = {
        "inserter:1": range(0, 0), "inserter:2": range(0, 0), "inserter:7": range(56, 56), "inserter:8": range(56, 56),
        "inserter:3": range(2, 43), "inserter:4": range(2, 43), "inserter:5": range(58, 99), "inserter:6": range(58, 99),
        "drill:1": range(5, 7), "drill:2": range(5, 7), "drill:3": range(61, 63), "drill:4": range(61, 63),
    };
    const forced = {...config, overrides: {...config.overrides, terminal_swing_count: 1}};
    const made = clockFromWindows(forced, windows, 112, quiet);
    expect(made.stability_check.as_built?.holds).toBe(true);
    expect(made.stability_check.as_built?.actual_output_items).toBe(64);
    expect(backpressureLossOf(forced, windows, 112, 64, quiet).survives).toBe(true);
});

for (const variant of grenadeClockCases()) {
    test(`grenade clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        // the game holds the target in every baseline period and is back at it in every judged period after each loss
        expect(native.baseline).toHaveLength(63);
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
            expect(loss.recovered.length).toBeGreaterThan(1);
        }
        expect(native.period).toBe(112);
        if (variant.kind === "owner's clock") {
            expect(generation).toBeUndefined();
            return;
        }
        const chosen = generated.alternatives.find(alternative => alternative.id === GENERATED_ALTERNATIVE)!;
        const exported = chosen.result.subtick ?? chosen.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(chosen.result.subtick?.clock.period_ticks ?? chosen.result.simulation_duration.ticks).toBe(generation!.period);
        expect(chosen.verdict).toBe(generation!.verdict);
        expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
            supply: chosen.belt?.kind ?? null}).toEqual(generation!.selection);
        expect(native.expected).toBe(generation!.expected);
    });
}
