import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { GENERATED_FIELDS, GENERATED_TYPE_FIELDS } from "./generated/prototype-types";

interface ManifestEntry {
    parent?: string | null;
    properties: string[];
}

const readResource = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../resources", name), "utf-8"));

// the manifest's sections without their $comment keys
const sectionOf = (section: Record<string, ManifestEntry | unknown>): Record<string, string[]> => Object.fromEntries(
    Object.entries(section).filter(([name]) => !name.startsWith("$")).map(([name, entry]) => [name, (entry as ManifestEntry).properties]),
);

const manifest = readResource("trait-fields.json");
const prototypes = sectionOf(manifest.prototypes);
const types = sectionOf(manifest.types);

/**
 * src/data/generated/prototype-types.ts is printed by scripts/prototype-types/generate.mjs from the manifest
 * (resources/trait-fields.json) and the game's prototype API spec. A manifest edited without a rerun fails here.
 */
describe("the generated prototype types", () => {
    it("hold exactly the properties the manifest lists for each class", () => {
        expect(GENERATED_FIELDS).toEqual(prototypes);
    });

    it("hold exactly the properties the manifest lists for each type", () => {
        expect(GENERATED_TYPE_FIELDS).toEqual(types);
    });

    it("have a hash of the spec's definition of every manifest property and type", () => {
        const version = readResource("prototype-api-version.json");
        const expected = [
            ...Object.entries(prototypes).flatMap(([name, properties]) => properties.map(property => `${name}.${property}`)),
            ...Object.entries(types).flatMap(([name, properties]) => [name, ...properties.map(property => `${name}.${property}`)]),
        ];
        expect(Object.keys(version.definitions)).toEqual(expected);
        for (const hash of Object.values(version.definitions)) expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("come from the game the data was dumped from", () => {
        const version = readResource("prototype-api-version.json");
        expect(version.application_version).toBe(readResource("data-version.json").factorio_version);
    });
});
