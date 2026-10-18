import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";

type Speed = "turbo" | "express" | "fast" | "yellow";
interface Variant {
    name: string; lane: 1 | 2 | "both"; speed: Speed;
    backed?: boolean; reflect?: boolean; turn?: number; releaseTick?: number;
    offsets: number[];
}
interface Stack { at: number; count: number; id: number; item: string }
interface Lane { length: number; stacks: Stack[] | Record<string, never> }
interface Sample {
    tick: number; held: number; held_item?: string; lanes: Lane[];
    feed: { lanes: (Lane & { count: number; full: boolean })[] };
    inputs: unknown; output: unknown; crafting_progress: number;
}
const stacks = (lane: Lane): Stack[] => Object.values(lane.stacks);
const speedPerTick = { turbo: 4 / 32, express: 3 / 32, fast: 2 / 32, yellow: 1 / 32 };
const variants: Variant[] = [];
for (const backed of [false, true]) for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-south-${lane}-${backed ? "backed" : "moving"}`, lane, backed, speed: "turbo",
    offsets: backed || lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 1, 2, 4] : [0, 2, 4, 6],
});
for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-north-${lane}-moving`, lane, reflect: true, speed: "turbo",
    offsets: lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 2, 4, 6] : [0, 1, 2, 4],
});
for (const speed of ["express", "fast", "yellow"] as const) for (const lane of [1, 2, "both"] as const) variants.push({
    name: `${speed}-south-${lane}-moving`, lane, speed,
    offsets: lane === "both" ? [0, 1, 2, 3] : lane === 1 ? [0, 1, 2, 4]
        : speed === "express" ? [0, 1, 4, 6] : speed === "fast" ? [0, 4, 8, 12] : [0, 4, 12, 20],
});
for (const turn of [1, 2, 3]) variants.push({
    name: `turbo-inner-rotation-${turn}`, lane: 2, turn, speed: "turbo", offsets: [0, 2, 4, 6],
});
for (const lane of [1, 2, "both"] as const) variants.push({
    name: `turbo-south-${lane}-release17`, lane, speed: "turbo", releaseTick: 17,
    offsets: lane === "both" ? [0, 1, 2, 3] : [0, 1, 3, 5],
});

/** Derive variants from the photographed layout: no additional copied blueprints or probes. */
function makeVariant(text: string, variant: Variant) {
    interface Entity { entity_number: number; name: string; position: { x: number; y: number }; direction?: number }
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as {
        blueprint: { entities: Entity[] };
    };
    const entities = decoded.blueprint.entities;
    const byId = (id: number) => {
        const entity = entities.find(e => e.entity_number === id);
        if (!entity) throw new Error(`missing side-loading fixture entity ${id}`);
        return entity;
    };
    expect(byId(6)).toMatchObject({ name: "turbo-transport-belt", position: { x: 0.5, y: 0.5 }, direction: 4 });
    // West feeders populate incoming lane 2; east feeders populate lane 1.
    const lane = variant.reflect && variant.lane !== "both" ? 3 - variant.lane : variant.lane;
    if (lane === 1) for (const id of [14, 15, 20, 21]) {
        const entity = byId(id);
        entity.position.x += id === 14 || id === 20 ? 2 : 4;
        if (id === 14 || id === 20) entity.direction = 4;
    }
    if (lane === "both") for (const [id, newId] of [[14, 22], [15, 23], [20, 24], [21, 25]]) {
        const entity = structuredClone(byId(id));
        entity.entity_number = newId;
        entity.position.x += id === 14 || id === 20 ? 2 : 4;
        if (id === 14 || id === 20) entity.direction = 4;
        entities.push(entity);
    }
    if (variant.backed) {
        expect(byId(10).name).toBe("turbo-loader");
        decoded.blueprint.entities = entities.filter(e => e.entity_number !== 10);
    }
    let feedDx = 0, feedDy = variant.reflect ? -1 : 1;
    for (const entity of decoded.blueprint.entities) {
        if (variant.speed !== "turbo") entity.name = entity.name.replace("turbo-", variant.speed === "yellow" ? "" : `${variant.speed}-`);
        if (variant.reflect) {
            entity.position.y = 1 - entity.position.y;
            entity.direction = (8 - (entity.direction ?? 0) + 16) % 16;
        }
        for (let turn = 0; turn < (variant.turn ?? 0); turn++) {
            const { x, y } = entity.position;
            entity.position = { x: 1 - y, y: x };
            entity.direction = ((entity.direction ?? 0) + 4) % 16;
        }
    }
    for (let turn = 0; turn < (variant.turn ?? 0); turn++) [feedDx, feedDy] = [-feedDy, feedDx];
    return {
        blueprint: "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64"),
        options: { feedDx, feedDy, releaseTick: variant.releaseTick ?? 16, lastTick: 96 },
    };
}

