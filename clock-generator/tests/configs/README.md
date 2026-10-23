# Configs kept for tests

Configs that tests generate from and that are not samples (`resources/config-samples/`): the blast and the sweeps do not
take them.

- `issue-100-electromagnetic-science-buffer-chest.json`: the config attached to
  [issue #100](https://github.com/abucnasty/clock-generator/issues/100) as
  `clock-config-electromagnetic-science-pack-1791649778665.json`, unchanged. Its output goes into a buffer chest that
  nothing empties, which fills up: no clock holds. `src/crafting/why-not-stable.generation.test.ts` checks that the
  result names the chest.
