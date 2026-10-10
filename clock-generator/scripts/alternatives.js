// node scripts/alternatives.js <KEY> [on|off] [swings]
// The potential clocks of a sample, the selected one starred: verdict, rate, wake-ups a minute, belt. <on|off> is
// "Belts do not move" (off by default); [swings] forces the output swings per cycle on every clock.
const [key, belts = "off", swings] = process.argv.slice(2);
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, clockBeltLabel } = dist("crafting/generate-blueprint.js");

(async () => {
    const config = await loadSample(key, belts === "on");
    if (swings !== undefined) {
        config.overrides = { ...config.overrides, terminal_swing_count: Number(swings) };
    }
    const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
    alternatives.forEach((a, index) => console.log(
        index === selected_index ? "*" : " ", a.id.padEnd(28), a.is_stable ? "stable  " : "UNSTABLE", `${a.items_per_second.toFixed(2)}/s`.padEnd(10),
        `wake ${a.wake_ups_per_minute?.toFixed(1) ?? "-"}`.padEnd(13), (a.belt ? clockBeltLabel(a.belt) : "-").padEnd(18), a.label));
})().catch(e => { console.error(e); process.exit(1); });
