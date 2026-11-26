import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { SerializableClockWindows } from "./clock";
import { quiet } from "./generate-blueprint-test-helpers";
import { unclockedRun, type UnclockedRun } from "./plan/unclocked-run";
import { buildRegionsOf, firstOrbitOf } from "./graph/build-regions";
import { cutRegionConfig } from "./graph/region-config";
import type { RegionOrbit } from "./graph/regions";
import { offsetsOf, regionLiftOf } from "./candidates/region-lift";
import type { InputWindowJudge } from "./candidates/metered-input-windows";
import type { OutputWindowDecision } from "./candidates/metered-output-windows";
import { chooseStaggeredWindows, ownOutputRelation, repeatedRun, staggeredInputWindows, type StaggerProposal } from "./candidates/staggered-input-windows";
import { Entity } from "../entities";

const PERIOD = 324;
const SERVICE = 108;
type Range = { start: number; end: number };
const every = (start: number, end: number): Range[] => repeatedRun({ start: ((start % SERVICE) + SERVICE) % SERVICE, length: end - start + 1 }, SERVICE, PERIOD);
const ids = (...numbers: number[]) => numbers.map(n => `inserter:${n}`);
const orbitOf = (config: Config): RegionOrbit => firstOrbitOf(buildRegionsOf(config))!;

describe("the cut of the first repeated group of machines", () => {
    let utility: Config;
    let orbit: RegionOrbit;
    beforeAll(async () => {
        utility = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
        orbit = orbitOf(utility);
    });

    it("keeps the group's machines and arms, the anchor and its arms that touch the group or no group, and half the setpoint", () => {
        const cut = cutRegionConfig(utility, orbit, 0);
        expect(cut.kind).toBe("cut");
        if (cut.kind !== "cut") return;
        expect(cut.region).toBe("machine:4/region:1");
        expect(cut.kept_inserters).toEqual(ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13));
        expect(cut.dropped_anchor_arms).toEqual(ids(15));
        expect(cut.config.machines.map(it => it.id)).toEqual([1, 2, 3, 4, 5]);
        expect(cut.config.inserters.map(it => it.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13]);
        expect(cut.config.setpoint).toEqual({ ...utility.setpoint, items_per_second: 160 });
    });

    it("is refused, with the code, where the build cannot be cut", async () => {
        const military = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        expect(cutRegionConfig(military, orbitOf(military), 0)).toMatchObject({ kind: "not_cut", reason: "output_belt" });
        const without = (node: string): RegionOrbit => ({ ...orbit, regions: orbit.regions.map((region, k) => k > 0 ? region
            : { ...region, nodes: region.nodes.filter(it => it !== node), arms: region.arms.filter(it => it !== node) }) });
        expect(cutRegionConfig(utility, without("machine:1"), 0)).toMatchObject({ kind: "not_cut", reason: "target_outside_regions" });
        expect(cutRegionConfig(utility, without("inserter:13"), 0)).toMatchObject({ kind: "not_cut", reason: "arm_in_no_region", detail: "inserter:13" });
        expect(cutRegionConfig(utility, without("machine:3"), 0)).toMatchObject({ kind: "not_cut", reason: "end_outside_cut" });
    });
});

