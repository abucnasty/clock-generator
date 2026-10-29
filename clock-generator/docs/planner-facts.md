# Planner facts

`toPlannerFacts(config)` (`src/crafting/facts/to-planner-facts.ts`) gives a build's traits (`src/entities/traits/`) as
plain nodes and edges, the input of the planner graph and the feasibility pass of 0.25.0. It reads the traits and the
config's layout (which entity an inserter takes from and drops into, where it drops on a belt), never the state of an
entity. Nothing in a generation calls it yet. The types are in `src/data-types/planner-facts.ts`, exported from the
light entry, and each sample's facts are kept in `src/crafting/facts/__snapshots__/<KEY>.facts.json`.

- **Nodes**, in the entity registry's order (`src/crafting/sequence/simulation-context.ts`) with the inserters, which
  are edges, left out: the two sides of every belt, belt by belt (`belt:2/lane:1`, `belt:2/lane:2`; a belt that lists
  one lane has a second side at the first lane's stack), machines (`machine:3`), containers (`chest:4`: chests,
  infinity chests, cars, tanks, wagons and silos) and drills (`drill:1`). Ties are broken by this order. A node carries
  its traits field for field: production (with the most crafts a second, `speed / energy_required`, exact in the
  configured float), yield, input limits, output block, recipe selection, placement, energy, spoilage and loop for a
  machine; storage for a container; the lane for a lane.
- **No item on a lane** has two values: `""` on a listed lane that carries nothing, `null` on the unlisted second side.
  Treat both as no item.
- **Inserter edges**, one for each item an inserter carries (`inserter:5/iron-plate`), from the node it takes from to
  the node it drops into. The edges of one inserter share its capacity group, and `capacity_groups` lists each group's
  edges with their hands and floor cycles, so that the rates of a group obey the sum of rate x cycle / (60 x hand) <= 1.
  An edge from a belt names the lane it takes the item from (its nearest lane where both carry it) and every lane that
  carries it (`from_lanes`). An edge onto a belt drops on the lane of the config's drop spot where it names one, else on
  the lane its hand of the item is rounded to. `lands_in` says where the item goes: a machine's ingredients or fuel slot,
  a container, a silo's input slots or a lane.
- **Fuel by edge.** An item that is both an ingredient and a machine's fuel lands in `"ingredients"` and feeds the fuel
  too. Fuel comes by edge wherever an in-edge carries the machine's `energy.fuel.item`, whatever its `lands_in`.
- **Placement edges**, one for each result of a machine that places its results itself or of a drill, into its target
  (`placement:drill:1/iron-ore`), with `lands_in` (a machine's ingredients, a container, a silo's input slots; null
  where the target takes none and the result stays in the placer). A placer without a target has none. A placement edge
  has no bound of its own: its source's production bounds it.
- **Planned and floor figures are kept apart.** `planned` is today's swing as the strategies count it (pickup, drop,
  cycle and what that moves a second). `floor` is the fewest ticks a pickup, drop and swing ever take: 1 at a machine or
  chest, a belt stack a tick at a belt, the swing `pickup + 2 x rotation + drop`. `ceiling` is `hand x 60 / floor cycle`,
  exact. The hand is the one the simulator moves of the item (`hand.by_item`), beside the nominal and research hands.
  The floors and the ceiling are the timing and throughput traits' own, except on a drop spot that is not the lane the
  hand is rounded to: there the drop floor is counted on the drop spot's lane. No sample has such a drop yet; the test
  lists any that does.
- **Standings.** Each floor carries its standing (`floor_standing`, from `TRAIT_BASIS`). A floor whose standing is below
  "measured" is null, as is a belt pickup by an inserter whose belt pickup is not calibrated, and nothing may refuse a
  build on a null.
- **Export demand is per belt and item.** `export_per_second` is set per lane, but the demand to check is the sum over
  the lanes of one belt that carry the item, filled by every edge onto any of those lanes
  (`src/crafting/export-delivery.ts`): both lanes of a belt may export an item that every filler drops on one of them.
- **Read-only.** A node's trait fields are the objects of the traits built for that call.

**The planner reads the same traits** where it works a figure out of a build (`traitsOf(config)`,
`src/entities/traits/traits-of.ts`: `buildTraits` once per config object, kept with it; a candidate's or a trial's
config is a new object and gets its own): the output capacity of the machines that make the target (`yield` of each,
its main product's exact rate), the machines' rates at the target (`yield`, `production`, `placement` and the takers'
`hand`), the sinks whose terminal outputs are judged as a rate or get room for one more output swing
(`storage.never_refuses`). The lane check reads what a
lane carries off the Lane traits of the belt it checks, and the belt pickup slack and the room for a hand of fuel count
a hand as the timing floor does, one belt stack a tick, each with the hand it reads (the nominal one and the hand of the
fuel). The cycle plan (`swing-counts.ts`) reads the same figures off the entities, which build them with the trait
functions: it runs on a registry, and the amounts a craft it divides by are exact fractions there, decimals in the traits.

Two traits of the catalogue are not in the facts: the inserter order (its decider build order is the clock's, not the
config's) and the wake-up rule of a node (read by the wake-up count only). Neither the graph nor the feasibility pass
reads them; they come with the planner that does.

`machineFactsOf` (`src/entities/traits/machine-facts-of.ts`) gives a machine's facts for the UI and the insights from its
traits, and nothing else makes them: a result's `machine_facts` (`machineFactsOfEntity`, each machine's traits built once from
the configuration its entity keeps) and the UI's facts query (`computeMachineFacts`, from a machine's parameters) both project
traits, and a test holds both to the traits `buildTraits` builds from the config, for every machine of every sample.
