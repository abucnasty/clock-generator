import { GAP, LOADER_TAKE_POSITION, ReceivingPiece, SIDE_LOAD_POINT, SideLoadLane, SPLITTER_LANE_LENGTH, STEP } from "./join-rules";

/**
 * A per-tick model of the belt lines at a join: belt lanes that go onto another belt by a side load or by a splitter.
 * It is fed with put-on events only (where and when a stack comes onto a line) and moves every stack each tick, as the
 * game does on turbo belts. Positions and lengths are whole numbers in 1/256 tile; a position is the distance to the
 * downstream end of the stack's line. The rules and the recordings they are read from:
 * tests/game/mechanics/belt-join/README.md. The numbers: join-rules.ts.
 *
 * A line is one transport line of one piece (a belt, an underground end or its tunnel, a splitter's input or output, a
 * loader), as the game has them: each belt has two, one for each lane.
 */

/** What a line with no line after it does: a loader takes its stacks; a shut end holds them */
export type LineEnd = "loader" | "shut";

export interface JoinLine {
    id: string;
    /** The game's line_length, in 1/256 tile */
    length: number;
    /** The line it feeds in-line: the stacks that leave this line's end go onto it */
    feeds?: string;
    /** At the end of a lane: a loader or a shut end */
    end?: LineEnd;
}

/** A sender lane that goes onto a receiving lane from the side; the sender line is the last line of the sender lane */
export interface SideLoad {
    sender: string;
    /** The line of the receiving lane on the piece that the sender lane goes onto */
    receiver: string;
    lane: SideLoadLane;
    piece: ReceivingPiece;
}

export type SplitterSide = "left" | "right";
export type SplitterPriority = SplitterSide | "none";

/** A splitter, by its lines: for each side, the line of lane 1 and of lane 2 */
export interface JoinSplitter {
    inputs: Record<SplitterSide, [string, string]>;
    outputs: Record<SplitterSide, [string, string]>;
    input_priority: SplitterPriority;
    output_priority: SplitterPriority;
}

export interface JoinLayout {
    lines: JoinLine[];
    side_loads?: SideLoad[];
    splitters?: JoinSplitter[];
}

/**
 * A stack put onto a line. A script's insert is put on before the tick's movement (it moves in its own tick); an
 * inserter's drop after it, at the position where it is first seen.
 */
export interface PutOn {
    line: string;
    position: number;
    time: "before-movement" | "after-movement";
}

/** An end changed in a tick acts from the next tick */
export interface EndChange {
    line: string;
    end: LineEnd;
}

export interface TickInput {
    put_ons?: PutOn[];
    end_changes?: EndChange[];
}

export interface JoinStack {
    /** In the order the stacks were put on, from 1; in a tick, the put-ons before the movement first */
    id: number;
    line: string;
    position: number;
}

interface Stack {
    id: number;
    position: number;
}

interface SplitterInput {
    splitter: Splitter;
    lane: 0 | 1;
}

interface Splitter {
    inputs: Record<SplitterSide, [Line, Line]>;
    outputs: Record<SplitterSide, [Line, Line]>;
    input_priority: SplitterSide;
    output_priority: SplitterSide;
}

/** "opening": a shut loader that opens holds its stacks for one tick more and takes its front stack at that tick's end */
type EndState = LineEnd | "opening";

interface Line {
    id: string;
    length: number;
    feeds: Line | null;
    end: EndState | null;
    /** As a sender of a side load that lands: its receiving line and side-load point */
    side: { receiver: Line; point: number } | null;
    splitter_input: SplitterInput | null;
    /** The lines that feed it in-line, in the layout's order */
    ups: Line[];
    /** The senders that land on it, in the layout's order */
    senders: Line[];
    /** Front (small position) first */
    stacks: Stack[];
}

const OTHER: Record<SplitterSide, SplitterSide> = { left: "right", right: "left" };

