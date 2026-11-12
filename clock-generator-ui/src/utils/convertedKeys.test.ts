import { describe, expect, it } from 'vitest';
import * as edits from './configForm/edits';
import { formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { formerKeysOf, recordFormConversion } from './convertedKeys';
import { keyToShow } from './resultsCache';
import { buildChangesOf } from './buildChanges';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

/** A build with a belt an inserter takes from, as a saved build of the released page held it: Backed up stored true */
function before(): ConfigFormData {
    let form = edits.addInserter(edits.addBelt(createDefaultConfig()));
    form = edits.updateBelt(form, 0, { lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] as ConfigFormData['belts'][number]['lanes'] });
    return edits.updateOverrides(form, 'backed_up_belts', true);
}
/** The same build as the page converts it on load */
function after(): ConfigFormData {
    const form = before();
    const { backed_up_belts: _setting, ...overrides } = form.overrides ?? {};
    void _setting;
    return { ...form, overrides, belts: form.belts.map(belt => ({ ...belt, lanes: belt.lanes.map(lane => ({ ...lane, lane_end: { kind: 'dead_end' as const } })) })) as ConfigFormData['belts'] };
}

describe('the clocks kept for a build before its belt setting was converted on load', () => {
    it('are found by the key the build has now, shown as its own: not out of date, with no change listed', () => {
        const old = formDataToConfig(before());
        const now = formDataToConfig(after());
        expect(configKeyOf(now)).not.toBe(configKeyOf(old));
        expect(formerKeysOf(configKeyOf(now))).toEqual([]);
        recordFormConversion(before(), after());
        expect(formerKeysOf(configKeyOf(now))).toEqual([configKeyOf(old)]);

        const kept = generatedForOf(old, 1_000);
        const entries = [{ key: kept.key, shownAt: 1 }];
        const choice = keyToShow({ currentKey: configKeyOf(now), mode: 'load', entries, dropped: null, shownKey: kept.key, formerKeys: formerKeysOf(configKeyOf(now)) });
        expect(choice).toEqual({ from: 'kept', key: kept.key, as: configKeyOf(now) });
        // as the page shows them (useSimulationWorker's restore): the kept clocks with the key the build has now
        const shown = { ...kept, key: (choice as { as: string }).as };
        expect(isStale(shown, configKeyOf(now))).toBe(false);
        expect(buildChangesOf(JSON.parse(shown.key), now)).toEqual([]);
    });

    it('are not taken for a build that was not converted: on load they show as they were, out of date', () => {
        const old = formDataToConfig(before());
        const other = formDataToConfig(edits.updateSetpoint(after(), 'items_per_second', 7));
        const kept = generatedForOf(old, 1_000);
        const choice = keyToShow({ currentKey: configKeyOf(other), mode: 'load', entries: [{ key: kept.key, shownAt: 1 }], dropped: null,
            shownKey: kept.key, formerKeys: formerKeysOf(configKeyOf(other)) });
        expect(choice).toEqual({ from: 'kept', key: kept.key });
        expect(isStale(kept, configKeyOf(other))).toBe(true);
    });
});
