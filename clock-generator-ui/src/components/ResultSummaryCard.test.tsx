// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, viewsOf } from '../test/checkedLanesFixtures';
import { ResultSummaryCard } from './ResultSummaryCard';

const card = (alternatives: ClockAlternativeView[], selectedIndex: number) => show(<ResultSummaryCard alternatives={alternatives} selectedIndex={selectedIndex}
    recommendedIndex={AUTOMATION_240.selected_index} onSelectRecommended={() => {}} pickRule={null} isGenerating={false} rateWarning={null} stale={false} />);

/** A clock kept before the engine gave the build's lanes and what was checked on them */
const keptBefore = (view: ClockAlternativeView): ClockAlternativeView => {
    const { checkedLanes: _checked, ...rest } = view;
    void _checked;
    return { ...rest, assumptions: { ...view.assumptions, lanes: undefined } };
};

describe('the card of a clock', () => {
    const views = viewsOf(AUTOMATION_240);

    it('says what was checked on the shared lanes, without opening "How this was checked"', () => {
        const { container } = card(views, AUTOMATION_240.selected_index);
        const checked = container.querySelector('[data-checked-lanes]')!;
        expect(checked.closest('details')).toBeNull();
        expect(checked.textContent).toContain('Made for 9 copies of your build.');
        expect(checked.textContent).toContain(checkedOf(AUTOMATION_240, 'time_study_windows').line.sentence);
        expect(screen.getByRole('button', { name: 'What was checked' })).toBeTruthy();
    });

    it('kept before the engine gave the lanes opens as it did: no line, no table, no error', () => {
        const { container } = card(views.map(keptBefore), AUTOMATION_240.selected_index);
        expect(container.querySelector('[data-result-card]')).not.toBeNull();
        expect(container.querySelector('[data-checked-lanes]')).toBeNull();
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        expect(container.textContent).not.toContain('Made for 9 copies of your build.');
    });
});
