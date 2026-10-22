import { Percentage } from "../../data-types";

export interface MiningProductivity {
    readonly productivity: Percentage;
}


/**
 * The force's mining productivity bonus for `level` levels of mining productivity research: 10% a level, as the game
 * gives it (`force.mining_drill_productivity_bonus` is level x 0.1). The sidecar exports that number of levels.
 */
function createFromResearchLevel(level: number): MiningProductivity {
    return {
        productivity: new Percentage(level * 10)
    };
}


export const MiningProductivity = {
    fromLevel: createFromResearchLevel
}
