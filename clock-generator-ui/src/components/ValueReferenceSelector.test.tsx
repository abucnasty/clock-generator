// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { EntityReference, TargetType, ValueReferenceType } from 'clock-generator/light';
import { expect, it, vi } from 'vitest';
import type { ValueReference } from '../hooks/useConfigForm';
import { show } from '../test/fixtures';
import { SELECT_NAMES } from '../utils/a11yLabels';
import { ValueReferenceSelector } from './ValueReferenceSelector';

it('shows a value of a type its list does not offer, a status on the right of a condition, as that type', () => {
    const status = { type: ValueReferenceType.MACHINE_STATUS, entity: EntityReference.SOURCE, status: 'WORKING' } as unknown as ValueReference;
    // MUI says the list does not hold the value, and nothing else is wrong
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    show(<ValueReferenceSelector value={status} onChange={vi.fn()} availableItems={[]} sourceType={TargetType.MACHINE} sinkType={TargetType.CHEST} />);
    expect(screen.getByRole('combobox', { name: SELECT_NAMES.valueType }).textContent).toBe(ValueReferenceType.MACHINE_STATUS);
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(warn.mock.calls.every(([message]) => String(message).includes(`out-of-range value \`${ValueReferenceType.MACHINE_STATUS}\``))).toBe(true);
    warn.mockRestore();
});
