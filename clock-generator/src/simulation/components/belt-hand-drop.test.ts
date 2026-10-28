import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../../tests/game/helpers/fixture-paths";
import {compareOutputStock, OutputClip} from "../../../tests/game/mechanics/belt-drop/output-stock-comparison";

const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.TURBO_BELT_DROP, "output-clips.json"), "utf8")) as {clips: OutputClip[]};

// All pickups, quantities, later hands, and local packet positions follow from a disabled startup and finite source.
for (const clip of fixture.clips) test(`finite output stock matches native hand, source and lane: ${clip.name}`, () => {
    expect(compareOutputStock(clip)).toEqual([]);
});
