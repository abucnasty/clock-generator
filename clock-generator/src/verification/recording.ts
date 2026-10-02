import { z } from "zod";

// Lua's table_to_json writes empty tables as {} even when they are arrays.
const luaArray = <T extends z.ZodTypeAny>(item: T) => z.preprocess(
    value => (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) ? [] : value,
    z.array(item)
);

/** [sample_index, value] entries, written only when the value changes */
const changeList = <T extends z.ZodTypeAny>(value: T) => luaArray(z.tuple([z.number().int(), value]));

const luaRecord = <T extends z.ZodTypeAny>(value: T) => z.preprocess(
    v => (Array.isArray(v) && v.length === 0) ? {} : v,
    z.record(z.string(), value)
);

const TargetRefSchema = z.object({
    type: z.enum(["machine", "belt", "chest"]),
    id: z.number().int(),
});

const RecordedInserterSchema = z.object({
    id: z.number().int(),
    unit_number: z.number().optional(),
    name: z.string(),
    source: TargetRefSchema,
    sink: TargetRefSchema,
    stack_size: z.number(),
    samples: z.object({
        held_count: luaArray(z.number()),
        held_item: changeList(z.string()),
        status: changeList(z.string()),
    }),
});

const RecordedMachineSchema = z.object({
    id: z.number().int(),
    unit_number: z.number().optional(),
    name: z.string(),
    recipe: z.string(),
    samples: z.object({
        status: changeList(z.string()),
        crafting_progress: luaArray(z.number()),
        bonus_progress: luaArray(z.number()),
        products_finished: luaArray(z.number()),
        inputs: luaRecord(luaArray(z.number())),
        outputs: luaRecord(luaArray(z.number())),
    }),
});

const RecordedConfigSchema = z.object({
    inserters: luaArray(z.object({
        source: TargetRefSchema,
        sink: TargetRefSchema,
        filters: luaArray(z.string()).optional(),
    }).passthrough()),
    belts: luaArray(z.object({
        id: z.number().int(),
        lanes: luaArray(z.object({ ingredient: z.string() }).passthrough()),
    }).passthrough()),
}).passthrough();

export const RecordingSchema = z.object({
    format: z.literal("clock-generator-recording"),
    version: z.literal(1),
    factorio_version: z.string().optional(),
    start_game_tick: z.number(),
    sample_count: z.number().int(),
    stop_reason: z.string().optional(),
    clock: z.object({ values: luaArray(z.number()) }).optional(),
    config: RecordedConfigSchema,
    inserters: luaArray(RecordedInserterSchema),
    machines: luaArray(RecordedMachineSchema),
});

export type Recording = z.infer<typeof RecordingSchema>;
export type RecordedInserter = z.infer<typeof RecordedInserterSchema>;
export type RecordedMachine = z.infer<typeof RecordedMachineSchema>;

export function parseRecording(json: unknown): Recording {
    return RecordingSchema.parse(json);
}

/** Expands a change-list into one value per sample */
export function expandChangeList<T>(changes: [number, T][], sample_count: number, fallback: T): T[] {
    const values: T[] = new Array(sample_count);
    let current = fallback;
    let next = 0;
    for (let i = 0; i < sample_count; i++) {
        while (next < changes.length && changes[next][0] <= i) {
            current = changes[next][1];
            next++;
        }
        values[i] = current;
    }
    return values;
}

/** Clock period inferred from the recorded clock values (max value + 1) */
export function recordedClockPeriod(recording: Recording): number | null {
    const values = recording.clock?.values;
    if (!values || values.length === 0) {
        return null;
    }
    return Math.max(...values) + 1;
}
