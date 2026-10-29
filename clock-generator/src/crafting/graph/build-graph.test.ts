import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type {
    ContainerNode,
    DrillNode,
    InserterEdge,
    InserterLandsIn,
    LaneNode,
    MachineNode,
    PlacementEdge,
    PlacementLandsIn,
    PlannerEdge,
    PlannerFacts,
    PlannerNode,
    PlannerTarget,
} from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import { plannerGraphOf } from "./build-graph";
import { graphInvariantIssues, uncoveredPortsOf } from "./invariants";
import { graphSnapshotOf } from "./snapshot";

// ---------------------------------------------------------------------------------------------------------------------
// Hand-made facts: the fields the graph reads as given, the rest as one assembler, one stack inserter and one turbo belt
// ---------------------------------------------------------------------------------------------------------------------

const NO_SPOILAGE = { items: [], loss_limit_share: 0.75 };
const ELECTRIC = { source: "electric", energy_usage_kw: 375, energy_bonus: 0, burner: null, fuel_modelled: false, fuel: null } as const;

function machine(id: number, inputs: readonly string[], results: readonly string[], options: {
    looping?: readonly string[];
    places_into?: { target: string; lands_in: readonly (PlacementLandsIn | null)[] };
} = {}): MachineNode {
    const key = `machine:${id}`;
    return {
        key, kind: "machine", entity: key,
        production: {
            kind: "recipe", recipe_or_resource: results[0], prototype: "assembling-machine-3", prototype_type: "assembling-machine",
            speed: 1, energy_required: 1, ticks_per_craft: 60, crafts_per_tick: 1 / 60, productivity: 0, bonus_per_craft: 0, ticks_per_bonus: 0,
            inputs: inputs.map(item => ({ item, per_craft: 1, per_second: 1, per_tick: 1 / 60 })),
            insertion_duration_ticks: null,
            crafts_per_second: { numerator: 1, denominator: 1 },
        },
        yield: {
            results: results.map((item, at) => ({
                item, amount: 1, probability: 1, extra_count_fraction: 0, ignored_by_productivity: 0, expected_per_craft: 1,
                per_second: { numerator: 1, denominator: 1 }, main: at === 0, stochastic: false,
            })),
            carry: "expected-with-carry",
            payouts_count_as_finishes: null,
        },
        input_limits: { overload_multiplier: 2, limits: inputs.map(item => ({ item, limit: 2, kind: "ingredient" })) },
        output_block: { rule: "overload", per_result: results.map(item => ({ item, rule: "overload", ingredients_blocked_at: 1, held_limit: 1, stack: 100 })) },
        recipe_selection: "fixed",
        placement: options.places_into === undefined ? null : {
            mechanism: "result-placement", vector_to_place_result: [0, -2], target: options.places_into.target,
            per_result: results.map((item, at) => ({ item, lands_in: options.places_into!.lands_in[at], into_machine_stop: null })),
            into_container: "room", phase: "before-and-after-craft", stops_while_stack_waits: true,
        },
        energy: ELECTRIC,
        spoilage: NO_SPOILAGE,
        loop: { self_ingredients: inputs.filter(item => results.includes(item)), looping_ingredients: options.looping ?? [], seeded: false },
    };
}

function drill(id: number, item: string, target: string): DrillNode {
    const key = `drill:${id}`;
    return {
        key, kind: "drill", entity: key,
        production: {
            kind: "resource", recipe_or_resource: item, prototype: null, prototype_type: null, speed: 1, energy_required: 1, ticks_per_craft: 60,
            crafts_per_tick: 1 / 60, productivity: 0, bonus_per_craft: null, ticks_per_bonus: null, inputs: [], insertion_duration_ticks: null,
            crafts_per_second: { numerator: 1, denominator: 1 },
        },
        yield: { ...machine(0, [], [item]).yield },
        placement: {
            mechanism: "mining-drop", vector_to_place_result: [0, -3], target, per_result: [{ item, lands_in: "storage", into_machine_stop: null }],
            into_container: "room", phase: "before-mining", stops_while_stack_waits: true,
        },
        energy: ELECTRIC,
    };
}

