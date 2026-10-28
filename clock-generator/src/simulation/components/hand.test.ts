import { describe, test, expect, vi } from "vitest"
import { mock } from 'vitest-mock-extended';
import { EntityState, InserterState, InserterStatus, MachineState } from "../../state"
import { InserterArchetype } from "../archetypes/inserter"
import { TransportBelt } from "../archetypes/transport-belt"
import { BeltStrategy } from "../../common/entity-types"
import { EntityId, Inserter, InserterMetadata, InserterStackSize, InserterTarget, Machine, MachineSpec, RecipeMetadata } from "../../entities"
import { ItemName } from "../../data/factorio-data-types"
import { InserterAnimation } from "../../entities/inserter/inserter-animation"
import { InserterAnimationOverrideConfig } from "../../config/schema"
import { AlwaysEnabledControl, EnableControl } from "../controls/enable-control";
import { MutableTickProvider } from "../current-tick-provider";
import { BeltSpeed, Lane } from "../../entities/belt";
import { InserterPhase } from "../status-codes";
import { ContainerStorage } from "./container-storage";
import { Hand, HandReason, HandScratch, STAY } from "./hand";
import { bindHandPorts } from "./hand-ports";
import { reasonText } from "../../state/reason-table";


/** A turbo belt built by hand for a test, with the gate every belt has: nothing withheld, nothing refused */
function beltOf(lanes: Lane[] = [{ ingredient_name: "iron-plate", stack_size: 4 }]): TransportBelt {
    return TransportBelt.create({ entity_id: EntityId.forBelt(-1), belt_speed: BeltSpeed.TURBO_TRANSPORT_BELT, strategy: BeltStrategy.NORMAL, lanes });
}

/** The inserter's Hand, bound as its archetype binds it, under `enable_control` */
function handOf(inserter_state: InserterState, source_state: EntityState, sink_state: EntityState, enable_control: EnableControl = AlwaysEnabledControl): Hand {
    return InserterArchetype.create({ inserter_state, source_state, sink_state, tick_provider: new MutableTickProvider(), enable_control }).hand;
}

