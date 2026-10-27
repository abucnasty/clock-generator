import {frontPickupClockTestsAt} from "../../tests/game/builds/front-pickup-clock-generation";

// the front pickup clocks on the turbo belt; the other tiers are in the files beside this one, so that a shard of the
// generation tests does not wait on all four
frontPickupClockTestsAt("turbo");
