// node scripts/prototype-types/generate.mjs --api <factorio>/doc-html/prototype-api.json --fields resources/trait-fields.json
//
// Writes the TypeScript types of what the engine reads from the game's prototypes, from two inputs:
//   --api     the prototype API spec that ships with the game (doc-html/prototype-api.json in the install; take the
//             locked install the data is dumped from, as resources/filter-raw.js does);
//   --fields  the manifest, resources/trait-fields.json: per prototype class and per struct type, the properties the
//             engine reads. It is the one hand-written list; this script only checks it against the spec and prints it.
// and writes, relative to the clock-generator folder:
//   src/data/generated/prototype-types.ts   an interface per manifest class (extending its parent's) and per manifest
//                                           type, with only the manifest's properties, typed as the spec types them;
//                                           GENERATED_FIELDS and GENERATED_TYPE_FIELDS list them for the unit test;
//   resources/prototype-api-version.json    the spec's application_version and api_version, and a short hash of each
//                                           manifest property's definition (its type, optional and default; not its
//                                           description), and of each manifest type's own definition. A hash also covers
//                                           the definitions of the named types the property reaches that print inline
//                                           (ItemStackIndex, Energy, the *ID aliases, unions of literals), and an
//                                           override of the property on a listed subclass (ItemPrototype's hidden).
//
// It fails, writing nothing, when the manifest names a class, type or property the spec does not have where the
// manifest puts it (a property belongs to the class that owns it in the spec, not to one that inherits it), or a parent
// the spec does not give. A struct type the manifest reaches but does not list becomes `unknown`, with a warning that
// names it: list it under "types" to spell it out. It also warns about a listed property whose default is another
// property of the same class ("Value of `ignored_by_stats`") that the manifest does not list.
//
// On a game version bump: rerun this with the new install's spec, then read the diffs. The generated file's diff shows
// the properties added, removed or retyped; the version file's diff shows which definitions changed (a changed default
// shows there and in the comment above the property). Data and types come from the same game: refresh
// resources/data-filtered.json from the same install (filter-raw.js), or the unit test of the generated types fails.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES_OUT = path.join(ROOT, "src/data/generated/prototype-types.ts");
const VERSION_OUT = path.join(ROOT, "resources/prototype-api-version.json");

// the spec's builtin types that TypeScript has a type for; any other builtin (table, DataExtendMethod) is unknown
const BUILTINS = {
    boolean: "boolean",
    string: "string",
    number: "number",
    double: "number",
    float: "number",
    int8: "number",
    int16: "number",
    int32: "number",
    uint8: "number",
    uint16: "number",
    uint32: "number",
    uint64: "number",
};

const ENTRY_KEYS = new Set(["$comment", "parent", "properties"]);

function argValue(name) {
    const at = process.argv.indexOf(`--${name}`);
    if (at >= 0) return process.argv[at + 1];
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/** The manifest's entries of one section, without its $comment keys */
function entriesOf(section) {
    return Object.entries(section ?? {}).filter(([name]) => !name.startsWith("$"));
}

// the keys of a definition that only change how the docs read it, left out of the hashes
const DOC_KEYS = new Set(["description", "full_format"]);

/** A type definition without its descriptions, for the hashes: a reworded description is not a changed definition */
function withoutDescriptions(value) {
    if (Array.isArray(value)) return value.map(withoutDescriptions);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !DOC_KEYS.has(key)).map(([key, v]) => [key, withoutDescriptions(v)]));
}

/** JSON with its keys sorted at every level, so a hash does not follow the spec's key order */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const hashOf = value => createHash("sha256").update(canonical(withoutDescriptions(value))).digest("hex").slice(0, 16);

/** Whether a complex type holds a struct of its own (the properties of the type it defines, as Vector's union does) */
function holdsStruct(type) {
    if (type === null || typeof type !== "object") return false;
    if (type.complex_type === "struct") return true;
    return (type.options ?? []).some(holdsStruct);
}