/** Independent candidate supply rule, not the production simulator. Phase is observed before pickup. */
function checkSingleStream(samples: Sample[], variant: Variant, firstGrab: number, fullTick: number) {
    const laneIndex = variant.reflect ? 0 : 1;
    const incomingIndex = Number(variant.lane) - 1;
    const speed = speedPerTick[variant.speed];
    const inner = variant.lane === (variant.reflect ? 1 : 2);
    const entry = inner ? 67 / 256 : 188 / 256;
    let transfers = 0;
    for (let index = 1; index < 16; index++) {
        const previous = samples[index - 1], current = samples[index];
        const oldIds = new Set(stacks(previous.lanes[laneIndex]).map(s => s.id));
        for (const stack of stacks(current.lanes[laneIndex]).filter(s => !oldIds.has(s.id))) {
            const incoming = stacks(previous.feed.lanes[incomingIndex]).find(s => s.id === stack.id)!;
            expect(incoming).toBeDefined();
            // Entry boundary minus unused motion after crossing the incoming line's end.
            expect(stack.at + speed - incoming.at).toBe(entry);
            transfers++;
        }
    }
    expect(transfers).toBeGreaterThan(0);
    const phase = (stacks(samples[0].lanes[laneIndex])[0].at + speed) % 0.25;
    const consumed = new Set<number>();
    let held = 0;
    for (const sample of samples.filter(s => s.tick <= fullTick)) {
        const available: { id: number; at: number }[] = [];
        for (let id = 0; id < 100; id++) {
            const at = phase - sample.tick * speed + id * 0.25;
            if (at >= 0 && at < entry && !consumed.has(id)) available.push({ id, at });
        }
        if (sample.tick >= firstGrab && held < 16 && available.length) {
            consumed.add(available.pop()!.id);
            held += 4;
        }
        expect(held, `held at ${sample.tick}`).toBe(sample.held);
        expect(available.map(s => s.at), `positions at ${sample.tick}`).toEqual(stacks(sample.lanes[laneIndex]).map(s => s.at).sort((a, b) => a - b));
    }
}

