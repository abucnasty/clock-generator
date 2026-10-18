import path from "path";
import { expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";

it("selects a moving clock with reachable stacks and keeps backed-up alternatives out of that preference", async () => {
    const config = await loadConfigFromFile(path.resolve(__dirname,
        "../../resources/config-samples/science/electromagnetic-science/belted-moving/config.json"));
    const generated = generateClockAlternatives(config, { logger: { log() {}, warn() {}, error() {}, debug() {} } });
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.verdict).toBe("stable");
    expect(selected.belt?.kind).toBe("moving");
    expect(selected.assessment.items_per_second).toBe(30);
    expect(selected.assessment.backpressure_loss).toMatchObject({ survives: true });
    expect(generated.alternatives.find(a => a.id === "planned")?.ranking.matches_belt_choice).toBe(false);
});
