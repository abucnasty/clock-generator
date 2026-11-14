import fs from "fs";
import path from "path";
import zlib from "zlib";
import { JoinModel, PutOn, TickInput } from "../../../../src/entities/belt/join/join-model";
import { endLinesOf, JoinCopy, layoutOf, Stream } from "./cases";

/** What probe.lua writes of the copies besides their rows (info.json) */
export interface JoinInfo {
    factorio: string;
    ticks: number;
    belt_stack_size_bonus: number;
    research_unchanged: boolean;
    research_unchanged_at_end: boolean;
    problems: unknown[];
    copies: {
        name: string;
        /** Each belt piece: its top-left tile in the copy and its lines' lengths in 1/256 tile */
        pieces: { key: string; name: string; lines: number[] }[];
        splitter?: [string, string];
        hand?: number;
        streams: { line: string; done: number[]; failed: number[] }[];
        actions: { t: number; action: "block" | "release" | "hand"; chest?: [number, number] }[];
    }[];
}

/** A copy's rows: for each tick, every stack as [line, unique id in order of first sight, position] */
export type CopyRows = [string, number, number][][];

/**
 * What recordings/ keeps of a copy: the game's facts the replay needs and every stack's line and position in every tick.
 * `put_ons`: [tick, line, position, 0 for a script insert (before the movement) or 1 for an inserter's drop (after it)].
 * `ends`: [tick, line, "shut" | "loader"], the tick the script changed the end chest. `rows`: for each tick, the stacks
 * as [line index into `lines`, position], by line and position.
 */
export interface KeptCopy {
    name: string;
    factorio: string;
    belt_stack_size: number;
    /** Every line of the copy's pieces and its length */
    lines: [string, number][];
    put_ons: [number, string, number, 0 | 1][];
    ends: [number, string, "shut" | "loader"][];
    rows: [number, number][][];
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

/** The game writes an empty list as `{}` */
const list = <T>(value: T[] | Record<string, never>): T[] => (Array.isArray(value) ? value : []);

export function parseInfo(text: string): JoinInfo {
    const info = JSON.parse(text) as JoinInfo;
    for (const copy of info.copies) {
        copy.actions = list(copy.actions ?? []);
        for (const s of copy.streams = list(copy.streams ?? [])) { s.done = list(s.done); s.failed = list(s.failed); }
    }
    info.problems = list(info.problems as never);
    return info;
}

/** The rows of every copy from the log, by copy name */
export function parseLog(text: string, info: JoinInfo): Map<string, CopyRows> {
    const rows = new Map<string, CopyRows>(info.copies.map(copy => [copy.name, []]));
    for (const line of text.split("\n")) {
        if (!line) continue;
        const [head, body] = line.split("|");
        const [t, index] = head.split(",").map(Number);
        const copy = info.copies[index - 1];
        const stacks: [string, number, number][] = [];
        if (body) for (const part of body.split(";")) {
            const [piece, n, id, position] = part.split(",").map(Number);
            stacks.push([`${copy.pieces[piece - 1].key}/${n}`, id, position]);
        }
        rows.get(copy.name)![t] = stacks;
    }
    return rows;
}

const byLineAndPosition = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);

/** The put-on events of a copy: its script inserts that were done, and on the turned shape the inserter's drops (the first row of each stack on the drop belt) */
export function putOnsOf(copy: JoinCopy, info: JoinInfo["copies"][number], rows: CopyRows): KeptCopy["put_ons"] {
    const spots = new Map<string, Stream>(copy.streams.map(s => [s.line, s]));
    const lengths = new Map(info.pieces.flatMap(p => p.lines.map((length, i): [string, number] => [`${p.key}/${i + 1}`, length])));
    const put_ons: KeptCopy["put_ons"] = [];
    for (const s of info.streams) for (const t of s.done) put_ons.push([t, s.line, spots.get(s.line)!.spot ?? lengths.get(s.line)! - 1, 0]);
    if (copy.hands) {
        const seen = new Set<number>();
        rows.forEach((stacks, t) => {
            for (const [line, id, position] of stacks) {
                if (seen.has(id)) continue;
                seen.add(id);
                if (line.startsWith("8,2/") && !put_ons.some(p => p[0] === t && p[1] === line && p[3] === 0)) put_ons.push([t, line, position, 1]);
            }
        });
    }
    return put_ons.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
}

/** What recordings/ keeps of one copy of a run */
export function keptCopy(copy: JoinCopy, info: JoinInfo, rows: CopyRows): KeptCopy {
    const own = info.copies.find(c => c.name === copy.name)!;
    const lines = own.pieces.flatMap(p => p.lines.map((length, i): [string, number] => [`${p.key}/${i + 1}`, length]));
    const index = new Map(lines.map(([line], i) => [line, i]));
    return {
        name: copy.name, factorio: info.factorio, belt_stack_size: info.belt_stack_size_bonus + 1, lines,
        put_ons: putOnsOf(copy, own, rows),
        ends: own.actions.filter(a => a.action !== "hand").flatMap(a => endLinesOf(a.chest!).map((line): [number, string, "shut" | "loader"] =>
            [a.t, line, a.action === "block" ? "shut" : "loader"])),
        rows: rows.map(stacks => stacks.map(([line, , position]): [string, number] => [line, position]).sort(byLineAndPosition)
            .map(([line, position]): [number, number] => [index.get(line)!, position])),
    };
}

export const writeKept = (dir: string, kept: KeptCopy) =>
    fs.writeFileSync(path.join(dir, `${kept.name}.json.zst`), zlib.zstdCompressSync(Buffer.from(JSON.stringify(kept)),
        { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } }));

export const loadKept = (name: string, dir = RECORDINGS_DIR): KeptCopy =>
    JSON.parse(zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, `${name}.json.zst`))).toString("utf8")) as KeptCopy;

/** The model's inputs of a copy, tick by tick, from its put-ons and end changes */
export function inputsOf(put_ons: KeptCopy["put_ons"], ends: KeptCopy["ends"]): Map<number, TickInput> {
    const inputs = new Map<number, TickInput>();
    const at = (t: number) => { if (!inputs.has(t)) inputs.set(t, { put_ons: [], end_changes: [] }); return inputs.get(t)!; };
    for (const [t, line, position, drop] of put_ons) at(t).put_ons!.push({ line, position, time: drop ? "after-movement" : "before-movement" } satisfies PutOn);
    for (const [t, line, end] of ends) at(t).end_changes!.push({ line, end });
    return inputs;
}

/**
 * The model fed with a copy's put-ons and end changes, tick by tick, set against its rows: the first tick where a
 * stack's line or position differs, with the stacks only the game has and only the model has; null when every tick agrees.
 */
export function replay(copy: JoinCopy, kept: KeptCopy): { t: number; game: string[]; model: string[] } | null {
    const model = new JoinModel(layoutOf(copy));
    const inputs = inputsOf(kept.put_ons, kept.ends);
    for (let t = 0; t < kept.rows.length; t++) {
        model.tick(inputs.get(t) ?? {});
        const mine = model.stacks().map((s): [string, number] => [s.line, s.position]).sort(byLineAndPosition).map(([l, p]) => `${l}@${p}`);
        const game = kept.rows[t].map(([line, position]) => `${kept.lines[line][0]}@${position}`);
        if (mine.join() !== game.join()) {
            const m = new Set(mine), g = new Set(game);
            return { t, game: game.filter(s => !m.has(s)), model: mine.filter(s => !g.has(s)) };
        }
    }
    return null;
}
