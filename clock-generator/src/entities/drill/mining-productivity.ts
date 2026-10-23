import { Percentage } from "../../data-types";

/** A drill's mining productivity: the force's mining productivity research and its productivity modules together */
export interface MiningProductivity {
    readonly productivity: Percentage;
}
