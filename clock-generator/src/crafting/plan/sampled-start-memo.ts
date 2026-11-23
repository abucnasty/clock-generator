import { OpenRange } from "../../data-types";
import { isPlainData, isProxy } from "../../common/plain-data";
import type { Config } from "../../config";
import type { EnableControlOverrideConfig } from "../../config/schema";
import type { RunOptions, SimulationStabilityCheck } from "./unclocked-run";

export const MAX_SAMPLED_START_KEY_CHARACTERS = 16_384;
const MAX_KEPT_KEY_CHARACTERS = 262_144;
const MAX_KEPT_STARTS = 64;

/** The quick check that owns the answer, and the main counter position this ask measures. */
export interface SampledStart {
    owner: object;
    save: boolean;
    enable_windows: ReadonlyMap<string, readonly OpenRange[]>;
    offset: number;
}

/** The current ordered enable windows, resolved configuration and run options. */
export function sampledStartInputs(start: SampledStart, configuration: Config, options: Omit<RunOptions, "logger">): unknown[] | null {
    const enable_windows = start.enable_windows;
    if (isProxy === undefined || isProxy(enable_windows) || Object.getPrototypeOf(enable_windows) !== Map.prototype || Reflect.ownKeys(enable_windows).length > 0
        || !isPlainData(configuration, MAX_SAMPLED_START_KEY_CHARACTERS) || !isPlainData(options, MAX_SAMPLED_START_KEY_CHARACTERS)) return null;
    const setpoint = Object.getOwnPropertyDescriptor(configuration, "setpoint")?.value;
    if (setpoint === null || typeof setpoint !== "object" || Object.getOwnPropertyDescriptor(setpoint, "counts")?.value === "destroyed") return null;
    // An enable window past its window cycle can warn directly to the console on every run.
    const exceeds_window_cycle = ({ overrides }: { overrides?: { enable_control?: EnableControlOverrideConfig } }) => {
        const control = overrides?.enable_control;
        return control?.mode === "CLOCKED" && (control.window_cycle_ticks === undefined || control.ranges.some(range => range.end > control.window_cycle_ticks!));
    };
    if (configuration.inserters.some(exceeds_window_cycle) || configuration.drills?.configs.some(exceeds_window_cycle)) return null;
    const ordered: [string, [number, number][]][] = [];
    let remaining = MAX_SAMPLED_START_KEY_CHARACTERS;
    for (const [entity, ranges] of enable_windows) {
        if (typeof entity !== "string" || isProxy(ranges) || !Array.isArray(ranges) || Object.getPrototypeOf(ranges) !== Array.prototype) return null;
        remaining -= 1 + entity.length + 2 * ranges.length;
        if (remaining < 0 || Reflect.ownKeys(ranges).length !== ranges.length + 1) return null;
        const bounds: [number, number][] = [];
        for (let index = 0; index < ranges.length; index++) {
            const field = Object.getOwnPropertyDescriptor(ranges, String(index));
            if (field === undefined || !field.enumerable || !("value" in field)) return null;
            const range: unknown = field.value;
            if (typeof range !== "object" || range === null || isProxy(range) || Object.getPrototypeOf(range) !== OpenRange.prototype
                || Reflect.ownKeys(range).length !== 2) return null;
            const from = Object.getOwnPropertyDescriptor(range, "start_inclusive");
            const to = Object.getOwnPropertyDescriptor(range, "end_inclusive");
            if (from === undefined || to === undefined || !("value" in from) || !("value" in to)
                || typeof from.value !== "number" || typeof to.value !== "number") return null;
            bounds.push([from.value, to.value]);
        }
        ordered.push([entity, bounds]);
    }
    return [start.offset, ordered, configuration, options];
}

/** Compact measurements carried by a quick check, for its own strict confirmation. */
export class SampledStartMemo {
    private readonly owners = new WeakMap<object, number>();
    private readonly kept = new Map<string, SimulationStabilityCheck>();
    private next_owner = 0;
    private characters = 0;
    private peak_entries = 0;
    private peak_characters = 0;
    private hits = 0;

    statistics() {
        return { hits: this.hits, entries: this.kept.size, key_characters: this.characters,
            peak_entries: this.peak_entries, peak_key_characters: this.peak_characters };
    }

    get(owner: object, key: string): SimulationStabilityCheck | undefined {
        const id = this.owners.get(owner);
        const answer = id === undefined ? undefined : this.kept.get(`${id}:${key}`);
        if (answer === undefined) return undefined;
        this.hits++;
        return { ...answer };
    }

    save(owner: object, key: string, answer: SimulationStabilityCheck): void {
        // Results with labels or other compound diagnostics retain their original reads and ownership.
        if (answer.full_output_chests !== undefined || answer.export_shortfalls !== undefined
            || answer.observation_span !== undefined || answer.as_built !== undefined) return;
        let id = this.owners.get(owner);
        if (id === undefined) {
            id = this.next_owner++;
            this.owners.set(owner, id);
        }
        const qualified = `${id}:${key}`;
        if (this.kept.has(qualified)) return;
        const { holds, actual_output_items, expected_output_items, used_lcm, repeat_window_cycles, repeat_output_items } = answer;
        this.kept.set(qualified, { holds, actual_output_items, expected_output_items, used_lcm, repeat_window_cycles, repeat_output_items });
        this.characters += qualified.length;
        for (const oldest of this.kept.keys()) {
            if (this.kept.size <= MAX_KEPT_STARTS && this.characters <= MAX_KEPT_KEY_CHARACTERS) break;
            this.kept.delete(oldest);
            this.characters -= oldest.length;
        }
        this.peak_entries = Math.max(this.peak_entries, this.kept.size);
        this.peak_characters = Math.max(this.peak_characters, this.characters);
    }
}
