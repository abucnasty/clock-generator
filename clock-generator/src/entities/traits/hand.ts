import { FactorioDataService } from "../../data";
import { fullResearchHandSize, isBulkInserter } from "../inserter/metadata/inserter-spec";

/** What an inserter moves of an item a swing */
export interface HandItem {
    readonly item: string;
    readonly hand: number;
}

/** An inserter's hand */
export interface HandTrait {
    readonly prototype: string;
    readonly quality: string;
    /** The config's `stack_size`, else the research hand: what the game reads as the inserter's stack size */
    readonly nominal: number;
    /** 1, plus the prototype's bonus, plus the research of its kind: 16, 12 or 4; quality does not change it */
    readonly research: number;
    /**
     * What it moves of each item it carries, the hand the simulator moves: the nominal hand, cut to the item's stack, and
     * rounded down to whole belt stacks where it drops on a belt lane (effectiveHandSize)
     */
    readonly by_item: readonly HandItem[];
    /** The items it carries, in the order it takes them (its nearest lane first where it names it) */
    readonly items: readonly string[];
    /**
     * Whether it waits for a full hand before it swings: at a machine that places its results itself, and elsewhere.
     * Filled from the prototype's `bulk` as the simulator decides it today (pickup-mode-transition-evaluator.ts);
     * decision 9e would fill it from `wait_for_full_hand` instead.
     */
    readonly full_hand: { readonly at_placing_source: boolean; readonly elsewhere: boolean };
    /** The prototype's `wait_for_full_hand` (spec default false), recorded beside `full_hand` and read by nothing yet */
    readonly wait_for_full_hand: boolean;
    /** The prototype's `grab_less_to_match_belt_stack` (spec default false); read by nothing yet */
    readonly grab_less_to_match_belt_stack: boolean;
    /** The prototype's `max_belt_stack_size` (spec default 1); read by nothing yet */
    readonly max_belt_stack_size: number;
}

export function inserterHand(prototype: string, quality: string, nominal: number, hand_sizes: ReadonlyMap<string, number>): HandTrait {
    const data = FactorioDataService.findInserterOrThrow(prototype);
    return {
        prototype,
        quality,
        nominal,
        research: fullResearchHandSize(prototype),
        by_item: Array.from(hand_sizes, ([item, hand]) => ({ item, hand })),
        items: Array.from(hand_sizes.keys()),
        full_hand: { at_placing_source: isBulkInserter(prototype), elsewhere: true },
        wait_for_full_hand: data.wait_for_full_hand ?? false,
        grab_less_to_match_belt_stack: data.grab_less_to_match_belt_stack ?? false,
        max_belt_stack_size: data.max_belt_stack_size ?? 1,
    };
}
