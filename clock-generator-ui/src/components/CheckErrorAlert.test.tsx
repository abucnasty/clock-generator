// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { CHECK_TEXT } from '../utils/checkThenGenerate';
import { CheckErrorAlert } from './CheckErrorAlert';

vi.stubGlobal('__APP_VERSION__', '9.9.9');

it('shows an unexpected error as an internal error, not as a refusal, with the details to copy', () => {
    show(<CheckErrorAlert crashed message="Cannot convert undefined or null to object"
        internal={{ message: 'Cannot convert undefined or null to object', stack: 'TypeError: at f', dataMismatch: false }} />);
    expect(screen.getByText(CHECK_TEXT.internalTitle)).toBeTruthy();
    expect(screen.getByText(CHECK_TEXT.internalText)).toBeTruthy();
    expect(screen.queryByText(CHECK_TEXT.errorTitle)).toBeNull();
    expect(screen.getByTestId('internal-error-details').textContent).toBe('Cannot convert undefined or null to object\nTypeError: at f\nPage version: 9.9.9');
    expect(screen.getByRole('button', { name: CHECK_TEXT.internalCopy })).toBeTruthy();
});

it('says so when the game data does not match the generator', () => {
    show(<CheckErrorAlert crashed message="x" internal={{ message: 'x', dataMismatch: true }} />);
    expect(screen.getByText(CHECK_TEXT.internalDataText)).toBeTruthy();
});

it('still shows an engine refusal as a refusal', () => {
    show(<CheckErrorAlert message="No clock fits" />);
    expect(screen.getByText(CHECK_TEXT.errorTitle)).toBeTruthy();
    expect(screen.queryByText(CHECK_TEXT.internalTitle)).toBeNull();
});