/** Checks the manifest against the spec; returns the errors, each a line for the person who edits the manifest */
function checkManifest(manifest, prototypes, types) {
    const errors = [];
    const listedPrototypes = new Map(entriesOf(manifest.prototypes));
    const listedTypes = new Map(entriesOf(manifest.types));

    const checkEntry = (section, name, entry) => {
        if (entry === null || typeof entry !== "object" || !Array.isArray(entry.properties)) {
            errors.push(`${section}.${name}: needs "properties", an array of property names`);
            return false;
        }
        for (const key of Object.keys(entry).filter(key => !ENTRY_KEYS.has(key))) {
            errors.push(`${section}.${name}: unknown key "${key}" (allowed: ${[...ENTRY_KEYS].join(", ")})`);
        }
        const seen = new Set();
        for (const property of entry.properties) {
            if (typeof property !== "string") errors.push(`${section}.${name}: property ${JSON.stringify(property)} is not a name`);
            else if (seen.has(property)) errors.push(`${section}.${name}.${property}: listed twice`);
            seen.add(property);
        }
        return true;
    };

    // a property listed on a class or type that inherits it: name its owner so the fix is plain
    const checkOwnProperties = (section, name, entry, spec, specs) => {
        for (const property of entry.properties) {
            if ((spec.properties ?? []).some(p => p.name === property)) continue;
            let owner = spec.parent ? specs.get(spec.parent) : undefined;
            while (owner && !(owner.properties ?? []).some(p => p.name === property)) owner = owner.parent ? specs.get(owner.parent) : undefined;
            errors.push(owner
                ? `${section}.${name}.${property}: ${name} does not own it in the spec; ${owner.name} does, list it there`
                : `${section}.${name}.${property}: no such property on ${name} or its ancestors in the spec`);
        }
    };

    if (listedPrototypes.size === 0) errors.push(`the manifest has no "prototypes"`);
    for (const [name, entry] of listedPrototypes) {
        if (!checkEntry("prototypes", name, entry)) continue;
        const spec = prototypes.get(name);
        if (!spec) {
            errors.push(`prototypes.${name}: no such prototype in the spec`);
            continue;
        }
        const parent = spec.parent ?? null;
        if (entry.parent !== parent) {
            errors.push(`prototypes.${name}: parent is ${JSON.stringify(entry.parent ?? null)} in the manifest, ${JSON.stringify(parent)} in the spec`);
        } else if (parent !== null && !listedPrototypes.has(parent)) {
            errors.push(`prototypes.${name}: its parent ${parent} is not listed; list every class of the chain (an empty one with [])`);
        }
        if (entry.properties.length === 0 && parent === null) errors.push(`prototypes.${name}: a root class must keep a property`);
        checkOwnProperties("prototypes", name, entry, spec, prototypes);
    }

    for (const [name, entry] of listedTypes) {
        if (!checkEntry("types", name, entry)) continue;
        if (listedPrototypes.has(name)) errors.push(`types.${name}: also listed as a prototype`);
        const spec = types.get(name);
        if (!spec) {
            errors.push(`types.${name}: no such type in the spec`);
            continue;
        }
        if (spec.type === "builtin" || typeof spec.type === "string") {
            errors.push(`types.${name}: an alias of ${spec.type}, which resolves inline; remove it from "types"`);
            continue;
        }
        if (entry.parent !== undefined) {
            if (entry.parent !== (spec.parent ?? null)) {
                errors.push(`types.${name}: parent is ${JSON.stringify(entry.parent)} in the manifest, ${JSON.stringify(spec.parent ?? null)} in the spec`);
            } else if (!listedTypes.has(entry.parent)) {
                errors.push(`types.${name}: its parent ${entry.parent} is not listed under "types"`);
            }
        }
        if (spec.type.complex_type === "struct" && entry.properties.length === 0 && entry.parent === undefined) {
            errors.push(`types.${name}: a struct that keeps no property and names no parent; remove it`);
        }
        if (!holdsStruct(spec.type) && entry.properties.length > 0) {
            errors.push(`types.${name}: a ${spec.type.complex_type} with no properties of its own; list it with []`);
            continue;
        }
        checkOwnProperties("types", name, entry, spec, types);
    }
    return errors;
}

/**
 * The listed properties whose default is another property of the class or its ancestors ("Value of `level`") that the
 * manifest does not list, each as "Class.property defaults to other": without it the default cannot be resolved
 */
