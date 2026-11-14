// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { names, pageWidth, show } from '../test/fixtures';
import { AUTOMATION_240, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240, viewsOf } from '../test/checkedLanesFixtures';
import { defaultBuildViewContext } from '../utils/buildViewContext';
import type { ResultDetail } from '../utils/resultsView';
import { rankOrderOf, recommendedIndexOf } from '../utils/recommendedClock';
import { statusOf } from '../utils/clockSummary';
import { fullClockName } from '../utils/strategyNames';
import { ResultsWorkspace } from './ResultsWorkspace';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'accumulator': 'Accumulator', 'supercapacitor': 'Supercapacitor', 'military-science-pack': 'Military science pack' });

type Props = ComponentProps<typeof ResultsWorkspace>;

/** The results of a kept result as the page shows them, with the selection and the workspace's tab kept as the page keeps them */
function Results({ alternatives, recommendedIndex, initialIndex, initialDetail, onDetailChange, onCardBackToRecommended, swingBackoffReport = null, isRunning = false }: {
    alternatives: ClockAlternativeView[]; recommendedIndex: number; initialIndex: number; initialDetail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void; onCardBackToRecommended: () => void; swingBackoffReport?: Props['swingBackoffReport'];
    isRunning?: boolean;
}) {
    const [selectedIndex, setSelectedIndex] = useState(initialIndex);
    const [detail, setDetail] = useState(initialDetail);
    const context = defaultBuildViewContext();
    const props: Props = {
        installOpen: false, onInstallClose: () => {}, onInstall: () => {}, copyLabel: 'Copy blueprint',
        wakeAsTable: false, onWakeAsTableChange: () => {},
        timeline: context.timeline, onTimelineChange: () => {},
        detail, onDetailChange: next => { onDetailChange(next); setDetail(next); },
        generatedFor: null, generationAssumptions: null, isRunning, error: null,
        alternatives, selectedIndex, onSelect: setSelectedIndex, recommendedIndex,
        onCardBackToRecommended: () => { onCardBackToRecommended(); setSelectedIndex(recommendedIndex); },
        pickRule: null, pending: [], skippedSearches: [], notMade: [], searchedDeeper: false, keptOn: false, canSearchDeeper: true,
        searchDeeperBlockedBy: null, onSearchDeeper: () => {}, blueprintString: null, simulationDurationTicks: null,
        transferHistory: null, stateTransitionHistory: null, fuelView: null, clockWindows: null, shiftOptions: null, swingBackoffReport,
        developerTools: false, logs: [], debugSteps: {} as Props['debugSteps'], onDebugStepsChange: () => {}, streamLogs: false,
        onStreamLogsChange: () => {}, onClearLogs: () => {}, staleFor: null, changes: [], onGenerate: () => {}, canGenerate: true,
        stoppedEarly: false, pickGone: null, copied: false, onCopy: () => {},
    };
    return <ResultsWorkspace {...props} />;
}

/** With nothing to wire: the install dialog, closed, reads it */
const withInstall = (clock: ClockAlternativeView): ClockAlternativeView => ({ ...clock, install: { book: false, wiring: [], drills: [], lines: {} } });

function results(alternatives: ClockAlternativeView[], recommendedIndex: number, initialIndex: number, initialDetail: ResultDetail = 'overview',
    swingBackoffReport: Props['swingBackoffReport'] = null) {
    const onDetailChange = vi.fn();
    const onCardBackToRecommended = vi.fn();
    const view = show(<Results alternatives={alternatives.map(withInstall)} recommendedIndex={recommendedIndex} initialIndex={initialIndex} initialDetail={initialDetail}
        onDetailChange={onDetailChange} onCardBackToRecommended={onCardBackToRecommended} swingBackoffReport={swingBackoffReport} />, { names: gameNames });
    return { ...view, onDetailChange, onCardBackToRecommended };
}

