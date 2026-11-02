/**
 * Whether a target that counts an item destroyed gets windows of results (result-windows.ts), by arithmetic over the
 * registry: the decision the build plan records and the cycle plan of such a target is made from
 * (`CraftingCyclePlan.create`, crafting-cycle.ts). A plan of whole hands where the takers' hands come out whole in a
 * period the container holds, or where the windows cannot be planned; else one window a period for each result, on the
 * longest period the containers hold.
 */
import assert from "../../common/assert";
import type { ConfigOverrides } from "../../config";
import type { Config } from "../../config/schema";
import type { ResultWindowsDecision, ResultWindowsTerms } from "../../data-types/build-plan";
import Fraction, { fraction } from "../../data-types/fraction";
import { Entity, handSizeFor, Machine, ReadableEntityRegistry } from "../../entities";
import { RESULT_WINDOWS_LONGEST_PERIOD_TICKS, resultsFitContainer, resultWindowsFeasible, resultWindowsPlan, sharedHandRefusal } from "../result-windows";
import { destroyedTargetBalance, transfersOfBalance } from "../sequence/cycle/cycle-transfers";
import { destroyedTargetCrafts, EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { targetInsertersOf, targetMachinesOf } from "../sequence/cycle/target-ends";
import type { TargetProductionRate } from "../target-production-rate";

/** Hands of the target item a target machine is brought in a cycle can be this many at most, for a cycle of whole ticks */
const MAX_DESTROYED_CYCLE_HANDS = 1000;

/** What the cycle of a destroyed target is made of: the machines that destroy it, the hand, and the fewest hands of a cycle */
export interface DestroyedTargetBasis {
    readonly item: string;
    readonly machines: readonly Machine[];
    readonly hand: number;
    /** Ticks a hand lasts at the target rate of one machine */
    readonly ticks_per_hand: Fraction;
    /** The fewest hands brought into each machine that last a whole number of ticks */
    readonly base_hands: number;
    /** The hands a cycle the config sets (`overrides.terminal_swing_count`) */
    readonly forced: number | undefined;
}

/**
 * The machines, the hand and the fewest hands of a cycle of a destroyed target: a cycle is the fewest hands of the item
 * brought into each machine that last a whole number of ticks at the target rate
 */
export function destroyedTargetBasisOf(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    config_overrides: Partial<ConfigOverrides>,
): DestroyedTargetBasis {
    const item = target_production_rate.machine_production_rate.item;
    const target = { item, counts: target_production_rate.counts };
    const machines = targetMachinesOf(target, entity_registry);
    assert(machines.length > 0, `No machine takes ${item} in from outside the build to destroy it`);
    const hand = handSizeFor(targetInsertersOf(machines[0], target, entity_registry)[0], item);
    const per_machine_rate = target_production_rate.machine_production_rate.amount_per_tick.divide(machines.length);
    const ticks_per_hand = fraction(hand).divide(per_machine_rate);
    let base_hands = 1;
    while (base_hands < MAX_DESTROYED_CYCLE_HANDS && ticks_per_hand.multiply(base_hands).getDenominator !== 1) {
        base_hands++;
    }
    return { item, machines, hand, ticks_per_hand, base_hands, forced: config_overrides.terminal_swing_count };
}

/**
 * The decision of a destroyed target: windows of results or whole hands, with its terms. Throws where an inserter takes
 * several results out of where a machine places them, which can stop the build for good.
 */
export function resultWindowsDecisionOf(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    config: Config,
    config_overrides: Partial<ConfigOverrides>,
    basis: DestroyedTargetBasis = destroyedTargetBasisOf(target_production_rate, entity_registry, config_overrides),
): ResultWindowsDecision {
    const { item, machines, hand, ticks_per_hand, base_hands, forced } = basis;
    for (const machine of machines) {
        const shared = sharedHandRefusal(machine, entity_registry);
        if (shared !== null) {
            throw new Error(shared);
        }
    }
    const craftsOf = (machine: Machine, hands: number) => destroyedTargetCrafts(machine, entity_registry, item, fraction(hands * hand)).toDecimal();
    const whole_hands = forced ?? base_hands;
    const whole_transfers = transfersOfBalance(destroyedTargetBalance([...machines], entity_registry, config, item, fraction(whole_hands),
        (machine, brought) => destroyedTargetCrafts(machine, entity_registry, item, brought)), entity_registry);
    const cycle_ticks = ticks_per_hand.multiply(base_hands).toDecimal();
    const crafts_per_cycle = (machine: Machine) => craftsOf(machine, base_hands);
    const whole_fits = wholeHandsFit(whole_transfers, ticks_per_hand.multiply(whole_hands).toDecimal(), machines, entity_registry,
        machine => craftsOf(machine, whole_hands));
    // asked only where whole hands do not fit, as the plan asks it
    const feasible = whole_fits ? null
        : machines.every(machine => resultWindowsFeasible(machine, entity_registry, cycle_ticks, crafts_per_cycle(machine)));
    const terms: ResultWindowsTerms = {
        item,
        machines: machines.map(machine => machine.entity_id.number),
        hand,
        ticks_per_hand: { numerator: ticks_per_hand.getNumerator, denominator: ticks_per_hand.getDenominator },
        base_hands,
        forced: forced ?? null,
        cycle_ticks,
        whole_hands_fit: whole_fits,
        windows_feasible: feasible,
        longest_period_ticks: RESULT_WINDOWS_LONGEST_PERIOD_TICKS,
    };
    if (whole_fits || feasible === false) {
        return { kind: "whole-hands", hands: whole_hands, terms };
    }
    // the results come too rarely: one window a period for each, on the longest period the containers hold
    assert(forced === undefined || forced % base_hands === 0,
        `${forced} hands of ${item} a cycle do not last whole ticks: the windows of results that come this rarely need a multiple of ${base_hands}`);
    const cycles = forced !== undefined ? forced / base_hands : Math.min(...machines.map(machine =>
        resultWindowsPlan({ machine, registry: entity_registry, cycle_ticks, crafts_per_cycle: crafts_per_cycle(machine), kind: "staggered" }).cycles));
    const plans = machines.map(machine =>
        resultWindowsPlan({ machine, registry: entity_registry, cycle_ticks, crafts_per_cycle: crafts_per_cycle(machine), kind: "staggered", cycles }));
    return { kind: "result-windows", hands: base_hands * cycles, cycles, terms, plans };
}

/**
 * Whether the takers' hands of a destroyed target's plan come out whole in a period the windows of results can be
 * planned on, and each machine's container holds what that period gives in all but 1 in 740 periods (every result
 * counted over the whole period): then the period is simulated as any other. Where not, the results get one window a
 * period each (result-windows.ts).
 */
function wholeHandsFit(
    transfers: EntityTransferCountMap,
    cycle_ticks: number,
    machines: readonly Machine[],
    entity_registry: ReadableEntityRegistry,
    craftsOf: (machine: Machine) => number,
): boolean {
    return machines.every(machine => {
        const results = new Set(machine.outputs.map(output => output.item_name));
        let cycles = 1;
        for (const planned of transfers.values()) {
            if (Entity.isInserter(planned.entity) && planned.entity.source.entity_id.id === machine.result_target?.id
                && planned.item_transfers.some(transfer => results.has(transfer.item_name))) {
                const denominator = planned.total_transfer_count.getDenominator;
                cycles = cycles / gcd(cycles, denominator) * denominator;
            }
        }
        return cycles * cycle_ticks <= RESULT_WINDOWS_LONGEST_PERIOD_TICKS
            && resultsFitContainer(machine, entity_registry, cycle_ticks, craftsOf(machine), cycles);
    });
}

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}