/** Verify the production mode with phase aligned from the pre-pickup stream, not fitted to grabs. */
function checkSimulator(config: Config, samples: Sample[], variant: Variant, firstGrab: number, fullTick: number) {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({
        inserterState: state, tick_provider: context.tick_provider,
        sourceState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id),
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    let shift = 0;
    if (!variant.backed) {
        const speed = speedPerTick[variant.speed];
        const lane = samples[0].lanes[variant.reflect ? 0 : 1];
        const phase = (stacks(lane)[0].at + speed) % 0.25;
        const entry = variant.lane === (variant.reflect ? 1 : 2) ? 67 / 256 : 188 / 256;
        const aligned = Array.from({length: 8}, (_, index) => index).find(index =>
            ((entry - index * speed) % 0.25 + 0.25) % 0.25 === phase);
        expect(aligned, "profile phase must align with the observed stream").toBeDefined();
        shift = aligned!;
    }
    for (const sample of samples.filter(s => s.tick >= firstGrab && s.tick <= fullTick)) {
        context.tick_provider.setCurrentTick(sample.tick + shift);
        mode.executeForTick();
        expect(state.held_item?.quantity ?? 0, `simulator held at ${sample.tick}`).toBe(sample.held);
    }
}

for (const variant of variants) test(`side-entry supply: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const fixture = GameFixturePaths.SIDE_LOADED_STRAIGHT;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "side-loaded-entry-"));
    try {
        const made = makeVariant(fs.readFileSync(path.join(fixture, "side-loaded-scaffold.txt"), "utf8"), variant);
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        config.belts[0].type = `${variant.speed === "yellow" ? "" : variant.speed + "-"}transport-belt` as typeof config.belts[0]["type"];
        config.belts[0].lanes = [
            { ingredient: variant.reflect ? "iron-plate" : "", stack_size: 4 },
            { ingredient: variant.reflect ? "" : "iron-plate", stack_size: 4 },
        ];
        config.overrides!.backed_up_belts = variant.backed ?? false;
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = variant.reflect ? 2 : 1;
        if (variant.lane === "both") delete source.pickup_supply;
        else {
            const profile = variant.lane === (variant.reflect ? 1 : 2) ? "side-inner" : "side-outer";
            source.pickup_supply = variant.reflect ? [profile, "through"] : ["through", profile];
        }
        const result = await recordInFactorio({
            factorio: factorio!, save: save!, config, blueprint: made.blueprint,
            lua: composeProbeSource(path.join(fixture, "probe.lua"), made.options),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 120, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: false,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
            initial: { belt_shape: string }; samples: Sample[];
        };
        const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        const localBelt = result.recording.config.belts.find((belt: { id: number }) => belt.id === exported.source.id)!;
        expect(localBelt.lanes.map((lane: { ingredient: string }) => lane.ingredient)).toEqual(variant.reflect ? ["iron-plate", ""] : ["", "iron-plate"]);
        expect(exported.source).toMatchObject({near_lane: variant.reflect ? 2 : 1, pickup_length: 1});
        if (variant.lane === "both") {
            expect(exported.source.pickup_supply).toBeUndefined();
            expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: exported.id ?? result.recording.config.inserters.indexOf(exported) + 1, reason: "merge"});
        } else {
            expect(exported.source.pickup_supply).toEqual(source.pickup_supply);
            expect(captured.source.pickup_supply).toEqual(source.pickup_supply);
            expect(result.recording.config.pickup_warnings).toBeUndefined();
        }
        const samples = report.samples;
        expect(report.initial.belt_shape).toBe("straight");
        expect(samples).toHaveLength(96);
        expect(samples.slice(0, made.options.releaseTick).every(s => s.held === 0)).toBe(true);
        const full = samples.find(s => s.held === 16)!;
        expect(full).toBeDefined();
        const hand = samples.filter(s => s.tick <= full.tick);
        const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
        expect(grabs.map(s => s.tick - grabs[0].tick)).toEqual(variant.offsets);
        expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill("iron-plate"));
        for (const sample of hand) {
            expect(sample.lanes.map(lane => lane.length)).toEqual([1, 1]);
            expect(stacks(sample.lanes[variant.reflect ? 1 : 0])).toEqual([]);
            expect(sample.inputs).toEqual({});
            expect(sample.output).toEqual({});
            expect(sample.crafting_progress).toBe(0);
            for (const [index, lane] of sample.feed.lanes.entries()) {
                const supplied = variant.lane === "both" || index + 1 === variant.lane;
                expect(lane.count).toBe(supplied ? 16 : 0);
                expect(lane.full).toBe(supplied);
            }
        }
        if (variant.lane !== "both") checkSimulator(config, samples, variant, grabs[0].tick, full.tick);
        if (variant.backed) {
            const initial = stacks(samples[0].lanes[1]);
            expect(initial.map(s => s.at)).toEqual(variant.lane === 2 ? [0, 0.25, 0.5] : [0, 0.25, 0.5, 0.75]);
            for (const sample of samples.slice(0, 16)) expect(stacks(sample.lanes[1])).toEqual(initial);
        } else if (variant.lane !== "both") {
            checkSingleStream(samples, variant, grabs[0].tick, full.tick);
        } else {
            // Both incoming streams compete for one receiving lane. The inner stream waits
            // before pickup, then contributes after the inserter opens a gap.
            const innerIndex = variant.reflect ? 0 : 1;
            const waitingId = stacks(samples[0].feed.lanes[innerIndex])[0].id;
            for (const sample of samples.slice(0, 16)) expect(stacks(sample.feed.lanes[innerIndex])[0].id).toBe(waitingId);
            const entered = samples.slice(16).some((sample, index) => {
                if (stacks(sample.lanes[variant.reflect ? 0 : 1]).some(stack => stack.id === waitingId)) return true;
                // At slow speeds it can arrive and be picked up before the next snapshot.
                const previous = samples[index + 15];
                return stacks(previous.feed.lanes[innerIndex]).some(stack => stack.id === waitingId)
                    && !stacks(sample.feed.lanes[innerIndex]).some(stack => stack.id === waitingId)
                    && sample.held === previous.held + 4;
            });
            expect(entered).toBe(true);
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);
