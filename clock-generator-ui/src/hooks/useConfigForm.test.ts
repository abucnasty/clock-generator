// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../utils/configForm/formData';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { useConfigForm } from './useConfigForm';

const persistence = vi.hoisted(() => vi.fn());
vi.mock('./usePersistedConfigForm', () => ({ usePersistedConfigForm: persistence }));
vi.mock('../utils/configForm/configMapping', async importOriginal => {
    const actual = await importOriginal<typeof import('../utils/configForm/configMapping')>();
    return { ...actual, formDataToConfig: vi.fn(actual.formDataToConfig) };
});

beforeEach(() => { vi.clearAllMocks(); });

describe('shared engine config', () => {
    it('shares one conversion across consumers and rerenders, and replaces it when the form changes', () => {
        const form = createDefaultConfig();
        const stored = { config: form, unchecked: null, setConfig: vi.fn() };
        persistence.mockReturnValue(stored);
        const { result, rerender } = renderHook(() => useConfigForm());
        const first = result.current;
        expect(first.exportableConfig).toBe(first.engineConfig);
        rerender();
        expect(result.current.engineConfig).toBe(first.engineConfig);
        expect(formDataToConfig).toHaveBeenCalledOnce();

        stored.config = { ...form, target_output: { ...form.target_output, copies: 5 } };
        rerender();
        const edited = result.current;
        expect(edited.engineConfig).not.toBe(first.engineConfig);
        expect(edited.engineConfig.target_output.copies).toBe(5);
        expect(edited.exportableConfig).toBe(edited.engineConfig);
        expect(formDataToConfig).toHaveBeenCalledTimes(2);
    });

    it('keeps an unchecked saved build exportable without using it as the active engine config', () => {
        const form = createDefaultConfig(), unchecked = { ...form, target_output: { ...form.target_output, copies: 7 } };
        persistence.mockReturnValue({ config: form, unchecked, setConfig: vi.fn() });
        const value = renderHook(() => useConfigForm()).result.current;
        expect(value.engineConfig.target_output.copies).toBe(form.target_output.copies);
        expect(value.exportableConfig?.target_output.copies).toBe(7);
        expect(value.exportableConfig).not.toBe(value.engineConfig);
    });
});