/** Both sides of a belt, `items[0]` on lane 1; "" for a listed lane that carries nothing, null for an unlisted side */
function belt(id: number, items: readonly [string | null, string | null], export_per_second: number | null = null): LaneNode[] {
    return ([1, 2] as const).map(lane => ({
        key: `belt:${id}/lane:${lane}`, kind: "lane", entity: `belt:${id}`, spoilage: NO_SPOILAGE,
        lane: {
            key: `belt:${id}/lane:${lane}`, belt: `belt:${id}`, lane, listed: items[lane - 1] !== null, item: items[lane - 1], stack: 4,
            belt_prototype: "turbo-transport-belt", tiles_per_tick: 0.125, belt_speed: 60, items_per_second_ceiling: { numerator: 120, denominator: 1 },
            supply: "moving", export_per_second: lane === 1 ? export_per_second : null,
        },
    }));
}

function chest(id: number, options: { never_refuses?: boolean; gives?: readonly string[]; input_slots?: readonly string[] } = {}): ContainerNode {
    const never_refuses = options.never_refuses ?? false;
    return {
        key: `chest:${id}`, kind: "container", entity: `chest:${id}`, spoilage: NO_SPOILAGE,
        storage: {
            kind: never_refuses ? "constant" : "slots", chest_type: never_refuses ? "infinity-chest" : "car", capacity_by_item: [], accepts: "any",
            gives: options.gives ?? [], items_put_in: [], never_refuses, constant_supply: never_refuses, slots: never_refuses ? null : 80,
            input_slots: options.input_slots === undefined ? null
                : { overload_multiplier: 1, limits: options.input_slots.map(item => ({ item, limit: 1, kind: "silo-input" })) },
        },
    };
}

/** An item an inserter carries: where from, where to, where it lands, and the lanes of a belt it takes it from */
type Carried = readonly [item: string, from: string, to: string, lands_in: InserterLandsIn | null, from_lanes?: readonly string[]];

/** An inserter's edges, one per item it carries */
function inserter(id: number, ...items: readonly Carried[]): InserterEdge[] {
    return items.map(([item, from, to, lands_in, from_lanes]) => ({
        key: `inserter:${id}/${item}`, via: "inserter", entity: `inserter:${id}`, group: `inserter:${id}`, item, from, to,
        from_lanes: from_lanes ?? (from.startsWith("belt:") ? [from] : []), lands_in,
        hand: {
            prototype: "stack-inserter", quality: "legendary", by_item: 16, nominal: 16, research: 16, items: items.map(it => it[0]),
            full_hand: { at_placing_source: true, elsewhere: true }, wait_for_full_hand: true, grab_less_to_match_belt_stack: true, max_belt_stack_size: 4,
        },
        rotation_ticks: 3,
        planned: { pickup: 1, drop: 1, cycle: 8, pickup_to_drop: 4, per_second: { numerator: 120, denominator: 1 } },
        floor: { pickup: 1, drop: 1, cycle: 8 },
        floor_standing: { pickup: "measured", drop: "measured", cycle: "measured" },
        ceiling: { numerator: 120, denominator: 1 },
        belt_pickup_calibrated: true,
        enable_latency_ticks: 2,
    }));
}

/** The placement edges of a machine or a drill into its target, as the facts give them */
function placements(placer: MachineNode | DrillNode): PlacementEdge[] {
    const placement = placer.placement!;
    return placement.per_result.map(result => ({
        key: `placement:${placer.key}/${result.item}`, via: "placement", entity: placer.key, item: result.item, from: placer.key,
        to: placement.target!, lands_in: result.lands_in, into_machine_stop: null, mechanism: placement.mechanism, ceiling: null,
    }));
}

