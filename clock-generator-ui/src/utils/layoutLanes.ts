/**
 * The input of the Layout view's lane editor mode: for each belt of the lists the view is given, the two lanes it is drawn
 * with and what the user can pick for each. The view knows lanes by the name its caller gives them, and edits nothing.
 */

/** A lane of a belt, named by its caller */
export interface LaneEditorLane {
    /** The caller's name for the lane; an edit calls back with it */
    id: number;
    /** The side of the belt the lane is on, looking the way the belt runs */
    side: 'left' | 'right';
    /** The item the lane carries, null where none is known */
    item: string | null;
    /** The items the user can pick for the lane, shown with "Another item"; null: the item is fixed and the lane has no control */
    candidates: readonly string[] | null;
    /** The items a second that leave the lane, where the lane is asked its rate: null until it is answered; left out where it is not asked */
    rate?: number | null;
}

export interface LaneEditorBelt {
    /** The lanes the belt is drawn with, in the order they are shown */
    lanes: readonly LaneEditorLane[];
    /** The way the belt runs at each of its tiles (0 north, 4 east, 8 south, 12 west), by the tile's centre as `tileKey` makes it */
    directions: ReadonlyMap<string, number>;
}

export interface LaneEditor {
    /** By belt id of the belts list the view is given; a belt that is not here is drawn as it is without the mode */
    belts: ReadonlyMap<number, LaneEditorBelt>;
    /** Every item the user can pick for a lane that has candidates */
    itemNames: readonly string[];
    /** The lane to mark in the editor of the selected belt, by the caller's name for it */
    markedLane?: number | null;
    /** An item is picked for a lane; the view changes nothing itself */
    onEdit(beltId: number, lane: number, item: string): void;
    /** A rate is typed for a lane that has one, and is above 0 */
    onRate?(beltId: number, lane: number, value: number): void;
}

/** The key of a belt tile in `LaneEditorBelt.directions`: the centre of the tile, as the layout gives it */
export const tileKey = (x: number, y: number): string => `${x},${y}`;
