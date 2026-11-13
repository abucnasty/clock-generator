// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
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
function Results({ alternatives, recommendedIndex, initialIndex, initialDetail, onDetailChange, onCardBackToRecommended, swingBackoffReport = null }: {
    alternatives: ClockAlternativeView[]; recommendedIndex: number; initialIndex: number; initialDetail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void; onCardBackToRecommended: () => void; swingBackoffReport?: Props['swingBackoffReport'];
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
        transferHistory: null, stateTransitionHistory: null, fuelView: null, clockWindows: null, shiftOptions: null, swingBackoffReport,
        developerTools: false, logs: [], debugSteps: {} as Props['debugSteps'], onDebugStepsChange: () => {}, streamLogs: false,
        onStreamLogsChange: () => {}, onClearLogs: () => {}, staleFor: null, changes: [], onGenerate: () => {}, canGenerate: true,
        stoppedEarly: false, pickGone: null, copied: false, onCopy: () => {},
    };
    return <ResultsWorkspace {...props} />;
}

function results(alternatives: ClockAlternativeView[], recommendedIndex: number, initialIndex: number, initialDetail: ResultDetail = 'overview',
    swingBackoffReport: Props['swingBackoffReport'] = null) {
    const onDetailChange = vi.fn();
    const onCardBackToRecommended = vi.fn();
    // with nothing to wire: the install dialog, closed, reads it
    const withInstall = alternatives.map(clock => ({ ...clock, install: { book: false, wiring: [], drills: [], lines: {} } }));
    const view = show(<Results alternatives={withInstall} recommendedIndex={recommendedIndex} initialIndex={initialIndex} initialDetail={initialDetail}
        onDetailChange={onDetailChange} onCardBackToRecommended={onCardBackToRecommended} swingBackoffReport={swingBackoffReport} />, { names: gameNames });
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

describe('the workspace\'s clock selector', () => {
    const military = viewsOf(MILITARY_240);
    /** The selector's line of each clock it offers, as the open list shows it */
    const linesOf = async (alternatives: ClockAlternativeView[]) => {
        const { user } = results(alternatives, MILITARY_240.selected_index, MILITARY_240.selected_index);
        await user.click(screen.getByRole('combobox'));
        return within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.querySelector('p, span')!.textContent);
    };

    it('says swings and wakeups of a clock made for a belt, and no belt word', async () => {
        expect(military[MILITARY_240.selected_index].beltLabel).toBe('backed-up');
        const lines = await linesOf(military);
        expect(lines).toContain('2 swings · 634 wakeups/min · Recommended');
        for (const line of lines) expect(line).not.toMatch(/Backed up|Moving| · $/);
    });

    it('says the same of a clock where no clocked inserter picks up from a belt, with no " · " left over', async () => {
        const lines = await linesOf(military.map(view => ({ ...view, beltLabel: '', belt: undefined })));
        expect(lines).toContain('2 swings · 634 wakeups/min · Recommended');
        for (const line of lines) expect(line).not.toMatch(/None| · $/);
    });
});

describe('the clock selector says the status of a clock that is not Stable', () => {
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
    /** The selector's label, and the lines of the clocks in the open list */
    const selectorOf = async (alternatives: ClockAlternativeView[], selected: number) => {
        const { user } = results(alternatives, recommended, selected);
        const label = [...document.querySelectorAll('label')].find(it => it.textContent!.startsWith('Clock'))!.textContent;
        await user.click(screen.getByRole('combobox'));
        const options = within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.querySelector('p, span')!.textContent!);
        return { label, options };
    };

    it.each(['Underproduces', 'Overproduces', 'No recovery', 'Error', 'Start-dependent'])('%s: "Clock · %s", and its line ends with the word', async status => {
        const { label, options } = await selectorOf(withStatus(0, status), 0);
        expect(label).toBe(`Clock · ${status}`);
        expect(options[0]).toBe(`2 swings · 765 wakeups/min · ${status}`);
        expect(options.join('\n')).not.toContain('Not stable');
    });

    it('Stable: "Clock" with no word, and nothing after its line; the recommended clock "Clock · Recommended"', async () => {
        const { label, options } = await selectorOf(military, 0);
        expect(label).toBe('Clock');
        expect(options[0]).toBe('2 swings · 765 wakeups/min');
        cleanup();
        expect((await selectorOf(military, recommended)).label).toBe('Clock · Recommended');
    });

    it('keeps the order of today: the status before Recommended in the label, Recommended before the status in a line', async () => {
        const { label, options } = await selectorOf(withStatus(recommended, 'No recovery'), recommended);
        expect(label).toBe('Clock · No recovery');
        expect(options).toContain('2 swings · 634 wakeups/min · Recommended');
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
