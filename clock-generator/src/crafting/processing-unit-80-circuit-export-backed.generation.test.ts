import {describe} from "vitest";
import {circuitExportClockTests} from "../../tests/game/builds/processing-unit-80-circuit-export-generation";

// The processing unit circuit export build with "Backed-up belts" on; the other cases are in processing-unit-80-circuit-export.generation.test.ts
describe("processing units at 80 a second with a circuit export", () => {
    circuitExportClockTests(variant => variant.backed);
});
