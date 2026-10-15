import { formatNumberText } from './numberText';

/** Where the examples dialog finds the list, which `scripts/copy-factorio-data.mjs` writes into `public/` */
export const EXAMPLE_MANIFEST_URL = '/examples/index.json';

/** One row of the list of example builds: the build file and what it holds */
export interface ExampleBuild {
    id: string;
    /** The build file, beside the list */
    file: string;
    /** Its Target Output */
    recipe: string;
    items_per_second: number;
    copies: number;
    machines: number;
    inserters: number;
    belts: number;
    chests: number;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isExampleBuild(row: unknown): row is ExampleBuild {
    if (typeof row !== 'object' || row === null) {
        return false;
    }
    const r = row as Record<string, unknown>;
    return isText(r.id) && isText(r.file) && isText(r.recipe)
        && typeof r.items_per_second === 'number' && Number.isFinite(r.items_per_second) && r.items_per_second > 0
        && isCount(r.copies) && r.copies >= 1
        && isCount(r.machines) && isCount(r.inserters) && isCount(r.belts) && isCount(r.chests);
}

/**
 * The example builds the list names; none when it is not a JSON list of well-formed rows. Without the copy script run,
 * the dev server answers the list's address with the page's own HTML, which reads as none too.
 */
export function readExampleManifest(text: string): ExampleBuild[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    return Array.isArray(parsed) && parsed.every(isExampleBuild) ? parsed : [];
}

/**
 * "Logistic science pack": the game's name of the build's recipe, given by `name`; the id in sentence case when the
 * game data has no name for it
 */
export function exampleTitle(example: Pick<ExampleBuild, 'recipe'>, name: (id: string) => string): string {
    const named = name(example.recipe);
    if (named !== example.recipe) {
        return named;
    }
    const words = example.recipe.replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "240/s · 11 copies · 1 machine, 3 inserters" */
export function exampleSummary(example: ExampleBuild): string {
    return [
        `${formatNumberText(example.items_per_second)}/s`,
        countOf(example.copies, 'copy', 'copies'),
        `${countOf(example.machines, 'machine', 'machines')}, ${countOf(example.inserters, 'inserter', 'inserters')}`,
    ].join(' · ');
}
