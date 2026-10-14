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
- biochambers with their energy consumption bonus, and mining drills with their speed bonus
- inserters: what each takes from and drops into, its stack size and filters
- belts and the items on each lane, and chests with what they hold
- a suggested target: the product that leaves your selection and how much of it the machines make at most per second

Inserters that take from or drop into something the text does not have are listed in the window with the text, with
why, and left out of it.

## Notes

- Needs Factorio 2.1.
- Source and bug reports: <https://github.com/abucnasty/clock-generator>
