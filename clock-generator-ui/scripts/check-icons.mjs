// Fails when public/icons lacks an icon the page always draws (see icon-names.mjs), and names the icons no name of
// the page asks for.
import { readdirSync } from 'node:fs';
import { ICONS_DIR, iconNames } from './icon-names.mjs';

const { requested, required } = iconNames();
const present = new Set(readdirSync(ICONS_DIR).filter(file => file.endsWith('.png')).map(file => file.slice(0, -'.png'.length)));

const unused = [...present].filter(name => !requested.has(name)).sort();
if (unused.length > 0) {
    console.warn(`Icons in public/icons that no name asks for: ${unused.join(', ')}`);
}

const missing = [...required].filter(name => !present.has(name)).sort();
if (missing.length > 0) {
    console.error(`Icons the page draws that public/icons is missing: ${missing.join(', ')}`);
    process.exit(1);
}

const drawn = [...requested].filter(name => present.has(name)).length;
console.log(`public/icons has the ${required.size} icons the page always draws, and icons for ${drawn} of the ${requested.size} names it can ask for`);
