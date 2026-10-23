/**
 * The game's rich text in a combinator's description, "[entity=car] → machine 1 [recipe=iron-plate] [item=iron-ore]
 * (inserter 1)": the tags the game draws as icons, split out from the words between them.
 */

/** What a tag names. Other kinds of tag (a tile, a technology) stay as the text they are */
export type RichIconKind = 'entity' | 'item' | 'fluid' | 'recipe' | 'quality';

export type RichTextPart =
    | { kind: 'text'; text: string }
    | { kind: 'icon'; icon: RichIconKind; name: string; /** The quality the tag asks for: "[item=iron-plate,quality=rare]" */ quality?: string };

const ICON_KINDS: ReadonlySet<string> = new Set<RichIconKind>(['entity', 'item', 'fluid', 'recipe', 'quality']);

/** "[kind=name]" or "[kind=name,quality=quality]" */
const TAG = /\[([a-z-]+)=([^\],[\s]+)(?:,quality=([^\],[\s]+))?\]/g;

/** The parts of a line, in order, whole: text and icons put back to back make the line again */
export function richTextParts(line: string): RichTextPart[] {
    const parts: RichTextPart[] = [];
    let end = 0;
    const text = (to: number) => {
        if (to > end) {
            const last = parts[parts.length - 1];
            const added = line.slice(end, to);
            if (last?.kind === 'text') {
                last.text += added;
            } else {
                parts.push({ kind: 'text', text: added });
            }
        }
    };
    for (const match of line.matchAll(TAG)) {
        const [whole, icon, name, quality] = match;
        if (!ICON_KINDS.has(icon)) {
            // not drawn as an icon: stays text, in the part of the words around it
            continue;
        }
        text(match.index);
        end = match.index + whole.length;
        parts.push({ kind: 'icon', icon: icon as RichIconKind, name, ...(quality !== undefined ? { quality } : {}) });
    }
    text(line.length);
    return parts;
}
