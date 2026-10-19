import { BeltPickupMergeConfig } from "../config/schema";
import { BeltSpeed } from "../entities/belt";
import { BeltSideFeedTraffic, SideFeedSnapshot } from "./belt-side-feed-traffic";
export type {SideFeedSnapshot as MergeSnapshot, SideFeedStack as MergeStack} from "./belt-side-feed-traffic";

/** Supported two-stream geometry; the shared traffic kernel also serves single-stream side feeds. */
export class BeltPickupMerge extends BeltSideFeedTraffic {
    constructor(public readonly config: BeltPickupMergeConfig, backed_up = false, initial?: SideFeedSnapshot, refill = true) {
        super({streams: {outer: config.outer, inner: config.inner}, downstream_tiles: config.downstream_tiles,
            outlet: config.outlet, belt_speed: BeltSpeed.TURBO_TRANSPORT_BELT}, backed_up, initial, refill);
    }
}