function whole(value: number, what: string): number {
    if (!Number.isInteger(value)) throw new Error(`${what} is ${value}: positions and lengths are whole 1/256 tiles`);
    return value;
}

function insert(line: Line, stack: Stack): void {
    let index = line.stacks.length;
    while (index > 0 && (line.stacks[index - 1].position > stack.position
        || (line.stacks[index - 1].position === stack.position && line.stacks[index - 1].id > stack.id))) index--;
    line.stacks.splice(index, 0, stack);
}

/** The per-tick model of the lines of one layout. Nothing outside its tests calls it yet. */
export class JoinModel {
    private readonly lines = new Map<string, Line>();
    private readonly order: Line[];
    private pending: EndChange[] = [];
    private next_id = 1;

    constructor(layout: JoinLayout) {
        for (const spec of layout.lines) {
            if (this.lines.has(spec.id)) throw new Error(`line ${spec.id} is in the layout twice`);
            this.lines.set(spec.id, { id: spec.id, length: whole(spec.length, `the length of line ${spec.id}`), feeds: null,
                end: spec.end ?? null, side: null, splitter_input: null, ups: [], senders: [], stacks: [] });
        }
        for (const spec of layout.lines) {
            if (spec.feeds !== undefined) {
                const line = this.line(spec.id);
                if (line.end) throw new Error(`line ${spec.id} has an end and feeds ${spec.feeds}`);
                line.feeds = this.line(spec.feeds);
            }
        }
        const senders = new Set<Line>();
        for (const load of layout.side_loads ?? []) {
            const sender = this.line(load.sender), receiver = this.line(load.receiver);
            if (sender.feeds || sender.end) throw new Error(`line ${load.sender} is a sender of a side load and has a way on of its own`);
            const point = SIDE_LOAD_POINT[load.piece][load.lane];
            // the hood shuts the other lane onto an underground end: it stands at its line's end
            if (point === null) sender.end = "shut";
            else sender.side = { receiver, point };
            senders.add(sender);
        }
        const splitters = (layout.splitters ?? []).map(spec => this.splitter(spec));
        for (const line of this.lines.values()) {
            if (!line.feeds && !line.end && !line.side && !line.splitter_input) {
                throw new Error(`line ${line.id} has no way on: it feeds no line, has no end, is no sender of a side load and no splitter's input`);
            }
        }
        // the lines in-line before each line, and the senders that land on it, in the layout's order
        for (const line of this.lines.values()) {
            if (line.feeds) line.feeds.ups.push(line);
            if (line.side) line.side.receiver.senders.push(line);
        }
        this.order = this.movementOrder(splitters);
    }

    /** Puts on the tick's stacks, moves every stack once, and returns the ids of the stacks put on, in the input's order */
    tick(input: TickInput = {}): number[] {
        for (const change of this.pending) {
            const line = this.line(change.line);
            line.end = change.end === "loader" && line.end === "shut" ? "opening" : change.end;
        }
        this.pending = (input.end_changes ?? []).map(change => {
            const line = this.line(change.line);
            if (!line.end) throw new Error(`line ${change.line} has no end to change`);
            return change;
        });
        const put_ons = input.put_ons ?? [];
        for (const put_on of put_ons) {
            const line = this.line(put_on.line);
            whole(put_on.position, `a put-on's position on line ${put_on.line}`);
            if (put_on.position < 0 || put_on.position >= line.length) {
                throw new Error(`a put-on at ${put_on.position} is not on line ${put_on.line} of length ${line.length}`);
            }
        }
        const ids = new Map<PutOn, number>();
        const put = (time: PutOn["time"]) => {
            for (const put_on of put_ons) if (put_on.time === time) {
                const id = this.next_id++;
                ids.set(put_on, id);
                insert(this.line(put_on.line), { id, position: put_on.position });
            }
        };
        put("before-movement");
        for (const line of this.order) this.move(line);
        put("after-movement");
        for (const line of this.lines.values()) {
            if (line.end === "opening") {
                line.stacks = line.stacks.filter(stack => stack.position >= LOADER_TAKE_POSITION);
                line.end = "loader";
            }
        }
        return put_ons.map(put_on => ids.get(put_on)!);
    }

