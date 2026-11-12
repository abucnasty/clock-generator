import type { Config } from 'clock-generator/browser';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import type { ConfigFormData } from './configForm/formData';
import { configKeyOf } from './resultsStaleness';

/**
 * The keys of builds that were loaded with the former belt setting and converted to lane ends: the key of the build as it
 * was, by the key it has now. Clocks kept for the build as it was are the clocks of the converted build (the conversion
 * keeps every input lane's end), so the page shows them for it, not as clocks of an earlier build. For this page only.
 */
const formerKeys = new Map<string, Set<string>>();

/** Records that the form `before` was converted to the form `after` */
export function recordFormConversion(before: ConfigFormData, after: ConfigFormData): void {
    const from = configKeyOf(formDataToConfig(before));
    const to = configKeyOf(formDataToConfig(after));
    if (from === to) return;
    formerKeys.set(to, new Set([...formerKeys.get(to) ?? [], from]));
}

/** Records that the config `before` of a file or a link was converted to `after`, as the form holds each */
export function recordConfigConversion(before: Config, after: Config): void {
    recordFormConversion(configToFormData(before), configToFormData(after));
}

/** The keys the build with `key` had before it was converted on load; none for a build that was not */
export function formerKeysOf(key: string): string[] {
    return [...formerKeys.get(key) ?? []];
}