afterEach(() => pageWidth(1024));

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
        // every test of the stable clock passes: no line above its table
        expect(panel('diagnostics').textContent).not.toContain(stable.checkedLanes!.line.sentence);
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

    it('opens on Diagnostics as the first thing there after the tests of the clock', async () => {
        const { user } = results(views, MILITARY_240.selected_index, index);
        await user.click(screen.getByRole('button', { name: 'See diagnostics' }));
        const [tests, first] = panel('diagnostics').querySelectorAll('[data-diagnostics] > *');
        expect(tests.hasAttribute('data-test-pipeline')).toBe(true);
        expect(first.getAttribute('data-insight')).toBe('unstable');
        expect(panel('diagnostics').querySelectorAll('[data-insight]')).toHaveLength(1);
        expect(document.querySelectorAll('[data-insight="unstable"]')).toHaveLength(1);
    });

    it('where it was the clock\'s only note, Overview does not say that nothing stands out', () => {
        const automation = viewsOf(AUTOMATION_240);
        results(automation, AUTOMATION_240.selected_index, automation.findIndex(view => view.id === 'takt_batches_observed_swings_4'));
        expect(panel('overview').textContent).not.toContain('Nothing stands out');
        expect(panel('overview').textContent).toContain('Nothing else stands out. Diagnostics says why this clock is not stable.');
    });
});

describe('the note on swings at other ticks than the plan', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = views.findIndex(view => view.id === 'takt_batches_observed');
    const swings = views[index].insights.find(insight => insight.id === 'plan-versus-clock')!;

    it('is in the clock\'s data and not in Overview\'s notes; the clock\'s other notes are lines there', () => {
        expect(swings.scope).toBe('clock');
        results(views, AUTOMATION_240.selected_index, index);
        const overview = panel('overview');
        expect(overview.querySelector('[data-insight="plan-versus-clock"]')).toBeNull();
        expect(overview.textContent).not.toContain(swings.title);
        expect(overview.textContent).not.toContain(swings.what);
        expect(within(overview).getByRole('group', { name: views[index].insights.find(insight => insight.id === 'wake-ups')!.title })
            .getAttribute('data-insight')).toBe('wake-ups');
    });

    it('where it is the clock\'s only note, Overview says that nothing stands out on this clock', () => {
        const only = views.map((view, at) => at === index ? { ...view, insights: view.insights.filter(insight => insight.scope === 'build' || insight.id === 'plan-versus-clock') } : view);
        results(only, AUTOMATION_240.selected_index, index);
        expect(panel('overview').textContent).toContain('Nothing stands out on this clock.');
    });
});

