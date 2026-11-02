// node scripts/export-clock.js <config json path or sample key> --out=<dir>
//          [--alternative=<id|selected|all>[,<id>...]] [--always-on] [--windows=<file>] [--tag=<word>]
//          [--scaffold=<blueprint file>] [--backed-up-belts] [--anchor=<x,y>] [--no-cells]
// Generates the clocks of a config and writes each ready to place, for the clock files tools/place-clocks.js reads (the
// benchmark tools' library, factorio-benchmark-tools): no game is started. The generator is the built one (`npx tsc`
// first), or the checkout CLOCK_GENERATOR_ROOT names.
//
//   <config>          a sample key of ConfigPaths (AUTOMATION_SCIENCE) or the path of a config JSON
//   --alternative     which of the generator's potential clocks: its id (as record-clock.js and the UI name it), `selected`
//                     (the default) or `all`; several ids may be given with commas. Unstable ones are written too, with their
//                     verdict, and place-clocks leaves a cell with one unclocked
//   --always-on       also writes the always-on arm: the same wire with a constant signal, so that every inserter the
//                     selected clock switches is wired and never disabled
//   --windows         hand-made windows, as record-clock.js reads them ({"period": 528, "output_swings": 2, "windows":
//                     {"inserter:1": [{"start": 1, "end": 6}, ...]}}), written as one arm named --tag (default given-windows)
//   --scaffold        the scaffold blueprint (default: <config name>-scaffold.txt beside the config); cells.json is made from it
//   --backed-up-belts generate for backed-up belts (overrides.backed_up_belts), which is what a scaffold has
//   --anchor          x,y of the copy's anchor in the scaffold's coordinates (default 0,0: the save has the scaffold where
//                     the blueprint says); the offsets of cells.json are from it
//   --no-cells        do not write cells.json
//
// Writes, in --out:
//   cells.json             {cells: [{name, config, problems, instances, inserters: {id: {name, offset, wired, has_wire}}}]},
//                          the scaffold's inserter behind each id of the config, found with the generator's matcher
//   <alternative id>/<config name>.json   the clock file: {selected, period_ticks, counted_ticks, schedule, blueprint,
//                          clock_windows, ...}; the blueprint's schedule combinators carry the tag clock_generator_inserters
//   <alternative id>/arm.json   what the arm is: verdict, holds, recovers, wake-ups a minute, period, inserters wired
//   always-on/...          the same, for --always-on
// <alternative id>/ is the folder to give place-clocks as --clocks. An error is written to <out>/error.json and exits 1.
const path = require("path"), fs = require("fs"), zlib = require("zlib");
const arg = name => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;
const flag = name => process.argv.includes(`--${name}`);
const positional = process.argv.slice(2).filter(a => !a.startsWith("--"));
const USAGE = "usage: export-clock.js <config json path or sample key> --out=<dir> [--alternative=<id|selected|all>] [--always-on] [--windows=<file>] [--tag=<word>] [--scaffold=<file>] [--backed-up-belts] [--anchor=<x,y>] [--no-cells]";
if (positional.length !== 1 || arg("out") === null) {
    console.error(USAGE);
    process.exit(2);
}
const out_dir = path.resolve(arg("out"));
const { dist, quiet, loadSample } = require("./lib");
const { ConfigPaths } = dist("config/config-paths.js");
const { generateClockAlternatives, clockFromWindows } = dist("crafting/generate-blueprint.js");
const { encodeBlueprintFile } = dist("blueprints/serde.js");

const INSERTERS_TAG = "clock_generator_inserters";
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1));

