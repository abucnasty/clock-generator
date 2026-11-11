import type { BeltLane, OutputBeltGeometry } from "../../../config/output-belt";
import type { JoinLayout, JoinLine, SideLoad, SplitterSide } from "./join-model";
import { LOADER_LINE_LENGTH, ReceivingEntity, UNDERGROUND_END_LINE_LENGTH } from "./join-rules";

/**
 * The output belt of a config as the lines of the join model (join-model.ts): the lines of the derived geometry
 * (config/output-belt.ts, `outputBeltGeometry`), with three things the geometry leaves to the model:
 * - **A side load onto an underground entrance** lands on the entrance's own line, which is the upstream half of its
 *   tile (UNDERGROUND_END_LINE_LENGTH). The geometry's line of that tile is cut in two: the entrance's line, then a line
 *   of the downstream half, which is the tunnel's. The side-load point 60 is measured on the entrance's own line; with the
 *   tile's whole line a side-loaded stack would skip half a tile (the automation science 240 build's lane change takes 414
 *   ticks to the splitter in the game and with the cut, 410 without it).
 * - **The outlet** is a loader: a line of LOADER_LINE_LENGTH with the end "loader" after the stretch's last tile, on
 *   each lane. A blockage shuts it.
 * - **The splitter's input lines** are the splitter's inputs in the model, not lines that feed its outputs.
 * An underground exit's line is the downstream half of its tile, so the geometry's lines that end at an exit's tile need
 * no cut; the line of a lone exit at a stretch's start is that half alone (128, the recording of the build shows it so).
 * Each lane of a sender goes onto the receiving lane from the downstream or the upstream side; the model shuts a lane that
 * an underground end's hood shuts.
 */

/** Where a copy's output inserter puts its stacks down: the middle of its drop tile, as the distance to the line's end */
export interface OutputBeltDropSpot {
    line: string;
    /** In 1/256 tile: the middle of the drop tile, the spot of a hand that has no drop spot of its own */
    spot: number;
}

export interface OutputBeltJoin {
    layout: JoinLayout;
    /** Each copy's drop spot, by the copy's number in the section (from 1) */
    drops: ReadonlyMap<number, OutputBeltDropSpot>;
    /** The outlet's loader lines, one a lane */
    outlet_lines: readonly string[];
}

const LANES: readonly BeltLane[] = ["left", "right"];
const ENTITY: Record<"side-straight" | "side-entrance" | "side-exit", ReceivingEntity> = {
    "side-straight": "belt", "side-entrance": "underground-entrance", "side-exit": "underground-exit",
};
/** The middle of a tile, the spot of a hand without a drop spot (BeltHandDrop) */
const TILE_MIDDLE = 128;

/** The join model's layout of an output belt, from its derived geometry (see the module's description) */
export function outputBeltJoinOf(geometry: OutputBeltGeometry): OutputBeltJoin {
    const lines = new Map<string, JoinLine & { lane: BeltLane }>();
    for (const line of geometry.lines) {
        if (line.feeds.length > 1 && !line.name.startsWith("the splitter's")) throw new Error(`line ${line.name} feeds ${line.feeds.length} lines`);
        lines.set(line.name, { id: line.name, length: line.length, lane: line.lane, ...(line.feeds.length === 1 && { feeds: line.feeds[0] }) });
    }
    const line = (id: string | undefined) => {
        const found = id === undefined ? undefined : lines.get(id);
        if (found === undefined) throw new Error(`the output belt has no line ${id}`);
        return found;
    };

    const side_loads: SideLoad[] = [];
    for (const load of geometry.side_loads) {
        const entity = ENTITY[load.layout];
        const receiver = line(load.receiver_line);
        if (entity === "underground-entrance") {
            // the entrance's own line is the upstream half of its tile; the downstream half is the tunnel's, on each lane
            const other = load.receiver_line!.replace(`${load.lane} lane:`, `${load.lane === "left" ? "right" : "left"} lane:`);
            for (const tile of [receiver, line(other)]) {
                const half = { id: `${tile.id} (its tunnel half)`, length: tile.length - UNDERGROUND_END_LINE_LENGTH, lane: tile.lane,
                    ...(tile.feeds !== undefined && { feeds: tile.feeds }) };
                lines.set(half.id, half);
                tile.length = UNDERGROUND_END_LINE_LENGTH;
                tile.feeds = half.id;
            }
        }
        for (const sender_lane of LANES) {
            const sender = line(load.sender_lines?.[sender_lane]);
            delete sender.feeds;
            side_loads.push({ sender: sender.id, receiver: receiver.id, lane: sender_lane === load.lane ? "downstream" : "upstream", entity });
        }
    }

    const outlet_lines: string[] = [];
    for (const outlet of geometry.outlets) {
        for (const lane of LANES) {
            const last = line(outlet.lines?.[lane]);
            const loader = { id: `the outlet's loader, ${lane} lane`, length: LOADER_LINE_LENGTH, lane, end: "loader" as const };
            lines.set(loader.id, loader);
            last.feeds = loader.id;
            outlet_lines.push(loader.id);
        }
    }

    const splitter = geometry.splitter;
    const pair = (kind: "input" | "output", side: SplitterSide): [string, string] =>
        [`the splitter's ${side} ${kind}, left lane`, `the splitter's ${side} ${kind}, right lane`];
    if (splitter !== undefined) {
        for (const side of LANES) for (const id of pair("input", side)) delete line(id).feeds;
    }

    const drops = new Map<number, OutputBeltDropSpot>();
    const side_belt = geometry.side_belt;
    for (const load of geometry.side_loads) {
        if (!("side_belt_of_copy" in load.sender) || side_belt === undefined) continue;
        const sender = line(load.sender_lines?.[side_belt.lane]);
        // the drop tile is the side belt's first tile: its middle is the rest of the line and half a tile from its end
        drops.set(load.sender.side_belt_of_copy, { line: sender.id, spot: sender.length - side_belt.drop_tile_end + TILE_MIDDLE });
    }
    for (const drop of geometry.drops) drops.set(drop.copy, { line: line(drop.line).id, spot: TILE_MIDDLE });

    return {
        layout: {
            lines: [...lines.values()].map(({ lane: _lane, ...rest }) => rest),
            side_loads,
            ...(splitter !== undefined && { splitters: [{ inputs: { left: pair("input", "left"), right: pair("input", "right") },
                outputs: { left: pair("output", "left"), right: pair("output", "right") },
                input_priority: splitter.input_priority, output_priority: splitter.output_priority }] }),
        },
        drops,
        outlet_lines,
    };
}
