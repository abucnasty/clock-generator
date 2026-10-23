import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import { ConfigPaths } from "../../../../src/config/config-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

// Factorio permits require only while parsing control.lua. Load the same Sidecar sources into test-local closures.
const modules = ["types", "helpers", "pickup-supply", "drop-merge", "suggested-target", "extraction", "export"];
const captureModules = `local capture_modules, require = {}, nil
require = function(name) return assert(capture_modules[name], name) end
` + modules.map(name => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, `clock-generator-sidecar/scripts/${name}.lua`), "utf8");
    return `capture_modules["__clock-generator-sidecar__.scripts.${name}"] = (function()\n${source}\nend)() or true\n`;
}).join("");

const SCAFFOLD = path.join(path.dirname(ConfigPaths.REAL_OWNER_LITHIUM_SILO), "lithium-silo-scaffold.txt");

/**
 * Every case the lua chunk below builds or reads, with the tiles it must mark ("none": not marked), written to the
 * script output as `case: tiles` lines. The test reads them back so a case that did not run fails.
 */
const EXPECTED_CASES: Record<string, string> = {
    "lithium-scaffold-marked": "2 drops, tiles 3 and 3",
    "lithium-scaffold-unmarked": "4 drops",
    "straight-run": "none",
    "curve": "none",
    "belt-end": "none",
    "loop": "none",
    "side-load-1-tile": "1",
    "side-load-far-down-a-long-selected-belt": "40",
    "side-load-past-the-selection": "none",
    "side-load-just-inside-the-selection": "4",
    "drop-on-the-through-belt": "none",
    "two-side-loads-nothing-behind": "none",
    "side-load-onto-an-exit": "1",
    "side-load-onto-an-entrance-with-a-belt-behind": "1",
    "side-load-onto-an-entrance-with-nothing-behind": "none",
    "entrance-exit-then-side-load": "3",
    "splitter-on-the-path": "none",
    "export-field": "ok",
};

