import factorioData from '../../../clock-generator/resources/data-filtered.json';
import { expect, it } from 'vitest';
import { ENGINE_DATA_SECTIONS, bugReportText, missingDataSections } from './internalError';

it('lists exactly the sections of the committed game data', () => {
    expect([...ENGINE_DATA_SECTIONS].sort()).toEqual(Object.keys(factorioData).sort());
    expect(missingDataSections(factorioData)).toEqual([]);
});

it('names the sections an older data file lacks', () => {
    const older: Record<string, unknown> = { ...factorioData };
    delete older.item_weight;
    delete older.names;
    expect(missingDataSections(older)).toEqual(['item_weight', 'names']);
    expect(missingDataSections(null)).toHaveLength(ENGINE_DATA_SECTIONS.length);
});

it('puts the error, its stack and the page version in the bug report', () => {
    expect(bugReportText({ message: 'boom', stack: 'at x', dataMismatch: false }, '1.2.3')).toBe('boom\nat x\nPage version: 1.2.3');
});