function unlistedDefaults(manifest, prototypes, types) {
    const found = [];
    const check = (entries, specs) => {
        const listed = new Map(entries);
        for (const [name, entry] of entries) {
            // every property of the chain, with the class that owns it, and whether the manifest lists it there
            const chain = new Map();
            for (let at = specs.get(name); at; at = at.parent ? specs.get(at.parent) : undefined) {
                for (const p of at.properties ?? []) if (!chain.has(p.name)) chain.set(p.name, listed.get(at.name)?.properties.includes(p.name) ?? false);
            }
            for (const property of entry.properties) {
                const def = specs.get(name).properties.find(p => p.name === property).default;
                if (typeof def !== "string") continue;
                for (const [, other] of def.matchAll(/`(\w+)`/g)) {
                    if (other !== property && chain.get(other) === false) found.push(`${name}.${property} defaults to ${other}`);
                }
            }
        }
    };
    check(entriesOf(manifest.prototypes), prototypes);
    check(entriesOf(manifest.types), types);
    return found;
}

/** Prints the manifest's classes and types as TypeScript */
function generate(manifest, spec, fieldsPath) {
    const prototypes = new Map(spec.prototypes.map(p => [p.name, p]));
    const types = new Map(spec.types.map(t => [t.name, t]));
    const listedPrototypes = entriesOf(manifest.prototypes);
    const listedTypes = entriesOf(manifest.types);
    const listedTypeNames = new Set(listedTypes.map(([name]) => name));
    // the types that become unknown, each with the first property that reaches it
    const unknownTypes = new Map();

    const unknownFor = (name, via) => {
        if (!unknownTypes.has(name)) unknownTypes.set(name, via);
        return { text: "unknown", union: false };
    };

    // a spec type as TypeScript; `union` says whether it needs parentheses as an array's element
    const tsType = (type, via, owner) => {
        if (typeof type === "string") {
            if (Object.hasOwn(BUILTINS, type)) return { text: BUILTINS[type], union: false };
            const def = types.get(type);
            if (!def || def.type === "builtin") return unknownFor(type, via);
            if (listedTypeNames.has(type)) return { text: type, union: false };
            if (typeof def.type === "string") return tsType(def.type, via);
            if (holdsStruct(def.type)) return unknownFor(type, via);
            return tsType(def.type, via, type);
        }
        switch (type.complex_type) {
            case "literal":
                return { text: JSON.stringify(type.value), union: false };
            case "type":
                return tsType(type.value, via, owner);
            case "array": {
                const element = tsType(type.value, via, owner);
                return { text: element.union ? `(${element.text})[]` : `${element.text}[]`, union: false };
            }
            case "dictionary":
                return { text: `Record<string, ${tsType(type.value, via, owner).text}>`, union: false };
            case "tuple":
                return { text: `[${type.values.map(value => tsType(value, via, owner).text).join(", ")}]`, union: false };
            case "union": {
                const options = [...new Set(type.options.map(option => tsType(option, via, owner).text))];
                return { text: options.join(" | "), union: options.length > 1 };
            }
            case "struct":
                // only a listed type's own definition holds a struct (holdsStruct sends the others to unknown)
                return { text: inlineStruct(owner), union: false };
            default:
                return unknownFor(`${type.complex_type} (complex type)`, via);
        }
    };

    // the listed subclasses of a class that override one of its properties, each with its own definition of it
    const isBelow = (name, ancestor) => {
        for (let at = prototypes.get(name)?.parent; at; at = prototypes.get(at)?.parent) if (at === ancestor) return true;
        return false;
    };
    const overridesOf = (owner, property) => listedPrototypes
        .filter(([name]) => isBelow(name, owner))
        .flatMap(([name]) => (prototypes.get(name).properties ?? []).filter(q => q.name === property && q.override).map(q => [name, q]));

    const comment = (property, owner) => {
        const parts = [];
        if (property.default !== undefined) {
            const value = typeof property.default === "string" ? property.default.replace(/\s+/g, " ").trim() : JSON.stringify(property.default.value);
            parts.push(`Default: ${value}.`);
        }
        if (property.visibility?.length) parts.push(`Visibility: ${property.visibility.join(", ")}.`);
        const overriddenBy = prototypes.has(owner) ? overridesOf(owner, property.name).map(([name]) => name) : [];
        if (overriddenBy.length) parts.push(`Overridden by ${overriddenBy.join(", ")}.`);
        return parts.length ? `/** ${parts.join(" ").replaceAll("*/", "*\\/")} */` : undefined;
    };

    // the kept properties of a class or type, one per line at the indent given
    const members = (owner, names, specProperties, indent) => names.flatMap(name => {
        const property = specProperties.find(p => p.name === name);
        const doc = comment(property, owner);
        const line = `${indent}${name}${property.optional ? "?" : ""}: ${tsType(property.type, `${owner}.${name}`).text};`;
        return doc ? [`${indent}${doc}`, line] : [line];
    });

    const listedTypeEntries = new Map(listedTypes);
    function inlineStruct(owner) {
        const lines = members(owner, listedTypeEntries.get(owner).properties, types.get(owner).properties ?? [], "    ");
        return `{\n${lines.join("\n")}\n}`;
    }

    // the manifest's path from the clock-generator folder, or a placeholder for one outside it (no machine's path)
    const fieldsFromRoot = path.relative(ROOT, fieldsPath);
    const fieldsShown = fieldsFromRoot.startsWith("..") || path.isAbsolute(fieldsFromRoot) ? "<trait-fields.json>" : fieldsFromRoot.split(path.sep).join("/");
    const out = [
        "// Generated by scripts/prototype-types/generate.mjs from the game's prototype API spec and the manifest: do not edit.",
        `// node scripts/prototype-types/generate.mjs --api <factorio>/doc-html/prototype-api.json --fields ${fieldsShown}`,
        `// Factorio ${spec.application_version}, prototype API version ${spec.api_version}. Only the properties the manifest lists are here.`,
        "// These are the spec's shapes. A name here may also be in src/data/factorio-data-types.ts, which types the filtered",
        "// data (other fields): import from this file by its path.",
        "",
        "// a type's keys, each option's of a union (Vector's struct as well as its tuple)",
        "type OwnKeys<T> = T extends unknown ? keyof T : never;",
        "",
    ];

    const declaration = (name, parent, keep, specEntry, doc) => {
        if (doc) out.push(`/** ${doc} */`);
        if (keep.length === 0) {
            out.push(`export type ${name} = ${parent};`, "");
            return;
        }
        out.push(`export interface ${name}${parent ? ` extends ${parent}` : ""} {`);
        out.push(...members(name, keep, specEntry.properties ?? [], "    "));
        out.push("}", "");
    };

    for (const [name, entry] of listedPrototypes) {
        const specEntry = prototypes.get(name);
        const doc = specEntry.typename ? `type "${specEntry.typename}"` : specEntry.abstract ? "abstract" : undefined;
        declaration(name, entry.parent, entry.properties, specEntry, doc);
    }

    for (const [name, entry] of listedTypes) {
        const specEntry = types.get(name);
        if (specEntry.type.complex_type === "struct") {
            declaration(name, entry.parent, entry.properties, specEntry);
        } else {
            out.push(`export type ${name} = ${tsType(specEntry.type, name, name).text};`, "");
        }
    }

    // `satisfies` ties each list to its declaration: a member removed by hand from one fails tsc
    const fieldList = entries => entries.map(([name, entry]) => `    ${name}: [${entry.properties.map(p => JSON.stringify(p)).join(", ")}],`);
    const keysOf = entries => entries.map(([name]) => `    ${name}: readonly OwnKeys<${name}>[];`);
    out.push(
        "/** Each class's own properties above, in the manifest's order */",
        "export const GENERATED_FIELDS = {",
        ...fieldList(listedPrototypes),
        "} as const satisfies {",
        ...keysOf(listedPrototypes),
        "};",
        "",
        "/** Each type's own properties above, in the manifest's order */",
        "export const GENERATED_TYPE_FIELDS = {",
        ...fieldList(listedTypes),
        "} as const satisfies {",
        ...keysOf(listedTypes),
        "};",
        "",
    );

    // the named types a type reaches that print inline (not listed, holding no struct), each with its definition, so
    // a retyped alias (ItemStackIndex from uint16 to uint32) changes the hash of every property that reaches it
    const inlineTypes = (type, found = {}) => {
        if (typeof type === "string") {
            const def = types.get(type);
            if (!def || Object.hasOwn(found, type) || listedTypeNames.has(type) || (typeof def.type === "object" && holdsStruct(def.type))) return found;
            found[type] = withoutDescriptions(def.type);
            return inlineTypes(def.type, found);
        }
        if (type === null || typeof type !== "object") return found;
        for (const inner of [type.key, type.value, ...(type.values ?? []), ...(type.options ?? [])]) inlineTypes(inner, found);
        return found;
    };
    const definitionOf = p => ({ type: p.type, optional: p.optional, default: p.default ?? null, inline_types: inlineTypes(p.type) });

    const definitions = {};
    for (const [name, entry] of listedPrototypes) {
        for (const property of entry.properties) {
            const p = prototypes.get(name).properties.find(q => q.name === property);
            const overrides = Object.fromEntries(overridesOf(name, property).map(([subclass, q]) => [subclass, definitionOf(q)]));
            definitions[`${name}.${property}`] = hashOf({ ...definitionOf(p), overrides });
        }
    }
    for (const [name, entry] of listedTypes) {
        const specEntry = types.get(name);
        definitions[name] = hashOf({ parent: specEntry.parent ?? null, type: specEntry.type, inline_types: inlineTypes(specEntry.type) });
        for (const property of entry.properties) {
            const p = specEntry.properties.find(q => q.name === property);
            definitions[`${name}.${property}`] = hashOf(definitionOf(p));
        }
    }
    const version = { application_version: spec.application_version, api_version: spec.api_version, definitions };

    return { typesText: out.join("\n"), versionText: `${JSON.stringify(version, null, 2)}\n`, unknownTypes, unlistedDefaults: unlistedDefaults(manifest, prototypes, types) };
}

