// Fails when public/icons lacks an icon the page always draws (see icon-names.mjs), or holds a file no name of the
// page asks for. The names the game data offers but no icon is drawn for (mod items, hidden recipes, barrels) are fine.
import { readdirSync } from 'node:fs';
import { ICONS_DIR, iconNames, recyclingIcons } from './icon-names.mjs';

const { requested, required } = iconNames();
// leaving out the hidden files an OS puts there, like .DS_Store
const files = readdirSync(ICONS_DIR).filter(file => !file.startsWith('.'));
const present = new Set(files.filter(file => file.endsWith('.png')).map(file => file.slice(0, -'.png'.length)));
let failed = false;

const unused = files.filter(file => !file.endsWith('.png') || !requested.has(file.slice(0, -'.png'.length))).sort();
if (unused.length > 0) {
    console.error(`Files in public/icons that no name asks for: ${unused.join(', ')}`);
    failed = true;
}

const missing = [...required].filter(name => !present.has(name)).sort();
if (missing.length > 0) {
    console.error(`Icons the page draws that public/icons is missing: ${missing.join(', ')}`);
    failed = true;
}

// a recycling recipe is drawn with the item's picture and the recycling arrows: it has an icon wherever its item has one
const withoutRecyclingIcon = recyclingIcons().filter(({ icon, item }) => present.has(item) && !present.has(icon)).map(({ icon }) => icon).sort();
if (withoutRecyclingIcon.length > 0) {
    console.error(`Recycling recipes whose item has an icon but that have none: ${withoutRecyclingIcon.join(', ')}`);
    failed = true;
}

if (failed) {
    process.exit(1);
}

const drawn = [...requested].filter(name => present.has(name)).length;
console.log(`public/icons has the ${required.size} icons the page always draws, and icons for ${drawn} of the ${requested.size} names it can ask for`);
