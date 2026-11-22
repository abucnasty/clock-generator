import type { Ratio } from "../entities/traits/ratio";
import {
    SECONDS_PER_TICK,
    TICKS_PER_SECOND
} from "./constants"

export class Duration {
    /** Present for a window cycle derived from an exact setpoint. */
    declare exact_ticks?: Ratio;

    public static ofTicks(ticks: number, exact?: Ratio): Duration {
        const duration = new Duration(
            ticks,
            SECONDS_PER_TICK.multiply(ticks).toDecimal()
        );
        if (exact) duration.exact_ticks = exact;
        return duration;
    }
    public static ofSeconds(seconds: number): Duration {
        return new Duration(
            TICKS_PER_SECOND.multiply(seconds).toDecimal(),
            seconds
        );
    }
    public static zero: Duration = this.ofTicks(0)

    constructor(
        public readonly ticks: number,
        public readonly seconds: number
    ) { }

    public add(other: Duration): Duration {
        return Duration.ofTicks(this.ticks + other.ticks);
    }

    public subtract(other: Duration): Duration {
        return Duration.ofTicks(this.ticks - other.ticks);
    }
}