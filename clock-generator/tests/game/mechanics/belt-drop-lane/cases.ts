/** One inserter of probe.lua dropping from a chest onto a straight belt */
export interface LaneCase {
    name: string;
    /** The way the belt runs */
    direction: "north" | "east" | "south" | "west";
    /** left, right: beside the belt, dropping across it; back: behind its first tile, dropping along it; front: ahead of its last tile, dropping against it */
    side: "left" | "right" | "back" | "front";
    inserter: "inserter" | "stack-inserter";
    item: string;
}

/** One game run: the belts built side by side, logged every tick */
export interface LaneRun {
    name: string;
    ticks: number;
    force?: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number; belt_stack_size_bonus: number};
    scenarios: LaneCase[];
}

const DIRECTIONS = ["north", "east", "south", "west"] as const;
const SIDES = ["left", "right", "back", "front"] as const;
const INSERTERS = ["inserter", "stack-inserter"] as const;
/** Two items, to show that the lane does not depend on what the hand carries */
const ITEMS = ["iron-plate", "copper-plate"] as const;

const own = (): LaneCase[] => DIRECTIONS.flatMap(direction => SIDES.flatMap(side => INSERTERS.flatMap(inserter => ITEMS.map((item): LaneCase =>
    ({name: `${direction}-${side}-${inserter}-${item}`, direction, side, inserter, item})))));

export const LANE_RUNS: LaneRun[] = [
    // the save's research: a basic inserter's hand is 4, a stack inserter's 16, a belt stack of 4
    {name: "default", ticks: 600, scenarios: own()},
    // no research: hands of 1 and 5, a belt stack of 1
    {name: "plain", ticks: 600, force: {inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0}, scenarios: own()},
];
