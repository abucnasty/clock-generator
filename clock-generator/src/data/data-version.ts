import fs from "fs";
import path from "path";

/** The game the data in resources/ came from, as resources/filter-raw.js recorded it beside the data */
export interface DataVersion {
    /** Such as "2.1.21" */
    factorio_version: string;
    build: number;
    /** The first line of `factorio --version` of the install the dump was made with */
    version_line: string;
    /** The day of the dump, as YYYY-MM-DD */
    dumped_on: string;
    recipes: number;
}

const DATA_VERSION_FILE = path.resolve(__dirname, "../../resources/data-version.json");

/** Found from this file so that it reads the same from src, from dist and from any working directory, like the data */
export function dataVersion(): DataVersion {
    return JSON.parse(fs.readFileSync(DATA_VERSION_FILE, "utf-8")) as DataVersion;
}

/** "Factorio 2.1.21 (build 87673)", for a header */
export function dataVersionText(version: DataVersion = dataVersion()): string {
    return `Factorio ${version.factorio_version} (build ${version.build})`;
}
