// The page fetches /data-filtered.json, the game data the generator reads from its resources folder, and the example
// builds "Try an example" offers. Only the generator's copies are committed: this puts them in public/ before
// `npm run dev` and `npm run build` (run it by hand when npm's ignore-scripts is on).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

copyFileSync(
    new URL('../../clock-generator/resources/data-filtered.json', import.meta.url),
    new URL('../public/data-filtered.json', import.meta.url),
);

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

const samples = new URL('../../clock-generator/resources/config-samples/', import.meta.url);
const examples = new URL('../public/examples/', import.meta.url);
rmSync(examples, { recursive: true, force: true });
mkdirSync(examples, { recursive: true });

const count = (list) => (Array.isArray(list) ? list.length : 0);
const manifest = EXAMPLES.map(({ id, path }) => {
    const source = new URL(path, samples);
    if (!existsSync(source)) {
        throw new Error(`copy-factorio-data: the example build ${path} is missing from clock-generator/resources/config-samples/`);
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
