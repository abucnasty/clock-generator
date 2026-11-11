import assert from "../common/assert";
import { Config } from "../config";
import { copySpacingOf, outputBeltGeometry } from "../config/output-belt";
import { BeltSpeed } from "../entities/belt";
import { EndChange, JoinModel, PutOn } from "../entities/belt/join/join-model";
import { GAP, STEP } from "../entities/belt/join/join-rules";
import { OutputBeltJoin, outputBeltJoinOf } from "../entities/belt/join/output-belt-join";
import { EntityId } from "../entities";
import { EntityState } from "../state/entity-state";
import { LaneTraffic } from "../state/lane-traffic";
import { copyNumberOf } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";

/**
 * The output belt of a config in the run of the copies: every stack on it moves each tick in the join model
 * (entities/belt/join/), from each copy's output inserter to the outlet. Each copy's output inserter puts its stacks down
 * on its drop tile, with the rule of a hand that drops on a belt (LaneTraffic): a stack goes down one step past the
 * tile's middle, or 64 behind the stack ahead, and less than 64 behind the middle; else it stays in the hand. On a free
 * side belt a hand's stacks go down 0, 1, 2 and 4 ticks after it comes, as in the game; a stack is held only when the
 * side belt has backed up to its drop tile (8 stacks on the automation science 240 build, as in the game).
 *
 * The output blockage shuts the outlet: the belt lane is blocked from draining to the belt it joins. Every lane upstream
 * backs up from there, and a hand is held only when its side belt is full. The end change acts from the tick after the
 * next, as an end that a script changes in a tick acts from the next tick in the game.
 *
 * The join model takes an inserter's drop after the tick's movement. A hand that puts a stack down in tick t sees the
 * stacks as they stand after the movement of tick t; its stack is then given to the model as put on before the movement
 * of tick t + 1, which places it the same: it stands where it was put in tick t and moves in tick t + 1.
 */

/** One hand of a copy's output inserter: the tick of its first try to put a stack down, of its last stack, and its stacks */
export interface OutputHand {
    readonly arrival: number;
    readonly last: number;
    readonly stacks: number;
}

/** The output belt as a run of the copies has it */
export class OutputBeltRun {
    private readonly model: JoinModel;
    private readonly order: readonly string[];
    /** The last tick whose movement the model has made */
    private done: number;
    /** Stacks put down in tick `done`, after its movement */
    private put: { line: string; position: number }[] = [];
    /** End changes made in tick `done`: given with the next tick, they act from the tick after it */
    private ends: EndChange[] = [];
    private shut = false;
    /** Each copy's hands, by the copy's number in the section (from 1) */
    public readonly hands = new Map<number, OutputHand[]>();
    /** The ticks a stack takes to go down on a free drop tile, by the stacks of a hand: 0, 1, 2 and 4 for four */
    private readonly free_spans = new Map<number, number>();

    constructor(private readonly join: OutputBeltJoin, start_tick: number) {
        this.model = new JoinModel(join.layout);
        this.order = join.layout.lines.map(line => line.id);
        this.done = start_tick;
    }

    /** The copies with a drop on the output belt, by their number in the section (from 1) */
    public copies(): number[] {
        return [...this.join.drops.keys()].sort((a, b) => a - b);
    }

    /** Makes the movement of every tick up to `tick` */
    private advanceTo(tick: number): void {
        assert(tick >= this.done, "The output belt cannot move backwards in time");
        while (this.done < tick) {
            const put_ons: PutOn[] = this.put.map(it => ({ ...it, time: "before-movement" }));
            this.model.tick({ put_ons, end_changes: this.ends });
            this.put = [];
            this.ends = [];
            this.done++;
        }
    }

