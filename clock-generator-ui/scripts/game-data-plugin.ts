// The page fetches /data-filtered.json, the game data the generator reads from its resources folder, and the example
// builds "Try an example" offers. Only the generator's copies are committed: this Vite plugin puts them in public/
// whenever Vite starts (dev server, build, the browser check's server), and the dev server copies them again when the
// generator's files change. It was npm's `predev`/`prebuild`, which never run with npm's ignore-scripts on, and a page
// served with an older engine's data fails on any section the engine has gained since.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const DATA = new URL('../../clock-generator/resources/data-filtered.json', import.meta.url);
const SAMPLES = new URL('../../clock-generator/resources/config-samples/', import.meta.url);
const PUBLIC = new URL('../public/', import.meta.url);

// One build per science pack, simplest first, so a newcomer's first Generate is quick. Each is copied flat as
// public/examples/<id>.json and listed in public/examples/index.json, which the examples dialog reads.
const EXAMPLES = [
    { id: 'logistic-science', path: 'science/logistic-science/logistic-science.json' },
    { id: 'automation-science', path: 'science/automation-science/automation-science.json' },
    { id: 'utility-science', path: 'science/utility-science/utility-science.json' },
    { id: 'chemical-science', path: 'science/chemical-science/chemical-science-shared-foundry.json' },
    { id: 'electromagnetic-science', path: 'science/electromagnetic-science/electromagnetic-science.json' },
    { id: 'military-science', path: 'science/military-science/military-science-1-inserter.json' },
    { id: 'production-science', path: 'science/production-science/production-science.json' },
    { id: 'metallurgic-science', path: 'science/metallurgic-science/metallurgic-science.json' },
    { id: 'agriculture-science', path: 'science/agriculture-science/agriculture-science.json' },
];

/** The generator's files this copies, which the dev server watches */
const SOURCES = [DATA, ...EXAMPLES.map(({ path }) => new URL(path, SAMPLES))].map((url) => fileURLToPath(url));

const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);

function copyGameData(): void {
    copyFileSync(DATA, new URL('data-filtered.json', PUBLIC));

    const examples = new URL('examples/', PUBLIC);
    rmSync(examples, { recursive: true, force: true });
    mkdirSync(examples, { recursive: true });
    const manifest = EXAMPLES.map(({ id, path }) => {
        const source = new URL(path, SAMPLES);
        if (!existsSync(source)) {
            throw new Error(`game data: the example build ${path} is missing from clock-generator/resources/config-samples/`);
        }
        const text = readFileSync(source, 'utf8');
        const config = JSON.parse(text);
        const file = `${id}.json`;
        writeFileSync(new URL(file, examples), text);
        return {
            id,
            file,
            recipe: config.target_output.recipe,
            items_per_second: config.target_output.items_per_second,
            ...(config.target_output.counts === 'destroyed' && { counts: 'destroyed' }),
            copies: config.target_output.copies ?? 1,
            machines: count(config.machines),
            inserters: count(config.inserters),
            belts: count(config.belts),
            chests: count(config.chests),
        };
    });
    writeFileSync(new URL('index.json', examples), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function gameDataPlugin(): Plugin {
    return {
        name: 'game-data',
        // the tests read the generator's data where it is and leave public/ alone
        apply: () => !process.env.VITEST,
        // before the dev server lists public/, which it serves only the files of until its watcher is ready
        configResolved() {
            copyGameData();
        },
        configureServer(server) {
            server.watcher.add(SOURCES);
            server.watcher.on('change', (file) => {
                if (!SOURCES.includes(file)) return;
                copyGameData();
                // the workers loaded the data once, when the page started
                server.ws.send({ type: 'full-reload' });
            });
        },
    };
}
