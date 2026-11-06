#!/usr/bin/env node
// Generates docs/maintainer/configuration-file-fields.md, the maintainer reference of the fields of a configuration file, from the
// engine's ConfigSchema (src/config/schema.ts) as zod gives it in JSON Schema. Reads the build (dist/): from
// clock-generator/,
//   npm run docs:fields              builds, then writes the topic
//   npm run docs:fields -- --check   builds, then exit code 1 and a diff when the committed topic is not current (CI)
// One table per top-level field, one row per field below it: its path, type, whether it is required and its
// description (the `.describe()` text of the schema). A field that JSON Schema cannot express (a custom check or a
// transform) has the type "any, see schema.ts". The count of those is printed.
const path = require("node:path");
const { writeOrCheck } = require("./generated-file");

const TOPIC = "docs/maintainer/configuration-file-fields.md";
const ANY = "any, see schema.ts";
// zod gives an integer this maximum when the schema sets none
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const { z } = require("zod");
const { ConfigSchema } = require(path.join(__dirname, "..", "..", "dist", "config", "schema"));
const schema = z.toJSONSchema(ConfigSchema, { unrepresentable: "any" });

const code = value => `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
const cell = text => String(text).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** Whether JSON Schema says nothing of the value: the "any" zod gives an unrepresentable schema */
const isAny = node => Object.keys(node).every(key => key === "description" || key === "default");
const isObject = node => node.type === "object" && node.properties !== undefined;

/** The property whose constant tells the variants of a union of objects apart, if there is one */
function discriminator(variants) {
    if (!variants.every(isObject)) return undefined;
    const keys = Object.keys(variants[0].properties).filter(key => variants.every(variant => variant.properties[key]?.const !== undefined));
    return keys.find(key => new Set(variants.map(variant => JSON.stringify(variant.properties[key].const))).size === variants.length);
}

/** A number's bounds as text: "> 0", "≥ 0", "0 to 15" */
function bounds(node) {
    const low = node.exclusiveMinimum !== undefined ? `> ${node.exclusiveMinimum}` : node.minimum !== undefined ? `≥ ${node.minimum}` : "";
    const max = node.maximum !== undefined && node.maximum !== SAFE_INTEGER ? node.maximum : undefined;
    const high = node.exclusiveMaximum !== undefined ? `< ${node.exclusiveMaximum}` : max !== undefined ? `≤ ${max}` : "";
    if (node.minimum !== undefined && max !== undefined) return ` ${node.minimum} to ${max}`;
    return [low, high].filter(Boolean).map(bound => ` ${bound}`).join(",");
}

const firstUse = new Map();
let anyCount = 0;

/** The row of a field, then the rows of the fields below it */
function rows(node, field, required) {
    const { type, below, description } = typeOf(node, field);
    const defaulted = node.default !== undefined ? `, default ${code(node.default)}` : "";
    return [{ field, type: type + defaulted, required, description: node.description ?? description ?? "" }, ...below];
}

/** The rows of the properties of an object, each path from `field` */
const propertyRows = (object, field, skip) => Object.entries(object.properties)
    .filter(([name]) => name !== skip)
    .flatMap(([name, child]) => rows(child, `${field}.${name}`, object.required?.includes(name) ?? false));

/** Rows once each: the variants of a union of arrays give the same fields */
function distinct(list) {
    const seen = new Set();
    return list.filter(row => {
        const key = JSON.stringify(row);
        return !seen.has(key) && seen.add(key);
    });
}

/** The type of a field as text, and the rows of the fields below it */
function typeOf(node, field) {
    if (node.$ref !== undefined) {
        const name = node.$ref.replace("#/$defs/", "");
        if (firstUse.has(name)) return { type: `the same as ${code(firstUse.get(name))}`, below: [] };
        firstUse.set(name, field);
        return { ...typeOf(schema.$defs[name], field), description: schema.$defs[name].description };
    }
    if (isAny(node)) {
        anyCount += 1;
        return { type: ANY, below: [] };
    }
    if (node.not !== undefined && Object.keys(node.not).length === 0) return { type: "not allowed", below: [] };
    if (node.const !== undefined) return { type: code(node.const), below: [] };
    if (node.enum !== undefined) return { type: `one of ${node.enum.map(code).join(", ")}`, below: [] };
    const variants = node.anyOf ?? node.oneOf;
    if (variants !== undefined) {
        const key = discriminator(variants);
        if (key !== undefined) {
            return {
                type: `one of ${variants.length} objects, by \`${key}\`: ${variants.map(variant => code(variant.properties[key].const)).join(", ")}`,
                below: variants.flatMap(variant => propertyRows(variant, `${field}{${key}=${variant.properties[key].const}}`, key)),
            };
        }
        if (variants.every(isObject)) {
            return {
                type: `one of ${variants.length} objects`,
                below: variants.flatMap((variant, index) => propertyRows(variant, `${field}{${index + 1}}`)),
            };
        }
        const types = variants.map(variant => typeOf(variant, field));
        return { type: types.map(each => each.type).join(" or "), below: distinct(types.flatMap(each => each.below)) };
    }
    switch (node.type) {
        case "object":
            if (node.properties !== undefined) return { type: "object", below: propertyRows(node, field) };
            return { type: `object of ${typeOf(typeof node.additionalProperties === "object" ? node.additionalProperties : {}, `${field}.*`).type} by key`, below: [] };
        case "array": {
            if (node.prefixItems !== undefined) {
                return {
                    type: `array of exactly ${node.prefixItems.length}`,
                    below: node.prefixItems.flatMap((item, index) => rows(item, `${field}[${index}]`, true)),
                };
            }
            const items = typeOf(node.items ?? {}, `${field}[]`);
            const least = node.minItems !== undefined ? ` (at least ${node.minItems})` : "";
            return { type: `array${least} of ${items.type === "object" ? "objects" : items.type}`, below: items.below };
        }
        case "string":
            return { type: node.minLength === 1 ? "string, not empty" : node.minLength ? `string of at least ${node.minLength} characters` : "string", below: [] };
        case "number":
        case "integer":
            return { type: `${node.type}${bounds(node)}`, below: [] };
        default:
            return { type: String(node.type), below: [] };
    }
}

