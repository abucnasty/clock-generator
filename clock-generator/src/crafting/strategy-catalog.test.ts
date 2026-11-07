import { describe, expect, test } from "vitest";
import type { StrategyConstruction, StrategyFamily } from "./clock-strategy";
import { catalogRowOf, routerRowOf, type EnableControlStrategyRouter, type StrategyCatalogRow } from "./strategy-catalog";

// Every family and construction of a strategy has its row; typed so that a family added to the union fails here until it is listed.
const CONSTRUCTIONS: Record<StrategyFamily, (StrategyConstruction | undefined)[]> = {
    "takt-batches": ["arithmetic", "planning-run"],
    "round-robin-polling": ["grouped-hands"],
    "euclidean-swings": ["planning-run"],
    "time-division-slots": [undefined],
    "time-study-windows": [undefined],
    "moved-output-swing": [undefined],
    "signal-offset": [undefined],
    "pitch-pickups": [undefined],
    "exhaust": [undefined],
    "per-branch": [undefined],
};
const ROUTERS: Record<EnableControlStrategyRouter, true> = { direct: true, coordinated_sources: true };

const words = (row: StrategyCatalogRow) => [row.name, row.line, row.definition, row.practice];

describe("the catalog", () => {
    test("has a row of words for every family and construction", () => {
        for (const [family, constructions] of Object.entries(CONSTRUCTIONS) as [StrategyFamily, (StrategyConstruction | undefined)[]][]) {
            for (const construction of constructions) {
                const row = catalogRowOf({ family, ...(construction !== undefined && { construction }) });
                expect(words(row).every(text => text.length > 0), `${family} ${construction}`).toBe(true);
            }
        }
    });

    test("tells the two Takt Batches apart by the tuning method", () => {
        expect(catalogRowOf({ family: "takt-batches", construction: "arithmetic" }).tuning_method).toBe("calculated");
        expect(catalogRowOf({ family: "takt-batches", construction: "planning-run" }).tuning_method).toBe("observed");
        expect(catalogRowOf({ family: "takt-batches", construction: "arithmetic" }).name).toBe(catalogRowOf({ family: "takt-batches", construction: "planning-run" }).name);
    });

    test("has a row of words for every router, and Coordinated Sources is the per-branch row", () => {
        for (const router of Object.keys(ROUTERS) as EnableControlStrategyRouter[]) expect(words(routerRowOf(router)).every(text => text.length > 0), router).toBe(true);
        expect(routerRowOf("coordinated_sources")).toBe(catalogRowOf({ family: "per-branch" }));
        expect(routerRowOf("direct").tuning_method).toBeNull();
    });
});
