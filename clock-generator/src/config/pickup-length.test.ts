import { describe, expect, it } from "vitest";
import { InserterConfigSchema } from "./schema";
import { parseConfig } from "./loader";

describe("belt pickup geometry defaults", () => {
    it.each([undefined, 1, 0.5] as const)("normalizes length %s", async length => {
        const config = await parseConfig(JSON.stringify({
            setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
            machines: [], belts: [],
            inserters: [{ source: { type: "belt", id: 1, pickup_length: length, ...(length === 0.5 && {pickup_layout: "side-entrance"}) }, sink: { type: "machine", id: 1 } }],
        }));
        expect(config.inserters[0].source).toEqual({ type: "belt", id: 1, pickup_length: length ?? 1, ...(length === 0.5 && {pickup_layout: "side-entrance"}) });
    });

    it("does not attach belt geometry to machine or chest sources", () => {
        for (const type of ["machine", "chest"] as const) {
            const source = { type, id: 1 };
            expect(InserterConfigSchema.parse({ source, sink: { type: "machine", id: 2 } }).source).toEqual(source);
        }
    });

    it.each([0, 0.25, 2, null])("rejects unsupported geometry %s instead of treating it as a supply setting", pickup_length => {
        expect(InserterConfigSchema.safeParse({
            source: { type: "belt", id: 1, pickup_length }, sink: { type: "machine", id: 1 },
        }).success).toBe(false);
    });
});
