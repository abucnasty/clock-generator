import { GameFixturePaths } from "../../tests/game/helpers/fixture-paths";
import { expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";
import { alwaysOnReasonProblemsOf } from "./generate-blueprint-test-helpers";

it("selects a moving clock with reachable stacks and keeps backed-up alternatives out of that preference", async () => {
    const config = await loadConfigFromFile(GameFixturePaths.DIFFERENT_ITEMS_CONFIG);
    const generated = generateClockAlternatives(config, { logger: { log() {}, warn() {}, error() {}, debug() {} } });
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.verdict).toBe("stable");
    expect(selected.belt?.kind).toBe("moving");
    expect(selected.assessment.items_per_second).toBe(30);
    expect(selected.assessment.backpressure_loss).toMatchObject({ survives: true });
    expect(generated.alternatives.find(a => a.id === "planned")?.ranking.matches_belt_choice).toBe(false);
});
