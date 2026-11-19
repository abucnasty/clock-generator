import assert from "../common/assert";
import { Config } from "../config";
import type { ItemName } from "../data";
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
 * (entities/belt/join/), from each copy's output inserter to the infinite end. Each copy's output inserter puts its stacks down
 * on its drop tile, with the rule of a hand that drops on a belt (LaneTraffic): a stack goes down one step past the
 * tile's middle, or 64 behind the stack ahead, and less than 64 behind the middle; else it stays in the hand. On a free
 * side belt a hand's stacks go down 0, 1, 2 and 4 ticks after it comes, as in the game; a stack is held only when the
 * side belt has backed up to its drop tile (8 stacks on the automation science 240 build, as in the game).
 *
 * The output blockage shuts the infinite end: the belt lane is blocked from draining to the belt it joins. Every lane upstream
 * backs up from there, and a hand is held only when its side belt is full. The end change acts from the tick after the
 * next, as an end that a script changes in a tick acts from the next tick in the game. So in a run of one copy too, where the
 * config states its output belt (`installOutputBeltOfOneCopy`): a hand is held once its own lane has backed up to its drop, and
 * a drop on the other lane is taken in full until that lane has (on the iron plate car build the left lane's drop is held first
 * and the right lane's never in the game's block, Factorio 2.1.24).
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
    /** The hands of each copy's output inserters, by the copy's number (from 1) */
    public readonly hands = new Map<number, OutputHand[]>();
    /** The ticks a stack takes to go down on a free drop tile, by the stacks of a hand: 0, 1, 2 and 4 for four */
    private readonly free_spans = new Map<number, number>();

    constructor(private readonly join: OutputBeltJoin, start_tick: number) {
        this.model = new JoinModel(join.layout);
        this.order = join.layout.lines.map(line => line.id);
        this.done = start_tick;
    }

    /** The numbers that the section gives a drop on the output belt (from 1) */
    public drops(): number[] {
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
     * Where a stack put down on the drop tile of the section's number `at` in this tick lands, as the distance to its line's
     * end; null where there is no room. LaneTraffic's rule, against the stacks of the drop tile's line after this tick's movement.
     */
    private landing(at: number, tick: number): { line: string; position: number } | null {
        this.advanceTo(tick);
        const drop = this.join.drops.get(at);
        assert(drop !== undefined, `Number ${at} drops on no point of the output belt`);
        const positions = this.model.positionsOn(drop.line);
        for (const stack of this.put) if (stack.line === drop.line) positions.push(stack.position);
        positions.sort((a, b) => a - b);
        let landing = drop.spot - STEP;
        for (const position of positions) if (position <= landing + STEP) landing = Math.max(landing, position + GAP);
        return landing >= drop.spot + GAP ? null : { line: drop.line, position: landing };
    }

    public hasRoom(at: number, tick: number): boolean {
        return this.landing(at, tick) !== null;
    }

    /** Puts a stack down on the drop tile of the section's number `at` in this tick, if there is room for it */
    public putDown(at: number, tick: number): boolean {
        const landing = this.landing(at, tick);
        if (landing === null) return false;
        this.put.push(landing);
        return true;
    }

    /** Records a hand of an output inserter of the copy once its last stack is down */
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

    /** Shuts the infinite end: the belt lane is blocked from draining to the belt it joins */
    public shutInfiniteEnd(tick: number): void {
        this.advanceTo(tick);
        this.shut = true;
        this.ends.push(...this.join.infinite_end_lines.map(line => ({ line, end: "shut" as const })));
    }

    /** Opens the infinite end again */
    public openInfiniteEnd(tick: number): void {
        this.advanceTo(tick);
        this.shut = false;
        this.ends.push(...this.join.infinite_end_lines.map(line => ({ line, end: "loader" as const })));
    }

    /**
     * The key of what the output belt holds, for the key of a repeated state: every line's stacks by position (not by
     * the order they were put on, which only grows), the stacks not yet given to the model, the infinite end and its change
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

    /** `at`: the inserter's number in the section; `copy`: the copy it is of (from 1) */
    constructor(private readonly run: OutputBeltRun, private readonly at: number, private readonly copy: number, private readonly holds_key: boolean,
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
        if (!this.run.putDown(this.at, tick)) return false;
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
        return this.run.hasRoom(this.at, tick);
    }

    public override stateKey(tick: number): string {
        return this.holds_key ? this.run.key(tick) : "";
    }

    public override snapshot(): readonly number[] {
        return [];
    }
}

/** The output inserters of the config, in its order: those that drop the target item onto a belt that carries it */
function outputInsertersOf(config: Config): number[] {
    const item = config.setpoint.recipe;
    const found = config.inserters.flatMap((inserter, index) => {
        if (inserter.sink.type !== "belt") return [];
        const belt = config.belts.find(it => it.id === inserter.sink.id);
        return belt !== undefined && belt.lanes.some(lane => lane.ingredient === item) ? [inserter.id ?? index + 1] : [];
    });
    assert(found.length > 0, `The output belt needs an output inserter that drops ${item} onto a belt; the config has none`);
    return found;
}

