import { useCallback, useMemo } from 'react';
import type {
    ChestType,
    Config,
    InserterCoverageIssue,
    InserterFixOption,
    SerializableTransferPlan,
} from 'clock-generator/browser';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import * as formEdits from '../utils/configForm/edits';
import type {
    BeltFormData,
    ChestFormData,
    ConfigFormData,
    DrillFormData,
    EntityKind,
    InserterFormData,
    MachineFormData,
} from '../utils/configForm/formData';
import { applyInserterFix } from '../utils/configForm/inserterFix';
import { usePersistedConfigForm, type BuildLibrary, type BuildMutationSnapshot } from './usePersistedConfigForm';
export type { BuildMutationSnapshot } from './usePersistedConfigForm';

// The form data types and helpers, for the components that use the form
export {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_STRATEGIES,
    LANE_CONSUMPTION_TOOLTIP,
    beltStrategyUpdate,
    containerItems,
    isBufferChest,
    isContainerChest,
    isInfinityChest,
} from '../utils/configForm/formData';
export type {
    BeltFormData,
    BeltLaneFormData,
    BeltStrategyFormValue,
    BufferChestFormData,
    ChestFormData,
    Condition,
    DrillFormData,
    EnableControlOverride,
    InserterFormData,
    MachineFormData,
    RuleSet,
    ValueReference,
} from '../utils/configForm/formData';
export { readConfigFile } from './usePersistedConfigForm';

interface UseConfigFormResult {
    config: ConfigFormData;
    /** False until the config saved in localStorage is checked and loaded */
    isLoaded: boolean;
    /** Why the saved config could not be checked, so it is never loaded; null otherwise */
    loadError: string | null;
    /** Tells the user the saved config could not be loaded and where it was backed up; null when there is no news */
    loadNotice: string | null;
    dismissLoadNotice: () => void;
    /** Your builds: the builds kept in this browser, and the one open in this tab */
    library: BuildLibrary;
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>;
    captureBuildMutation: () => BuildMutationSnapshot;
    commitBuildReplacement: (expected: BuildMutationSnapshot, next: ConfigFormData, beforeCommit: () => void) => boolean;
    
    duplicateEntity: (kind: EntityKind, index: number) => void;
    updateInserters: (uuids: readonly string[], updates: Partial<InserterFormData>) => void;

    // Target output
    updateTargetOutput: (field: keyof ConfigFormData['target_output'], value: string | number) => void;
    
    // Machines
    addMachine: () => void;
    updateMachine: (index: number, field: keyof MachineFormData, value: string | number) => void;
    /** Sets several fields of a machine as one edit; a field set to undefined is removed */
    patchMachine: (index: number, patch: Partial<MachineFormData>) => void;
    removeMachine: (index: number) => void;
    reorderMachines: (fromIndex: number, toIndex: number) => void;
    
    // Inserters
    addInserter: () => void;
    updateInserter: (index: number, updates: Partial<InserterFormData>) => void;
    removeInserter: (index: number) => void;
    reorderInserters: (fromIndex: number, toIndex: number) => void;
    
    // Belts
    addBelt: () => void;
    updateBelt: (index: number, updates: Partial<BeltFormData>) => void;
    removeBelt: (index: number) => void;
    reorderBelts: (fromIndex: number, toIndex: number) => void;
    
    // Chests
    addChest: (chestType?: ChestType) => void;
    updateChest: (index: number, updates: Partial<ChestFormData>) => void;
    switchChestType: (index: number, newType: ChestType, disposal?: boolean) => void;
    removeChest: (index: number) => void;
    reorderChests: (fromIndex: number, toIndex: number) => void;
    
    // Drills
    addDrill: () => void;
    updateDrill: (index: number, updates: Partial<DrillFormData>) => void;
    removeDrill: (index: number) => void;
    reorderDrills: (fromIndex: number, toIndex: number) => void;
    
    // Overrides
    updateOverrides: (field: keyof NonNullable<ConfigFormData['overrides']>, value: number | boolean | string[] | undefined) => void;
    updateIgnoredIngredients: (items: string[], transferPlan: SerializableTransferPlan) => void;
    
    // Import/Export
    importConfig: (config: Config, prototypeSource?: MachineFormData['_prototype_source']) => void;
    /** Engine config derived once for this form revision, shared by validation and generation. */
    engineConfig: Config;
    /**
     * The config Export gives: until the saved config is loaded, that one rather than the defaults, so it can be saved
     * even when the engine's worker fails to start; null when it cannot be turned into a config
     */
    exportableConfig: Config | null;
    resetConfig: () => void;

    // Inserter fix auto-fill
    applyInserterFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
}

export function useConfigForm(): UseConfigFormResult {
    const { config, setConfig, resetConfig, captureBuildMutation, commitBuildReplacement,
        isLoaded, loadError, unchecked, loadNotice, dismissLoadNotice, library } = usePersistedConfigForm();

    // Each edit applies its plain function of the form state
    const edits = useMemo(() => {
        const edit = <A extends unknown[]>(fn: (prev: ConfigFormData, ...args: A) => ConfigFormData) =>
            (...args: A) => setConfig((prev) => fn(prev, ...args));
        return {
            duplicateEntity: edit(formEdits.duplicateEntity),
            updateInserters: edit(formEdits.updateInserters),
            updateTargetOutput: edit(formEdits.updateTargetOutput),
            addMachine: edit(formEdits.addMachine),
            updateMachine: edit(formEdits.updateMachine),
            patchMachine: edit(formEdits.patchMachine),
            removeMachine: edit(formEdits.removeMachine),
            reorderMachines: edit(formEdits.reorderMachines),
            addInserter: edit(formEdits.addInserter),
            updateInserter: edit(formEdits.updateInserter),
            removeInserter: edit(formEdits.removeInserter),
            reorderInserters: edit(formEdits.reorderInserters),
            addBelt: edit(formEdits.addBelt),
            updateBelt: edit(formEdits.updateBelt),
            removeBelt: edit(formEdits.removeBelt),
            reorderBelts: edit(formEdits.reorderBelts),
            addChest: edit(formEdits.addChest),
            updateChest: edit(formEdits.updateChest),
            switchChestType: edit(formEdits.switchChestType),
            removeChest: edit(formEdits.removeChest),
            reorderChests: edit(formEdits.reorderChests),
            addDrill: edit(formEdits.addDrill),
            updateDrill: edit(formEdits.updateDrill),
            removeDrill: edit(formEdits.removeDrill),
            reorderDrills: edit(formEdits.reorderDrills),
            updateOverrides: edit(formEdits.updateOverrides),
            updateIgnoredIngredients: edit(formEdits.updateIgnoredIngredients),
            applyInserterFix: edit(applyInserterFix),
        };
    }, [setConfig]);

    // Import/Export
    const importConfig = useCallback((imported: Config, prototypeSource?: MachineFormData['_prototype_source']) => {
        setConfig(configToFormData(imported, prototypeSource));
    }, [setConfig]);

    const engineConfig = useMemo(() => formDataToConfig(config), [config]);

    const exportableConfig = useMemo((): Config | null => {
        if (unchecked === null) {
            return engineConfig;
        }
        try {
            return formDataToConfig(unchecked);
        } catch {
            return null;
        }
    }, [unchecked, engineConfig]);

    return {
        config,
        isLoaded,
        loadError,
        loadNotice,
        dismissLoadNotice,
        library,
        setConfig,
        captureBuildMutation,
        commitBuildReplacement,
        ...edits,
        importConfig,
        engineConfig,
        exportableConfig,
        resetConfig,
    };
}
