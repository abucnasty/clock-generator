# Configs kept for tests

Configs that tests generate from and that are not samples (`resources/config-samples/`): the blast and the sweeps do not
take them.

- `issue-100-electromagnetic-science-buffer-chest.json`: the config attached to
  [issue #100](https://github.com/abucnasty/clock-generator/issues/100) as
  `clock-config-electromagnetic-science-pack-1791649778665.json`, unchanged. Its output goes into a buffer chest that
  nothing empties, which fills up: no clock holds. `src/crafting/why-not-stable.generation.test.ts` checks that the
  result names the chest.
- `bursts-solid-fuel-rocket-fuel.json`: a build made for the grouped hands rule's bursts. A chemical plant that holds a
  stack of 50 solid fuel and makes 0.4 a tick fills one rocket fuel assembler with ten hands of 16 a period of 600 ticks
  (1.6 rocket fuel a second). One run of the ten hands draws 160 where the plant can give at most 50 + 0.4 x 72, and one
  machine cannot be split into groups, so only hands in bursts with pauses for the plant to refill serve it.
  `src/crafting/candidates/hand-walks.test.ts` checks the bursts the rule makes.