describe("the lift of a group's clock onto every group", () => {
    let utility: Config;
    let grenade: Config;
    beforeAll(async () => {
        utility = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
        grenade = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    });
    const window = [{ start: 10, end: 20 }];

    it("gives each arm's windows to its partner in every group, with no shift", () => {
        const { windows, code } = regionLiftOf(utility, orbitOf(utility), 0).lift({ "inserter:1": window, "inserter:3": every(14, 41) });
        expect(code).toBe("lifted");
        expect(windows).toEqual({ "inserter:1": window, "inserter:11": window, "inserter:3": every(14, 41), "inserter:20": every(14, 41) });
    });

    it("gives an anchor arm's windows to the anchor arm of the other group, and keeps those of an anchor arm that touches no group", () => {
        const lift = regionLiftOf(utility, orbitOf(utility), 0);
        expect(lift.lift({ "inserter:8": window }).windows).toEqual({ "inserter:8": window, "inserter:15": window });
        expect(lift.lift({ "inserter:7": window }).windows).toEqual({ "inserter:7": window });
    });

    it("leaves an open arm open in every group", () => {
        const reason = { kind: "no-swing" } as const;
        const { windows, left_open } = regionLiftOf(utility, orbitOf(utility), 0).lift({}, new Map([["inserter:2", reason]]));
        expect(windows).toEqual({});
        expect(Object.fromEntries(left_open)).toEqual({ "inserter:2": reason, "inserter:12": reason });
    });

    it("gives no lift where a drill with windows has no partner", () => {
        const orbit = orbitOf(grenade);
        const unmapped: RegionOrbit = { ...orbit, maps: orbit.maps.map((map, k) => k === 0 ? map : Object.fromEntries(Object.entries(map).filter(([from]) => from !== "drill:1"))) };
        expect(regionLiftOf(grenade, unmapped, 0).lift({ "drill:1": window }).code).toBe("no_drill_map");
    });

    it("reads the offset between the groups from a clock of the whole build, the negative one of two equal ones", () => {
        const lift = regionLiftOf(grenade, orbitOf(grenade), 0);
        const at = (start: number) => [{ start, end: start + 3 }];
        const mine = lift.takersIn(0), theirs = lift.takersIn(1);
        const windows: SerializableClockWindows = Object.fromEntries([...mine.map((key, i) => [key, at(10 + 4 * i)]), ...theirs.map((key, i) => [key, at(66 + 4 * i)])]);
        expect(Object.fromEntries(offsetsOf(lift, windows, 112))).toEqual({ 1: -56 });
        expect(Object.fromEntries(offsetsOf(lift, { ...windows, [theirs[0]]: at(60) }, 112))).toEqual({ 1: null });
    });
});

