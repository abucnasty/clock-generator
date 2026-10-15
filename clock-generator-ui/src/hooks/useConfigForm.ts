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
    InserterFormData,
    MachineFormData,
} from '../utils/configForm/formData';
import { applyInserterFix } from '../utils/configForm/inserterFix';
import { usePersistedConfigForm, type BuildLibrary } from './usePersistedConfigForm';

// The form data types and helpers, for the components that use the form
export {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_STRATEGIES,
    LANE_CONSUMPTION_TOOLTIP,
    beltStrategyUpdate,
    isBufferChest,
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
    
    // Target output
    updateTargetOutput: (field: keyof ConfigFormData['target_output'], value: string | number) => void;
    
    // Machines
    addMachine: () => void;
    updateMachine: (index: number, field: keyof MachineFormData, value: string | number) => void;
    removeMachine: (index: number) => void;
    reorderMachines: (fromIndex: number, toIndex: number) => void;
    mergeMachines: (machines: MachineFormData[]) => void;
    replaceMachines: (machines: MachineFormData[]) => void;
    
    // Inserters
    addInserter: () => void;
    updateInserter: (index: number, updates: Partial<InserterFormData>) => void;
    removeInserter: (index: number) => void;
    reorderInserters: (fromIndex: number, toIndex: number) => void;
    replaceInserters: (inserters: InserterFormData[]) => void;
    
    // Belts
    addBelt: () => void;
    updateBelt: (index: number, updates: Partial<BeltFormData>) => void;
    removeBelt: (index: number) => void;
    reorderBelts: (fromIndex: number, toIndex: number) => void;
    replaceBelts: (belts: BeltFormData[]) => void;
    
    // Chests
    addChest: (chestType?: ChestType) => void;
    updateChest: (index: number, updates: Partial<ChestFormData>) => void;
    switchChestType: (index: number, newType: ChestType) => void;
    removeChest: (index: number) => void;
    reorderChests: (fromIndex: number, toIndex: number) => void;
    replaceChests: (chests: ChestFormData[]) => void;
    
    // Drills
    enableDrills: () => void;
    disableDrills: () => void;
    updateDrillsConfig: (field: 'mining_productivity_level', value: number) => void;
    addDrill: () => void;
    updateDrill: (index: number, updates: Partial<DrillFormData>) => void;
    removeDrill: (index: number) => void;
    reorderDrills: (fromIndex: number, toIndex: number) => void;
    mergeDrills: (drills: DrillFormData[]) => void;
    replaceDrills: (drills: DrillFormData[]) => void;
    
    // Overrides
    updateOverrides: (field: keyof NonNullable<ConfigFormData['overrides']>, value: number | boolean | string[] | undefined) => void;
    updateIgnoredIngredients: (items: string[], transferPlan: SerializableTransferPlan) => void;
    
    // Import/Export
    importConfig: (config: Config) => void;
    exportConfig: () => Config;
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
    const { config, setConfig, resetConfig, isLoaded, loadError, unchecked, loadNotice, dismissLoadNotice, library } = usePersistedConfigForm();

    // Each edit applies its plain function of the form state
    const edits = useMemo(() => {
        const edit = <A extends unknown[]>(fn: (prev: ConfigFormData, ...args: A) => ConfigFormData) =>
            (...args: A) => setConfig((prev) => fn(prev, ...args));
        return {
            updateTargetOutput: edit(formEdits.updateTargetOutput),
            addMachine: edit(formEdits.addMachine),
            updateMachine: edit(formEdits.updateMachine),
            removeMachine: edit(formEdits.removeMachine),
            reorderMachines: edit(formEdits.reorderMachines),
            mergeMachines: edit(formEdits.mergeMachines),
            replaceMachines: edit(formEdits.replaceMachines),
            addInserter: edit(formEdits.addInserter),
            updateInserter: edit(formEdits.updateInserter),
            removeInserter: edit(formEdits.removeInserter),
            reorderInserters: edit(formEdits.reorderInserters),
            replaceInserters: edit(formEdits.replaceInserters),
            addBelt: edit(formEdits.addBelt),
            updateBelt: edit(formEdits.updateBelt),
            removeBelt: edit(formEdits.removeBelt),
            reorderBelts: edit(formEdits.reorderBelts),
            replaceBelts: edit(formEdits.replaceBelts),
            addChest: edit(formEdits.addChest),
            updateChest: edit(formEdits.updateChest),
            switchChestType: edit(formEdits.switchChestType),
            removeChest: edit(formEdits.removeChest),
            reorderChests: edit(formEdits.reorderChests),
            replaceChests: edit(formEdits.replaceChests),
            enableDrills: edit(formEdits.enableDrills),
            disableDrills: edit(formEdits.disableDrills),
            updateDrillsConfig: edit(formEdits.updateDrillsConfig),
            addDrill: edit(formEdits.addDrill),
            updateDrill: edit(formEdits.updateDrill),
            removeDrill: edit(formEdits.removeDrill),
            reorderDrills: edit(formEdits.reorderDrills),
            mergeDrills: edit(formEdits.mergeDrills),
            replaceDrills: edit(formEdits.replaceDrills),
            updateOverrides: edit(formEdits.updateOverrides),
            updateIgnoredIngredients: edit(formEdits.updateIgnoredIngredients),
            applyInserterFix: edit(applyInserterFix),
        };
    }, [setConfig]);

    // Import/Export
    const importConfig = useCallback((imported: Config) => {
        setConfig(configToFormData(imported));
    }, [setConfig]);

    const exportConfig = useCallback((): Config => formDataToConfig(config), [config]);

    const exportableConfig = useMemo((): Config | null => {
        if (unchecked === null) {
            return exportConfig();
        }
        try {
            return formDataToConfig(unchecked);
        } catch {
            return null;
        }
    }, [unchecked, exportConfig]);

    return {
        config,
        isLoaded,
        loadError,
        loadNotice,
        dismissLoadNotice,
        library,
        setConfig,
        ...edits,
        importConfig,
        exportConfig,
        exportableConfig,
        resetConfig,
    };
}
