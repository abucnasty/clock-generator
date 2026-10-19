/** Physical pickup layouts calibrated by the belt experiments. Supply motion is a separate setting. */
export const BELT_PICKUP_LAYOUTS = [
    "side-straight", "side-entrance", "side-exit", "front-entrance", "front-exit", "over-hood-exit",
] as const;
export type BeltPickupLayout = typeof BELT_PICKUP_LAYOUTS[number];

export function pickupLengthForLayout(layout: BeltPickupLayout): 0.5 | 1 {
    return layout === "side-straight" ? 1 : 0.5;
}

export const BELT_PICKUP_LAYOUT_LABELS: Record<BeltPickupLayout, string> = {
    "side-straight": "Straight belt — side pickup",
    "side-entrance": "Underground entrance — side pickup",
    "side-exit": "Underground exit — side pickup",
    "front-entrance": "Underground entrance — front pickup",
    "front-exit": "Underground exit — front pickup",
    "over-hood-exit": "Underground exit — over the hood",
};

/** Geometry defaults are safe only for an ordinary straight belt. Underground layouts must be named. */
export function pickupLayoutProblem(source: {pickup_layout?: BeltPickupLayout; pickup_length?: number}): string | null {
    if (source.pickup_layout && !BELT_PICKUP_LAYOUTS.includes(source.pickup_layout)) return "Unknown pickup layout.";
    const length = source.pickup_length ?? (source.pickup_layout ? pickupLengthForLayout(source.pickup_layout) : 1);
    if (!source.pickup_layout) return length === 1 ? null : "Choose the underground pickup layout; half-tile reach alone does not identify the approach.";
    if (length !== pickupLengthForLayout(source.pickup_layout)) return "Pickup layout and exposed length disagree.";
    return null;
}