const sections = [];
let fieldCount = 0;
for (const [name, child] of Object.entries(schema.properties)) {
    const out = rows(child, name, schema.required.includes(name));
    fieldCount += out.length;
    sections.push([
        `## ${name}`,
        "",
        "| Field | Type | Required | Description |",
        "|---|---|---|---|",
        ...out.map(row => `| \`${cell(row.field)}\` | ${cell(row.type)} | ${row.required ? "yes" : "no"} | ${cell(row.description)} |`),
    ].join("\n"));
}

const topic = `---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: configuration-file-fields
---

# Configuration file fields

The fields of a configuration file, as the engine reads it. This topic is generated from \`ConfigSchema\` in
\`clock-generator/src/config/schema.ts\`: do not edit it. To change a field or its description, change the schema, then
run \`npm run docs:fields\` in \`clock-generator/\`. CI fails when this topic is not current.

There is one table for each top-level field. A field below another has the path from the top-level field:

- \`[]\` is an item of an array, and \`[0]\` the first item of an array of a fixed length.
- \`{type=belt}\` is the variant of a union whose \`type\` is \`belt\`.
- \`{2}\` is the second variant of a union that has no such field.

The type comes from the JSON Schema that zod makes of \`ConfigSchema\`. The type of a field that JSON Schema cannot
show, such as a custom check or a transform, is "${ANY}". "Required" is yes when the field must be in its object
after the engine reads the file: a field with a default is required, but a configuration file can leave it out.

${sections.join("\n\n")}
`;

writeOrCheck(TOPIC, topic, process.argv.includes("--check"), "npm run docs:fields");
console.log(`${anyCount} of ${fieldCount} rows have the type "${ANY}"`);