describe("an inserter's Hand (belt to machine)", () => {

    interface TestContext {
        inserterState: InserterState,
        sourceState: EntityState,
        sinkState: EntityState,
    }

    const createMachine = (recipeName: string, metadata: Partial<MachineSpec> = {}): Machine => {
        const id = -1;
        return Machine.createMachine(id, {
            crafting_speed: 1,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName(recipeName),
            ...metadata,
        })
    }

    const createInserter = (args: {
        source: InserterTarget,
        sink: InserterTarget,
        stack_size?: InserterStackSize,
        filters?: ItemName[]
    }): Inserter => {
        const {
            source,
            sink,
            stack_size = InserterStackSize.SIZE_16,
            filters = []
        } = args;

        const overrides: InserterAnimationOverrideConfig = {}
        const metadata = InserterMetadata.create(
            source.entity_id.type,
            sink.entity_id.type,
            stack_size,
            filters,
            overrides
        )
        const inserter: Inserter = {
            entity_id: EntityId.forInserter(-1),
            metadata: metadata,
            animation: InserterAnimation.fromMetadata(metadata.animation),
            source: source,
            sink: sink,
            filtered_items: new Set(filters),
        }
        // These transition tests start with a fully backed-up ordinary belt.
        if (EntityId.isBelt(source.entity_id)) {
            inserter.pickup_length = 1;
            inserter.belt_supply = "backed_up";
        }
        return inserter;
    }

    const createTestContext = (): TestContext => {
        const mockSource: TransportBelt = beltOf();

        const mockSink: MachineState = MachineState.forMachine(
            createMachine("iron-gear-wheel")
        )
        return {
            sourceState: mockSource,
            sinkState: mockSink,
            inserterState: InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                filters: ["iron-plate"]
            }))
        }
    }

    describe("its idle rule", () => {

        test("starts a pickup when it can pick up", () => {
            const testContext = createTestContext();
            const hand = handOf(testContext.inserterState, testContext.sourceState, testContext.sinkState);

            expect(hand.rule()).toBe(InserterPhase.PICKUP);
        })

        test("stays idle when the inputs are over the automated insertion limit of the machine", () => {
            const testContext = createTestContext();
            const hand = handOf(testContext.inserterState, testContext.sourceState, testContext.sinkState);

            const machineState = testContext.sinkState as MachineState;
            const automated_insertion_limit = machineState.machine.inputs.get("iron-plate")!.automated_insertion_limit;
            machineState.inventoryState.setQuantity("iron-plate", automated_insertion_limit.quantity);

            expect(hand.rule()).toBe(STAY)
        })

        test("stays idle when the target machine is output blocked", () => {
            const testContext = createTestContext();
            const hand = handOf(testContext.inserterState, testContext.sourceState, testContext.sinkState);

            const machineState = testContext.sinkState as MachineState;
            const output_block_quantity = machineState.machine.output.outputBlock.held_limit;
            machineState.inventoryState.setQuantity("iron-gear-wheel", output_block_quantity);

            expect(hand.rule()).toBe(STAY)
        })
    })

    // same-tick rule 12
    describe("at a control swap", () => {

        test("sets every field of its scratch record back to what a new record holds", () => {
            const fresh = new HandScratch();
            const scratch = new HandScratch();
            const other = (value: unknown) => value === null ? 3 : typeof value === "number" ? value + 3
                : typeof value === "boolean" ? !value : typeof value === "string" ? `${value}coal` : null;
            for (const [field, value] of Object.entries(fresh)) {
                (scratch as unknown as Record<string, unknown>)[field] = other(value);
                expect((scratch as unknown as Record<string, unknown>)[field], field).not.toEqual(value);
            }
            scratch.reset();
            expect(scratch).toEqual(fresh);
        })

        test("starts at IDLE with its scratch set back, and leaves what the hand holds, the status as written and the wait flag", () => {
            const testContext = createTestContext();
            const state = testContext.inserterState;
            const hand = handOf(state, testContext.sourceState, testContext.sinkState);
            const scratch = hand.scratch;
            hand.phase = InserterPhase.WAITING_FOR_SINK;
            Object.assign(scratch, { pickup_ticks: 2, belt_grab_decided: false, saw_sink_blocked: true, reason: HandReason.SINK_TAKES_NO_MORE });
            const held = { item_name: "iron-plate", quantity: 8 };
            Object.assign(state, { held_item: held, status: InserterStatus.WAITING_FOR_SINK, waits_for_sink: true });

            hand.resetForSwap();

            expect(hand.phase).toBe(InserterPhase.IDLE);
            expect(hand.scratch).toBe(scratch);
            expect(scratch).toEqual(new HandScratch());
            expect([state.held_item, state.status, state.waits_for_sink]).toEqual([held, InserterStatus.WAITING_FOR_SINK, true]);
            expect(state.held_item).toBe(held);
        })
    })

    // A reason's text is made only when an observer that records it asks (P4 section 8), so this checks every code
    // whether or not a run's observers ask for it
    describe("its reasons", () => {

        test("give a text for every code, a template's with the item and the quantity, and fail on a code with none", () => {
            const testContext = createTestContext();
            const hand = handOf(testContext.inserterState, testContext.sourceState, testContext.sinkState);
            const textOf = (reason: number) => {
                Object.assign(hand.scratch, { reason, reason_item: "iron-plate", reason_quantity: 7 });
                return reasonText(hand.reasonId());
            };
            const texts = Object.values(HandReason).map(textOf);

            expect(new Set(texts).size).toBe(Object.values(HandReason).length);
            expect(textOf(HandReason.MACHINE_HAS)).toBe("machine has 7 of iron-plate to pickup");
            expect(textOf(HandReason.INSERTER_ENABLED)).toBe("inserter enabled");
            expect(() => textOf(-1)).toThrow("No reason has the code -1");
            expect(() => textOf(Object.values(HandReason).length)).toThrow();
        })
    })

    // An inserter that waits for space in a machine is asleep and acts in the tick after the one that wakes it.
    // Recorded in Factorio 2.1.21 on inserters that take from a machine or a chest and had waited 6 ticks or more for a
    // machine at its output block, at the tick another inserter took its products down: the first items a tick later
    // in 5,777 cases of 5,777 where the machine finished no craft the tick before, in the same tick in 3,756 of 3,756
    // where it did. On the advanced circuit scaffold: the output inserter took 16 advanced circuits at sample 230 of
    // the recording of the evenly spaced windows (28 down to 12, block 21), and the cable and the plastic inserter of
    // that plant, waiting since 221 and 224, took their hands at 231.
    describe("an inserter that waits for space in a machine whose products another inserter takes", () => {
        /**
         * `window_opens_at`: the tick a window of a clock of the game opens, before which the inserter is disabled;
         * `decider_build_order`: where that clock's decider stands in the order the clock's deciders are built
         */
        const setup = (source_state: EntityState, window_opens_at?: number, decider_build_order?: number) => {
            const sink = MachineState.forMachine(createMachine("transport-belt"));
            const inserter_state = InserterState.createIdle(createInserter({
                source: { entity_id: source_state.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                sink: { entity_id: sink.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                filters: ["iron-gear-wheel"],
            }));
            let tick = 0;
            const window_control = window_opens_at === undefined ? AlwaysEnabledControl : {
                is_game_clock: true,
                decider_build_order,
                isEnabled: () => tick >= window_opens_at,
                isEnabledIn: (ticks: number) => tick + ticks >= window_opens_at,
            };
            // its Hand stays in its idle phase: each look runs the idle rule, whatever it gives
            const hand = handOf(inserter_state, source_state, sink, window_control);
            const block = sink.machine.output.outputBlock;
            return {
                sink,
                /** The inserter looks at its sink in a tick */
                look: () => { tick += 1; return hand.rule(); },
                /** The machine ends a tick with its output at the block */
                endTickAtTheBlock: (finished_craft: boolean) => {
                    sink.inventoryState.setQuantity(block.item_name, block.ingredients_blocked_at);
                    sink.wakes.outputBlockedAfterLastTick = true;
                    sink.wakes.finishedCraftInLastTick = finished_craft;
                },
                /** An output inserter, which is updated first, takes the products in the tick the inserter looks next */
                takeProducts: () => sink.inventoryState.setQuantity(block.item_name, 0),
                /** The machine ends a tick with its output under the block */
                endTickUnderTheBlock: () => { sink.wakes.outputBlockedAfterLastTick = false; sink.wakes.finishedCraftInLastTick = false; },
            };
        };
        const machineWithGears = (): MachineState => {
            const source = MachineState.forMachine(createMachine("iron-gear-wheel"));
            source.inventoryState.setQuantity("iron-gear-wheel", 50);
            return source;
        };

        test("takes its first items a tick after the products are taken", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(STAY);
            takeProducts();
            expect(look()).toBe(STAY);
            endTickUnderTheBlock();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("takes them in the tick the products are taken when the machine finished a craft the tick before", () => {
            const { look, endTickAtTheBlock, takeProducts } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(STAY);
            endTickAtTheBlock(true);
            takeProducts();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("is not held up when it only looks in the tick the products are taken: its arm came back, or its window opened", () => {
            const { look, endTickAtTheBlock, takeProducts } = setup(machineWithGears());
            endTickAtTheBlock(false);
            takeProducts();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("waits a tick once: products taken again in the tick after do not hold it up again", () => {
            const { look, endTickAtTheBlock, takeProducts } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(STAY);
            takeProducts();
            expect(look()).toBe(STAY);
            // the machine was back at its block when that tick was done, and is emptied again
            endTickAtTheBlock(false);
            takeProducts();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        // An inserter whose window of a clock of the game opens in a tick shows as enabled in the tick before and waits in
        // it. Recorded in Factorio 2.1.21 on the accumulator build of issue 152 and on the scaffolds, for inserters
        // that take from a machine and whose window opens in the tick another inserter takes the products of the
        // machine they put into down from its block: the first items a tick later in 1,158 cases of 1,170 where the
        // inserter that took the products was enabled before, also where the machine finished a craft the tick before
        // (44 of 44). Where that inserter's window opened too, the game updates the inserter of the last built decider
        // first (#268): in the tick of the take where the taker's decider was built after this one's, a tick later
        // where before, 9,189 of 9,189 windows over fifteen runs, each clock also built in reverse and renumbered.
        test("takes its first items a tick later when its window opens in the tick the products are taken", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(machineWithGears(), 2);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            expect(look()).toBe(STAY);
            endTickUnderTheBlock();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("takes its first items a tick later when its window opens as the products are taken, though a craft finished the tick before", () => {
            const { look, endTickAtTheBlock, takeProducts } = setup(machineWithGears(), 2);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            endTickAtTheBlock(true);
            takeProducts();
            expect(look()).toBe(STAY);
        })

        test("takes them in the tick they are taken when the window of the inserter that takes them opens in that tick too, its decider built after this one's", () => {
            const { sink, look, endTickAtTheBlock, takeProducts } = setup(machineWithGears(), 2, 1);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            sink.wakes.windowOpeningTakeDecider = 2;
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("takes them a tick later when the window of the inserter that takes them opens in that tick too, its decider built before this one's", () => {
            const { sink, look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(machineWithGears(), 2, 1);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            sink.wakes.windowOpeningTakeDecider = 0;
            expect(look()).toBe(STAY);
            endTickUnderTheBlock();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("takes them a tick later where the order of its own decider or the taker's is not known", () => {
            for (const [own, taker] of [[undefined, 2], [1, -1]] as const) {
                const { sink, look, endTickAtTheBlock, takeProducts } = setup(machineWithGears(), 2, own);
                endTickAtTheBlock(false);
                expect(look()).toBe(InserterPhase.DISABLED);
                takeProducts();
                sink.wakes.windowOpeningTakeDecider = taker;
                expect(look()).toBe(STAY);
            }
        })

        test("is not held up when its window opens after the machine was cleared", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(machineWithGears(), 3);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            endTickUnderTheBlock();
            expect(look()).toBe(InserterPhase.DISABLED);
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("leaves an inserter that takes from a belt to its pickup phase, which lands the first stack a tick later", () => {
            const belt: TransportBelt = beltOf();
            const { look, endTickAtTheBlock, takeProducts } = setup(belt);
            endTickAtTheBlock(false);
            expect(look()).toBe(STAY);
            takeProducts();
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        // Recorded in Factorio 2.1.21 on the thaeln scaffold (clock-generator/.scratch/geppetto/apprentice-m4-decider-latency.md):
        // a belt-fed inserter that is enabled while its machine is at its output block, and whose machine another
        // inserter takes down from the block, grabs 2 ticks after its enable (waiting for space, waiting for items, then
        // the hand grows); the simulator took 1.
        test("takes its first items from a belt 2 ticks after its window opens on a machine at its output block, where a hand not started by a window takes 1", () => {
            const belt = () => beltOf();
            /** Looks after the products are taken: the index of the first look that starts the pickup */
            const firstPickupLook = (window_opens_at?: number) => {
                const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(belt(), window_opens_at);
                endTickAtTheBlock(false);
                expect(look()).toBe(window_opens_at === undefined ? STAY : InserterPhase.DISABLED);
                takeProducts();
                const picks_up: boolean[] = [];
                for (let index = 0; index < 3; index++) {
                    picks_up.push(look() === InserterPhase.PICKUP);
                    endTickUnderTheBlock();
                }
                return picks_up.indexOf(true);
            };
            expect(firstPickupLook(undefined)).toBe(0);
            expect(firstPickupLook(2)).toBe(1);
        })

        // A belt-fed inserter goes by the same order (#268): where #267 found the taker's drop target deciding it
        // (a tick later in 1,327 of 1,327 windows where the taker drops onto a belt, in the tick in 602 of 602 where
        // into a machine or a chest), each was the order the generator builds the deciders in; built the other way,
        // the same windows flip, onto a belt and into a machine alike (chemical science: 82 and 166 swap sides).
        test("takes its first items from a belt in the tick the products are taken when the inserter that takes them, its window opening in that tick too, has its decider built after this one's", () => {
            const belt: TransportBelt = beltOf();
            const { sink, look, endTickAtTheBlock, takeProducts } = setup(belt, 2, 0);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            sink.wakes.windowOpeningTakeDecider = 1;
            expect(look()).toBe(InserterPhase.PICKUP);
        })

        test("takes its first items from a belt a tick later when the inserter that takes them, its window opening in that tick too, has its decider built before this one's", () => {
            const belt: TransportBelt = beltOf();
            const { sink, look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock } = setup(belt, 2, 1);
            endTickAtTheBlock(false);
            expect(look()).toBe(InserterPhase.DISABLED);
            takeProducts();
            sink.wakes.windowOpeningTakeDecider = 0;
            expect(look()).toBe(STAY);
            endTickUnderTheBlock();
            expect(look()).toBe(InserterPhase.PICKUP);
        })
    })

    // the pickup phase's step: the pickup port of the hand's source, bound as its archetype binds it
    describe("its pickup (belt to machine)", () => {

        test("stops picking up from belt once stack size is reached", () => {
            const mockSource: TransportBelt = beltOf([
                { ingredient_name: "iron-plate", stack_size: 4 }
            ]);

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const stack_size = InserterStackSize.SIZE_12;
            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: stack_size,
                filters: ["iron-plate"]
            }));

            const ticks = new MutableTickProvider();
            const pickup = bindHandPorts({
                tick_provider: ticks,
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            }).pickup;

            // First pickup: 0 + 4 = 4
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(4);

            // Second pickup: 4 + 4 = 8
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Third pickup: 8 + 4 = 12 (should reach stack size)
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(12);

            // Fourth pickup: should not exceed stack size of 12
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(12);
            expect(inserterState.held_item?.quantity).toBeLessThanOrEqual(stack_size);
        })

        test("holds a partly filled hand while the machine's output is at the block, and goes on once it is under", () => {
            const mockSource: TransportBelt = beltOf([
                { ingredient_name: "iron-plate", stack_size: 4 }
            ]);

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: InserterStackSize.SIZE_16,
                filters: ["iron-plate"]
            }));

            const ticks = new MutableTickProvider();
            const pickup = bindHandPorts({
                tick_provider: ticks,
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            }).pickup;

            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(4);

            // the machine's output reaches the block: the hand waits with what it holds
            const block = mockSink.machine.output.outputBlock;
            mockSink.inventoryState.addQuantity(block.item_name, block.held_limit);
            ticks.incrementTick();
            pickup.pickup();
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(4);

            // the output drops under the block and the inserter comes back from waiting: one tick to decide, then the next stack
            mockSink.inventoryState.removeQuantity(block.item_name, 1);
            pickup.enter(InserterPhase.WAITING_FOR_SINK);
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(4);
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Again at the block, and this time the machine finished a craft in the tick before its products are taken:
            // that had woken the inserter, and the next stack lands in the tick they are taken. Recorded in Factorio
            // 2.1.21: 248 hands of 248 went on in that tick, 843 of 843 a tick later without a craft the tick before.
            mockSink.inventoryState.addQuantity(block.item_name, 1);
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(8);
            mockSink.wakes.outputBlockedAfterLastTick = true;
            mockSink.wakes.finishedCraftInLastTick = true;
            mockSink.inventoryState.removeQuantity(block.item_name, 1);
            pickup.enter(InserterPhase.WAITING_FOR_SINK);
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(12);
        })

        // Recorded in Factorio 2.1.21 on the accumulator build of issue 152 and on the scaffolds: an inserter that takes
        // from a machine and holds part of a hand took nothing more while the machine it puts into was at its output
        // block, in 20,701 samples of 20,701 with products to take, and took more in 11,561 of 11,561 where it was not.
        test("holds a partly filled hand from a machine while the machine it puts into is at its block", () => {
            const source = MachineState.forMachine(createMachine("iron-gear-wheel"));
            const sink = MachineState.forMachine(createMachine("transport-belt"));
            const inserter_state = InserterState.createIdle(createInserter({
                source: { entity_id: source.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                sink: { entity_id: sink.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                filters: ["iron-gear-wheel"],
            }));
            const pickup = bindHandPorts({ inserterState: inserter_state, sourceState: source, sinkState: sink }).pickup;
            source.inventoryState.setQuantity("iron-gear-wheel", 5);
            pickup.pickup();
            expect(inserter_state.held_item?.quantity).toBe(5);

            const block = sink.machine.output.outputBlock;
            sink.inventoryState.setQuantity(block.item_name, block.ingredients_blocked_at);
            source.inventoryState.setQuantity("iron-gear-wheel", 5);
            pickup.pickup();
            expect(inserter_state.held_item?.quantity).toBe(5);

            sink.inventoryState.setQuantity(block.item_name, 0);
            pickup.pickup();
            expect(inserter_state.held_item?.quantity).toBe(10);
        })

        test("caps pickup quantity when remaining capacity is less than lane stack size", () => {
            const mockSource: TransportBelt = beltOf([
                { ingredient_name: "iron-plate", stack_size: 4 }
            ]);

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const stack_size = InserterStackSize.SIZE_10;
            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: stack_size,
                filters: ["iron-plate"]
            }));

            const ticks = new MutableTickProvider();
            const pickup = bindHandPorts({
                tick_provider: ticks,
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            }).pickup;

            // First pickup
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(4);

            // Second pickup
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Third pickup
            ticks.incrementTick();
            pickup.pickup();
            expect(inserterState.held_item?.quantity).toBe(10);
            expect(inserterState.held_item?.quantity).toBeLessThanOrEqual(stack_size);
        })

        test("skips blocked belt item and picks next available unblocked item", () => {
            const mockSource: TransportBelt = beltOf([
                { ingredient_name: "iron-plate", stack_size: 4 },
                { ingredient_name: "copper-cable", stack_size: 4 },
            ]);

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("electronic-circuit")
            );

            const ironPlateInsertionLimit = mockSink.machine.inputs
                .getOrThrow("iron-plate")
                .automated_insertion_limit
                .quantity;
            mockSink.inventoryState.setQuantity("iron-plate", ironPlateInsertionLimit);

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                filters: ["iron-plate", "copper-cable"]
            }));

            const ticks = new MutableTickProvider();
            const pickup = bindHandPorts({
                tick_provider: ticks,
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            }).pickup;

            ticks.incrementTick();
            pickup.pickup();

            expect(inserterState.held_item?.item_name).toBe("copper-cable");
            expect(inserterState.held_item?.quantity).toBe(4);
        })

        test("skips blocked chest item and picks next available unblocked item", () => {
            const quantity = (itemName?: string) => itemName === "iron-plate" || itemName === "copper-cable" ? 100 : 0;
            const take = vi.fn();
            const mockSource: ContainerStorage = mock<ContainerStorage>({
                entity_id: EntityId.forChest(-1),
                getCurrentQuantity: quantity,
                has: (itemName: string) => quantity(itemName) >= 1,
                take,
                getItemFilters: () => ["iron-plate", "copper-cable"],
            });

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("electronic-circuit")
            );

            const ironPlateInsertionLimit = mockSink.machine.inputs
                .getOrThrow("iron-plate")
                .automated_insertion_limit
                .quantity;
            mockSink.inventoryState.setQuantity("iron-plate", ironPlateInsertionLimit);

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                filters: ["iron-plate", "copper-cable"]
            }));

            const pickup = bindHandPorts({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            }).pickup;

            pickup.pickup();

            expect(inserterState.held_item?.item_name).toBe("copper-cable");
            expect(inserterState.held_item?.quantity).toBeGreaterThan(0);
            // taken through the chest's pickup port
            expect(take).toHaveBeenCalledWith("copper-cable", inserterState.held_item?.quantity);
        })
    })
})
