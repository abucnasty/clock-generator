// node scripts/drop-spacing-diagrams.js [folder]
// Writes the diagrams of tests/game/mechanics/drop-spacing/README.md (default: that folder's images/). The slot of every hand is
// worked out the way src/config/drop-spacing.ts does: a hand that starts at tick t at place p lies at (p - v t) mod L, with L = v
// times the period, from the places and the tiles a tick that dropLines reads off the grenade sample; whether the hands fit
// is asked of dropSpacing. Needs the engine built (npm run build).
const fs = require("fs");
const path = require("path");
const { dist, loadSample } = require("./lib");
const { dropLines, dropSpacing } = dist("config/drop-spacing.js");

const PERIOD = 112;
const OUT = process.argv[2] ?? path.join(__dirname, "..", "tests", "game", "mechanics", "drop-spacing", "images");

/** The hands of the first line: [{copy, inserter (1 or 2 of the pair), slot}] for a pitch and the ticks the pair's inserters start at */
async function hands(pitch, ticks) {
    const config = await loadSample("REAL_OWNER_GRENADE");
    config.target_output.copy_offset = { x: pitch, y: 0 };
    const [line] = dropLines(config);
    const L = line.tiles_per_tick * PERIOD;
    const mod = (value) => ((value % L) + L) % L;
    const sense = line.flow; // the belt runs west: places grow toward smaller x
    const place = (inserter, copy) => sense * (inserter.along + copy * pitch * Math.sign(config.target_output.copy_offset.x));
    const origin = place(line.inserters[0], 0);
    const starts = new Map(line.inserters.map((inserter, index) => [inserter.id, [ticks[index]]]));
    const other = dropLines(config).slice(1).flatMap((it) => it.inserters.map((inserter, index) => [inserter.id, [ticks[index]]]));
    other.forEach(([id, value]) => starts.set(id, value));
    const result = [];
    for (let copy = 0; copy < config.target_output.copies; copy++) {
        line.inserters.forEach((inserter, index) => {
            result.push({ copy, which: index + 1, slot: Math.round(mod(place(inserter, copy) - origin - line.tiles_per_tick * ticks[index])) % L });
        });
    }
    const fits = dropSpacing(config, starts, PERIOD).lines.every((it) => it.fits);
    return { hands: result, fits, L, ids: line.inserters.map((it) => it.id), apart: Math.abs(line.inserters[1].along - line.inserters[0].along) };
}

const PALETTE = `
  <style>
    /* Transparent canvas; light colors below remain the fallback for static renderers. */
    @media (prefers-color-scheme: dark) {
      [fill="#1565c0"] { fill: #79b8ff; }
      [fill="#00796b"] { fill: #56d4b0; }
      [fill="#bd4c0b"] { fill: #ffab70; }
      [fill="#203047"] { fill: #e6edf3; }
      [fill="#526176"] { fill: #b3c0d0; }
      [fill="#eaf3ff"] { fill: #182c44; }
      [fill="#e3f4ef"] { fill: #17352f; }
      [fill="#fff2e7"] { fill: #36271d; }
      [stroke="#1565c0"] { stroke: #79b8ff; }
      [stroke="#00796b"] { stroke: #56d4b0; }
      [stroke="#bd4c0b"] { stroke: #ffab70; }
      [stroke="#ccd5df"] { stroke: #40516a; }
      [stroke="#8292a7"] { stroke: #91a4b8; }
    }
  </style>`;

const svg = (width, height, title, desc, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${desc}</desc>${PALETTE}
  <defs>
    <marker id="flow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
      <path d="M0 0 L6 3 L0 6" fill="#1565c0" />
    </marker>
  </defs>
  <g font-family="Arial, Helvetica, sans-serif">
${body}
  </g>
</svg>
`;
const text = (x, y, size, content, { weight = "normal", fill = "#203047", anchor } = {}) =>
    `    <text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}"${anchor ? ` text-anchor="${anchor}"` : ""}>${content}</text>`;