test("Sidecar marks a drop that side-loads onto a belt fed from behind, and no other", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sideload-drop-"));
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: 60, warmup_ticks: 3600, settle_ticks: 0,
            seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + `
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local report = {}
local function note(case, text) table.insert(report, case .. ": " .. text) end

-- The lithium scaffold: the two drops on underground entrances whose exits side-load onto the shared belt are marked
-- with 3 tiles; the other four, which run in line with that belt, are not.
local captured = extraction.extract_all_entities(entities, game.forces.player)
local marked, unmarked = {}, {}
for _, data in ipairs(captured.inserters) do
    if data.sink and data.sink.type == "belt" then
        local target = data.entity.drop_target
        -- the two marked drops land on pieces that face north or south; the belt they join and the other drops face east
        local vertical = target.direction == defines.direction.north or target.direction == defines.direction.south
        if data.sink.side_load_tiles then table.insert(marked, data.sink.side_load_tiles) else table.insert(unmarked, data) end
        assert(vertical == (data.sink.side_load_tiles ~= nil), "a drop is marked exactly when it lands on a vertical piece")
    end
end
assert(#marked == 2 and marked[1] == 3 and marked[2] == 3, "two drops marked with 3 tiles")
assert(#unmarked == 4, "four drops not marked")
note("lithium-scaffold-marked", "2 drops, tiles " .. marked[1] .. " and " .. marked[2])
note("lithium-scaffold-unmarked", "4 drops")

-- Small builds on their own ground. Each case: belt pieces, an inserter that drops on one, the tiles the drop is
-- marked with (nil: not marked), and the pieces the export is told were selected.
local function belt(name, x, y, direction, endpoint)
    return assert(surface.create_entity{name = name, position = {x, y}, direction = direction, type = endpoint, force = "player"})
end
local N, E, S, W = defines.direction.north, defines.direction.east, defines.direction.south, defines.direction.west
local function line(x, y, direction, count)
    local dx = direction == E and 1 or direction == W and -1 or 0
    local dy = direction == S and 1 or direction == N and -1 or 0
    local pieces = {}
    for i = 0, count - 1 do table.insert(pieces, belt("turbo-transport-belt", x + dx * i, y + dy * i, direction)) end
    return pieces
end
local function join(...)
    local all = {}
    for _, list in ipairs{...} do for _, piece in ipairs(list) do table.insert(all, piece) end end
    return all
end
-- an inserter beside a piece, pointing away from it: it drops on the piece. The chest it takes from is behind it.
local function dropper(piece, dx, dy)
    local direction = dy == 1 and S or dy == -1 and N or dx == 1 and E or W
    local px, py = piece.position.x, piece.position.y
    local inserter = assert(surface.create_entity{name = "stack-inserter", position = {px + dx, py + dy}, direction = direction, force = "player"})
    local chest = assert(surface.create_entity{name = "infinity-chest", position = {px + 2 * dx, py + 2 * dy}, force = "player"})
    inserter.pickup_target = chest
    inserter.drop_target = piece
    assert(inserter.drop_target == piece, "the inserter drops on its piece")
    return inserter, chest
end
local function case(name, expected, selection, drop_piece, dx, dy)
    local inserter, chest = dropper(drop_piece, dx, dy)
    local list = join(selection, {inserter, chest})
    local result = extraction.extract_all_entities(list, game.forces.player)
    local tiles
    for _, data in ipairs(result.inserters) do
        if data.entity == inserter then tiles = data.sink.side_load_tiles end
    end
    assert(tiles == expected, name .. ": expected " .. tostring(expected) .. ", got " .. tostring(tiles))
    note(name, tiles and tostring(tiles) or "none")
    return result, inserter
end

-- 100,300 up: one case every 100 tiles in x, so none touches another
local X, Y = 100, 300
local function origin() X = X + 100; return X, Y end

do local x, y = origin()  -- a straight run to its end
    local pieces = line(x, y, E, 6)
    case("straight-run", nil, pieces, pieces[1], 0, 1)
end
do local x, y = origin()  -- a curve: the piece that turns has only the one input
    local a, b = line(x, y, E, 3), line(x + 3, y, S, 3)
    assert(b[1].belt_shape ~= "straight", "the piece that turns is a curve")
    case("curve", nil, join(a, b), a[1], 0, -1)
end
do local x, y = origin()  -- the drop is on the last piece
    local pieces = line(x, y, E, 3)
    case("belt-end", nil, pieces, pieces[3], 0, 1)
end
do local x, y = origin()  -- a loop of four curves
    local pieces = {belt("turbo-transport-belt", x, y, E), belt("turbo-transport-belt", x + 1, y, S),
        belt("turbo-transport-belt", x + 1, y + 1, W), belt("turbo-transport-belt", x, y + 1, N)}
    case("loop", nil, pieces, pieces[1], 0, -1)
end
do local x, y = origin()  -- a side belt one tile from the belt it joins, which is fed from behind
    local main, side = line(x, y, E, 6), line(x + 3, y + 1, N, 1)
    assert(main[4].belt_shape == "straight")
    case("side-load-1-tile", 1, join(main, side), side[1], 1, 0)
end
do local x, y = origin()  -- the side belt is 40 tiles long and the whole of it is selected
    local main = line(x + 40, y + 5, N, 11)
    local side = line(x, y, E, 40)
    case("side-load-far-down-a-long-selected-belt", 40, join(main, side), side[1], 0, 1)
end
do local x, y = origin()  -- the belt it joins is not selected: the walk leaves the selection
    local main = line(x + 4, y + 5, N, 11)
    local side = line(x, y, E, 4)
    assert(side[4].belt_neighbours.outputs[1] == main[6], "the side belt does join the main belt")
    case("side-load-past-the-selection", nil, side, side[1], 0, 1)
end
do local x, y = origin()  -- the same, with the belt it joins selected
    local main = line(x + 4, y + 5, N, 11)
    local side = line(x, y, E, 4)
    case("side-load-just-inside-the-selection", 4, join(main, side), side[1], 0, 1)
end
do local x, y = origin()  -- a drop on the belt that is side-loaded onto
    local main, side = line(x, y, E, 6), line(x + 3, y + 1, N, 1)
    case("drop-on-the-through-belt", nil, join(main, side), main[2], 0, -1)
end
do local x, y = origin()  -- a belt from each side and none behind: each has its own lane
    local target = line(x + 1, y, E, 4)
    local north, south = line(x + 1, y - 1, S, 1), line(x + 1, y + 1, N, 1)
    assert(target[1].belt_shape == "straight")
    case("two-side-loads-nothing-behind", nil, join(target, north, south), north[1], -1, 0)
end
do local x, y = origin()  -- an underground exit is fed from the tunnel
    local entrance = belt("turbo-underground-belt", x, y, E, "input")
    local exit = belt("turbo-underground-belt", x + 3, y, E, "output")
    local after = line(x + 4, y, E, 2)
    local side = line(x + 3, y + 1, N, 1)
    case("side-load-onto-an-exit", 1, join({entrance, exit}, after, side), side[1], 1, 0)
end
do local x, y = origin()  -- an underground entrance with a belt behind it
    local behind = line(x - 1, y, E, 1)
    local entrance = belt("turbo-underground-belt", x, y, E, "input")
    local exit = belt("turbo-underground-belt", x + 3, y, E, "output")
    local side = line(x, y + 1, N, 1)
    case("side-load-onto-an-entrance-with-a-belt-behind", 1, join(behind, {entrance, exit}, side), side[1], 1, 0)
end
do local x, y = origin()  -- an underground entrance with nothing behind it
    local entrance = belt("turbo-underground-belt", x, y, E, "input")
    local exit = belt("turbo-underground-belt", x + 3, y, E, "output")
    local side = line(x, y + 1, N, 1)
    case("side-load-onto-an-entrance-with-nothing-behind", nil, join({entrance, exit}, side), side[1], 1, 0)
end
local export_result, export_inserter
do local x, y = origin()  -- the lithium shape: the drop is on an entrance, the exit side-loads onto a belt fed from behind
    local main = line(x - 1, y - 3, E, 3)
    local entrance = belt("turbo-underground-belt", x, y, N, "input")
    local exit = belt("turbo-underground-belt", x, y - 2, N, "output")
    main[1].get_transport_line(1).insert_at_back({name = "iron-plate", count = 4}, 4)
    export_result, export_inserter = case("entrance-exit-then-side-load", 3, join(main, {entrance, exit}), entrance, 1, 0)
end
do local x, y = origin()  -- a splitter ends the walk; a merge beyond it is not found
    local first = line(x, y, E, 1)
    local splitter = belt("turbo-splitter", x + 1, y, E)
    local after = line(x + 2, y, E, 3)
    local side = line(x + 4, y + 1, N, 1)
    case("splitter-on-the-path", nil, join(first, {splitter}, after, side), first[1], 0, -1)
end

-- The export carries the mark on the sink of the marked drop, and on no other
local exported = export.to_table(export_result)
local marked_count = 0
for index, entry in ipairs(exported.inserters) do
    local capture = entry.sink.drop_capture
    if capture then
        marked_count = marked_count + 1
        assert(capture.status == "side-loaded" and capture.tiles == 3)
        assert(capture.sidecar_version == script.active_mods["clock-generator-sidecar"])
    end
end
assert(marked_count == 1, "one drop is marked in the export")
assert(#export.drop_marks(exported) == 1 and export.drop_marks(exported)[1].tiles == 3)
assert(exported.pickup_warnings == nil, "no top-level list for a drop")
note("export-field", "ok")

helpers.write_file("sideload-drop-cases.txt", table.concat(report, "\\n") .. "\\n", false)
`,
        });
        const report = fs.readFileSync(path.join(scratch, "script-output", "sideload-drop-cases.txt"), "utf8")
            .trim().split("\n").map(line => line.split(": "));
        const read = Object.fromEntries(report.map(([name, text]) => [name, text]));
        for (const [name, expected] of Object.entries(EXPECTED_CASES)) {
            expect(read[name], name).toBeDefined();
            expect(read[name]).toBe(expected);
        }
        expect(Object.keys(read).sort()).toEqual(Object.keys(EXPECTED_CASES).sort());
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
