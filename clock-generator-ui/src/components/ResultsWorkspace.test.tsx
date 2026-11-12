// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240, viewsOf } from '../test/checkedLanesFixtures';
import { defaultBuildViewContext } from '../utils/buildViewContext';
import type { ResultDetail } from '../utils/resultsView';
import { ResultsWorkspace } from './ResultsWorkspace';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'accumulator': 'Accumulator', 'supercapacitor': 'Supercapacitor', 'military-science-pack': 'Military science pack' });

type Props = ComponentProps<typeof ResultsWorkspace>;

/** The results of a kept result as the page shows them, with the selection and the workspace's tab kept as the page keeps them */
function Results({ alternatives, recommendedIndex, initialIndex, initialDetail, onDetailChange, onCardBackToRecommended }: {
    alternatives: ClockAlternativeView[]; recommendedIndex: number; initialIndex: number; initialDetail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void; onCardBackToRecommended: () => void;
}) {
    const [selectedIndex, setSelectedIndex] = useState(initialIndex);
    const [detail, setDetail] = useState(initialDetail);
    const context = defaultBuildViewContext();
    const props: Props = {
        installOpen: false, onInstallClose: () => {}, onInstall: () => {}, copyLabel: 'Copy blueprint',
        comparison: context.comparison, onComparisonChange: () => {}, wakeAsTable: false, onWakeAsTableChange: () => {},
        timeline: context.timeline, onTimelineChange: () => {},
        detail, onDetailChange: next => { onDetailChange(next); setDetail(next); },
        generatedFor: null, generationAssumptions: null, isRunning: false, error: null,
        alternatives, selectedIndex, onSelect: setSelectedIndex, recommendedIndex,
        onCardBackToRecommended: () => { onCardBackToRecommended(); setSelectedIndex(recommendedIndex); },
        pickRule: null, pending: [], skippedSearches: [], notMade: [], searchedDeeper: false, keptOn: false, canSearchDeeper: true,
        searchDeeperBlockedBy: null, onSearchDeeper: () => {}, blueprintString: null, simulationDurationTicks: null,
        transferHistory: null, stateTransitionHistory: null, fuelView: null, clockWindows: null, shiftOptions: null, swingBackoffReport: null,
        developerTools: false, logs: [], debugSteps: {} as Props['debugSteps'], onDebugStepsChange: () => {}, streamLogs: false,
        onStreamLogsChange: () => {}, onClearLogs: () => {}, staleFor: null, changes: [], onGenerate: () => {}, canGenerate: true,
        stoppedEarly: false, pickGone: null, copied: false, onCopy: () => {},
    };
    return <ResultsWorkspace {...props} />;
}

function results(alternatives: ClockAlternativeView[], recommendedIndex: number, initialIndex: number, initialDetail: ResultDetail = 'overview') {
    const onDetailChange = vi.fn();
    const onCardBackToRecommended = vi.fn();
    // with nothing to wire: the install dialog, closed, reads it
    const withInstall = alternatives.map(clock => ({ ...clock, install: { book: false, wiring: [], drills: [], lines: {} } }));
    const view = show(<Results alternatives={withInstall} recommendedIndex={recommendedIndex} initialIndex={initialIndex} initialDetail={initialDetail}
        onDetailChange={onDetailChange} onCardBackToRecommended={onCardBackToRecommended} />, { names: gameNames });
    return { ...view, onDetailChange, onCardBackToRecommended };
}

const tabs = () => within(screen.getByRole('tablist', { name: 'Selected clock workspace' })).getAllByRole('tab');
const panel = (tab: string) => document.getElementById(`result-context-panel-${tab}`)!;

describe('the workspace\'s tabs', () => {
    const views = viewsOf(AUTOMATION_240);

    it('are Overview, Diagnostics and Timeline, and the arrow keys move between them', async () => {
        const { user, onDetailChange } = results(views, AUTOMATION_240.selected_index, AUTOMATION_240.selected_index);
        expect(tabs().map(tab => tab.textContent)).toEqual(['Overview', 'Diagnostics', 'Timeline']);
        tabs()[0].focus();
        await user.keyboard('{ArrowRight}');
        expect(document.activeElement).toBe(tabs()[1]);
        expect(onDetailChange).toHaveBeenLastCalledWith('diagnostics');
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
        expect(panel('diagnostics').hidden).toBe(false);
        await user.keyboard('{ArrowLeft}');
        expect(onDetailChange).toHaveBeenLastCalledWith('overview');
    });

    it('a saved Diagnostics view opens on Diagnostics, with the selected clock\'s lanes', () => {
        const stable = views[AUTOMATION_240.selected_index];
        results(views, AUTOMATION_240.selected_index, AUTOMATION_240.selected_index, 'diagnostics');
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
        expect(panel('diagnostics').textContent).toContain(stable.checkedLanes!.line.sentence);
        expect(within(panel('diagnostics')).getByRole('table', { name: 'Shared lanes' })).toBeTruthy();
    });
});