    /**
     * Where a stack put down on the copy's drop tile in this tick lands, as the distance to its line's end; null where
     * there is no room. LaneTraffic's rule, against the stacks of the drop tile's line after this tick's movement.
     */
    private landing(copy: number, tick: number): { line: string; position: number } | null {
        this.advanceTo(tick);
        const drop = this.join.drops.get(copy);
        assert(drop !== undefined, `Copy ${copy} drops on no point of the output belt`);
        const positions = this.model.positionsOn(drop.line);
        for (const stack of this.put) if (stack.line === drop.line) positions.push(stack.position);
        positions.sort((a, b) => a - b);
        let landing = drop.spot - STEP;
        for (const position of positions) if (position <= landing + STEP) landing = Math.max(landing, position + GAP);
        return landing >= drop.spot + GAP ? null : { line: drop.line, position: landing };
    }

    public hasRoom(copy: number, tick: number): boolean {
        return this.landing(copy, tick) !== null;
    }

    /** Puts a stack down on the copy's drop tile in this tick, if there is room for it */
    public putDown(copy: number, tick: number): boolean {
        const landing = this.landing(copy, tick);
        if (landing === null) return false;
        this.put.push(landing);
        return true;
    }

    /** Records a hand of the copy's output inserter once its last stack is down */
    public handDone(copy: number, hand: OutputHand): void {
        this.hands.set(copy, [...this.hands.get(copy) ?? [], hand]);
    }

    /**
     * Whether a hand took longer to go down than it does on a free drop tile: it was held, as the side belt was full. The
     * free span comes from the same rule on an empty line.
     */
    public held(hand: OutputHand): boolean {
        let free = this.free_spans.get(hand.stacks);
        if (free === undefined) {
            const spot = 128;
            let positions: number[] = [];
            let tick = 0;
            for (let down = 0; down < hand.stacks; tick++) {
                if (tick > 0) positions = positions.map(position => position - STEP);
                let landing = spot - STEP;
                for (const position of [...positions].sort((a, b) => a - b)) if (position <= landing + STEP) landing = Math.max(landing, position + GAP);
                if (landing < spot + GAP) {
                    positions.push(landing);
                    down++;
                }
            }
            free = tick - 1;
            this.free_spans.set(hand.stacks, free);
        }
        return hand.last - hand.arrival > free;
    }

    /** Shuts the outlet: the belt lane is blocked from draining to the belt it joins */
    public shutOutlet(tick: number): void {
        this.advanceTo(tick);
        this.shut = true;
        this.ends.push(...this.join.outlet_lines.map(line => ({ line, end: "shut" as const })));
    }

    /** Opens the outlet again */
    public openOutlet(tick: number): void {
        this.advanceTo(tick);
        this.shut = false;
        this.ends.push(...this.join.outlet_lines.map(line => ({ line, end: "loader" as const })));
    }

    /**
     * The key of what the output belt holds, for the key of a repeated state: every line's stacks by position (not by
     * the order they were put on, which only grows), the stacks not yet given to the model, the outlet and its change
     */
    public key(tick: number): string {
        this.advanceTo(tick);
        const by_line = new Map<string, number[]>();
        for (const stack of this.model.stacks()) {
            const positions = by_line.get(stack.line);
            if (positions === undefined) by_line.set(stack.line, [stack.position]);
            else positions.push(stack.position);
        }
        const lines = this.order.flatMap((id, index) => {
            const positions = by_line.get(id);
            return positions === undefined ? [] : [`${index}:${positions.sort((a, b) => a - b).join(",")}`];
        });
        const put = this.put.map(it => `${this.order.indexOf(it.line)}:${it.position}`).sort().join(",");
        return `${this.shut ? "shut" : "open"};${this.ends.map(it => it.end).join(",")};${put};${lines.join(" ")}`;
    }

    /** The stacks on the output belt, by line, for a reader */
    public stacks(tick: number): ReturnType<JoinModel["stacks"]> {
        this.advanceTo(tick);
        return this.model.stacks();
    }
}

