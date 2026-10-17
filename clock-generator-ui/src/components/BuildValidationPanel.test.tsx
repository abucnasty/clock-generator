import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildValidationPanel } from './BuildValidationPanel';
import { buildValidationIssues } from '../utils/buildValidation';
import { outputChestIssues } from '../utils/outputChestIssues';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';

it('renders one named validation panel with one chest error, preserving the repair without nested alerts', () => {
    const chests: ChestFormData[] = [{ id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [] }];
    const inserters: InserterFormData[] = [{ id: 2, _uuid: 'ins-2', stack_size: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } }];
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [], chests, inserters, machines: [], chestIssues: outputChestIssues(chests, inserters), coverageText: () => '' });
    const html = renderToStaticMarkup(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={chests} inserters={inserters}
        onApplyFix={() => {}} onSwitchType={() => {}} onEnableRemoval={() => {}} onReview={() => {}} />);
    expect(html).toContain('aria-label="Build validation"');
    expect(html.match(/>Chest 7 needs output removal enabled</g)).toHaveLength(1);
    expect(html).toContain('Enable Remove unfiltered items for Chest 7');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Advisory');
    expect(html).toContain('id="validation-issue-chest:7:removal-disabled"');
});
