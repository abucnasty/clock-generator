import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
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

/**
 * A machine making iron gear wheels with three output inserters, each held by a circuit condition that never holds, so
 * every output belt is empty: one drops onto the head of a straight line, one onto an underground exit from its side,
 * one onto a side belt that side-loads onto a line fed from behind (fixtures/empty-output-belt/README.md).
 */
const SCAFFOLD = path.join(__dirname, "fixtures/empty-output-belt/scaffold.scaffold");

/** Ticks the inserters are held before the empty export, and then run before the filled one */
const HELD_TICKS = 600;
const RUN_TICKS = 1800;

type Export = { inserters: { sink: { type: string; id: number } }[]; belts: { lanes: { ingredient: string }[] }[] };
type Report = {
    build_tick: { drop_target_set: boolean; pickup_target_set: boolean; inserters: { source: { type: string }; sink: { type: string } }[];
        belts: { lanes: { ingredient: string }[] }[] };
    empty: Export; filled: Export; empty_belt_items: number; filled_belt_items: number; held_inserters: number;
    landings: { predicted: number | false; lines: number[] }[];
};

test("Sidecar exports an empty output belt as the same build exports it once items have run onto it", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-empty-output-belt-"));
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: HELD_TICKS + RUN_TICKS, warmup_ticks: 600, settle_ticks: 0,
            seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + `
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local BELTS = { ["transport-belt"] = true, ["underground-belt"] = true, ["splitter"] = true }
local report = { landings = {} }
local held, landed = {}, {}
for _, entity in pairs(entities) do
    local wire = entity.type == "inserter" and entity.get_wire_connector(defines.wire_connector_id.circuit_red, false)
    if wire and wire.connection_count > 0 then table.insert(held, entity) end
end
local function belt_items()
    local count = 0
    for _, entity in pairs(entities) do
        if BELTS[entity.type] then
            for line = 1, entity.get_max_transport_line_index() do count = count + entity.get_transport_line(line).get_item_count() end
        end
    end
    return count
end
local function exported()
    return export.to_table(extraction.extract_all_entities(entities, game.forces.player))
end
-- On the tick an inserter is built the game has not yet set its drop and pickup targets: the export takes the entities
-- on its drop and pickup tiles instead. A machine, an inserter under it and a belt running east, built here.
do
    local machine = surface.create_entity({ name = "assembling-machine-3", position = { 100.5, 900.5 }, force = "player" })
    machine.set_recipe("iron-gear-wheel")
    local inserter = surface.create_entity({ name = "fast-inserter", position = { 100.5, 902.5 }, direction = defines.direction.north, force = "player" })
    local built = { machine, inserter }
    for x = 100, 102 do
        table.insert(built, surface.create_entity({ name = "turbo-transport-belt", position = { x + 0.5, 903.5 }, direction = defines.direction.east, force = "player" }))
    end
    local result = export.to_table(extraction.extract_all_entities(built, game.forces.player))
    report.build_tick = { drop_target_set = inserter.drop_target ~= nil, pickup_target_set = inserter.pickup_target ~= nil,
        inserters = result.inserters, belts = result.belts }
end
local start = game.tick
script.on_nth_tick(1, function()
    local since = game.tick - start
    if since == ${HELD_TICKS} then
        report.empty, report.empty_belt_items, report.held_inserters = exported(), belt_items(), #held
        for _, inserter in ipairs(held) do inserter.get_wire_connector(defines.wire_connector_id.circuit_red, false).disconnect_all() end
    elseif since > ${HELD_TICKS} and since < ${HELD_TICKS + RUN_TICKS} then
        -- the line of its drop piece that each held inserter's first item lands on, against the export's reading of it
        for index, inserter in ipairs(held) do
            local piece = extraction.inserter_end(inserter, "drop")
            if not landed[index] and piece and BELTS[piece.type] then
                local lines = {}
                for line = 1, piece.get_max_transport_line_index() do
                    if piece.get_transport_line(line).get_item_count() > 0 then table.insert(lines, line) end
                end
                if #lines > 0 then
                    landed[index] = true
                    table.insert(report.landings, { predicted = extraction.drop_line(inserter, piece) or false, lines = lines })
                end
            end
        end
    elseif since == ${HELD_TICKS + RUN_TICKS} then
        report.filled, report.filled_belt_items = exported(), belt_items()
        helpers.write_file("sidecar-empty-output-belt.json", helpers.table_to_json(report), false)
        script.on_nth_tick(1, nil)
    end
end)
`,
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "script-output", "sidecar-empty-output-belt.json"), "utf8")) as Report;
        // the empty reading is of empty belts, and the filled one of belts that items have run onto
        expect(report.held_inserters).toBe(3);
        expect(report.empty_belt_items).toBe(0);
        expect(report.filled_belt_items).toBeGreaterThan(0);
        // each drop lands on the line the export reads for it
        expect(report.landings).toHaveLength(3);
        for (const landing of report.landings) expect(landing.lines).toEqual([landing.predicted]);
        // the three output inserters and their belts are in the empty export, as in the filled one, field for field
        expect(report.empty.inserters.filter(inserter => inserter.sink.type === "belt")).toHaveLength(3);
        expect(report.empty.belts).toHaveLength(3);
        expect(report.empty).toEqual(report.filled);
        // on the tick it is built, the inserter has no targets from the game, and the export finds them on its tiles
        expect(report.build_tick).toMatchObject({ drop_target_set: false, pickup_target_set: false,
            inserters: [{ source: { type: "machine" }, sink: { type: "belt" } }],
            belts: [{ lanes: [{ ingredient: "iron-gear-wheel" }] }] });
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