/** The clock file of an arm: the generator's clock (the subtick one where the period is fractional) with its schedule combinators tagged */
function clockFileOf(alternative, config_path) {
    const result = alternative.result;
    const exported = result.subtick ?? result;
    const file = JSON.parse(JSON.stringify({ blueprint: exported.blueprint }));
    const ids = new Map(exported.schedule.inserter_combinators.map(it => [it.entity_number, it.inserter_ids]));
    for (const entity of file.blueprint.entities ?? []) {
        if (ids.has(entity.entity_number)) {
            entity.tags = { ...entity.tags, [INSERTERS_TAG]: ids.get(entity.entity_number) };
        }
    }
    const assessment = alternative.assessment;
    return {
        selected: { id: alternative.id, label: alternative.label, verdict: alternative.verdict, items_per_second: assessment?.items_per_second ?? result.stability_check.expected_output_items },
        config: config_path,
        period_ticks: result.simulation_duration.ticks,
        subtick: result.subtick ? { period_ticks: result.subtick.clock.period_ticks, scale: result.subtick.clock.scale } : null,
        counted_ticks: exported.schedule.counted_ticks,
        schedule: exported.schedule,
        clock_windows: result.clock_windows,
        blueprint: encodeBlueprintFile(file),
    };
}

/** The always-on arm: one combinator that outputs a constant, wired to the inserters the clock switches */
function alwaysOnFileOf(clock, config_path, version) {
    const ids = [...new Set(clock.schedule.inserter_combinators.flatMap(it => it.inserter_ids))].sort((a, b) => a - b);
    const combinator = {
        entity_number: 1, name: "arithmetic-combinator", position: { x: 0.5, y: 0 }, direction: 8,
        player_description: "Always on: a constant signal for the inserters the clock would switch; no clock",
        control_behavior: { arithmetic_conditions: { first_constant: 1, second_constant: 0, operation: "+", output_signal: { type: "virtual", name: "signal-A" } } },
        tags: { [INSERTERS_TAG]: ids },
    };
    return {
        selected: { id: "always-on", label: "Always on: wired, never disabled", verdict: "stable", items_per_second: clock.selected.items_per_second },
        config: config_path, period_ticks: clock.period_ticks, subtick: null, counted_ticks: clock.counted_ticks,
        schedule: { counted_ticks: clock.counted_ticks, inserter_combinators: [{ entity_number: 1, inserter_ids: ids }] },
        clock_windows: {},
        blueprint: encodeBlueprintFile({ blueprint: { item: "blueprint", label: "Always on", entities: [combinator], icons: [], version }}),
    };
}
/** What an arm is, beside its clock file */
function armOf(alternative, clock, config_path, selected_id, always_on = false) {
    const assessment = alternative?.assessment;
    const as_built = alternative?.result.stability_check.as_built;
    const wired = new Set(clock.schedule.inserter_combinators.flatMap(it => it.inserter_ids));
    return {
        config: config_path,
        alternative: { id: clock.selected.id, label: clock.selected.label },
        selected: !always_on && clock.selected.id === selected_id,
        always_on,
        verdict: clock.selected.verdict,
        holds: always_on ? null : assessment?.holds ?? alternative?.result.stability_check.holds ?? null,
        recovers: always_on ? null : assessment?.backpressure_loss?.survives ?? null,
        wake_ups_per_minute: always_on ? null : assessment?.wake_ups_per_minute ?? as_built?.wake_ups?.wake_ups_per_minute ?? null,
        items_per_second: clock.selected.items_per_second,
        period_ticks: clock.period_ticks, counted_ticks: clock.counted_ticks,
        inserters_wired: wired.size, inserter_ids: [...wired].sort((a, b) => a - b),
        schedule_combinators: clock.schedule.inserter_combinators.length,
        clock_file: `${path.basename(config_path, ".json")}.json`,
    };
}

