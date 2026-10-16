import type { BeltFormData, InserterFormData } from './configForm/formData';

type Source = InserterFormData['source'];

/**
 * The items on the two lanes of the belt an inserter takes from, when they are two different items it could choose
 * between; null for any other source (a machine, a chest, a belt with one lane, both lanes the same, a lane left empty).
 */
export function nearLaneItems(source: Source, belts: BeltFormData[]): string[] | null {
    if (source.type !== 'belt') return null;
    const lanes = belts.find(b => b.id === source.id)?.lanes.map(l => l.ingredient) ?? [];
    return lanes.length === 2 && lanes[0] && lanes[1] && lanes[0] !== lanes[1] ? lanes : null;
}

/** The source with its nearest lane set to 1 or 2, or without one for 0 (the key is removed, not set to undefined) */
export function withNearLane(source: Source, lane: 0 | 1 | 2): Source {
    const rest = { ...source };
    delete rest.near_lane;
    return lane === 0 ? rest : { ...rest, near_lane: lane };
}
