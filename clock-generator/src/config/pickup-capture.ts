import { z } from "zod";
import { BELT_PICKUP_LAYOUTS, BeltPickupLayout, pickupLengthForLayout, pickupLayoutProblem } from "../common/belt-pickup-layout";

/** A positive model declaration is required before imported pickup data can drive a simulation. */
export const BeltPickupCaptureSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("supported"),
        model: z.enum(["belt", "turbo-two-stream"]),
        model_version: z.union([z.literal(1), z.literal(2)]),
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
    pickup_layout?: BeltPickupLayout;
    near_lane?: number;
    pickup_merge?: unknown;
};

const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Missing approach data cannot be recovered from a half-tile span or an old positive marker. */
function normalizeSource(source: Record<string, unknown>): Record<string, unknown> {
    const layout = source.pickup_layout;
    let updated = source;
    if (typeof layout === "string" && BELT_PICKUP_LAYOUTS.includes(layout as BeltPickupLayout)
        && source.pickup_length === undefined) updated = {...source, pickup_length: pickupLengthForLayout(layout as BeltPickupLayout)};
    const capture = source.pickup_capture;
    if (object(capture) && capture.status === "supported" && capture.model_version === 1
        && capture.entity_type === "underground-belt") updated = {...updated,
            pickup_capture: {...capture, status: "unclassified", reason: "layout-not-captured"}};
    return updated;
}

/** Run before schema defaults: legacy diagnostics must not disappear into a straight-belt default. */
export function sidecarPickupInserters(inserters: unknown, version: unknown, warnings: unknown): unknown {
    if (!Array.isArray(inserters)) return inserters;
    const notes = Array.isArray(warnings) ? warnings.filter(object) : [];
    return inserters.map((entry, index) => {
        if (!object(entry) || !object(entry.source) || entry.source.type !== "belt") return entry;
        const source = normalizeSource(entry.source);
        const note = notes.find(note => note.inserter_id === (entry.id ?? index + 1));
        // An explicit warning wins over a contradictory supported marker. Unknown metadata is preserved so
        // validation rejects future models rather than stripping their fields and assuming a current model.
        if (source.pickup_capture !== undefined && !note) return source === entry.source ? entry : {...entry, source};
        const capture = object(source.pickup_capture) ? source.pickup_capture : {};
        const reason = note ? (typeof note.reason === "string" ? note.reason : "unsupported") : "legacy";
        return { ...entry, source: { ...source, pickup_capture: {
            ...capture, status: note ? "unsupported" : "unclassified", reason,
            ...(reason === "splitter" && { entity_type: "splitter" }),
            ...(typeof version === "string" && { sidecar_version: version }),
        } } };
    });
}

/** Derive length only from explicit layouts; normalize recognizable capture provenance before defaults. */
export function normalizePickupCaptureConfig(value: unknown): unknown {
    if (!object(value) || !Array.isArray(value.inserters)) return value;
    // Layout can supply length, but length cannot recover an underground layout.
    const inserters = value.inserters.map(entry => {
        if (!object(entry) || !object(entry.source) || entry.source.type !== "belt") return entry;
        const source = normalizeSource(entry.source);
        return source === entry.source ? entry : {...entry, source};
    });
    return {...value, inserters: "sidecar_version" in value || "pickup_warnings" in value
        ? sidecarPickupInserters(inserters, value.sidecar_version, value.pickup_warnings) : inserters};
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
    if (![1, 2].includes(capture.model_version) || !["belt", "turbo-two-stream"].includes(capture.model)) {
        return "This pickup capture model is not supported by this engine. Update the generator before importing it.";
    }
    if (capture.model_version === 1 && capture.entity_type === "underground-belt") {
        return "Pickup layout was not captured. Update Sidecar and recapture this underground input before generation.";
    }
    if (capture.model_version === 2 && !source.pickup_layout) return "Supported pickup capture needs an explicit layout. Recapture this input.";
    const layoutProblem = pickupLayoutProblem(source);
    if (layoutProblem) return layoutProblem;
    const length = source.pickup_length ?? (source.pickup_layout ? pickupLengthForLayout(source.pickup_layout) : 1);
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
