import fs from "fs";
import path from "path";
import { FactorioData } from "./factorio-data-types";
import { FactorioDataService } from "./factorio-data-service";
import { parseBundledData } from "./bundled-data";

/**
 * The game data in resources/, found from this file so that it reads the same from src, from dist and from any
 * working directory. Importing this module makes FactorioDataService read it on first use; the browser entry leaves it
 * out and initializes the service with fetched data instead.
 */
const FACTORIO_DATA_FILE = path.resolve(__dirname, "../../resources/data-filtered.json");

function readFactorioDataFile(): FactorioData {
    return parseBundledData(fs.readFileSync(FACTORIO_DATA_FILE, "utf-8"));
}

FactorioDataService.setDefaultSource(readFactorioDataFile);
