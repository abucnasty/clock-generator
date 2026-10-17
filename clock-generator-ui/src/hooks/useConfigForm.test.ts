import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../utils/configForm/formData';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { useConfigForm } from './useConfigForm';

const runner = await vi.hoisted(async () => {
    const { createHookRunner } = await import('../test/hookRunner');
    return { ...createHookRunner(), persistence: vi.fn() };
});
vi.mock('react', () => runner.react);
vi.mock('./usePersistedConfigForm', () => ({ usePersistedConfigForm: runner.persistence }));
vi.mock('../utils/configForm/configMapping', async importOriginal => {
    const actual = await importOriginal<typeof import('../utils/configForm/configMapping')>();
    return { ...actual, formDataToConfig: vi.fn(actual.formDataToConfig) };
});

function Render() {
    runner.begin();
    const value = useConfigForm();
    runner.commit();
    return value;
}

beforeEach(() => { runner.reset(); vi.clearAllMocks(); });

describe('shared engine config', () => {
    it('shares one conversion across consumers and rerenders, and replaces it when the form changes', () => {
        const form = createDefaultConfig();
        const stored = { config: form, unchecked: null, setConfig: vi.fn() };
        runner.persistence.mockReturnValue(stored);
        const first = Render();
        expect(first.exportableConfig).toBe(first.engineConfig);
        expect(Render().engineConfig).toBe(first.engineConfig);
        expect(formDataToConfig).toHaveBeenCalledOnce();

        stored.config = { ...form, target_output: { ...form.target_output, copies: 5 } };
        const edited = Render();
        expect(edited.engineConfig).not.toBe(first.engineConfig);
        expect(edited.engineConfig.target_output.copies).toBe(5);
        expect(edited.exportableConfig).toBe(edited.engineConfig);
        expect(formDataToConfig).toHaveBeenCalledTimes(2);
    });

    it('keeps an unchecked saved build exportable without using it as the active engine config', () => {
        const form = createDefaultConfig(), unchecked = { ...form, target_output: { ...form.target_output, copies: 7 } };
        runner.persistence.mockReturnValue({ config: form, unchecked, setConfig: vi.fn() });
        const value = Render();
        expect(value.engineConfig.target_output.copies).toBe(form.target_output.copies);
        expect(value.exportableConfig?.target_output.copies).toBe(7);
        expect(value.exportableConfig).not.toBe(value.engineConfig);
    });
});