/** A strip of the L slots at (x, y): each slot lists the hands that land on it. Slots with two or more hands are orange. */
function strip(x, y, result, cell) {
    const out = [];
    const L = result.L;
    const bySlot = Array.from({ length: L }, () => []);
    result.hands.forEach((hand) => bySlot[hand.slot].push(hand));
    bySlot.forEach((list, slot) => {
        const cx = x + slot * cell;
        const colour = list.length > 1 ? "#bd4c0b" : list.length === 1 ? (list[0].which === 1 ? "#1565c0" : "#00796b") : "#ccd5df";
        const tint = list.length > 1 ? "#fff2e7" : list.length === 1 ? (list[0].which === 1 ? "#eaf3ff" : "#e3f4ef") : "none";
        out.push(`    <rect x="${cx}" y="${y}" width="${cell - 4}" height="70" rx="4" fill="${tint}" stroke="${colour}" />`);
        out.push(text(cx + (cell - 4) / 2, y - 6, 12, String(slot), { fill: "#526176", anchor: "middle" }));
        if (list.length === 1) {
            out.push(text(cx + (cell - 4) / 2, y + 30, 14, `copy ${list[0].copy}`, { fill: colour, weight: "bold", anchor: "middle" }));
            out.push(text(cx + (cell - 4) / 2, y + 50, 12, `inserter ${result.ids[list[0].which - 1]}`, { fill: colour, anchor: "middle" }));
        } else if (list.length > 1) {
            out.push(text(cx + (cell - 4) / 2, y + 24, 14, `${list.length} hands`, { fill: colour, weight: "bold", anchor: "middle" }));
            [1, 2].forEach((which, row) => {
                const copies = list.filter((hand) => hand.which === which).map((hand) => hand.copy).sort((one, two) => one - two);
                if (copies.length === 0) return;
                const names = copies.length > 2 ? `${copies[0]}-${copies[copies.length - 1]}` : copies.join(", ");
                out.push(text(cx + (cell - 4) / 2, y + 42 + row * 15, 11, `ins. ${result.ids[which - 1]}: copy ${names}`.replace("copy 0-", "copies 0-"), { fill: colour, anchor: "middle" }));
            });
        }
    });
    return out.join("\n");
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const together = await hands(12, [0, 0]);
    const apart14 = await hands(14, [0, 0]);
    const later8 = await hands(12, [0, 8]);
    const later16 = await hands(12, [0, 16]);
    for (const [name, r, expected] of [["12 apart", together, true], ["14 apart", apart14, false], ["8 ticks later", later8, false], ["16 ticks later", later16, true]]) {
        if (r.fits !== expected) throw new Error(`${name}: the model says fits=${r.fits}`);
        const slots = new Set(r.hands.map((h) => h.slot)).size;
        if (r.fits && slots !== r.L) throw new Error(`${name}: ${slots} slots filled of ${r.L}`);
    }
    const evens = together.hands.filter((h) => h.which === 1).map((h) => h.slot).sort((a, b) => a - b);
    const odds = together.hands.filter((h) => h.which === 2).map((h) => h.slot).sort((a, b) => a - b);

    // 1. the loop
    const loop = [
        text(20, 30, 22, "One lane of the belt in one period: 14 slots, every one filled once", { weight: "bold" }),
        text(20, 55, 15, "Grenade build: 7 copies 12 tiles apart, two inserters a copy (3 tiles apart), a turbo belt, a period of 112 ticks, a hand of 16 at stack size 4 = one tile"),
        text(20, 78, 13, "The belt moves 0.125 tiles a tick, so L = 0.125 × 112 = 14 tiles. Slot = (place − 0.125 × tick) mod 14, counted from copy 0's first inserter. The pattern repeats every period."),
        strip(20, 125, together, 78),
        `    <path d="M20 225 H1092" stroke="#1565c0" stroke-width="2" fill="none" marker-end="url(#flow)" />`,
        text(20, 247, 13, "the belt carries the pattern along; after slot 13 comes slot 0 again, in the next period", { fill: "#526176" }),
        text(20, 285, 14, `First inserters (blue) land on slots ${evens.join(", ")}: the copies' places 12 tiles apart are 0, 12, 24, ... mod 14 = even slots.`),
        text(20, 308, 14, `Second inserters (teal) land on slots ${odds.join(", ")}: 3 tiles from the first, so an odd slot.`),
        text(20, 331, 14, "All 14 slots are used once, so every hand has a stretch of belt of its own and none waits."),
    ].join("\n");
    fs.writeFileSync(path.join(OUT, "drop-spacing-loop.svg"), svg(1120, 350, "The 14 slots of one belt lane in one period",
        `Seven copies of the grenade build stand 12 tiles apart and each has two output inserters 3 tiles apart. In a 112-tick period a turbo belt moves 14 tiles, so one lane is a loop of 14 one-tile slots. The first inserters of the seven copies land on slots ${evens.join(", ")} and the second inserters on slots ${odds.join(", ")}; every slot is filled once.`, loop));

    // 2. fit against collide
    const strip2 = (label, color, result, y, cell, note) => [
        text(20, y - 28, 17, label, { weight: "bold", fill: color }),
        strip(20, y, result, cell),
        text(20, y + 95, 13, note, { fill: "#526176" }),
    ].join("\n");
    const sharedSlots = new Set(apart14.hands.map((h) => h.slot));
    const body2 = [
        text(20, 30, 22, "Copies 12 tiles apart fit; copies 14 tiles apart land on each other", { weight: "bold" }),
        text(20, 55, 14, "The same grenade build and period (L = 14 tiles). The hands of a period, wrapped around the loop of 14 slots."),
        strip2("Pitch 12 (fit)", "#1565c0", together, 120, 78, "12 mod 14 = 12, gcd(12, 14) = 2: the 7 copies take the 7 even slots, the second inserters the 7 odd slots."),
        strip2("Pitch 14 (collide)", "#bd4c0b", apart14, 275, 78, `14 mod 14 = 0, gcd(14, 14) = 14: every copy lands on the same ${sharedSlots.size} slots (${[...sharedSlots].join(" and ")}); 7 hands share a slot, the later ones wait.`),
        text(20, 420, 16, "Where a hand lands:   tile = (x − v · t) mod L,   L = v · period = 0.125 × 112 = 14 tiles", { weight: "bold" }),
        text(20, 443, 14, "x = copy × pitch + the inserter's place along the belt, t = the tick the hand starts. The pitch spreads the copies over L / gcd(pitch, L) tiles, and 7 copies need 7 of them."),
    ].join("\n");
    fs.writeFileSync(path.join(OUT, "drop-spacing-fit-collide.svg"), svg(1120, 465, "Copies 12 tiles apart fit, copies 14 tiles apart land on each other",
        `Two strips of the 14 slots of one belt lane. With the copies 12 tiles apart the first inserters land on the even slots and the second inserters on the odd slots, each slot once. With the copies 14 tiles apart every copy lands on slots ${[...sharedSlots].join(" and ")}, seven hands on each, and the later hands wait. The landing formula is tile = (x - v t) mod L with L = v times the period.`, body2));

    // 3. the start tick standing in for a tile
    const body3 = [
        text(20, 30, 22, "A start 8 ticks later is one slot further along", { weight: "bold" }),
        text(20, 55, 14, "Copies 12 tiles apart, inserters 3 tiles apart. Inserter 2 of every copy starts d ticks after inserter 1; the belt moves one tile in 8 ticks."),
        strip2("Inserter 2 starts together with inserter 1 (fit)", "#1565c0", together, 120, 78, "d = 0: the second hands are on the odd slots."),
        strip2("d = 8 ticks (collide)", "#bd4c0b", later8, 270, 78, "One slot along: the second hands now land on even slots, the first hands' slots."),
        strip2("d = 16 ticks (fit)", "#1565c0", later16, 420, 78, "Two slots along: odd slots again, so a start tick can stand in for two tiles of distance between the inserters."),
    ].join("\n");
    fs.writeFileSync(path.join(OUT, "drop-spacing-start-tick.svg"), svg(1120, 545, "A start 8 ticks later lands one slot further along",
        "Three strips of the 14 slots of one belt lane for copies 12 tiles apart. Starting the second inserter of every copy 0 ticks after the first fits, 8 ticks after puts the second hands on the first hands' slots so they collide, and 16 ticks after fits again, because the belt moves one tile in 8 ticks.", body3));
    console.log("wrote", OUT);
})();
