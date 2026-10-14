// The page fetches /data-filtered.json, the game data the generator reads from its resources folder. Only the
// generator's copy is committed: this puts it in public/ before `npm run dev` and `npm run build`.
import { copyFileSync } from 'node:fs';

copyFileSync(
    new URL('../../clock-generator/resources/data-filtered.json', import.meta.url),
    new URL('../public/data-filtered.json', import.meta.url),
);
