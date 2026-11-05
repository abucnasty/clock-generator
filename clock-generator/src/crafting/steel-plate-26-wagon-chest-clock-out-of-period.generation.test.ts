import {steelWagonClockTests} from "../../tests/game/builds/steel-plate-26-wagon-chest-clock-generation";

// the clock of the steel build with items left out of the period: it generates a build of its own, which takes about
// as long as all the rest of steel-plate-26-wagon-chest-clock.generation.test.ts
steelWagonClockTests(variant => variant.ignored_lcm_ingredients !== undefined);
