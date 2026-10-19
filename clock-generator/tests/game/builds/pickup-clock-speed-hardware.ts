import zlib from "zlib";
import {expect} from "vitest";
import {z} from "zod";
import {Config} from "../../../src/config";
import {Recording} from "../../../src/verification/recording";

/** Audit retained native setup separately from throughput; numeric belt ids are local to each export. */
export function assertPickupClockHardware(recording: Recording, config: Config, blueprint: string): void {
    const expectedMachine = config.machines[0];
    const machines = z.array(z.object({id: z.number(), recipe: z.string(), crafting_speed: z.number(), productivity: z.number()}))
        .parse(recording.config.machines);
    expect(machines).toHaveLength(1);
    const machine = machines[0];
    expect(machine).toMatchObject({recipe: expectedMachine.recipe, crafting_speed: expectedMachine.crafting_speed,
        productivity: expectedMachine.productivity});
    expect(recording.machines).toHaveLength(1);
    expect(recording.machines[0]).toMatchObject({id: machine.id, recipe: expectedMachine.recipe});
    const expectedInput = config.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
    if (expectedInput.source.type !== "belt") throw new Error("Expected belt input");
    const expectedOutput = config.inserters.find(inserter => inserter.source.type === "machine")!;
    const input = recording.inserters.filter(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine");
    const output = recording.inserters.filter(inserter => inserter.source.type === "machine");
    expect(input).toHaveLength(1);
    expect(output).toHaveLength(1);
    expect(input[0]).toMatchObject({sink: {id: machine.id}, stack_size: expectedInput.stack_size});
    expect(input[0].source).toMatchObject({near_lane: expectedInput.source.near_lane,
        pickup_length: expectedInput.source.pickup_length});
    expect(output[0]).toMatchObject({source: {id: machine.id}, sink: {type: expectedOutput.sink.type},
        stack_size: expectedOutput.stack_size});
    for (const actual of [input[0], output[0]]) {
        const captured = recording.config.inserters.find(inserter => inserter.source.type === actual.source.type
            && inserter.sink.type === actual.sink.type && (inserter.source.type === "machine"
                ? inserter.source.id === machine.id : inserter.sink.id === machine.id));
        expect(captured).toMatchObject({source: actual.source, sink: actual.sink, stack_size: actual.stack_size});
    }
    const expectedBelt = config.belts.find(belt => belt.id === expectedInput.source.id)!;
    const inputBelt = recording.config.belts.find(belt => belt.id === input[0].source.id);
    expect(inputBelt).toMatchObject({type: expectedBelt.type, lanes: expectedBelt.lanes});
    const heldItems = output[0].samples.held_item.map(([, item]) => item).filter(Boolean);
    expect(heldItems.every(item => item === config.target_output.recipe)).toBe(true);
    if (expectedOutput.sink.type === "belt") {
        const outputBelt = config.belts.find(belt => belt.id === expectedOutput.sink.id)!;
        expect(output[0].drop_lane).toEqual({index: 1, length: 1});
        const counts = output[0].samples.held_count;
        const drops = counts.slice(1).map((count, index) => counts[index] - count).filter(count => count > 0);
        expect(drops.every(count => count === outputBelt.lanes[0].stack_size)).toBe(true);
        // Empty output belts are omitted by Sidecar; their sink id falls back to 1 and can alias the input.
        // Only compare output lane metadata when the exported belt actually carries the output product.
        const nativeOutput = recording.config.belts.find(belt => belt.id === output[0].sink.id
            && belt.lanes.some(lane => lane.ingredient === config.target_output.recipe));
        if (nativeOutput) expect(nativeOutput).toMatchObject({type: outputBelt.type, lanes: outputBelt.lanes});
    }
    const entities = (JSON.parse(zlib.inflateSync(Buffer.from(blueprint.trim().slice(1), "base64")).toString()) as
        {blueprint: {entities: {name: string}[]}}).blueprint.entities;
    const transport = entities.map(entity => /^(turbo-|express-|fast-)?(transport-belt|underground-belt|loader|splitter)$/.exec(entity.name))
        .filter((match): match is RegExpExecArray => match !== null);
    expect(transport.length).toBeGreaterThan(0);
    expect(transport.every(match => `${match[1] ?? ""}transport-belt` === expectedBelt.type)).toBe(true);
}
