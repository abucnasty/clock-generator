import {overHoodClockTestsAt} from "../../tests/game/builds/over-hood-clock-generation";

// the over-the-hood clocks on the fast belt; the other tiers are in the files beside this one, so that a shard of the
// generation tests does not wait on all four
overHoodClockTestsAt("fast");