(async () => {
    const key = positional[0];
    const config_path = ConfigPaths[key] ?? path.resolve(key);
    const name = path.basename(config_path, ".json");
    const config_label = ConfigPaths[key] === undefined ? config_path : key;
    fs.mkdirSync(out_dir, { recursive: true });
    const config = await loadSample(key, flag("backed-up-belts"));

    let alternatives, selected_id;
    if (arg("windows") !== null) {
        const given = JSON.parse(fs.readFileSync(path.resolve(arg("windows")), "utf-8"));
        if (given.output_swings) {
            config.overrides = { ...config.overrides, terminal_swing_count: given.output_swings };
        }
        const made = clockFromWindows(config, given.windows, given.period, quiet);
        const tag = arg("tag") ?? "given-windows";
        alternatives = [{ id: tag, label: `the windows of ${path.basename(arg("windows"))}`, belt: made.belt, verdict: made.stability_check.holds ? "stable" : "unstable", result: made }];
        selected_id = tag;
    } else {
        const generated = generateClockAlternatives(config, { logger: quiet });
        selected_id = generated.alternatives[generated.selected_index].id;
        const wanted = (arg("alternative") ?? "selected").split(",");
        const missing = wanted.filter(id => id !== "all" && id !== "selected" && !generated.alternatives.some(a => a.id === id));
        if (missing.length > 0) {
            throw new Error(`No potential clock ${missing.join(", ")}. There are: ${generated.alternatives.map(a => a.id).join(", ")}`);
        }
        alternatives = wanted.includes("all") ? generated.alternatives
            : generated.alternatives.filter(a => wanted.includes(a.id) || (wanted.includes("selected") && a.id === selected_id));
    }

    const written = [];
    let selected_clock;
    for (const alternative of alternatives) {
        const clock = clockFileOf(alternative, config_label);
        const folder = path.join(out_dir, alternative.id);
        fs.mkdirSync(folder, { recursive: true });
        write(path.join(folder, `${name}.json`), clock);
        write(path.join(folder, "arm.json"), armOf(alternative, clock, config_label, selected_id));
        written.push(path.join(alternative.id, `${name}.json`), path.join(alternative.id, "arm.json"));
        if (alternative.id === selected_id || selected_clock === undefined) selected_clock = clock;
        console.log(`${name}: ${alternative.id} "${alternative.label}" ${alternative.verdict}, period ${clock.period_ticks}, ${clock.schedule.inserter_combinators.length} schedule combinators`);
    }
    if (flag("always-on")) {
        const version = (alternatives.find(a => a.id === selected_id) ?? alternatives[0]).result.blueprint.version;
        const clock = alwaysOnFileOf(selected_clock, config_label, version);
        const folder = path.join(out_dir, "always-on");
        fs.mkdirSync(folder, { recursive: true });
        write(path.join(folder, `${name}.json`), clock);
        write(path.join(folder, "arm.json"), armOf(undefined, clock, config_label, selected_id, true));
        written.push(path.join("always-on", `${name}.json`), path.join("always-on", "arm.json"));
        console.log(`${name}: always-on, ${clock.schedule.inserter_combinators[0].inserter_ids.length} inserters wired`);
    }

    if (!flag("no-cells")) {
        const scaffold = arg("scaffold") !== null ? path.resolve(arg("scaffold")) : config_path.replace(/\.json$/, "-scaffold.txt");
        if (!fs.existsSync(scaffold)) {
            throw new Error(`No scaffold at ${scaffold}: give --scaffold=<blueprint file> or --no-cells`);
        }
        const text = fs.readFileSync(scaffold, "utf-8").trim();
        const blueprint = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString("utf-8"));
        const anchor = (arg("anchor") ?? "0,0").split(",").map(Number);
        const { cellOf } = require("./scaffold-cells");
        const { cell, matched } = cellOf({ blueprint, config, name, clock_file: `${name}.json`, anchor });
        write(path.join(out_dir, "cells.json"), { cells: [cell] });
        written.push("cells.json");
        console.log(`${name}: cells.json, ${matched} of ${config.inserters.length} inserters found in ${path.basename(scaffold)}${cell.problems.length > 0 ? `; problems: ${cell.problems.join("; ")}` : ""}`);
    }
    write(path.join(out_dir, "written.json"), { config: config_path, files: written });
})().catch(error => {
    fs.mkdirSync(out_dir, { recursive: true });
    write(path.join(out_dir, "error.json"), { config: positional[0], error: (error.stack ?? String(error)).split("\n").slice(0, 8).join("\n") });
    console.error(`${positional[0]}: FAILED: ${error.message}`);
    process.exit(1);
});
