import {steelWagonClockTests} from "../../tests/game/builds/steel-wagon-clock-generation";

// the clock of the steel build with items left out of the period: it generates a build of its own, which takes about
// as long as all the rest of steel-wagon-clock.generation.test.ts
steelWagonClockTests(variant => variant.ignored_lcm_ingredients !== undefined);
