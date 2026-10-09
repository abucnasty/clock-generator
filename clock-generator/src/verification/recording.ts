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
        /** Burner machines only: items in the fuel slot per sample, by fuel item */
        fuel: luaRecord(luaArray(z.number())).optional(),
        /** Burner machines only: MJ left in the fuel item being burned per sample */
        burning_remaining: luaArray(z.number()).optional(),
        /** Burner machines only: the fuel item being burned, "" when none */
        currently_burning: changeList(z.string()).optional(),
    }),
});

/** A mining drill that drops into a machine */
const RecordedDrillSchema = z.object({
    id: z.number().int(),
    unit_number: z.number().optional(),
    name: z.string(),
    mined_item_name: z.string(),
    target: TargetRefSchema.optional(),
    samples: z.object({
        status: changeList(z.string()),
        /** How far along the ore being mined is, 0 to 1, per sample */
        mining_progress: luaArray(z.number()),
        /** How full the mining productivity bar is, 0 to 1, per sample */
        bonus_mining_progress: luaArray(z.number()),
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

/**
 * Ticks between the clock counting a value and the combinators that enable the inserters seeing it: they read the
 * clock through the lock filter (see lockFilter in blueprints/entity/decider-combinator.ts), a combinator of its own,
 * which takes a tick. The generator leaves the windows where they are, so every window opens this many ticks after
 * the position the recorder sampled, and a recorded swing is compared with the windows this many ticks earlier.
 */
export const CLOCK_TO_WINDOW_TICKS = 1;

/**
 * The clock counts 1 to its period, never 0 (see the clock in crafting/blueprint.ts), and the recorder samples it as
 * it is, where it counts. Here the values become 0-based positions in the period, as the windows of the generator are: the period
 * starts where the clock is 1, and the period is the largest position plus one. A recorded 0 is not a position: the
 * clock signal was absent, or the clock counted from 0, as clocks made before the count started at 1 did.
 * The windows are CLOCK_TO_WINDOW_TICKS later than these positions (see windowPositions in recording-history.ts);
 * the periods stay where the recorder cut them, which is where the clock wraps.
 */
const RecordedClockSchema = z.object({ values: luaArray(z.number()) }).superRefine((clock, context) => {
    const index = clock.values.indexOf(0);
    if (index >= 0) {
        context.addIssue({
            code: "custom",
            path: ["values", index],
            message: "Recorded clock value 0: a clock counts 1 to its period, so the clock signal was absent, "
                + "or the clock was made before clocks counted from 1 and has to be generated again",
        });
    }
}).transform(clock => ({ values: clock.values.map(value => value - 1) }));

export const RecordingSchema = z.object({
    format: z.literal("clock-generator-recording"),
    version: z.literal(1),
    factorio_version: z.string().optional(),
    start_game_tick: z.number(),
    sample_count: z.number().int(),
    stop_reason: z.string().optional(),
    clock: RecordedClockSchema.optional(),
    config: RecordedConfigSchema,
    inserters: luaArray(RecordedInserterSchema),
    machines: luaArray(RecordedMachineSchema),
    /** Absent in recordings made before the recorder sampled drills */
    drills: luaArray(RecordedDrillSchema).optional(),
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
