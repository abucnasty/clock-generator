# Clock Generator UI

The web front end of the Factorio clock generator: a React and Vite app for building a config, validating it and
generating clocks as blueprints.

It depends on the engine in `../clock-generator` through a `file:` dependency and imports it as
`clock-generator/browser`. Generation runs in a pool of web workers, so the page stays responsive while clocks are
simulated.

## Commands

Install with `npm install`. The dev server needs the engine built first (`npm run build` in `../clock-generator`).

- `npm run dev` starts the Vite dev server.
- `npm run build` runs `build:deps`, which installs and builds the engine, then type checks and builds the site into
  `dist/`.
- `npm run lint` runs ESLint; `npm run lint:fix` fixes what it can.
- `npm run preview` serves the built `dist/`.
- `node scripts/copy-factorio-data.mjs` copies the game data and the example builds ("Try an example") from
  `../clock-generator/resources` into `public/`. It runs before `dev` and `build`; run it by hand when npm's
  `ignore-scripts` is on.

## Words in the UI

One word per idea in every string a player reads. New copy uses these terms; the "use instead of" column lists what they
replace. The words of the engine's own text (clock names and descriptions, the Insights prose) are not covered yet.

| Term | Definition | Use instead of |
|---|---|---|
| swing | One trip of an inserter: it picks something up and drops it. | transfer, trip, "hand" for a trip |
| swing plan | How many swings each inserter makes per crafting cycle. | transfer plan |
| crafting cycle | The short stretch of time the plan is built around. In one crafting cycle each output inserter makes a set number of swings. | cycle, output cycle |
| clock period | How long until the clock repeats: a whole number of crafting cycles. Shown in ticks. | period, LCM period |
| wake window | A stretch of ticks during which the clock switches an inserter on. | window, clock window, inserter window, enable range |
| wake-up (provisional) | One time the game wakes an inserter that is switched on and waiting, because a machine finished a craft. Each is a small check that moves little or nothing, so fewer wake-ups cost less UPS. | "one start of a wake window" |
| start point | The place in the clock period where the clock starts. | "one start of the clock" |
| copies | How many identical copies of your build you will place. "Copy" stays a verb ("Copy blueprint"). | copy as any other noun |
| build | The machines, inserters, belts and chests you set up, which the clocks are made for. Saved as a build file (Open build file…, Save build file, Reset build). | configuration, config |
| Your builds | The builds kept in this browser, one per name. | library, saved configs |
| share link | A link that carries a copy of a build; opening it adds the build to Your builds. | permalink, URL |
| clock | The set of combinators that switches your inserters on in their wake windows and repeats every clock period. The tool makes several and recommends one. | potential clock |
| blueprint | The Factorio string you paste in the game. It holds a clock's combinators, not your build. | "blueprint" for a clock or a build |
| check | Test that your build can be clocked, without making any clocks. The Validate button and its chips keep their names until the Check only rework (2.3). | validation, "run a simulation", "re-run the simulation" (in sentences) |
| enable rule ("rule" for short) | The rule that says when an inserter or drill is switched on. Modes: Auto, Always on, Never on, Clocked, Conditional. | enable control, override (only Advanced Overrides keeps "override"), AUTO, ALWAYS, NEVER, CLOCKED, CONDITIONAL |
| assembling machine | The Type option for an ordinary crafting machine (the others are Furnace and Biochamber). "Machine" stays the word for any of the three. | assembler, machine as a type |
| holds the rate | The clock makes the target rate for as long as nothing runs out and nothing backs up. | "meets the target rate" |
| starved | An input runs out. | input loss |
| jammed | The output is blocked and backs up. | backpressure loss |
| recovers | After the build is starved or jammed, it gets back to its rate by itself. | survives backpressure loss, no recovery |
| belt slack | Extra ticks added to a wake window so a late pickup from a moving belt can still finish. | belt pickup slack |
| simulator | The tool's own model of your build, used to test each clock. It is not Factorio. | simulation, for a button press |
| LCM (expert) | The number of crafting cycles in one clock period. Only in the Swing Plan and Advanced Overrides, glossed where it first appears. | LCM cycles, LCM period |
| hand | What an inserter is holding right now. Only for the load, never for the trip. | hand for a swing |

Kept as they are: tick, UPS, combinator, insertion limit, Sidecar mod, Configure and Results, Generate, Stack Size and
"Copy old clock…". Until the Results rework (2.5), the clock table's Status column still says Stable, Unstable and No
recovery, and the engine's clock names and Insights prose keep their old words.
