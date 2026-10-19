import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {BELT_SPEEDS} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {overTheHoodExitAtSpeed} from "./over-the-hood-exit-fixtures";

test("the documented compact over-the-hood scaffold matches the captured normal control", () => {
    const fixture = GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT;
    const source = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
    const documented = fs.readFileSync(path.join(fixture, "compact-normal-scaffold.txt"), "utf8");
    const normal = BELT_SPEEDS.find(speed => speed.name === "normal")!;
    const decode = (text: string) => JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    expect(decode(documented)).toEqual(decode(overTheHoodExitAtSpeed(source, normal, {compactDestination: true})));
});