/**
 * A copy's output inserter's drop slot on its belt's lane, in place of its own local tile (BeltLane.seedDrop): its
 * stacks go onto the output belt. One drop of the run holds the output belt's key, so that the state of the run holds it
 * once (simulationStateKey reads each hand's drop slot).
 */
export class OutputBeltDrop extends LaneTraffic {
    private in_hand = false;
    private arrival = 0;
    private stacks = 0;
    private last = 0;

    constructor(private readonly run: OutputBeltRun, private readonly copy: number, private readonly holds_key: boolean,
        private readonly held: () => number, private readonly stack_items: number, belt_speed: BeltSpeed) {
        super(belt_speed);
    }

    public override registerSpot(): void { }

    public override tryPlace(tick: number): boolean {
        if (!this.in_hand) {
            this.in_hand = true;
            this.arrival = tick;
            this.stacks = 0;
        }
        if (!this.run.putDown(this.copy, tick)) return false;
        this.stacks++;
        this.last = tick;
        // the hand is empty once this stack leaves it
        if (this.held() <= this.stack_items) {
            this.in_hand = false;
            this.run.handDone(this.copy, { arrival: this.arrival, last: this.last, stacks: this.stacks });
        }
        return true;
    }

    public override hasRoom(tick: number): boolean {
        return this.run.hasRoom(this.copy, tick);
    }

    public override stateKey(tick: number): string {
        return this.holds_key ? this.run.key(tick) : "";
    }

    public override snapshot(): readonly number[] {
        return [];
    }
}

/** The output inserter of the config: the one that drops the target item onto a belt that carries it */
function outputInserterOf(config: Config): number {
    const item = config.setpoint.recipe;
    const found = config.inserters.flatMap((inserter, index) => {
        if (inserter.sink.type !== "belt") return [];
        const belt = config.belts.find(it => it.id === inserter.sink.id);
        return belt !== undefined && belt.lanes.some(lane => lane.ingredient === item) ? [inserter.id ?? index + 1] : [];
    });
    assert(found.length === 1, `The output belt needs one output inserter that drops ${item} onto a belt; the config has ${found.length}`);
    return found[0];
}

/**
 * Puts the output belt of the config into a run of the copies before its first tick: each copy that the section names
 * gets a drop slot on the output belt in place of its own local tile. Null where the config states no output belt.
 */
export function installOutputBelt(context: SimulationContext, config: Config): OutputBeltRun | null {
    if (config.output_belt === undefined) return null;
    const now = () => context.tick_provider.getCurrentTick();
    assert(now() === 0, "The output belt goes in before the first tick");
    const join = outputBeltJoinOf(outputBeltGeometry(config.output_belt, copySpacingOf(config.setpoint.copy_offset) ?? 0));
    const run = new OutputBeltRun(join, now());
    const inserter_number = outputInserterOf(config);
    run.copies().forEach((copy, index) => {
        const inserter_id = EntityId.forInserter(copyNumberOf(copy - 1, inserter_number)).id;
        const inserter = context.inserters.find(it => it.entity_id.id === inserter_id);
        assert(inserter !== undefined, `The output belt names copy ${copy}, which the run of the copies does not hold`);
        const belt_state = context.state_registry.getStateByEntityIdOrThrow(inserter.inserter_state.inserter.sink.entity_id);
        assert(EntityState.isBelt(belt_state), `${inserter_id} does not drop on a belt`);
        assert(belt_state.belt.belt_speed === BeltSpeed.TURBO_TRANSPORT_BELT && belt_state.lanes.every(lane => lane.stack_size === 4),
            "The model of the output belt knows turbo belts with stacks of 4 only");
        const held = () => inserter.inserter_state.held_item?.quantity ?? 0;
        belt_state.lanes.forEach((lane, at) => lane.seedDrop(inserter_id,
            new OutputBeltDrop(run, copy, index === 0 && at === 0, held, lane.stack_size, belt_state.belt.belt_speed)));
    });
    return run;
}
