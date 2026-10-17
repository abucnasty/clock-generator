import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import agricultureConfig from '../../../clock-generator/resources/config-samples/science/agriculture-science/agriculture-science.json?raw';
import { DEFAULT_INSPECTION } from '../utils/timelineInspection';
import { flowReplayIndex, flowReplaySnapshot } from '../utils/flowReplay';
import { FlowReplay } from './FlowReplay';

it('renders replay controls using an agricultural build with recorded fuel and machine loops', async () => {
    const engine = await import('clock-generator/browser');
    engine.FactorioDataService.initialize(JSON.parse(factorioData));
    const config = engine.parseConfigFromJson(agricultureConfig);
    const recording = engine.recordSimulationTimeline({ config, mode: 'plan', period_ticks: 600, terminal_swing_count: 1, windows: {} });
    const machine = recording.entities.find(entity => entity.recipe === 'agricultural-science-pack')!;
    const snapshot = flowReplaySnapshot(flowReplayIndex(recording), machine.id, 10);
    expect(snapshot.inventory.some(value => value.unit === 'MJ' && Number(value.value) > 0)).toBe(true);
    const html = renderToStaticMarkup(<FlowReplay config={config} recording={recording} tick={10} inspection={{ ...DEFAULT_INSPECTION, view: 'flow' }} cycleTicks={96}
        onTick={() => {}} onChange={() => {}} onInspectActivity={() => {}} />);
    expect(html).toContain('Flow replay legend');
    expect(html).toContain('Selected or hovered route');
    expect(html).toContain('Recorded item transfer · quantity on the line');
    expect(html).toContain('Selected entity outline');
    expect(html.indexOf('aria-label="Connection legend"')).toBeLessThan(html.indexOf('Entity states'));
    expect(html).toContain('Previous transfer');
    expect(html).toContain('Play one crafting cycle');
    expect(html).toContain('not physical item positions');
    expect(html).not.toContain('Add Entity');
});
