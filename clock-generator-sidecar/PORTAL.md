Copy a Factorio build as text for the **Clock Generator** website: <https://clock-generator-self.vercel.app>

The website works out a circuit clock for your inserters, so the build makes the rate you want while its inserters wake
up as seldom as possible, and gives you a blueprint of the clock to place.

## How to use it

1. Press Alt+E (or click the shortcut button) to pick up the selection tool.
2. Drag over the machines, inserters, belts and chests of one build.
3. Click **Copy JSON**. The text is already selected: press Ctrl+C.
4. Open <https://clock-generator-self.vercel.app> and click **Paste from Factorio**.

## What it copies

- machines and furnaces: recipe, crafting speed (with modules and beacons) and productivity (with research)
- biochambers with their energy consumption bonus, and mining drills with their speed bonus and productivity
- inserters: what each takes from and drops into, its kind, quality, stack size and filters (none when they are switched off; a blacklist, which the website refuses, is marked)
- belts and the items on each lane, and chests with what they hold
- cars, tanks, cargo wagons and rocket silos as chests: a wagon's quality, slot filters, what they hold, and a silo's recipe quality, crafting speed and productivity
- belt pickup reach and preferred lane, including inline pickups downstream of underground entrances and exits, and upstream across an exit's hood, where flipping the inserter changes its preferred lane
- a warning for each belt pickup it cannot describe, which the website then refuses: bends, splitters, belt tiles that another belt side-loads onto, and inline or other pickup geometry it does not support
- a suggested target: the product that leaves your selection and how much of it the machines make at most per second

Inserters that take from or drop into something the text does not have are listed in the window with the text, with
why, and left out of it.

## Notes

- Needs Factorio 2.1.
- Source and bug reports: <https://github.com/abucnasty/clock-generator>

### Pickup capture compatibility

Belt-fed inserters include a persistent supported/unsupported classification, native source identity and a
versioned model declaration where supported. The generator retains this information when saving a build.
Old or unsupported captures require a fresh supported capture before generation; updating the mod alone
does not update copied JSON or a saved build.

Splitters and side-loading are out of scope: an inserter that picks up from a splitter, or from a belt tile that
another belt side-loads onto, is marked unsupported. The website refuses it.
