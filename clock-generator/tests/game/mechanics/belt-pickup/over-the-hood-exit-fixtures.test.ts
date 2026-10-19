import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {BELT_SPEEDS} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {overTheHoodExitAtSpeed, overTheHoodReplayRoot} from "./over-the-hood-exit-fixtures";

test("the documented compact over-the-hood scaffold matches the captured normal control", () => {
    const fixture = GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT;
    const source = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
    const documented = fs.readFileSync(path.join(fixture, "compact-normal-scaffold.txt"), "utf8");
    const normal = BELT_SPEEDS.find(speed => speed.name === "normal")!;
    const decode = (text: string) => JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    expect(decode(documented)).toEqual(decode(overTheHoodExitAtSpeed(source, normal, {compactDestination: true})));
});

interface NativePhase {first_grab_phases: [number, number]; preferred: 1 | 2}
const evidence = GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT;
const base = JSON.parse(fs.readFileSync(path.join(evidence, "expectations.json"), "utf8")) as Record<string, NativePhase>;
const shifted = JSON.parse(fs.readFileSync(path.join(evidence, "phase-expectations.json"), "utf8")) as Record<string, NativePhase>;

for (const compact of [false, true]) for (const speed of BELT_SPEEDS) for (const mirrored of [false, true])
    for (const content of ["original", "swapped", "same-item"] as const) {
        if (!compact && speed.name === "normal") continue;
        const name = `${speed.name}-${compact ? "compact" : "plant"}-${mirrored ? "mirrored" : "unmirrored"}-moving-${content}`;
        test(`native first-grab phases cover both aligned lanes: ${name}`, () => {
            const period = speed.name === "turbo" ? 2 : speed.name === "fast" ? 4 : 8;
            const rows = Array.from({length: period}, (_, delay) => delay ? shifted[`${name}-release-${delay}`] : base[name]);
            expect(rows.every(Boolean)).toBe(true);
            expect(rows.every(row => row.preferred === (mirrored ? 2 : 1))).toBe(true);
            expect(rows.every(row => row.first_grab_phases[0] === row.first_grab_phases[1])).toBe(true);
            for (const lane of [0, 1]) {
                const observed = [...new Set(rows.map(row => row.first_grab_phases[lane]))].sort((a, b) => a - b);
                const cycle = Array.from({length: period}, (_, delay) =>
                    (base[name].first_grab_phases[lane] - delay * speed.units * 8 + 512) % 64).sort((a, b) => a - b);
                expect(observed).toHaveLength(period);
                expect(observed).toEqual(cycle);
            }
        });
    }

test("the aligned phase matrix retains 216 moving controls and 42 backed-up controls", () => {
    expect(Object.keys(base)).toHaveLength(84);
    expect(Object.keys(shifted)).toHaveLength(174);
    expect(Object.keys(shifted).every(name => /-moving-.*-release-[1-7]$/.test(name))).toBe(true);
    expect(Object.keys(base).filter(name => name.includes("-moving-"))).toHaveLength(42);
    expect(new Set([...Object.keys(base), ...Object.keys(shifted)]).size).toBe(258);
});

test("partial replay configuration never falls back to a native game run", () => {
    expect(overTheHoodReplayRoot(0)).toBeUndefined();
    expect(overTheHoodReplayRoot(0, "base", "phases")).toBe("base");
    expect(overTheHoodReplayRoot(1, "base", "phases")).toBe("phases");
    expect(() => overTheHoodReplayRoot(1, "base")).toThrow("OVER_HOOD_PHASE_REPLAY_DIR is missing");
    expect(() => overTheHoodReplayRoot(0, undefined, "phases")).toThrow("OVER_HOOD_REPLAY_DIR is missing");
    expect(() => overTheHoodReplayRoot(0, "")).toThrow("OVER_HOOD_REPLAY_DIR is missing");
});