/** The output belt of a run of one copy, by the run's context, with the item it takes away (`installOutputBeltOfOneCopy`) */
const one_copy_belts = new WeakMap<SimulationContext, { item: ItemName; belt: OutputBeltRun }>();

/**
 * The output belt that `installOutputBeltOfOneCopy` put into the run of this context, with the item it takes away: an output
 * blockage of that item shuts its infinite end, as in the run of the copies. Undefined where it put none in.
 */
export function outputBeltOfOneCopy(context: SimulationContext): { item: ItemName; belt: OutputBeltRun } | undefined {
    return one_copy_belts.get(context);
}

/**
 * Puts the output belt of the config into a run of one copy (the config's own build) where its clock starts, empty, as the run
 * of the copies has it (`installSharedLanes`): a hand onto the output belt is held where the belt is, not only where its own
 * drop tile is. Where the config states no output belt, where its section is of several copies (their output belt is the run
 * of the copies'), or where its output inserters drop on belts the model does not know (other than turbo belts with stacks of
 * 4: the belt speed fixtures run a build on other tiers), the run keeps each drop tile's own lane. Null then.
 */
export function installOutputBeltOfOneCopy(context: SimulationContext, config: Config): OutputBeltRun | null {
    const run = oneCopyOutputBelt(context, config);
    if (run !== null) one_copy_belts.set(context, { item: config.setpoint.recipe, belt: run });
    return run;
}

function oneCopyOutputBelt(context: SimulationContext, config: Config): OutputBeltRun | null {
    if (config.output_belt === undefined) return null;
    const outputs = outputInsertersOf(config);
    // a section of several copies is the run of the copies' (`installSharedLanes`): its own output inserters are not all here
    const geometry = outputBeltGeometry(config.output_belt, copySpacingOf(config.setpoint.copy_offset) ?? 0);
    const numbers = [...geometry.drops.map(drop => drop.copy),
        ...geometry.side_loads.flatMap(load => "side_belt_of_copy" in load.sender ? [load.sender.side_belt_of_copy] : [])];
    if (numbers.some(number => number > outputs.length)) return null;
    const modelled = outputs.every(id => {
        const inserter = context.inserters.find(it => it.entity_id.id === EntityId.forInserter(id).id);
        const belt_state = inserter && context.state_registry.getStateByEntityIdOrThrow(inserter.inserter_state.inserter.sink.entity_id);
        return belt_state !== undefined && EntityState.isBelt(belt_state)
            && belt_state.belt.belt_speed === BeltSpeed.TURBO_TRANSPORT_BELT && belt_state.lanes.every(lane => lane.stack_size === 4);
    });
    return modelled ? putOutputBelt(context, config) : null;
}

/**
 * Puts the output belt of the config into a run of the copies before its first tick: each output inserter that the section
 * names gets a drop slot on the output belt in place of its own local tile. Null where the config states no output belt.
 * A number of the section names a copy's output inserter: with k output inserters a copy, number n is the
 * ((n - 1) mod k + 1)-th of copy floor((n - 1) / k) + 1, so with one it is the copy.
 */
export function installOutputBelt(context: SimulationContext, config: Config): OutputBeltRun | null {
    assert(context.tick_provider.getCurrentTick() === 0, "The output belt goes in before the first tick");
    return putOutputBelt(context, config);
}

/** The output belt, put in at the tick the run stands at: empty, from there on */
function putOutputBelt(context: SimulationContext, config: Config): OutputBeltRun | null {
    if (config.output_belt === undefined) return null;
    const now = () => context.tick_provider.getCurrentTick();
    const join = outputBeltJoinOf(outputBeltGeometry(config.output_belt, copySpacingOf(config.setpoint.copy_offset) ?? 0));
    const run = new OutputBeltRun(join, now());
    const outputs = outputInsertersOf(config);
    run.drops().forEach((at, index) => {
        const copy = Math.floor((at - 1) / outputs.length) + 1;
        const inserter_id = EntityId.forInserter(copyNumberOf(copy - 1, outputs[(at - 1) % outputs.length])).id;
        const inserter = context.inserters.find(it => it.entity_id.id === inserter_id);
        assert(inserter !== undefined, `The output belt names output inserter ${at}, which the run of the copies does not hold`);
        const belt_state = context.state_registry.getStateByEntityIdOrThrow(inserter.inserter_state.inserter.sink.entity_id);
        assert(EntityState.isBelt(belt_state), `${inserter_id} does not drop on a belt`);
        assert(belt_state.belt.belt_speed === BeltSpeed.TURBO_TRANSPORT_BELT && belt_state.lanes.every(lane => lane.stack_size === 4),
            "The model of the output belt knows turbo belts with stacks of 4 only");
        const held = () => inserter.inserter_state.held_item?.quantity ?? 0;
        belt_state.lanes.forEach((lane, lane_at) => lane.seedDrop(inserter_id,
            new OutputBeltDrop(run, at, copy, index === 0 && lane_at === 0, held, lane.stack_size, belt_state.belt.belt_speed)));
    });
    return run;
}
