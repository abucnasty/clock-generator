import { GameFixturePaths } from "../../tests/game/helpers/fixture-paths";
import { expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";

it("selects a moving clock with reachable stacks and keeps backed-up alternatives out of that preference", async () => {
    const config = await loadConfigFromFile(GameFixturePaths.DIFFERENT_ITEMS_CONFIG);
    const generated = generateClockAlternatives(config, { logger: { log() {}, warn() {}, error() {}, debug() {} } });
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.verdict).toBe("stable");
    expect(selected.belt?.kind).toBe("moving");
    expect(selected.assessment.items_per_second).toBe(30);
    expect(selected.assessment.backpressure_loss).toMatchObject({ survives: true });
    expect(generated.alternatives.find(a => a.id === "planned")?.ranking.matches_belt_choice).toBe(false);
});


it.each(['side-inner', 'side-outer'] as const)('generates a stable moving clock with a single %s stream', async profile => {
    const config = await loadConfigFromFile(GameFixturePaths.SAME_ITEM_CONFIG);
    config.belts[0].lanes[1]!.ingredient = '';
    const source = config.inserters[1].source;
    if (source.type !== 'belt') throw new Error('expected belt input');
    source.pickup_length = 1;
    source.pickup_supply = [profile, 'through'];
    const generated = generateClockAlternatives(config, {logger: {log() {}, warn() {}, error() {}, debug() {}}});
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.verdict).toBe('stable');
    expect(selected.belt?.kind).toBe('moving');
    expect(selected.assessment.items_per_second).toBeGreaterThanOrEqual(config.target_output.items_per_second);
});