function main() {
    const apiPath = argValue("api");
    const fieldsPath = argValue("fields");
    if (!apiPath || !fieldsPath) {
        console.error("usage: node scripts/prototype-types/generate.mjs --api <factorio>/doc-html/prototype-api.json --fields resources/trait-fields.json");
        process.exitCode = 2;
        return;
    }
    const spec = JSON.parse(fs.readFileSync(apiPath, "utf-8"));
    const manifest = JSON.parse(fs.readFileSync(fieldsPath, "utf-8"));
    if (spec.stage !== "prototype" || !Array.isArray(spec.prototypes) || !Array.isArray(spec.types)) {
        console.error(`${apiPath} is not the prototype API spec (prototype-api.json)`);
        process.exitCode = 1;
        return;
    }

    const errors = checkManifest(manifest, new Map(spec.prototypes.map(p => [p.name, p])), new Map(spec.types.map(t => [t.name, t])));
    if (errors.length > 0) {
        console.error(`${fieldsPath} does not match the spec of Factorio ${spec.application_version}; nothing written:`);
        for (const error of errors) console.error(`  ${error}`);
        process.exitCode = 1;
        return;
    }

    const { typesText, versionText, unknownTypes, unlistedDefaults } = generate(manifest, spec, path.resolve(fieldsPath));
    fs.mkdirSync(path.dirname(TYPES_OUT), { recursive: true });
    fs.writeFileSync(TYPES_OUT, typesText);
    fs.writeFileSync(VERSION_OUT, versionText);
    console.log(`wrote ${path.relative(process.cwd(), TYPES_OUT)} and ${path.relative(process.cwd(), VERSION_OUT)} (Factorio ${spec.application_version}, API ${spec.api_version})`);
    if (unknownTypes.size > 0) {
        const count = unknownTypes.size === 1 ? "1 type" : `${unknownTypes.size} types`;
        console.warn(`warning: ${count} the manifest reaches, not listed under "types", typed unknown:`);
        for (const [name, via] of unknownTypes) console.warn(`  ${name} (first reached by ${via})`);
    }
    if (unlistedDefaults.length > 0) {
        console.warn(`warning: a default names a property the manifest does not list; list it, or the default cannot be resolved:`);
        for (const line of unlistedDefaults) console.warn(`  ${line}`);
    }
}

main();
