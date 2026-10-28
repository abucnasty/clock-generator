// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import agricultureConfig from '../../../clock-generator/resources/config-samples/science/agriculture-science/agriculture-science.json?raw';
import { show } from '../test/fixtures';
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
    show(<FlowReplay config={config} recording={recording} tick={10} inspection={{ ...DEFAULT_INSPECTION, view: 'flow' }} cycleTicks={96}
        onTick={() => {}} onChange={() => {}} onInspectActivity={() => {}} />);
    const connections = screen.getByRole('list', { name: 'Connection legend' });
    expect(within(connections).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Selected or hovered route',
        'Transfer at this tick · item and quantity', 'Recent activity · no quantity', 'Selected entity outline']);
    // the routes' legend comes before the states'
    expect(connections.compareDocumentPosition(screen.getByText('Entity states')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Flow replay legend' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Transfer scope' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Previous transfer' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Play one crafting cycle' })).toBeDefined();
    expect(screen.getByText(/Belts show routes, not physical item positions\.$/)).toBeDefined();
    expect(screen.queryByText(/Highlights cover ticks/)).toBeNull();
    // a replay, not an editor
    expect(screen.queryByRole('button', { name: /Add Entity/i })).toBeNull();
    expect(screen.queryByText(/Add Entity/)).toBeNull();
});