describe("the stagger step inside a repeated group's generation", () => {
    let config: Config;
    let plan: UnclockedRun;
    beforeAll(async () => {
        config = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
        plan = unclockedRun({ ...config, overrides: { terminal_swing_count: 6, lcm: 1, derive_clock_windows: false } }, { logger: quiet });
    });
    const TURNS: Record<number, number> = { 5: 0, 6: 36, 9: 72, 14: 18, 16: 54, 17: 90 };
    const takers = new Set(ids(5, 6, 9, 14, 16, 17));
    const windowsOf = (): SerializableClockWindows => Object.fromEntries(Object.entries({
        ...Object.fromEntries(Object.entries(TURNS).map(([id, turn]) => [id, every(turn, turn + 1)])),
        2: every(14, 41), 3: every(14, 41), 10: every(14, 41), 12: [{ start: 0, end: PERIOD - 1 }], 20: [{ start: 0, end: PERIOD - 1 }], 21: [{ start: 0, end: PERIOD - 1 }],
        11: every(0, 24), 18: every(36, 60), 19: every(72, 96), 1: every(0, 10), 4: every(36, 46), 13: every(72, 82),
    }).map(([id, ranges]) => [`inserter:${id}`, ranges]));
    const outputs = (kinds: Record<number, OutputWindowDecision["kind"]>): Record<string, OutputWindowDecision> => Object.fromEntries(Object.entries(kinds)
        .map(([id, kind]) => [`inserter:${id}`, kind === "bounded" ? { kind, service_ticks: SERVICE, observed_ticks: 5184, items_taken: 768 } : { kind }] as [string, OutputWindowDecision]));
    // the staggered machines' own outputs left already bounded, and no other target machine's output left so
    const own_bounded = outputs({ 1: "already_bounded", 4: "already_bounded", 13: "already_bounded", 11: "bounded", 18: "bounded", 19: "bounded" });

    it("relates an own output with no sibling to its own machine's metered taker", () => {
        const inserter = (id: number) => plan.run.simulation_context.entity_registry.getAll().filter(Entity.isInserter).find(it => it.entity_id.id === `inserter:${id}`)!;
        const arm = inserter(1), taker = inserter(5);
        const run = ownOutputRelation(arm, taker, plan, SERVICE)!;
        const hands = Math.ceil(plan.run.swing_counts.get(arm.entity_id)!.total_transfer_count.toDecimal() * SERVICE / PERIOD);
        expect(run.length).toBe(hands * arm.animation.total.ticks + 1);
        // the run ends in the tick the taker's hand lands: the circuit latency, then its pickup, swing and drop
        expect((run.start + run.length - 1) % SERVICE).toBe(2 + taker.animation.pickup_to_drop.ticks - 1);
    });

    it("staggers an own output left already bounded only inside a group's generation", () => {
        const whole = staggeredInputWindows(plan, windowsOf(), takers, own_bounded)!;
        for (const id of ids(1, 4, 13)) expect(whole.decisions[id]).toEqual({ kind: "retained", reason: "output_not_bounded" });
        const region = staggeredInputWindows(plan, windowsOf(), takers, own_bounded, { clusters: {} })!;
        const first = region.groups[0].proposals[0];
        expect(first.staggered["inserter:1"]).toMatchObject({ kind: "staggered", role: "output", relation_from: ["own:machine:1"] });
        expect(Object.keys(first.changes).sort()).toEqual(ids(1, 10, 13, 2, 3, 4).sort());
    });

    it("proposes each reference's own observed cluster, moved to each arm's turn, only inside a group's generation", () => {
        const outputs_bounded = outputs({ 1: "bounded", 4: "bounded", 13: "bounded", 11: "already_bounded", 18: "already_bounded", 19: "already_bounded" });
        const whole = staggeredInputWindows(plan, windowsOf(), takers, outputs_bounded)!;
        expect(whole.groups[0].proposals.map(it => it.reference)).toEqual(ids(2, 10, 3));
        const region = staggeredInputWindows(plan, windowsOf(), takers, outputs_bounded, { clusters: { "inserter:2": every(20, 30) } })!;
        expect(region.groups[0].proposals.map(it => it.reference)).toEqual([...ids(2, 10, 3), "cluster:inserter:2"]);
        const cluster = region.groups[0].proposals[3];
        expect([cluster.changes["inserter:2"], cluster.changes["inserter:3"], cluster.changes["inserter:10"]]).toEqual([every(20, 30), every(56, 66), every(92, 102)]);
    });
});

describe("the recovery gate of a repeated group's stagger step", () => {
    const proposal: StaggerProposal = { reference: "inserter:2", changes: { "inserter:2": every(14, 41) },
        staggered: { "inserter:2": { kind: "staggered", role: "input", reference: "inserter:2", shift_ticks: 0, service_ticks: SERVICE } } };
    const judge = (mine: [number, number], theirs: [number, number]): InputWindowJudge => ({
        longRun: changes => ({ holds: true, wake_ups: Object.keys(changes).length === 0 ? 632.07 : 498.71, stage: null }),
        wholeCheck: () => null,
        recovery: changes => {
            const [one_copy, copies] = Object.keys(changes).length === 0 ? theirs : mine;
            return { one_copy, copies };
        },
    });

    it("reads the worse of the two readings: 16/19 against 15/19 is taken, 16/20 against 19/19 refused", () => {
        expect(chooseStaggeredWindows([proposal], judge([16, 19], [15, 19]), "worse_of_two").taken).toBe(proposal);
        expect(chooseStaggeredWindows([proposal], judge([16, 20], [19, 19]), "worse_of_two").decisions["inserter:2"])
            .toEqual({ kind: "retained", reason: "recovery_worse" });
    });
});
