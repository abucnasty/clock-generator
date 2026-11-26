import type { Layout, LayoutBeltTile, LayoutInserter } from './layoutOf';
import { LAYOUT_TILE_PX as PX } from './layoutBounds';

/** A rectangle of the picture, in its units (pixels at zoom 1) */
export interface Box { x: number; y: number; width: number; height: number }

export const px = (tiles: number) => tiles * PX;

/** The height of an inserter's number badge and of a combinator's tag */
export const MARK_HEIGHT = 15;

/** Where an inserter's number badge is, with the matching inserter's number beside it, in picture units */
export function badgeBox(inserter: LayoutInserter, twins: readonly number[] | undefined): Box & { badgeWidth: number } {
    const badgeWidth = 8 + String(inserter.number).length * 7;
    const twinWidth = twins !== undefined && twins.length > 0 ? 2 + 5.8 * `=${twins.join(',')}`.length : 0;
    return { x: px(inserter.x) - PX * 0.5 - badgeWidth * 0.45, y: px(inserter.y) - PX * 0.5 - 6, width: badgeWidth + twinWidth, height: MARK_HEIGHT, badgeWidth };
}

export const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * The label of a belt tile ("b4"), at the corner of its tile that no inserter number covers: the badge of an inserter next to
 * the tile reaches over the tile's own corner, so the four corners are tried and the one with the least cover is taken
 */
function beltLabelAt(tile: LayoutBeltTile, covers: readonly Box[]): { x: number; y: number; width: number } {
    const width = 5.4 * `b${tile.beltId}`.length + 2, height = 9;
    const left = px(tile.x - 0.5), top = px(tile.y - 0.5);
    const corners = [[left + 2, top + PX - 3], [left + PX - 2 - width, top + PX - 3], [left + PX - 2 - width, top + 9], [left + 2, top + 9]];
    const covered = (corner: number[]) => covers.reduce((sum, box) => sum + overlap({ x: corner[0], y: corner[1] - height + 1, width, height }, box), 0);
    const [x, y] = corners.reduce((best, corner) => (covered(corner) < covered(best) ? corner : best));
    return { x, y, width };
}

/** The box a belt label takes (its `y` is its baseline) */
const beltLabelBox = (label: { x: number; y: number; width: number }): Box => ({ x: label.x, y: label.y - 8, width: label.width, height: 9 });

/** The width of a combinator's tag, from its letters: the same as a number badge of as many characters */
const tagWidth = (letter: string): number => 8 + letter.length * 7;

/** What a combinator's tag is placed beside: the number badge of an inserter, or of a drill's box, and the letter it carries */
interface TagWish {
    /** "inserter:5", "drill:2" */
    key: string;
    letter: string;
    /** The badge the tag stands after */
    badge: Box;
}

/**
 * Where each tag goes: after its badge, else the first place around the badge that no number badge, belt label or earlier
 * tag covers, else the one that covers least. The tags are placed in the order given, so the same build gives the same places.
 */
function placeTags(wishes: readonly TagWish[], obstacles: readonly Box[]): Map<string, Box> {
    const placed = new Map<string, Box>();
    const taken = [...obstacles];
    for (const wish of wishes) {
        const width = tagWidth(wish.letter), { badge } = wish, gap = 2, step = MARK_HEIGHT + 2;
        const candidates: Box[] = [
            [badge.x + badge.width + gap, badge.y],
            [badge.x - width - gap, badge.y],
            [badge.x, badge.y - step],
            [badge.x + badge.width + gap, badge.y + step],
            [badge.x, badge.y + step],
            [badge.x + badge.width + gap, badge.y - step],
            [badge.x - width - gap, badge.y + step],
            [badge.x - width - gap, badge.y - step],
            [badge.x + badge.width + gap + width + gap, badge.y],
            [badge.x, badge.y + 2 * step],
            [badge.x, badge.y - 2 * step],
        ].map(([x, y]) => ({ x, y, width, height: MARK_HEIGHT }));
        const cover = (box: Box) => taken.reduce((sum, other) => sum + overlap(box, other), 0);
        const best = candidates.find(box => cover(box) === 0) ?? candidates.reduce((least, box) => (cover(box) < cover(least) ? box : least));
        placed.set(wish.key, best);
        taken.push(best);
    }
    return placed;
}

/** The corner badge of a box (machine, drill, chest), where its number is drawn: the badge's width is the number's */
function boxBadge(box: { x: number; y: number; width: number; height: number; freeFacing: boolean; unsized: boolean }, id: number): Box {
    const small = box.freeFacing || box.unsized;
    const span = small ? 1 : box.width, spanHeight = small ? 1 : box.height;
    return { x: px(box.x - span / 2) + 2, y: px(box.y - spanHeight / 2) + 2, width: Math.max(12, 6.2 * String(id).length + 8), height: MARK_HEIGHT };
}

/** Everything the picture writes over the build: the badges, the belt labels and the tags, as boxes */
interface LayoutMarks {
    badges: Box[];
    beltLabels: Box[];
    tags: Map<string, Box>;
}

/**
 * The marks of a picture. `lettered` is the letter of each inserter ("inserter:5") and drill ("drill:2") of a clock that is
 * current for the build; without it the inserters carry the matching inserter's number (`twins`) and no tag is placed.
 */
export function layoutMarks(layout: Layout, twins: ReadonlyMap<number, number[]> | undefined, lettered: ReadonlyMap<string, string> | null): LayoutMarks {
    const badges = layout.inserters.map(inserter => badgeBox(inserter, lettered === null ? twins?.get(inserter.id) : undefined));
    const beltLabels = layout.beltTiles.map(tile => beltLabelBox(beltLabelAt(tile, badges)));
    const tags = new Map<string, Box>();
    if (lettered !== null) {
        const boxBadges = layout.boxes.map(box => boxBadge(box, box.id));
        const inserterWishes = layout.inserters.flatMap((inserter, index) => {
            const key = `inserter:${inserter.number}`, letter = lettered.get(key);
            return letter === undefined ? [] : [{ key, number: inserter.number, letter, badge: badges[index] }];
        });
        const drillWishes = layout.boxes.flatMap((box, index) => {
            const key = `drill:${box.id}`, letter = box.kind === 'drill' ? lettered.get(key) : undefined;
            return letter === undefined ? [] : [{ key, number: box.id, letter, badge: boxBadges[index] }];
        });
        // by number, the inserters and then the drills, so that the same build always gives the same places
        const byNumber = (a: { number: number }, b: { number: number }) => a.number - b.number;
        const wishes: TagWish[] = [...inserterWishes.sort(byNumber), ...drillWishes.sort(byNumber)];
        for (const [key, box] of placeTags(wishes, [...badges, ...boxBadges, ...beltLabels])) tags.set(key, box);
    }
    return { badges, beltLabels, tags };
}
