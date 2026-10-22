import fs from "fs";
import { builtinModules } from "module";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The modules source code still requires once compiled, as tsc leaves out the imports only types use. A dynamic
 * import keeps the quotes of the source, so either quote is matched.
 */
function importsOf(source: string): string[] {
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    return [...output.matchAll(/require\((["'])([^"']+)\1\)/g)].map(it => it[2]);
}

function resolveSource(from: string, specifier: string): string {
    const base = path.resolve(path.dirname(from), specifier);
    const candidate = [`${base}.ts`, path.join(base, "index.ts")].find(it => fs.existsSync(it));
    if (!candidate) {
        throw new Error(`Cannot resolve ${specifier} from ${from}`);
    }
    return candidate;
}

/** Every import in the module graph of the entry, with the file that makes it; the relative ones are followed */
function importsReachedFrom(entry: string): { file: string, specifier: string }[] {
    const seen = new Set<string>();
    const found: { file: string, specifier: string }[] = [];
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const specifier of importsOf(fs.readFileSync(file, "utf-8"))) {
            found.push({ file: path.relative(__dirname, file), specifier });
            if (specifier.startsWith(".")) {
                visit(resolveSource(file, specifier));
            }
        }
    };
    visit(entry);
    return found;
}

/** Every Node built-in the module graph of the entry reaches, with the file that imports it */
function nodeBuiltinsReachedFrom(entry: string): string[] {
    const builtins = new Set(builtinModules);
    return importsReachedFrom(entry)
        .filter(({ specifier }) => specifier.startsWith("node:") || builtins.has(specifier.split("/")[0]))
        .map(({ file, specifier }) => `${file} imports ${specifier}`);
}

describe("the browser entry", () => {
    it("reaches no Node built-in module", () => {
        expect(nodeBuiltinsReachedFrom(path.join(__dirname, "browser.ts"))).toEqual([]);
    });

    it("finds the fs import that the Node entry reaches", () => {
        expect(nodeBuiltinsReachedFrom(path.join(__dirname, "index.ts"))).toContain("data/factorio-data-file.ts imports fs");
    });

    it("finds dynamic imports in single quotes", () => {
        expect(importsOf("export const inflate = () => import('zlib');")).toEqual(["zlib"]);
    });
});

describe("the light entry", () => {
    it("reaches only a few small modules and no package", () => {
        const files = new Set(importsReachedFrom(path.join(__dirname, "light.ts")).map(({ file, specifier }) =>
            specifier.startsWith(".") ? path.relative(__dirname, resolveSource(path.join(__dirname, file), specifier)) : specifier));
        expect([...files].sort()).toEqual([
            "common/assert.ts",
            "common/belt-pickup-layout.ts",
            "common/enable-control-types.ts",
            "common/entity-types.ts",
            "common/slot-filter.ts",
            "config/copies-value.ts",
            "config/migrate-belt-supply.ts",
            "crafting/rank.ts",
            "crafting/why-not-stable.ts",
            "data-types/fraction.ts",
            "data-types/map-extended.ts",
            "data-types/option.ts",
            "entities/entity-type.ts",
            "state/entity-status.ts",
            "state/status-category.ts",
        ]);
    });
});
