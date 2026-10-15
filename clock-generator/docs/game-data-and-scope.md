# Game data and what is not modelled yet

This page holds what the generator reads from the game and what it refuses by name; GOALS.md holds the goals.

The generator reads the game's recipes, items, drills and resources from a dump of Factorio 2.1.21 (build 87673, `resources/data-version.json`, since 0.14.0; before that an older 2.0 dump that still named the ore melting recipes `molten-iron` and `molten-copper`). 2.1 gives a recipe a list of crafting categories; the generator reads the list, and the only thing it does with it is tell a biochamber from an assembler in an older sidecar's export. The game's version the data comes from is recorded beside it and printed in the header of `npm run calls`, so a call can be told from one made on other data.

A config describes one copy of a build, and `copies` is the number of identical copies, with no inserter between copies and the belts shared; it may be fractional (5.5) when the build holds a partial block, planned as that fraction of one block's rate and read as an exact fraction, so a whole number or a short decimal (`src/config/schema.ts`). A config that holds several identical copies is refused and told to describe one (`src/config/copies-validator.ts`): the smallest repeating unit is what is planned, never a block of hundreds of inserters.

What the generator does not model is refused by name, with where it is on the roadmap (`docs/ROADMAP.md`), so that a user and the config writer know whether to wait or to work around it:
- A recipe whose only products are fluids (ore melting, acid, oil cracking): follow-up F1, a fluid rate model for the drills and inserters feeding it. Fluid ingredients are dropped from a recipe and the machine is taken to be fed; whether that lets the model's foundry run faster or slower than the game's is a question of milestone M1.
- A car, tank or cargo wagon as a chest, and a rocket silo as a chest or as the machine crafting rocket parts: milestone M2.
- Recyclers and per-quality output: milestone M3. The recycler's recipe data (`shared_probability` per result) is in the dump and read as a result's expected amount (the slice's width); the recycler's output on the tile in front, and its per-quality tiers, are not modelled.
- Inserters other than the legendary stack inserter (since 0.14.0, `prototype` and `quality` in the config): their swing between machines and chests and their hand come from the game data by the rule in [rules-of-the-game.md](rules-of-the-game.md) (measured once); picking up from and dropping onto a belt keep the legendary stack inserter's timing (follow-up F7), and every kind waits for a full hand as the stack inserter does, although the game data gives only the stack inserter `wait_for_full_hand`. The burner inserter is refused. The sidecar and the web form do not carry the two fields yet.
- Latches and sensors switching an inserter: not modelled and not compared; such an inserter is one to clock.

