import { Config } from './schema';

// ============================================================================
// The lane a drop lands on, from the way the inserter faces
// ============================================================================
//
// A stack inserter beside a belt drops onto the belt's far lane. The Sidecar exports the way the inserter faces, which is
// the side it takes from (`direction`), and the way the belt runs at the drop tile (`sink.belt_direction`); from these
// two the lane follows. An inserter at the end of the belt drops in line with it, and a drop that side-loads onto
// another belt (`drop_capture`) does not stay on the lane it lands on: neither has a known lane here. A configuration
// made by hand has neither field, so none of its drops has a known lane.

type Inserter = Config['inserters'][number];
type BeltSink = Extract<Inserter['sink'], { type: 'belt' }>;

/** The direction when it is one of the four cardinal ones (0 north, 4 east, 8 south, 12 west), else null */
const cardinal = (direction: number | undefined): number | null =>
    direction !== undefined && direction % 4 === 0 && direction >= 0 && direction < 16 ? direction : null;

/**
 * The lane of the belt an inserter's drop lands on, 1 (the left lane in the direction of travel) or 2: lane 2 from the
 * belt's left side, lane 1 from its right side. Null when it is not known: a direction that is missing or not cardinal,
 * a drop from the end of the belt, or a drop that side-loads onto another belt.
 */
export function dropSideLane(inserter: Pick<Inserter, 'direction'>, sink: Pick<BeltSink, 'belt_direction' | 'drop_capture'>): 1 | 2 | null {
    const facing = cardinal(inserter.direction);
    const belt = cardinal(sink.belt_direction);
    if (facing === null || belt === null || sink.drop_capture !== undefined) return null;
    // the inserter drops away from the side it takes from
    const toward = (facing + 8) % 16;
    // along the belt: from one of its ends
    if ((toward - belt + 16) % 8 === 0) return null;
    return toward === (belt + 4) % 16 ? 2 : 1;
}
