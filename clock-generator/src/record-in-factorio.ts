import fs from "fs/promises";
import path from "path";
import { loadConfigFromFile } from "./config/loader";
import { recordInFactorio, Seed } from "./harness/factorio-harness";
import { summarizeRecording } from "./harness/recording-summary";

function argValue(name: string): string | undefined {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

function argFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

/** The text of a file when the value names one (or starts with @), else the value itself */
async function fileOrText(value: string): Promise<string> {
    const file = value.startsWith("@") ? value.slice(1) : value;
    const text = await fs.readFile(file, "utf-8").catch(() => null);
    if (text === null && value.startsWith("@")) {
        throw new Error(`Cannot read ${file}`);
    }
    return (text ?? value).trim();
}

function usage(): never {
    console.error([
        "Usage: npm run record -- --blueprint=<file or string> --save=<save.zip> --out=<recording.json> [options]",
        "  --factorio=<path>     Factorio executable or install folder (default: $FACTORIO_PATH)",
        "  --save=<save.zip>     save to build in, with the recorder mod's dependencies (default: $FACTORIO_HARNESS_SAVE); it is copied, never changed",
        "  --ticks=<n>           ticks to record (default 600); with a clock, whole clock periods until at least this many",
        "  --warmup=<n>          ticks the build runs before it is seeded and recorded, so belts fill (default 0; it always runs one)",
        "  --seed=<json or file> items to add right before recording, e.g.",
        "                        '[{\"target\":{\"recipe\":\"pentapod-egg\"},\"item\":\"pentapod-egg\",\"count\":10}]'",
        "                        target: name, type, recipe, unit_number; inventory: input, output, fuel, modules, chest",
        "  --clock=<file or string> --config=<config.json>",
        "                        replace the build's clock with this generated clock blueprint, wired to the inserters of the config it was made from",
        "  --unclocked           remove the build's clock and let its inserters run freely",
        "  --surface=<name>      default nauvis",
        "  --position=<x,y>      middle of the build (default: right of everything already built)",
        "  --lua=<file or code>  Lua chunk run right before recording, called with (entities, surface, area)",
        "  --work-dir=<folder>   keep Factorio's write data (log, script-output) here instead of a temporary folder",
        "  --speed=<n>           game speed (default 1000, as fast as the machine allows; 1 with --watch)",
        "  --watch               also open the game with graphics, looking at the build, to watch the run",
        "  --timeout=<seconds>   default 900",
    ].join("\n"));
    process.exit(2);
}

async function main() {
    const blueprint = argValue("blueprint");
    const factorio = argValue("factorio") ?? process.env.FACTORIO_PATH;
    const save = argValue("save") ?? process.env.FACTORIO_HARNESS_SAVE;
    const out = argValue("out");
    if (!blueprint || !out) {
        usage();
    }
    if (!factorio || !save) {
        console.error(!factorio
            ? "Where is Factorio? Pass --factorio=<executable or install folder> or set FACTORIO_PATH."
            : "Which save? Pass --save=<save.zip> or set FACTORIO_HARNESS_SAVE.");
        process.exit(2);
    }

    const clock = argValue("clock");
    const config_path = argValue("config");
    const seed = argValue("seed");
    const lua = argValue("lua");
    const position = argValue("position")?.split(",").map(Number);
    const work_dir = argValue("work-dir");

    const result = await recordInFactorio({
        factorio,
        save: path.resolve(save),
        blueprint: await fileOrText(blueprint),
        out,
        ticks: Number(argValue("ticks") ?? 600),
        warmup_ticks: Number(argValue("warmup") ?? 0),
        seed: seed ? JSON.parse(await fileOrText(seed)) as Seed[] : [],
        clock: clock ? await fileOrText(clock) : undefined,
        config: config_path ? await loadConfigFromFile(config_path) : undefined,
        unclocked: argFlag("unclocked"),
        surface: argValue("surface"),
        position: position ? { x: position[0], y: position[1] } : undefined,
        lua: lua ? await fileOrText(lua) : undefined,
        work_dir: work_dir ? path.resolve(work_dir) : undefined,
        game_speed: Number(argValue("speed") ?? (argFlag("watch") ? 1 : 1000)),
        watch: argFlag("watch"),
        timeout_seconds: Number(argValue("timeout") ?? 900),
        log: message => console.error(message),
    });

    // progress goes to stderr; stdout is the result
    console.log(`Recording: ${result.recording_path}`);
    summarizeRecording(result.recording).forEach(line => console.log(line));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
