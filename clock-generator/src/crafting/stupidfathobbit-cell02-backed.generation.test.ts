import {describe} from "vitest";
import {cell02ClockTests} from "../../tests/game/builds/stupidfathobbit-cell02-generation";

// The real stupidfathobbit cell 02 with "Backed-up belts" on; the other cases are in stupidfathobbit-cell02.generation.test.ts
describe("the real stupidfathobbit cell 02", () => {
    cell02ClockTests(variant => variant.backed);
});