    /** Every stack, by id */
    stacks(): JoinStack[] {
        const all: JoinStack[] = [];
        for (const line of this.lines.values()) for (const stack of line.stacks) all.push({ id: stack.id, line: line.id, position: stack.position });
        return all.sort((a, b) => a.id - b.id);
    }

    private line(id: string): Line {
        const line = this.lines.get(id);
        if (!line) throw new Error(`line ${id} is not in the layout`);
        return line;
    }

    private splitter(spec: JoinSplitter): Splitter {
        for (const [what, priority] of [["input", spec.input_priority], ["output", spec.output_priority]] as const) {
            if (priority !== "left" && priority !== "right") {
                throw new Error(`a splitter's ${what} priority is "${priority}": the model knows a splitter only with left or right on both`);
            }
        }
        const pair = (ids: [string, string]): [Line, Line] => [this.line(ids[0]), this.line(ids[1])];
        const splitter: Splitter = {
            inputs: { left: pair(spec.inputs.left), right: pair(spec.inputs.right) },
            outputs: { left: pair(spec.outputs.left), right: pair(spec.outputs.right) },
            input_priority: spec.input_priority as SplitterSide,
            output_priority: spec.output_priority as SplitterSide,
        };
        for (const side of ["left", "right"] as const) splitter.inputs[side].forEach((line, lane) => {
            if (line.feeds || line.end || line.side) throw new Error(`line ${line.id} is a splitter's input and has a way on of its own`);
            line.splitter_input = { splitter, lane: lane as 0 | 1 };
        });
        return splitter;
    }

    /**
     * The lines move one at a time, downstream first: from each end, a line and then the lines in-line before it, and
     * after those the senders that land on it. A splitter's input lines move after both its outputs, the one with the
     * input priority first.
     */
    private movementOrder(splitters: Splitter[]): Line[] {
        const order: Line[] = [];
        const seen = new Set<Line>();
        const visit = (line: Line) => {
            if (seen.has(line)) throw new Error(`line ${line.id} is reached twice: the layout has a loop without a splitter`);
            seen.add(line);
            order.push(line);
            for (const up of line.ups) visit(up);
            for (const sender of line.senders) visit(sender);
        };
        for (const line of this.lines.values()) if (!line.feeds && !line.side && !line.splitter_input) visit(line);
        let waiting = splitters;
        while (waiting.length) {
            const ready = waiting.filter(splitter => (["left", "right"] as const).every(side => splitter.outputs[side].every(line => seen.has(line))));
            if (!ready.length) throw new Error("a splitter's output is not reached from any end");
            for (const splitter of ready) {
                const first = splitter.input_priority;
                for (const side of [first, OTHER[first]]) for (const line of splitter.inputs[side]) visit(line);
            }
            waiting = waiting.filter(splitter => !ready.includes(splitter));
        }
        const missing = [...this.lines.values()].filter(line => !seen.has(line));
        if (missing.length) throw new Error(`lines ${missing.map(line => line.id).join(", ")} are reached from no end`);
        return order;
    }

    private move(line: Line): void {
        const keep: Stack[] = [];
        for (const stack of line.stacks) {
            if (!keep.length && stack.position - STEP < 0 && (line.side || line.splitter_input)) {
                // a side head lands or a splitter's head goes onto an output; else it stands at its line's end
                if (line.side ? this.land(line, stack) : this.handOver(line, stack)) continue;
                keep.push({ id: stack.id, position: 0 });
                continue;
            }
            const ahead = keep.length ? keep[keep.length - 1].position : this.aheadOnPath(line);
            let position = stack.position - STEP;
            if (ahead !== null) position = Math.min(stack.position, Math.max(position, ahead + GAP));
            if (line.end === "loader" && position < LOADER_TAKE_POSITION) continue;
            if (position < 0) {
                if (line.feeds) {
                    insert(line.feeds, { id: stack.id, position: line.feeds.length + position });
                    continue;
                }
                position = 0;
            }
            keep.push({ id: stack.id, position });
        }
        line.stacks = keep;
    }