describe('the list of clocks in place of the workspace\'s clock selector', () => {
    const military = viewsOf(MILITARY_240);
    const recommended = MILITARY_240.selected_index;
    /** The military clocks with clock `at` made to have `status`, as statusOf reads it */
    const withStatus = (at: number, status: string): ClockAlternativeView[] => military.map((view, index) => {
        if (index !== at) return view;
        const off = (rate_off_target: number, verdict: string) => ({ ...view, verdict, ranking: { ...view.ranking, meets_target_rate: false, rate_off_target },
            assessment: { ...view.assessment, items_per_second: view.assessment.items_per_second + rate_off_target } });
        switch (status) {
            case 'Underproduces': return off(-48, 'unstable') as ClockAlternativeView;
            case 'Overproduces': return off(12, 'unstable') as ClockAlternativeView;
            case 'No recovery': return { ...view, verdict: 'no recovery', assessment: { ...view.assessment,
                disturbance_trial: { survives: false, broken_by: ['an input stops arriving'], recovered_after_window_cycles: null } } } as ClockAlternativeView;
            case 'Error': return { ...view, assessment: { ...view.assessment, disturbance_trial: null } } as ClockAlternativeView;
            case 'Start-dependent': return { ...view, verdict: 'unstable', assessment: { ...view.assessment,
                start_dependence: { verdict: 'start-dependent', expected_output_items: 240, starts: [] } } } as ClockAlternativeView;
            default: return view;
        }
    });
    const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-clock-list] [data-clock-row="${id}"]`)!;

    it('stands in place of the selector: the workspace has none, and the list selects the clock the card and the tabs show', async () => {
        const { user, container } = results(military, recommended, recommended);
        expect(screen.queryByRole('combobox')).toBeNull();
        const other = military.findIndex((_, at) => at !== recommended);
        await user.click(rowOf(military[other].id).querySelector('[data-clock-name]')!);
        expect(container.querySelector('[data-result-card]')!.textContent).toContain(fullClockName(military[other]).split(' · ')[0]);
        expect((within(container.querySelector<HTMLElement>('[data-clock-list]')!).getAllByRole('radio') as HTMLInputElement[])
            .filter(radio => radio.checked).map(radio => radio.closest<HTMLElement>('[data-clock-row]')!.dataset.clockRow)).toEqual([military[other].id]);
    });

    it('says the swings and wakeups of a clock made for a belt, and no belt word; the recommended clock is rank 1', () => {
        expect(military[recommended].beltLabel).toBe('backed-up');
        results(military, recommended, recommended);
        const row = rowOf(military[recommended].id);
        expect(row.querySelector('[data-clock-swings]')!.textContent).toBe('2 swings');
        expect(row.querySelector('[data-wake-ups]')!.textContent).toBe('634');
        expect(row.querySelector('[data-rank]')!.textContent).toBe('1');
        expect(document.querySelector('[data-clock-list]')!.textContent).not.toMatch(/Backed up|Moving/);
    });

    it.each(['Underproduces', 'Overproduces', 'No recovery', 'Error', 'Start-dependent'])('%s: the row says the word once, out loud, and the mark of its status', status => {
        const clocks = withStatus(0, status);
        results(clocks, recommended, 0);
        const row = rowOf(clocks[0].id);
        const spoken = row.querySelector('input')!.getAttribute('aria-label')!;
        expect(spoken.split(status)).toHaveLength(2);
        expect(row.querySelector('[data-status-mark]')!.getAttribute('data-status-mark')).toBe(statusOf(clocks[0]).kind);
        // under the name, the rate where it makes too little or too much; the word otherwise
        const line = row.querySelector('[data-clock-swings]')!.textContent!;
        expect(line).toBe(['Underproduces', 'Overproduces'].includes(status) ? `2 swings · ${statusOf(clocks[0]).detail}` : `2 swings · ${status}`);
        expect(document.body.textContent).not.toContain('Not stable');
    });

    it('Stable: no word under the name, the mark of Stable', () => {
        results(military, recommended, 0);
        const row = rowOf(military[0].id);
        expect(row.querySelector('[data-clock-swings]')!.textContent).toBe('2 swings');
        expect(row.querySelector('[data-status-mark]')!.getAttribute('data-status-mark')).toBe('stable');
    });
});

describe('the compare table over the page', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;
    const compare = () => screen.getByRole('button', { name: `Compare all ${views.length}` });

    it('opens from the list, closes on Escape, and gives the focus back to the button', async () => {
        const { user } = results(views, index, index);
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.click(compare());
        const window = screen.getByRole('dialog', { name: /^Compare clocks/ });
        expect(within(window).getAllByRole('radio')).toHaveLength(views.length);
        await user.keyboard('{Escape}');
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(document.activeElement).toBe(compare());
    });

    it('closes from its close button, with the focus back on the button', async () => {
        const { user } = results(views, index, index);
        await user.click(compare());
        await user.click(within(screen.getByRole('dialog', { name: /^Compare clocks/ })).getByRole('button', { name: 'Close' }));
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(document.activeElement).toBe(compare());
    });

    it('selects the clock of a row it chooses, and stays open', async () => {
        const { user, container } = results(views, index, index);
        await user.click(compare());
        const other = views.find(view => view.id === 'euclidean_swings')!;
        await user.click(within(screen.getByRole('dialog', { name: /^Compare clocks/ })).getByRole('radio', { name: fullClockName(other) }));
        expect(screen.getByRole('dialog', { name: /^Compare clocks/ })).toBeTruthy();
        expect(container.querySelector('[data-result-card]')!.textContent).toContain(fullClockName(other).split(' · ')[0]);
        expect((document.querySelector<HTMLInputElement>(`[data-clock-row="${other.id}"] input`)!).checked).toBe(true);
    });
});

describe('Diagnostics beside the selected clock, from 1536 px', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = views.findIndex(view => view.id === 'euclidean_swings');

    it('is a column of its own and no tab from 1536 px, with no link to it on the card', () => {
        pageWidth(1536);
        const { container } = results(views, AUTOMATION_240.selected_index, index);
        expect(tabs().map(tab => tab.textContent)).toEqual(['Overview', 'Timeline']);
        const column = container.querySelector<HTMLElement>('[data-diagnostics-column]')!;
        expect(column.querySelector('[data-cause-headline]')!.textContent).toBe(views[index].checkedLanes!.cause!.headline.text);
        expect(within(container.querySelector<HTMLElement>('[data-result-card]')!).queryByRole('button', { name: 'See diagnostics' })).toBeNull();
        expect(document.getElementById('result-context-panel-diagnostics')).toBeNull();
        expect(container.querySelectorAll('[data-cause-headline]')).toHaveLength(1);
    });

    it('is a tab below 1536 px', () => {
        pageWidth(1535);
        const { container } = results(views, AUTOMATION_240.selected_index, index);
        expect(tabs().map(tab => tab.textContent)).toEqual(['Overview', 'Diagnostics', 'Timeline']);
        expect(container.querySelector('[data-diagnostics-column]')).toBeNull();
    });

    it('a saved Diagnostics view opens on Overview from 1536 px, and keeps Diagnostics saved for a narrower page', () => {
        pageWidth(1536);
        const { onDetailChange } = results(views, AUTOMATION_240.selected_index, index, 'diagnostics');
        expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
        expect(panel('overview').hidden).toBe(false);
        expect(onDetailChange).not.toHaveBeenCalled();
        // the same saved view on a narrower page
        cleanup();
        pageWidth(1280);
        results(views, AUTOMATION_240.selected_index, index, 'diagnostics');
        expect(tabs()[1].textContent).toBe('Diagnostics');
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    });

    it('is a tab again in fullscreen, which covers the column', async () => {
        pageWidth(1536);
        const { user } = results(views, AUTOMATION_240.selected_index, index);
        await user.click(screen.getByRole('button', { name: 'Open fullscreen' }));
        expect(tabs().map(tab => tab.textContent)).toEqual(['Overview', 'Diagnostics', 'Timeline']);
    });
});

describe('the page\'s columns', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;
    const columns = (container: HTMLElement) => getComputedStyle(container.querySelector<HTMLElement>('[data-results-columns]')!).gridTemplateColumns;

    it.each([[1920, '360px minmax(0, 1fr) minmax(0, 0.8fr)'], [1536, '360px minmax(0, 1fr) minmax(0, 0.8fr)'], [1280, '360px minmax(0, 1fr)'],
        [900, '360px minmax(0, 1fr)'], [390, 'minmax(0, 1fr)']])('at %s px: %s', (width, template) => {
        pageWidth(width);
        const { container } = results(views, index, index);
        expect(columns(container)).toBe(template);
        // the list first: on a phone it stands above the card
        const grid = container.querySelector<HTMLElement>('[data-results-columns]')!;
        expect(grid.firstElementChild!.querySelector('[data-clock-list]')).not.toBeNull();
    });

    it('has no column for the list before anything is made', () => {
        pageWidth(1920);
        const { container } = results([], 0, 0);
        expect(container.querySelector('[data-clock-list]')).toBeNull();
        expect(columns(container)).toBe('minmax(0, 1fr)');
    });
});

describe('the Overview tab', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;

    it('opens on "Model and tested starts": no "Why this clock", and the clock\'s description stays in its help', () => {
        results(views, index, index);
        const overview = panel('overview');
        expect(within(overview).queryByRole('heading', { name: 'Why this clock' })).toBeNull();
        expect(overview.textContent).not.toContain(views[index].description);
        expect(overview.textContent).not.toMatch(/The clock repeats every/);
        expect(overview.textContent!.startsWith('Model and tested starts')).toBe(true);
    });

    it('says a back-off that found a swing count that holds inside "Model and tested starts", in plain text, with its details', async () => {
        const report = { triggered: true, initial_terminal_swing_count: 4, stable_terminal_swing_count: 3, initial_attempt: { terminal_swing_count: 4, holds: false, actual_output_items: 320, expected_output_items: 336 }, attempts: [{ terminal_swing_count: 3, holds: true, actual_output_items: 336, expected_output_items: 336 }] };
        const { user } = results(views, index, index, 'overview', report as unknown as Props['swingBackoffReport']);
        const fold = panel('overview').querySelector<HTMLDetailsElement>('[data-model-assumptions]')!;
        const backoff = fold.querySelector('[data-swing-backoff]')!;
        expect(backoff.textContent).toContain('Output Swing Backoff Triggered');
        expect(backoff.textContent).toContain('Output swings reduced from 4 → 3 so the clock holds the rate');
        expect(backoff.closest('.MuiAlert-root')).toBeNull();
        expect(panel('overview').querySelectorAll('[data-swing-backoff]')).toHaveLength(1);
        expect(fold.open).toBe(false);
        fold.open = true;
        await user.click(within(backoff as HTMLElement).getByRole('button', { name: 'View Details' }));
        expect(await screen.findByRole('dialog', { name: 'Output Swing Backoff Report' })).toBeTruthy();
    });
});

describe('the card\'s Simulation results', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;

    it('leave the cold start, the drop positions, the inserter types and the Factorio version to Model and tested starts and the install steps', () => {
        const { container } = results(views, index, index);
        const fold = container.querySelector('[data-result-card] details')!;
        expect(fold.textContent).toContain('Simulation results');
        for (const gone of ['Tested in the simulator from a cold start', 'starting states', 'was not given, so each is treated',
            'have no type set', 'The blueprint needs Factorio 2.1 or later.']) expect(fold.textContent).not.toContain(gone);
        const model = panel('overview').querySelector('[data-model-assumptions]')!;
        expect(model.textContent).toContain('Tested from a cold start');
        expect(model.textContent).toContain('starting states');
    });
});

describe('the list while a run goes', () => {
    it('holds its rows while the run goes, and sorts them by rank when it ends', () => {
        const views = viewsOf(MILITARY_240).map(withInstall);
        const recommended = views[MILITARY_240.selected_index];
        const before = views.filter(view => view !== recommended);
        const at = (clocks: ClockAlternativeView[], isRunning: boolean) => <Results alternatives={clocks} recommendedIndex={recommendedIndexOf(clocks)!}
            initialIndex={0} initialDetail="overview" onDetailChange={() => {}} onCardBackToRecommended={() => {}} isRunning={isRunning} />;
        const { rerender } = show(at(before, true), { names: gameNames });
        const firstRow = () => document.querySelector<HTMLElement>('[data-clock-list] [data-clock-row]')!.dataset.clockRow;
        const first = firstRow();
        rerender(at(views, true));
        expect(firstRow()).toBe(first);
        rerender(at(views, false));
        expect(firstRow()).toBe(views[rankOrderOf(views)[0]].id);
        expect(firstRow()).toBe(recommended.id);
    });
});
