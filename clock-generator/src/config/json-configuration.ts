import { isPlainData } from "../common/plain-data";
import type { Config } from "./schema";

/** Configurations returned by the Node JSON loader. The caller can still change their contents. */
const parsed_configurations = new WeakSet<object>();

export function didParseJsonConfiguration(configuration: object): void {
    parsed_configurations.add(configuration);
}

export function isPlainJsonConfiguration(configuration: Config): boolean {
    return parsed_configurations.has(configuration) && isPlainData(configuration);
}