    /** The last stack on the lines that `line` feeds in-line (moved already in this tick), in `line`'s positions */
    private aheadOnPath(line: Line): number | null {
        let offset = 0;
        for (let next = line.feeds; next; next = next.feeds) {
            offset -= next.length;
            if (next.stacks.length) return next.stacks[next.stacks.length - 1].position + offset;
        }
        return null;
    }

    /**
     * A side head whose step would take it past its line's end lands at the first spot at or behind S - STEP + p that is
     * GAP clear of the receiving lane's stacks: a stack of the receiving lane at or ahead of the spot, or at or past S,
     * goes first. Only if that spot is at most S + GAP - 1; else the head stands.
     */
    private land(sender: Line, stack: Stack): boolean {
        const { receiver, point } = sender.side!;
        let spot = point - STEP + stack.position;
        // a stack further than GAP behind the first spot never moves it, nor one past the last spot that can land
        const near = this.receivingLane(receiver, spot - GAP, point + GAP - 1);
        for (let moved = true; moved;) {
            moved = false;
            for (const position of near) {
                if (spot - GAP < position && (position <= spot || position <= point)) {
                    spot = position + GAP;
                    moved = true;
                }
            }
        }
        if (spot > point + GAP - 1) return false;
        let line = receiver;
        while (spot >= line.length && line.ups.length) {
            spot -= line.length;
            line = line.ups[0];
        }
        insert(line, { id: stack.id, position: spot });
        return true;
    }

    /** The positions of the receiving lane's stacks from `low` to `high`, in the receiving line's positions */
    private receivingLane(receiver: Line, low: number, high: number): number[] {
        const positions: number[] = [];
        const add = (line: Line, offset: number) => {
            for (const stack of line.stacks) if (stack.position + offset >= low && stack.position + offset <= high) positions.push(stack.position + offset);
        };
        add(receiver, 0);
        for (let line = receiver, offset = 0; line.ups.length && offset <= high;) {
            offset += line.length;
            line = line.ups[0];
            add(line, offset);
        }
        for (let line = receiver, offset = 0; line.feeds && offset > low;) {
            line = line.feeds;
            offset -= line.length;
            add(line, offset);
        }
        return positions.sort((a, b) => a - b);
    }

    /**
     * A splitter's head whose step would take it past its input line's end goes onto the output with the output priority,
     * else onto the other, on its own lane, at SPLITTER_LANE_LENGTH - input length less the rest of its step (its natural
     * spot). An output takes it GAP behind its last stack when its natural spot is nearer than that, if that is on the
     * output line; past the output's back end, at the back end only when the natural spot is at most GAP before it and
     * the back end is behind the last stack.
     */
    private handOver(input: Line, stack: Stack): boolean {
        const { splitter, lane } = input.splitter_input!;
        const natural = SPLITTER_LANE_LENGTH - input.length + stack.position - STEP;
        for (const side of [splitter.output_priority, OTHER[splitter.output_priority]]) {
            const output = splitter.outputs[side][lane];
            const back = output.length - 1;
            const last = output.stacks.length ? output.stacks[output.stacks.length - 1].position : null;
            let spot: number | null = last === null ? natural : Math.max(natural, last + GAP);
            if (spot > back) spot = natural + GAP >= back && last! < back ? back : null;
            if (spot !== null) {
                insert(output, { id: stack.id, position: spot });
                return true;
            }
        }
        return false;
    }
}
