import {beltPickupClockTestsAt} from "../../tests/game/builds/belt-pickup-clock-generation";

// the belt pickup clocks on the normal belt; the other tiers are in the files beside this one, so that a shard of the
// generation tests does not wait on all four
beltPickupClockTestsAt("normal");
