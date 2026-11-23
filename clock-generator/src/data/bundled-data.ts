import { isPlainData } from "../common/plain-data";
import type { FactorioData } from "./factorio-data-types";

const bundled_data = new WeakSet<FactorioData>();

export function parseBundledData(text: string): FactorioData {
    const data = JSON.parse(text) as FactorioData;
    bundled_data.add(data);
    return data;
}

export function isPlainBundledData(data: FactorioData | null): boolean {
    return data !== null && bundled_data.has(data) && isPlainData(data);
}
