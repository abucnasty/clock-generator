import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { FactorioBlueprintFile } from "../../../../src/blueprints/blueprint";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { composeProbeSource } from "../../helpers/probe-source";
import { COPIES, SHAPES, streamTicks, TICKS } from "./cases";
import { keptCopy, parseInfo, parseLog, replay, writeKept } from "./recording";

/**
 * The belt join family in the game: every copy of cases.ts built by probe.lua and logged every tick, then every kept copy
 * set against the join model fed with its put-on events. Run again when the Factorio version changes (README.md).
 * JOIN_CAPTURE_DIR (an empty directory) keeps the full log and writes every copy's kept form there; JOIN_COPIES names
 * the copies to build (comma separated; default all).
 */
const wanted = process.env.JOIN_COPIES?.split(",");
const copies = COPIES.filter(copy => !wanted || wanted.includes(copy.name));

test("belt join: the game gives the join model's rows on every kept copy", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.JOIN_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), "belt-join-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty JOIN_CAPTURE_DIR");
    fs.mkdirSync(scratch, { recursive: true });
    try {
        // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the copies
        const blueprint = encodeBlueprintFile({ blueprint: { item: "blueprint", label: "Belt join", version: 562949955649536,
            entities: [{ entity_number: 1, name: "assembling-machine-1", position: { x: 0.5, y: 0.5 }, recipe: "rail" }] } } as unknown as FactorioBlueprintFile);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"), { ticks: TICKS, copies: copies.map(copy => ({
            name: copy.name, entities: SHAPES[copy.shape], priority: copy.priority, hands: copy.hands, ends: copy.ends,
            streams: copy.streams.map(s => ({ line: s.line, spot: s.spot, ticks: streamTicks(s) })),
        })) });
        await recordInFactorio({ factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: TICKS + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {} });
        const output = path.join(scratch, "game/script-output/belt-join");
        expect(fs.existsSync(path.join(output, "info.json")), "the probe wrote its log").toBe(true);
        const info = parseInfo(fs.readFileSync(path.join(output, "info.json"), "utf8"));
        expect(info.problems).toEqual([]);
        expect(info.research_unchanged && info.research_unchanged_at_end).toBe(true);
        expect(info.belt_stack_size_bonus, "stacks of 4").toBe(3);
        const rows = parseLog(fs.readFileSync(path.join(output, "log.txt"), "utf8"), info);
        const differ: string[] = [];
        for (const copy of copies) {
            expect(rows.get(copy.name)!.length, copy.name).toBe(TICKS + 1);
            const kept = keptCopy(copy, info, rows.get(copy.name)!);
            if (retained) writeKept(scratch, kept);
            const first = copy.kept ? replay(copy, kept) : null;
            if (first) differ.push(`${copy.name} t${first.t}: game ${first.game.join(" ")}; model ${first.model.join(" ")}`);
        }
        expect(differ, "kept copies where the game and the join model differ").toEqual([]);
    } finally { if (!retained) fs.rmSync(scratch, { recursive: true, force: true }); }
}, 1_000_000);
