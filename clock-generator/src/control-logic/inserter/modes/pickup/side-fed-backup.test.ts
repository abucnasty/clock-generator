import fs from "fs";
import path from "path";
import {beforeAll, expect, test} from "vitest";
import {Config} from "../../../../config";
import {loadConfigFromFile} from "../../../../config/loader";
import {GameFixturePaths} from "../../../../../tests/game/helpers/fixture-paths";
import {compareSingleSideFeed, SingleSideClip} from "../../../../../tests/game/mechanics/belt-pickup/single-side-feed-comparison";

const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.SIDE_LOADED_STRAIGHT, "single-backed-clips.json"), "utf8")) as {clips: SingleSideClip[]};
let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(path.join(GameFixturePaths.SIDE_LOADED_STRAIGHT, "config.json"));});
for (const clip of fixture.clips) test(`persistent single-stream side refill: ${clip.name}`, () => {
    expect(compareSingleSideFeed(config, clip)).toEqual([]);
    expect(compareSingleSideFeed(config, clip, true)).toEqual([]);
});
