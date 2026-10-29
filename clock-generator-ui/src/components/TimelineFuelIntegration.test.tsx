// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import agricultureConfig from '../../../clock-generator/resources/config-samples/science/agriculture-science/agriculture-science.json?raw';
import { show } from '../test/fixtures';
import { DEFAULT_INSPECTION } from '../utils/timelineInspection';
import { signalsForTimelinePause } from '../utils/timelinePresentation';
import { TimelineTickInspector } from './TimelineTickInspector';
import { TimelineEvidenceChart } from './TimelineEvidenceChart';

/** The facts the inspector shows before its disclosure, as `term: value` */
const shownFacts = () => {
    const inspector = within(screen.getByRole('complementary', { name: 'Tick inspector' }));
    const disclosure = inspector.getByRole('group');
    const values = inspector.getAllByRole('definition');
    return inspector.getAllByRole('term').flatMap((term, index) => disclosure.contains(term) ? [] : [`${term.textContent}: ${values[index].textContent}`]);
};

it('reveals nutrient stock and burning energy from a real agricultural-science replay when exploring fuel', async () => {
    const engine = await import('clock-generator/browser');
    engine.FactorioDataService.initialize(JSON.parse(factorioData));
    const config = engine.parseConfigFromJson(agricultureConfig);
    const recording = engine.recordSimulationTimeline({ config, mode: 'plan', period_ticks: 600, terminal_swing_count: 1, windows: {} });
    const machine = recording.entities.find(entity => entity.recipe === 'agricultural-science-pack')!;
    expect(machine).toBeDefined();
    const fuel = machine.signals.find(signal => signal.id === 'fuel')!;
    expect(fuel).toMatchObject({ item: 'nutrients', unit: 'items' });
    expect(fuel.values.some(value => Number(value) > 0)).toBe(true);
    const energy = machine.signals.find(signal => signal.id === 'burning')!;
    expect(energy.unit).toBe('MJ');
    expect(energy.values.some(value => Number(value) > 0)).toBe(true);
    const signals = signalsForTimelinePause(DEFAULT_INSPECTION.signals, 'no_fuel');
    show(<>
        <TimelineTickInspector recording={recording} entity={machine} inspection={{ ...DEFAULT_INSPECTION, view: 'activity', signals }} tick={10} events={[]} connected={[]} onEntityChange={() => {}} />
        <TimelineEvidenceChart recording={recording} selected={machine} groups={signals} range={{ start: 0, end: recording.end_tick }} tick={10} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />
    </>);
    expect(shownFacts()).toEqual(expect.arrayContaining([expect.stringMatching(/^Fuel slot · nutrients: [\d.]+ items/), expect.stringMatching(/^Burning fuel remaining: [\d.]+ MJ$/)]));
    // each chart lane is a canvas, named for what it draws
    expect(screen.getByRole('img', { name: /^Fuel slot · nutrients, / })).toBeDefined();
    expect(screen.getByRole('img', { name: /^Burning fuel remaining, / })).toBeDefined();
});