describe('the card\'s link "See diagnostics"', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = views.findIndex(view => view.id === 'euclidean_swings');

    it('opens the selected clock\'s Diagnostics and puts the focus in its panel', async () => {
        const { user, container, onDetailChange } = results(views, AUTOMATION_240.selected_index, index);
        const card = container.querySelector<HTMLElement>('[data-result-card]')!;
        await user.click(within(card).getByRole('button', { name: 'See diagnostics' }));
        expect(onDetailChange).toHaveBeenLastCalledWith('diagnostics');
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(panel('diagnostics'));
        expect(panel('diagnostics').querySelector('[data-cause-headline]')!.textContent).toBe(views[index].checkedLanes!.cause!.headline.text);
        // what the card showed of the lanes is in the tab, once
        expect(card.querySelector('[data-cause-headline], [data-picture]')).toBeNull();
        expect(container.querySelectorAll('[data-cause-headline]')).toHaveLength(1);
    });
});

describe('the note on why no clock is stable, of a loss on a shared lane', () => {
    const result = ELECTROMAGNETIC_330_TWO_SWINGS;
    const views = viewsOf(result);

    it('holds its title and the count line, no picture and no link; the tab of that clock holds the count line, as its heading, and the pictures', async () => {
        const { user, container } = results(views, result.selected_index, result.selected_index);
        const headline = views[result.selected_index].checkedLanes!.cause!.headline.text;
        const note = container.querySelector<HTMLElement>('[data-why-not-stable]')!;
        expect(note.querySelector('[data-cause-headline]')!.textContent).toBe(headline);
        expect(note.querySelector('[data-picture]')).toBeNull();
        expect(within(note).queryByRole('button')).toBeNull();
        await user.click(within(container.querySelector<HTMLElement>('[data-result-card]')!).getByRole('button', { name: 'See diagnostics' }));
        const tab = panel('diagnostics');
        expect(within(tab).getByRole('heading', { level: 3, name: headline })).toBeTruthy();
        expect([...tab.querySelectorAll('[data-picture]')].map(it => it.getAttribute('data-picture'))).toEqual(['copies', 'window-cycles']);
        expect(document.activeElement).toBe(tab);
    });
});

describe('the note that says why a clock is not stable', () => {
    const views = viewsOf(MILITARY_240);
    const index = views.findIndex(view => view.id === 'takt_batches_observed_swings_4');

    it('is on Diagnostics, first, and not in Overview\'s notes; the other notes stay in Overview', () => {
        results(views, MILITARY_240.selected_index, index);
        const overview = panel('overview');
        expect(overview.querySelector('[data-insight="unstable"]')).toBeNull();
        expect(overview.querySelector('[data-insight="wake-ups"]')).not.toBeNull();
        expect(overview.textContent).not.toContain('This clock underproduces');
        // Diagnostics is mounted when shown
        expect(panel('diagnostics').textContent).toBe('');
    });

    it('opens on Diagnostics as the first thing there', async () => {
        const { user } = results(views, MILITARY_240.selected_index, index);
        await user.click(screen.getByRole('button', { name: 'See diagnostics' }));
        const first = panel('diagnostics').querySelector('[data-diagnostics] > *')!;
        expect(first.getAttribute('data-insight')).toBe('unstable');
        expect(panel('diagnostics').querySelectorAll('[data-insight]')).toHaveLength(1);
        expect(document.querySelectorAll('[data-insight="unstable"]')).toHaveLength(1);
    });

    it('where it was the clock\'s only note, Overview does not say that nothing stands out', () => {
        const automation = viewsOf(AUTOMATION_240);
        results(automation, AUTOMATION_240.selected_index, automation.findIndex(view => view.id === 'takt_batches_observed_swings_4'));
        expect(panel('overview').textContent).not.toContain('Nothing stands out');
        expect(panel('overview').textContent).toContain('Nothing else stands out. Diagnostics says why this clock does not keep its rate.');
    });
});
