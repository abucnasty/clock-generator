import { describe, expect, it } from "vitest";
import path from "path";
import { composeProbeSource } from "./probe-source";
import { GameFixturePaths } from "./fixture-paths";

describe("probe source passed through the existing harness Lua interface", () => {
    it("round-trips parameters containing quotes, newlines and Lua closing delimiters without exposing executable source", () => {
        const options = { item: `a"\\b\n]] ]=] ]==]'); error("must remain data") --` };
        const source = composeProbeSource(path.join(GameFixturePaths.DIFFERENT_ITEMS, "backed-up-probe.lua"), options);
        const literal = /local options = helpers\.json_to_table\(\[(=*)\[([\s\S]*?)\]\1\]\)/.exec(source);
        expect(literal).not.toBeNull();
        expect(JSON.parse(literal![2])).toEqual(options);
        expect(source).not.toContain("__ITEM__");
    });
});
