import { z } from "zod";

/** A positive model declaration is required before imported pickup data can drive a simulation. */
export const BeltPickupCaptureSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("supported"),
        model: z.enum(["belt", "turbo-two-stream"]),
        model_version: z.literal(1),
        entity_type: z.enum(["transport-belt", "underground-belt"]),
        entity_name: z.string().optional(),
        sidecar_version: z.string().optional(),
    }),
    z.object({
        status: z.enum(["unsupported", "unclassified"]),
        entity_type: z.string().optional(),
        entity_name: z.string().optional(),
        sidecar_version: z.string().optional(),
        reason: z.string(),
    }),
]);

type PickupSource = {
    type: string;
    pickup_capture?: z.infer<typeof BeltPickupCaptureSchema>;
    pickup_length?: number;
    near_lane?: number;
    pickup_merge?: unknown;
};

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Run before schema defaults: legacy diagnostics must not disappear into a straight-belt default. */
export function sidecarPickupInserters(inserters: unknown, version: unknown, warnings: unknown): unknown {
    if (!Array.isArray(inserters)) return inserters;
    const notes = Array.isArray(warnings) ? warnings.filter(object) : [];
    return inserters.map((entry, index) => {
        if (!object(entry) || !object(entry.source) || entry.source.type !== "belt") return entry;
        const source = entry.source;
        const note = notes.find(note => note.inserter_id === (entry.id ?? index + 1));
        // An explicit warning wins over a contradictory supported marker. Unknown metadata is preserved so
        // validation rejects future models rather than stripping their fields and assuming a current model.
        if (source.pickup_capture !== undefined && !note) return entry;
        const capture = object(source.pickup_capture) ? source.pickup_capture : {};
        const reason = note ? (typeof note.reason === "string" ? note.reason : "unsupported") : "legacy";
        return { ...entry, source: { ...source, pickup_capture: {
            ...capture, status: note ? "unsupported" : "unclassified", reason,
            ...(reason === "splitter" && { entity_type: "splitter" }),
            ...(typeof version === "string" && { sidecar_version: version }),
        } } };
    });
}

/** Saved manual configs keep their defaults; only a recognizable Sidecar envelope is migrated. */
export function normalizePickupCaptureConfig(value: unknown): unknown {
    if (!object(value) || !("sidecar_version" in value || "pickup_warnings" in value)) return value;
    return { ...value, inserters: sidecarPickupInserters(value.inserters, value.sidecar_version, value.pickup_warnings) };
}

/** A supported declaration still needs the matching model inputs; provenance alone is not a supply model. */
export function pickupCaptureProblem(source: PickupSource): string | null {
    if (source.type !== "belt" || source.pickup_capture === undefined) return null;
    const capture = source.pickup_capture;
    if (capture.status === "unsupported") {
        return `Pickup captured as unsupported (${capture.entity_type && capture.entity_type !== capture.reason ? capture.entity_type + ": " : ""}${capture.reason}). `
            + "A supported model and a new Sidecar capture are required before generation. Updating the mod does not update this saved capture.";
    }
    if (capture.status !== "supported") {
        return "Pickup classification was not captured. Update Sidecar and recapture this input before generation; geometry defaults cannot establish support.";
    }
    if (capture.model_version !== 1 || !["belt", "turbo-two-stream"].includes(capture.model)) {
        return "This pickup capture model is not supported by this engine. Update the generator before importing it.";
    }
    const length = source.pickup_length ?? 1;
    if ((capture.entity_type !== "transport-belt" && capture.entity_type !== "underground-belt")
        || length !== (capture.entity_type === "underground-belt" ? 0.5 : 1)
        || (source.near_lane !== 1 && source.near_lane !== 2)) {
        return "Supported pickup capture needs matching physical geometry and an explicit preferred lane. Recapture this input.";
    }
    if ((capture.model === "turbo-two-stream") !== (source.pickup_merge !== undefined)) {
        return "Pickup capture model does not match its supply data. Recapture this input.";
    }
    return null;
}

export function assertPickupCaptureSupported(id: number, source: PickupSource): void {
    const problem = pickupCaptureProblem(source);
    if (problem) throw new Error(`Inserter ${id}: ${problem}`);
}
