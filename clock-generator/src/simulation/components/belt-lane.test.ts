import { describe, expect, test } from "vitest";
import { BeltStrategy } from "../../common/entity-types";
import { EntityId } from "../../entities";
import { Belt, BeltSpeed } from "../../entities/belt";
import { BackedUpPickupLane } from "../../state/backed-up-pickup-lane";
import { BeltPickupLane } from "../../state/belt-pickup-lane";
import { BeltPickupStock } from "../../state/belt-pickup-stock";
import { LaneTraffic } from "../../state/lane-traffic";
import { TransportBelt } from "../archetypes/transport-belt";
import { BeltLane } from "./belt-lane";

const SPEED = BeltSpeed.TURBO_TRANSPORT_BELT;
const HALF_TILE = Belt.ticksPerTile(SPEED).toDecimal() * 0.5;

function twoLaneBelt(): TransportBelt {
    return TransportBelt.create({
        entity_id: EntityId.forBelt(1), belt_speed: SPEED, strategy: BeltStrategy.NORMAL,
        lanes: [{ ingredient_name: "iron-plate", stack_size: 4 }, { ingredient_name: "copper-plate", stack_size: 2 }],
    });
}

/** The lanes' part of the key as the belt state before the lanes were components wrote it, over the same lane contents */
function keyOfOneBeltState(lane_traffic: { stateKey(tick: number): string }[], drop_lanes: Map<string, LaneTraffic[]>,
    pickup_lanes: Map<string, BeltPickupStock[]>, tick: number): string {
    return lane_traffic.map(it => it.stateKey(tick)).join("|")
        + ";" + [...drop_lanes].map(([id, lanes]) => `${id}:${lanes.map(lane => lane.stateKey(tick)).join("|")}`).join(";")
        + ";" + [...pickup_lanes].map(([id, lanes]) => `${id}:${lanes.map(lane => lane.stateKey(tick)).join("|")}`).join(";");
}

describe("BeltLane", () => {
    test("reads its item and stack from the lane", () => {
        const lane = new BeltLane({ ingredient_name: "iron-plate", stack_size: 4 }, SPEED);
        expect([lane.item, lane.stack_size]).toEqual(["iron-plate", 4]);
    });

    test("gives every hand with a drop spot the one shared traffic, and each hand without one its own tile, kept on a rebuild", () => {
        const lane = new BeltLane({ ingredient_name: "iron-plate", stack_size: 4 }, SPEED);
        expect(lane.sharedDrop(HALF_TILE)).toBe(lane.sharedDrop(HALF_TILE));
        const own = lane.ownDrop("inserter:1", HALF_TILE);
        expect(lane.ownDrop("inserter:1", HALF_TILE)).toBe(own);
        expect(lane.ownDrop("inserter:2", HALF_TILE)).not.toBe(own);
        expect([...lane.dropIds()]).toEqual(["inserter:1", "inserter:2"]);
        expect(lane.insert(own, 0, HALF_TILE)).toBe(true);
        expect(lane.dropOf("inserter:1")).toBe(own.traffic);
    });

    test("a seeded stock reaches the slot a built hand holds, and one stack a tick is taken from it", () => {
        const lane = new BeltLane({ ingredient_name: "iron-plate", stack_size: 4 }, SPEED);
        const pickup = lane.addPickup("inserter:1", new BackedUpPickupLane(SPEED, 1, 4));
        const seeded = new BeltPickupLane(SPEED, 1, 4, 3);
        lane.seedPickup("inserter:1", seeded);
        expect(lane.pickupOf("inserter:1")).toBe(pickup);
        expect(pickup.stock).toBe(seeded);
        expect(lane.take(pickup, 5, 4)).toBe(4);
        expect(lane.takenAt(pickup, 5)).toBe(true);
        expect(lane.take(pickup, 5, 4)).toBe(0);
    });
});

describe("TransportBelt", () => {
    test("has one lane for each lane of the belt and one supply gate", () => {
        const belt = twoLaneBelt();
        expect(belt.lanes.map(lane => lane.item)).toEqual(["iron-plate", "copper-plate"]);
        expect(belt.supply.isOpen()).toBe(true);
    });

    test("keys its inventory, its supply gate and its lanes as the belt's state did: shared traffic, then each hand's own tiles, then each hand's reach", () => {
        const belt = twoLaneBelt();
        const [first, second] = belt.lanes;
        // The old formula is fed the traffics and stocks this test makes, not what the belt hands back for them
        const shared = belt.lanes.map(lane => lane.sharedDrop(HALF_TILE));
        const drop_lanes = new Map(["inserter:3", "inserter:1"]
            .map(id => [id, belt.lanes.map(lane => lane.ownDrop(id, HALF_TILE).traffic)]));
        const pickup_lanes = new Map(["inserter:4", "inserter:2"]
            .map(id => [id, belt.lanes.map(lane => new BeltPickupLane(SPEED, 1, lane.stack_size, 0))]));
        for (const [id, stocks] of pickup_lanes) belt.seedPickups(id, stocks);
        first.insert(shared[0], 0, HALF_TILE);
        second.insert(second.ownDrop("inserter:1", HALF_TILE), 1, HALF_TILE);
        first.take(first.pickupOf("inserter:2")!, 2, 4);

        const tick = 3;
        const key = belt.stateKey(tick);
        // the belt's inventory (what its lanes give, the same in every tick) and its gate (open: nothing) come first
        const inventory = JSON.stringify(Object.entries(belt.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b)));
        expect(key).toBe(`${inventory};;` + keyOfOneBeltState(shared.map(drop => drop.traffic), drop_lanes, pickup_lanes, tick));
        // shared traffic of both lanes; own tiles of inserters 3 and 1 by lane; the reach of inserters 4 and 2 by lane
        expect(key).toBe(`[["copper-plate",8],["iron-plate",16]];;`
            + "-7|;inserter:3:|;inserter:1:|-6;inserter:4:32;false;|32;false;;inserter:2:32;false;2:0|32;false;");
        belt.supply.withheld.add("iron-plate");
        expect(belt.stateKey(tick)).toBe(key.replace(";;", ";W:iron-plate;R:;"));
    });

    test("tells apart a stack taken and one not taken", () => {
        const taken = twoLaneBelt(), untouched = twoLaneBelt();
        for (const belt of [taken, untouched]) {
            belt.seedPickups("inserter:1", belt.lanes.map(lane => new BeltPickupLane(SPEED, 1, lane.stack_size, 0)));
        }
        taken.lanes[0].take(taken.lanes[0].pickupOf("inserter:1")!, 0, 4);
        expect(taken.stateKey(1)).not.toBe(untouched.stateKey(1));
    });

    test("seeds a stock for each lane, never fewer", () => {
        const belt = twoLaneBelt();
        expect(() => belt.seedPickups("inserter:1", [new BeltPickupLane(SPEED, 1, 4, 0)])).toThrow();
    });
});
