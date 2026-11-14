import { z } from "zod";

/**
 * The lane end that is not a dead end is an infinite end, `{"kind": "infinite"}`: it takes every item that reaches it.
 * No released config states a lane end, so the words it had before are not read: `"kind": "outlet"` and `outlet_rate`
 * are refused, each with a message that names the field and says what to state.
 */
function refuseOutletWords(value: unknown, context: z.RefinementCtx): void {
    if (typeof value !== "object" || value === null) return;
    if ((value as { kind?: unknown }).kind === "outlet") {
        context.addIssue({ code: "custom", path: ["kind"],
            message: "`lane_end.kind` \"outlet\" is not read. A lane end that is not a dead end is an infinite end: state `{\"kind\": \"infinite\"}`." });
    }
    if ("outlet_rate" in value) {
        context.addIssue({ code: "custom", path: ["outlet_rate"],
            message: "`lane_end.outlet_rate` is not read. An infinite end takes every item that reaches it: remove the field." });
    }
}

/** A lane end's schema, with the words of the lane end before the infinite end refused first (see refuseOutletWords) */
export function withoutOutletWords<T extends z.ZodType>(schema: T) {
    return z.unknown().superRefine(refuseOutletWords).pipe(schema);
}
