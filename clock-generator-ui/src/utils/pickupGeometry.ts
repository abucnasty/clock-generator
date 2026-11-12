import { pickupLengthForLayout, type BeltPickupLayout } from 'clock-generator/light';
import type { InserterFormData } from './configForm/formData';

export type PickupType = BeltPickupLayout;
type Source = InserterFormData['source'];
type Capture = Source['pickup_capture'];

/** A capture that cannot drive generation: recorded as unsupported or unclassified, or an old underground declaration */
const isUnverified = (capture: Capture) => capture !== undefined
    && (capture.status !== 'supported' || (capture.model_version === 1 && capture.entity_type === 'underground-belt'));

export function pickupTypeOf(source: Source): PickupType | 'underground' | 'unverified' {
    if (isUnverified(source.pickup_capture)) return 'unverified';
    return source.pickup_layout ?? (source.pickup_length === 0.5 ? 'underground' : 'side-straight');
}

/** A pickup that the clock generator leaves out on purpose, by the reason its capture gives */
type OutOfScopePickup = 'splitter' | 'side-loaded';

/** How an out-of-scope pickup is named, and what makes it one */
export const OUT_OF_SCOPE_PICKUPS: Readonly<Record<OutOfScopePickup, { label: string; detail: string }>> = {
    'splitter': { label: 'splitter', detail: 'Its pickup tile is a splitter.' },
    'side-loaded': { label: 'side-loaded belt', detail: 'Another belt side-loads onto its pickup tile.' },
};

/** Why no update of Sidecar or recapture makes an out-of-scope pickup supported, and what to build instead */
export const OUT_OF_SCOPE_PICKUP_SCOPE = 'Splitters and side-loaded belt tiles are out of scope.'
    + ' Use a supported straight belt, bend or underground pickup.'
    + ' Rebuild the pickup as one of these, then recapture it with Sidecar.';

/**
 * The out-of-scope pickup an imported capture records, or null. Only the reasons that the engine refuses as out of
 * scope count; any other unsupported capture stays unverified.
 */
export function unsupportedPickupOf(source: { pickup_capture?: Capture }): OutOfScopePickup | null {
    const capture = source.pickup_capture;
    if (capture?.status !== 'unsupported') return null;
    const reason = capture.reason;
    return reason === 'splitter' || reason === 'side-loaded' ? reason : null;
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt' || pickupTypeOf(source) === 'unverified') return source;
    const length = pickupLengthForLayout(type);
    const updated = { ...source, pickup_length: length, pickup_layout: type,
        ...(type === 'bend-right-upstream' && {near_lane: 1 as const}) };
    // A deliberate geometry edit becomes a manual configuration, not a new physical capture.
    if (pickupTypeOf(source) !== type || updated.near_lane !== source.near_lane) delete updated.pickup_capture;
    return updated;
}

/** Make the UI's straight-belt default explicit for generation and export, including older saved forms. */
export function withDefaultPickupType(source: Source): Source {
    return source.type === 'belt' && source.pickup_length === undefined
        ? {...source, pickup_length: source.pickup_layout ? pickupLengthForLayout(source.pickup_layout) : 1} : source;
}

export interface PickupBuild {
    inserters: readonly { id?: number; source: { type: string; id?: number; pickup_length?: number; pickup_layout?: BeltPickupLayout; pickup_capture?: Source['pickup_capture'] } }[];
    /** The belts, whose lanes say how they end; none where the place does not know them */
    belts?: readonly { id: number; lanes: readonly { ingredient: string; lane_end?: { kind: string }; consumption_per_second?: number }[] }[];
    overrides?: { backed_up_belts?: boolean };
}

/**
 * For a place that has no clock (the form, an import): whether every lane an inserter takes from ends in a dead end. A lane
 * that states its end has it, an export lane is an infinite end, and a lane that states none has the end the belt setting
 * gives (Moving: infinite, true: dead end), else the one its role gives, which for a lane an inserter takes from is a dead
 * end. A lane of a belt that the build also drops onto is read as taken. With no such lane, the belt setting's answer. A
 * clock reads the engine's belt instead (`ClockAlternativeView.belt`).
 */
export function takenLanesEndInDeadEnds(build: PickupBuild): boolean {
    const takenBelts = new Set(build.inserters.flatMap(inserter => inserter.source.type === 'belt' && inserter.source.id !== undefined ? [inserter.source.id] : []));
    const lanes = (build.belts ?? []).filter(belt => takenBelts.has(belt.id)).flatMap(belt => belt.lanes).filter(lane => lane.ingredient !== '');
    if (lanes.length === 0) return build.overrides?.backed_up_belts === true;
    const unstated = build.overrides?.backed_up_belts === false ? 'infinite' : 'dead_end';
    return lanes.every(lane => (lane.consumption_per_second !== undefined ? 'infinite' : lane.lane_end?.kind ?? unstated) === 'dead_end');
}

export function pickupGeometryOf(build: PickupBuild) {
    const inputs = build.inserters.map((inserter, index) => ({ id: inserter.id ?? index + 1, source: inserter.source }))
        .filter(inserter => inserter.source.type === 'belt');
    const unverified = inputs.filter(inserter => isUnverified(inserter.source.pickup_capture)).map(i => i.id);
    // Out of scope: a subset of the unverified pickups, which no recapture makes supported
    const unsupported = inputs.filter(inserter => unsupportedPickupOf(inserter.source) !== null).map(i => i.id);
    const missing = inputs.filter(({source}) => source.pickup_layout
        ? source.pickup_length !== pickupLengthForLayout(source.pickup_layout)
        : source.pickup_length !== 1).map(i => i.id);
    return { total: inputs.length, known: inputs.filter(i => !missing.includes(i.id) && !unverified.includes(i.id)).length, missing, unverified, unsupported };
}
