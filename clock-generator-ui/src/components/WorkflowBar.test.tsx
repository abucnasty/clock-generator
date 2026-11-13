// @vitest-environment happy-dom
import { fireEvent, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { buildValidationIssues, isRefused } from '../utils/buildValidation';
import { CHECK_TEXT } from '../utils/checkThenGenerate';
import { WorkflowBar } from './WorkflowBar';

const opening = "No clock can hold this build's target:";
const problem = 'Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build. Lower the target.';
const none = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 1 }], chestIssues: [], coverageText: () => '' };

/** The bar as the page gives it, for the problems the last check found (none while the build has changed since) */
function bar(failure?: Parameters<typeof buildValidationIssues>[0]['failure'], onGenerate = vi.fn()) {
    const problems = buildValidationIssues({ ...none, failure }).filter(issue => issue.blocksGeneration);
    const props = { view: 'configure' as const, onViewChange: vi.fn(), isLoading: false, generationFailed: false,
        progressStore: { get: () => null, set: vi.fn(), subscribe: () => () => undefined }, onGenerate, onCheckOnly: vi.fn(),
        primaryAction: 'generate' as const, busy: false, checking: null, checkStatus: failure ? 'invalid' as const : 'none' as const,
        checkedForGenerate: true, chip: null, blueprintString: null, selectedLabel: null, selectedLine: null, selectedId: null,
        selectionQuiet: false, rateWarning: null, copyLabel: 'Copy blueprint', staleFor: null, copied: false, onCopy: vi.fn(),
        problems, refused: isRefused(problems), note: null, startHere: false, onGoToProblem: vi.fn(), running: false, onCancel: vi.fn(),
        lastStop: null, restoredId: 0, pickGone: null, identity: null, entryAction: null, menu: null };
    return props as unknown as Parameters<typeof WorkflowBar>[0];
}

const refusal = { message: `${opening} ${problem}`, diagnostics: [{ kind: 'refusal' as const, opening, problems: [problem, problem + ' '] }] };

it('turns Generate off while the build is refused, says why, and counts each problem', async () => {
    const onGenerate = vi.fn();
    const { user } = show(<WorkflowBar {...bar(refusal, onGenerate)} />);
    const generate = screen.getByRole('button', { name: 'Generate' });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    // the count chip is what it is described by
    expect(generate.getAttribute('aria-describedby')).toBe(screen.getByText('2 check errors').closest('[id]')?.id);
    await user.hover(generate.parentElement!);
    expect(await screen.findByText(CHECK_TEXT.generateRefusedTooltip)).toBeDefined();
    fireEvent.click(generate);
    expect(onGenerate).not.toHaveBeenCalled();
});

it('turns Generate on again once the build has changed and the refusal is gone', async () => {
    const onGenerate = vi.fn();
    const view = show(<WorkflowBar {...bar(refusal, onGenerate)} />);
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    // an edit makes the last check out of date: the page then hands over no failure
    view.rerender(<WorkflowBar {...bar(undefined, onGenerate)} />);
    const generate = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    expect(generate.getAttribute('aria-describedby')).toBeNull();
    await view.user.click(generate);
    expect(onGenerate).toHaveBeenCalledOnce();
});

it("does not open Copy's warning for the pointer it comes in under or the focus the bar moves to it; the player's move and focus open it", async () => {
    const warning = 'This clock has no recovery: the build does not go back to its rate by itself.';
    const props = bar();
    const view = show(<WorkflowBar {...props} />);
    // Generate turns off while the run goes, which drops the focus to the page; the bar moves it to Cancel
    view.rerender(<WorkflowBar {...props} running isLoading busy />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: CHECK_TEXT.cancel }));
    // the run ends with a clock that warns: Cancel goes, and the bar moves the focus to Copy
    view.rerender(<WorkflowBar {...props} primaryAction="copy-bar" blueprintString="0eNq" rateWarning={warning} />);
    const copy = screen.getByRole('button', { name: 'Copy blueprint' });
    expect(document.activeElement).toBe(copy);
    // Copy came in under a pointer that rests where Generate was: the browser gives a mouseover and no move
    fireEvent.mouseOver(copy);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseLeave(copy);
    // the player's move over Copy opens it, and leaving closes it
    await view.user.hover(copy);
    expect((await screen.findByRole('tooltip')).textContent).toContain(warning);
    await view.user.unhover(copy);
    await waitForElementToBeRemoved(() => screen.queryByRole('tooltip'));
    // the player's own focus opens it
    await view.user.tab({ shift: true });
    await view.user.tab();
    expect(document.activeElement).toBe(copy);
    expect((await screen.findByRole('tooltip')).textContent).toContain(warning);
});

it('leaves Generate on for the other blocking errors, which it goes to instead', () => {
    const fieldError = { message: 'x', diagnostics: [{ kind: 'field' as const, path: ['setpoint', 'recipe'], message: 'Required' }] };
    show(<WorkflowBar {...bar(fieldError)} />);
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(false);
});