function factsOf(nodes: readonly PlannerNode[], edges: readonly PlannerEdge[], target: Partial<PlannerTarget> = {}): PlannerFacts {
    const inserter_edges = edges.filter((edge): edge is InserterEdge => edge.via === "inserter");
    const groups = [...new Set(inserter_edges.map(edge => edge.group))];
    return {
        schema: 1,
        target: { item: "", counts: "made", items_per_second: 1, copies: 1, per_copy: { numerator: 1, denominator: 1 }, ...target },
        nodes,
        edges,
        capacity_groups: groups.map(group => ({
            group,
            edges: inserter_edges.filter(edge => edge.group === group).map(edge => ({ edge: edge.key, item: edge.item, hand: 16, floor_cycle: 8 })),
        })),
    };
}

/** The graph of hand-made facts, which must hold its invariants */
function graphOf(facts: PlannerFacts): PlannerGraph {
    const graph = plannerGraphOf(facts);
    expect(graphInvariantIssues(facts, graph)).toEqual([]);
    return graph;
}

const edge = (graph: PlannerGraph, key: string) => graph.edges.find(it => it.key === key)!;

// ---------------------------------------------------------------------------------------------------------------------

describe("the planner graph of hand-made facts", () => {
    it("of a chain: a lane, two machines and an infinity chest; no loop, one terminal edge, the order along it", () => {
        const graph = graphOf(factsOf(
            [...belt(1, ["iron-ore", null]), machine(1, ["iron-ore"], ["iron-plate"]), machine(2, ["iron-plate"], ["iron-gear-wheel"]), chest(1, { never_refuses: true })],
            [
                ...inserter(1, ["iron-ore", "belt:1/lane:1", "machine:1", "ingredients"]),
                ...inserter(2, ["iron-plate", "machine:1", "machine:2", "ingredients"]),
                ...inserter(3, ["iron-gear-wheel", "machine:2", "chest:1", "storage"]),
            ],
            { item: "iron-gear-wheel" },
        ));
        expect(graph.nodes.map(node => [node.key, node.ports])).toEqual([
            ["belt:1/lane:1", ["belt:1/lane:1#iron-ore"]],
            ["belt:1/lane:2", []],
            ["machine:1", []],
            ["machine:2", []],
            ["chest:1", ["chest:1#iron-gear-wheel"]],
            ["sink", []],
        ]);
        expect(graph.components).toEqual([]);
        expect(graph.terminal).toEqual(["inserter:3/iron-gear-wheel"]);
        expect(edge(graph, "inserter:3/iron-gear-wheel").terminal).toBe("storage");
        expect(edge(graph, "inserter:1/iron-ore")).toMatchObject({ from: "belt:1/lane:1#iron-ore", to: "machine:1", hand: 16, floor_cycle: 8, terminal: null });
        expect(graph.order).toEqual(["belt:1/lane:1#iron-ore", "machine:1", "machine:2", "chest:1#iron-gear-wheel", "sink"]);
        expect(graph.shared).toEqual({ out: [], in: [], lanes: [] });
    });

    it("of two machines that feed each other (as agricultural science's egg machines): one loop to seed", () => {
        const graph = graphOf(factsOf(
            [
                ...belt(1, ["nutrients", null]),
                machine(1, ["pentapod-egg", "nutrients"], ["pentapod-egg"], { looping: ["pentapod-egg"] }),
                machine(2, ["pentapod-egg", "nutrients"], ["pentapod-egg"], { looping: ["pentapod-egg"] }),
                chest(1, { never_refuses: true }),
            ],
            [
                ...inserter(1, ["nutrients", "belt:1/lane:1", "machine:1", "ingredients"]),
                ...inserter(2, ["nutrients", "belt:1/lane:1", "machine:2", "ingredients"]),
                ...inserter(3, ["pentapod-egg", "machine:1", "machine:2", "ingredients"]),
                ...inserter(4, ["pentapod-egg", "machine:2", "machine:1", "ingredients"]),
                ...inserter(5, ["pentapod-egg", "machine:1", "chest:1", "storage"]),
            ],
            { item: "pentapod-egg" },
        ));
        expect(graph.components).toEqual([{
            key: "loop:1",
            members: ["machine:1", "machine:2"],
            looping_items: ["pentapod-egg"],
            inside: ["inserter:3/pentapod-egg", "inserter:4/pentapod-egg"],
            in: ["inserter:1/nutrients", "inserter:2/nutrients"],
            out: ["inserter:5/pentapod-egg"],
        }]);
        expect(graph.order).toEqual(["belt:1/lane:1#nutrients", "loop:1", "chest:1#pentapod-egg", "sink"]);
        expect(graph.shared.lanes).toEqual([{ at: "belt:1/lane:1#nutrients", item: "nutrients", edges: ["inserter:1/nutrients", "inserter:2/nutrients"] }]);
        expect(graph.shared.out).toEqual([{ at: "machine:1", item: "pentapod-egg", edges: ["inserter:3/pentapod-egg", "inserter:5/pentapod-egg"] }]);
    });

    it("of a recycler that places into a car it takes from (as the ore voider): a loop through the car's port, the ore brought in terminal", () => {
        const recycler = machine(1, ["iron-ore"], ["iron-ore"], { places_into: { target: "chest:1", lands_in: ["storage"] } });
        const graph = graphOf(factsOf(
            [recycler, chest(1, { gives: ["iron-ore"] }), chest(2, { never_refuses: true, gives: ["iron-ore"] })],
            [
                ...inserter(1, ["iron-ore", "chest:1", "machine:1", "ingredients"]),
                ...inserter(2, ["iron-ore", "chest:2", "machine:1", "ingredients"]),
                ...placements(recycler),
            ],
            { item: "iron-ore", counts: "destroyed" },
        ));
        expect(graph.components).toEqual([{
            key: "loop:1",
            members: ["machine:1", "chest:1#iron-ore"],
            looping_items: [],
            inside: ["inserter:1/iron-ore", "placement:machine:1/iron-ore"],
            in: ["inserter:2/iron-ore"],
            out: [],
        }]);
        expect(graph.terminal).toEqual(["inserter:2/iron-ore"]);
        expect(edge(graph, "inserter:2/iron-ore").terminal).toBe("destroyed");
        // the supply from outside comes before the loop it feeds, and the loop goes on into the SINK
        expect(graph.order).toEqual(["chest:2#iron-ore", "loop:1", "sink"]);
    });

    it("of a wagon that carries ore one way and plates the other (as the steel wagon): no loop on its ports", () => {
        const miner = drill(1, "iron-ore", "chest:1");
        const graph = graphOf(factsOf(
            [...belt(1, ["steel-plate", null]), machine(1, ["iron-plate"], ["steel-plate"]), machine(2, ["iron-ore"], ["iron-plate"]), chest(1), miner],
            [
                ...inserter(1, ["iron-plate", "chest:1", "machine:1", "ingredients"]),
                ...inserter(2, ["steel-plate", "machine:1", "chest:1", "storage"]),
                ...inserter(3, ["steel-plate", "chest:1", "belt:1/lane:1", "lane"]),
                ...inserter(4, ["iron-plate", "machine:2", "chest:1", "storage"]),
                ...inserter(5, ["iron-ore", "chest:1", "machine:2", "ingredients"]),
                ...placements(miner),
            ],
            { item: "steel-plate" },
        ));
        expect(graph.components).toEqual([]);
        expect(graph.nodes.find(node => node.key === "chest:1")!.ports).toEqual(["chest:1#iron-ore", "chest:1#iron-plate", "chest:1#steel-plate"]);
        expect(graph.terminal).toEqual(["inserter:3/steel-plate"]);
        expect(edge(graph, "inserter:3/steel-plate").terminal).toBe("output-lane");
        // the output lane port after the flow that fills it
        expect(graph.order).toEqual([
            "drill:1", "chest:1#iron-ore", "machine:2", "chest:1#iron-plate", "machine:1", "chest:1#steel-plate", "belt:1/lane:1#steel-plate", "sink",
        ]);
    });

    it("of a machine with two takers of one item: a shared node, and a shared feeder where two drop into one", () => {
        const graph = graphOf(factsOf(
            [...belt(1, ["copper-cable", null]), machine(1, ["copper-plate"], ["copper-cable"]), machine(2, ["copper-cable"], ["electronic-circuit"]), chest(1, { never_refuses: true, gives: ["copper-plate"] })],
            [
                ...inserter(1, ["copper-plate", "chest:1", "machine:1", "ingredients"]),
                ...inserter(2, ["copper-cable", "machine:1", "machine:2", "ingredients"]),
                ...inserter(3, ["copper-cable", "machine:1", "machine:2", "ingredients"]),
                ...inserter(4, ["copper-cable", "machine:1", "belt:1/lane:1", "lane"]),
                ...inserter(5, ["electronic-circuit", "machine:2", "chest:1", "storage"]),
            ],
            { item: "electronic-circuit" },
        ));
        expect(graph.shared.out).toEqual([
            { at: "machine:1", item: "copper-cable", edges: ["inserter:2/copper-cable", "inserter:3/copper-cable", "inserter:4/copper-cable"] },
        ]);
        expect(graph.shared.in).toEqual([{ at: "machine:2", item: "copper-cable", edges: ["inserter:2/copper-cable", "inserter:3/copper-cable"] }]);
        // the cable dropped on a lane nobody takes from leaves the build; the infinity chest gives plates and takes circuits
        expect(graph.terminal).toEqual(["inserter:4/copper-cable", "inserter:5/electronic-circuit"]);
        expect(graph.nodes.find(node => node.key === "chest:1")!.ports).toEqual(["chest:1#copper-plate", "chest:1#electronic-circuit"]);
    });

    it("of an inserter that carries two items: one capacity group, two edges, each from the lane of its item", () => {
        const facts = factsOf(
            [...belt(1, ["inserter", "transport-belt"]), ...belt(2, ["iron-plate", "iron-plate"]), machine(1, ["inserter", "transport-belt", "iron-plate"], ["logistic-science-pack"])],
            [
                ...inserter(1,
                    ["inserter", "belt:1/lane:1", "machine:1", "ingredients"],
                    ["transport-belt", "belt:1/lane:2", "machine:1", "ingredients"]),
                ...inserter(2, ["iron-plate", "belt:2/lane:1", "machine:1", "ingredients", ["belt:2/lane:1", "belt:2/lane:2"]]),
            ],
        );
        const graph = graphOf(facts);
        expect(graph.edges.filter(it => it.group === "inserter:1").map(it => [it.key, it.from])).toEqual([
            ["inserter:1/inserter", "belt:1/lane:1#inserter"],
            ["inserter:1/transport-belt", "belt:1/lane:2#transport-belt"],
        ]);
        // a pickup from a belt whose both lanes carry the item takes from both lane ports: neither looks untaken
        expect(edge(graph, "inserter:2/iron-plate").from_ports).toEqual(["belt:2/lane:1#iron-plate", "belt:2/lane:2#iron-plate"]);
        expect(graph.order.slice(0, 4)).toEqual(["belt:1/lane:1#inserter", "belt:1/lane:2#transport-belt", "belt:2/lane:1#iron-plate", "belt:2/lane:2#iron-plate"]);
        // its result has no taker: an uncovered port, as the coverage check reports it
        expect(uncoveredPortsOf(facts, graph)).toEqual([{ side: "output", at: "machine:1", item: "logistic-science-pack" }]);
    });

    it("of a placer into a silo whose recipe takes one of its results: an input port with no way out, no port for what the target takes none of", () => {
        const placer = machine(1, ["holmium-plate"], ["rocket-fuel", "lithium", "advanced-circuit"], { places_into: { target: "chest:1", lands_in: ["input-slots", "storage", null] } });
        const facts = factsOf(
            [placer, chest(1, { input_slots: ["rocket-fuel"] }), chest(2, { never_refuses: true, gives: ["holmium-plate"] })],
            [
                ...inserter(1, ["holmium-plate", "chest:2", "machine:1", "ingredients"]),
                ...inserter(2, ["lithium", "chest:1", "chest:2", "storage"]),
                ...placements(placer),
            ],
        );
        const graph = graphOf(facts);
        expect(graph.nodes.find(node => node.key === "chest:1")!.ports).toEqual(["chest:1#input:rocket-fuel", "chest:1#lithium"]);
        expect(edge(graph, "placement:machine:1/rocket-fuel")).toMatchObject({ to: "chest:1#input:rocket-fuel", lands_in: "input-slots", terminal: null });
        expect(graph.edges.some(it => it.from_ports.includes("chest:1#input:rocket-fuel"))).toBe(false);
        // the result the silo takes none of stays in the placer: no arc, no port; no inserter takes it out either
        expect(edge(graph, "placement:machine:1/advanced-circuit")).toMatchObject({ to: "chest:1", lands_in: null, terminal: null });
        expect(uncoveredPortsOf(facts, graph)).toEqual([{ side: "output", at: "machine:1", item: "advanced-circuit" }]);
    });

    it("of an export lane: what is dropped on it is terminal, a demand the build must meet, though another lane is taken from", () => {
        const graph = graphOf(factsOf(
            [...belt(1, ["electronic-circuit", null], 55), ...belt(2, ["electronic-circuit", null]), machine(1, ["copper-cable"], ["electronic-circuit"]),
                machine(2, ["electronic-circuit"], ["processing-unit"]), chest(1, { never_refuses: true, gives: ["copper-cable"] })],
            [
                ...inserter(1, ["copper-cable", "chest:1", "machine:1", "ingredients"]),
                ...inserter(2, ["electronic-circuit", "machine:1", "belt:1/lane:1", "lane"]),
                ...inserter(3, ["electronic-circuit", "machine:1", "belt:2/lane:1", "lane"]),
                ...inserter(4, ["electronic-circuit", "belt:2/lane:1", "machine:2", "ingredients"]),
                ...inserter(5, ["processing-unit", "machine:2", "chest:1", "storage"]),
            ],
            { item: "processing-unit" },
        ));
        expect(graph.edges.map(it => [it.key, it.terminal])).toEqual([
            ["inserter:1/copper-cable", null],
            ["inserter:2/electronic-circuit", "export-lane"],
            ["inserter:3/electronic-circuit", null],
            ["inserter:4/electronic-circuit", null],
            ["inserter:5/processing-unit", "storage"],
        ]);
        // the export lane's port after the machine that fills it
        expect(graph.order.indexOf("belt:1/lane:1#electronic-circuit")).toBeGreaterThan(graph.order.indexOf("machine:1"));
    });

    it("of an export belt: a drop on its other side fills the export too, though something takes from that side", () => {
        const graph = graphOf(factsOf(
            [...belt(1, ["electronic-circuit", null], 55), ...belt(2, ["electronic-circuit", "electronic-circuit"], 55), machine(1, ["copper-cable"], ["electronic-circuit"]),
                machine(2, ["electronic-circuit"], ["processing-unit"]), chest(1, { never_refuses: true, gives: ["copper-cable"] })],
            [
                ...inserter(1, ["copper-cable", "chest:1", "machine:1", "ingredients"]),
                ...inserter(2, ["electronic-circuit", "machine:1", "belt:1/lane:2", "lane"]),
                ...inserter(3, ["electronic-circuit", "machine:1", "belt:2/lane:2", "lane"]),
                ...inserter(4, ["electronic-circuit", "belt:2/lane:2", "machine:2", "ingredients"]),
                ...inserter(5, ["processing-unit", "machine:2", "chest:1", "storage"]),
            ],
            { item: "processing-unit" },
        ));
        expect(graph.edges.map(it => [it.key, it.terminal])).toEqual([
            ["inserter:1/copper-cable", null],
            ["inserter:2/electronic-circuit", "export-lane"],
            ["inserter:3/electronic-circuit", "export-lane"],
            ["inserter:4/electronic-circuit", null],
            ["inserter:5/processing-unit", "storage"],
        ]);
        // the taken side keeps the flow from its filler to its taker
        expect(graph.order).toEqual([
            "belt:1/lane:1#electronic-circuit", "belt:2/lane:1#electronic-circuit", "chest:1#copper-cable", "machine:1", "belt:1/lane:2#electronic-circuit", "belt:2/lane:2#electronic-circuit", "machine:2", "chest:1#processing-unit", "sink",
        ]);
    });

    it("of a destroyed target (D13): terminal only where it is brought from a container or a belt the build puts nothing into", () => {
        const recycler = machine(1, ["scrap"], ["iron-gear-wheel"], { places_into: { target: "chest:3", lands_in: ["storage"] } });
        const facts = factsOf(
            [...belt(1, ["scrap", null]), ...belt(2, ["scrap", null]), recycler, chest(1), chest(3, { never_refuses: true })],
            [
                ...inserter(1, ["scrap", "belt:1/lane:1", "machine:1", "ingredients"]),
                ...inserter(2, ["scrap", "belt:2/lane:1", "chest:1", "storage"]),
                ...inserter(3, ["scrap", "chest:1", "machine:1", "ingredients"]),
                ...placements(recycler),
            ],
            { item: "scrap", counts: "destroyed" },
        );
        const graph = graphOf(facts);
        expect(graph.terminal).toEqual(["inserter:1/scrap", "placement:machine:1/iron-gear-wheel"]);
        expect(graph.edges.map(it => it.terminal)).toEqual(["destroyed", null, null, "storage"]);
        // the destroyed scrap still flows into the recycler: its lane comes before it, and the recycler goes on into the SINK
        expect(graph.order).toEqual(["belt:1/lane:1#scrap", "belt:2/lane:1#scrap", "chest:1#scrap", "machine:1", "chest:3#iron-gear-wheel", "sink"]);
        // counted as made, the scrap brought in is no terminal edge
        expect(plannerGraphOf(facts, { ...facts.target, counts: "made" }).terminal).toEqual(["placement:machine:1/iron-gear-wheel"]);
    });

    it("comes out the same each time, as plain JSON", () => {
        const facts = factsOf(
            [...belt(1, ["iron-ore", "iron-ore"]), machine(1, ["iron-ore"], ["iron-plate"]), chest(1, { never_refuses: true })],
            [...inserter(1, ["iron-ore", "belt:1/lane:2", "machine:1", "ingredients", ["belt:1/lane:1", "belt:1/lane:2"]]), ...inserter(2, ["iron-plate", "machine:1", "chest:1", "storage"])],
        );
        const graph = plannerGraphOf(facts);
        expect(JSON.parse(JSON.stringify(graph))).toStrictEqual(graph);
        expect(graphSnapshotOf(plannerGraphOf(facts), "HAND")).toBe(graphSnapshotOf(graph, "HAND"));
        expect(JSON.parse(graphSnapshotOf(graph, "HAND"))).toMatchObject({ schema: 1, sample: "HAND" });
    });

    it("whose invariants are broken is told so, item by item", () => {
        const facts = factsOf(
            [...belt(1, ["iron-ore", null]), machine(1, ["iron-ore"], ["iron-plate"]), chest(1, { never_refuses: true })],
            [...inserter(1, ["iron-ore", "belt:1/lane:1", "machine:1", "ingredients"]), ...inserter(2, ["iron-plate", "machine:1", "chest:1", "storage"])],
        );
        const graph = plannerGraphOf(facts);
        const broken: PlannerGraph = {
            ...graph,
            edges: graph.edges.map(it => it.key === "inserter:1/iron-ore" ? { ...it, to: "machine:9", group: "inserter:7" } : it),
            order: [...graph.order].reverse(),
            terminal: [],
        };
        expect(graphInvariantIssues(facts, broken, []).map(issue => issue.split(":")[0])).toEqual(
            ["1", "2", "3", "4", "4", "5"]);
    });

    it("is built from types alone: the builder, its components and its snapshot import no engine module", () => {
        for (const file of ["build-graph.ts", "components.ts", "snapshot.ts", "invariants.ts"]) {
            const source = fs.readFileSync(path.join(__dirname, file), "utf8");
            // an import written over several lines too
            const imports = [...source.matchAll(/^import\s+(type\s+)?[\s\S]*?\s+from\s+"([^"]+)";/gm)];
            expect(imports.length, file).toBe((source.match(/^import\b/gm) ?? []).length);
            expect(imports.filter(([, type, from]) => type === undefined && !from.startsWith("./")), file).toEqual([]);
        }
    });
});
