import { Download, Upload, ContentPaste, MoreVert, RestartAlt } from '@mui/icons-material';
import { Box, Button, Alert, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Typography, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, useMediaQuery, useTheme } from '@mui/material';
import { useRef, useState, useCallback } from 'react';
import type { Config } from 'clock-generator/browser';
import { Option } from 'clock-generator/light';
import { readConfigFile } from '../hooks/useConfigForm';
import { useNotify } from '../hooks/useMessages';
import { describePaste, UNDO_IMPORT_MESSAGE, UNDO_RESET_MESSAGE } from '../utils/undoSnapshot';
import { askEngine } from '../worker/engineClient';
import type {
    BeltConfiguration,
    ChestConfiguration,
    InserterConfiguration,
    MachineConfiguration,
    MiningDrillConfiguration,
    PastedEntities,
} from '../worker/types';

interface PendingImport extends PastedEntities {
    miningProductivityLevel?: number;
}

interface ImportSelections {
    machines: boolean;
    drills: boolean;
    inserters: boolean;
    belts: boolean;
    chests: boolean;
}

interface ConfigImportExportProps {
    /** Null disables Export */
    config: Config | null;
    onImport: (config: Config) => void;
    onReplaceMachines: (machines: MachineConfiguration[]) => void;
    onReplaceDrills: (drills: MiningDrillConfiguration[]) => void;
    onReplaceInserters: (inserters: InserterConfiguration[]) => void;
    onReplaceBelts: (belts: BeltConfiguration[]) => void;
    onReplaceChests: (chests: ChestConfiguration[]) => void;
    onUpdateMiningProductivityLevel: (level: number) => void;
    onReset: () => void;
    /** Called after Import, Paste or Reset replaced the build, so the clocks and validation of the old one go */
    onBuildReplaced: () => void;
    /** Call just before the build is replaced, so the app can snapshot it for Undo; the message says what happened */
    onUndoable: (message: string) => void;
}

export function ConfigImportExport({
    config,
    onImport,
    onReplaceMachines,
    onReplaceDrills,
    onReplaceInserters,
    onReplaceBelts,
    onReplaceChests,
    onUpdateMiningProductivityLevel,
    onReset,
    onBuildReplaced,
    onUndoable,
}: ConfigImportExportProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    // below 900px the app bar has room for the title and the menu only: Import and Export move into the menu
    const narrow = useMediaQuery(useTheme().breakpoints.down('md'));
    const notify = useNotify();

    // State for the hamburger menu
    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
    const menuOpen = Boolean(menuAnchorEl);

    // State for the import confirmation modal
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
    const [importSelections, setImportSelections] = useState<ImportSelections>({
        machines: true,
        drills: true,
        inserters: true,
        belts: true,
        chests: true,
    });

    const handleExport = useCallback(() => {
        if (!config) return;
        const target_recipe_name = config.target_output.recipe
        const jsonString = JSON.stringify(config, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clock-config-${target_recipe_name}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify({ severity: 'success', text: 'Configuration exported successfully!' });
    }, [config, notify]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                const content = await file.text();
                // values out of bounds are kept, for the form to show; only a broken file is rejected
                const parsedConfig = await askEngine({ kind: 'config-file', config: readConfigFile(content) });

                // its Undo message says it was imported
                onUndoable(UNDO_IMPORT_MESSAGE);
                onImport(parsedConfig);
                onBuildReplaced();
            } catch (error) {
                console.error('Import error:', error);
                notify({ severity: 'error', text: `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}` });
            }

            // Reset the input so the same file can be imported again
            event.target.value = '';
        },
        [onImport, onBuildReplaced, onUndoable, notify]
    );

    const handlePasteFromFactorio = useCallback(async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            
            // Try to parse as JSON
            let parsed: unknown;
            try {
                parsed = JSON.parse(clipboardText);
            } catch {
                throw new Error('Clipboard does not contain valid JSON. Make sure to copy from the Factorio mod.');
            }

            // Check if it's the new format with machines and drills
            if (typeof parsed === 'object' && parsed !== null && 'machines' in parsed) {
                const data = parsed as { 
                    machines?: unknown[]; 
                    drills?: { mining_productivity_level?: number; configs?: unknown[] } | unknown[]; 
                    inserters?: unknown[]; 
                    belts?: unknown[];
                    chests?: unknown[];
                    sidecar_version?: unknown;
                };
                
                const machineCount = Array.isArray(data.machines) ? data.machines.length : 0;
                // Handle new drills format: { mining_productivity_level, configs: [...] }
                const drillsData = data.drills;
                const drillConfigs = drillsData && typeof drillsData === 'object' && !Array.isArray(drillsData) && 'configs' in drillsData
                    ? (drillsData.configs as unknown[])
                    : (Array.isArray(drillsData) ? drillsData : []);
                const miningProductivityLevel = drillsData && typeof drillsData === 'object' && !Array.isArray(drillsData) && 'mining_productivity_level' in drillsData
                    ? (drillsData.mining_productivity_level as number)
                    : undefined;
                const drillCount = Array.isArray(drillConfigs) ? drillConfigs.length : 0;
                const inserterCount = Array.isArray(data.inserters) ? data.inserters.length : 0;
                const beltCount = Array.isArray(data.belts) ? data.belts.length : 0;
                const chestCount = Array.isArray(data.chests) ? data.chests.length : 0;
                
                if (machineCount === 0 && drillCount === 0 && inserterCount === 0 && beltCount === 0 && chestCount === 0) {
                    throw new Error('No machines, drills, inserters, belts, or chests found in clipboard data.');
                }

                // Validate each list against its schema
                const validated = await askEngine({
                    kind: 'pasted-entities',
                    machines: data.machines,
                    drills: drillConfigs,
                    inserters: data.inserters,
                    belts: data.belts,
                    chests: data.chests,
                    sidecar_version: data.sidecar_version,
                });

                // Store pending import and show confirmation modal
                setPendingImport({ ...validated, miningProductivityLevel });
                // Reset selections to include all available items
                setImportSelections({
                    machines: validated.machines.length > 0,
                    drills: validated.drills.length > 0,
                    inserters: validated.inserters.length > 0,
                    belts: validated.belts.length > 0,
                    chests: validated.chests.length > 0,
                });
                return;
            }

            // Legacy format: array of machines
            if (!Array.isArray(parsed)) {
                throw new Error('Expected machines/drills object or array from Factorio mod.');
            }

            if (parsed.length === 0) {
                throw new Error('No machines found in clipboard data.');
            }

            // Validate each machine entry
            const validated = await askEngine({
                kind: 'pasted-entities',
                machines: parsed,
                drills: [],
                inserters: [],
                belts: [],
                chests: [],
                sidecar_version: undefined,
            });

            // Store pending import and show confirmation modal (legacy format - machines only)
            setPendingImport(validated);
            setImportSelections({
                machines: true,
                drills: false,
                inserters: false,
                belts: false,
                chests: false,
            });
        } catch (error) {
            console.error('Paste from Factorio error:', error);
            notify({ severity: 'error', text: `Failed to paste: ${error instanceof Error ? error.message : 'Unknown error'}` });
        }
    }, [notify]);

    const handleConfirmImport = useCallback(() => {
        if (!pendingImport) return;

        const machines = importSelections.machines && pendingImport.machines.length > 0;
        const drills = importSelections.drills && pendingImport.drills.length > 0;
        const inserters = importSelections.inserters && pendingImport.inserters.length > 0;
        const belts = importSelections.belts && pendingImport.belts.length > 0;
        const chests = importSelections.chests && pendingImport.chests.length > 0;
        const parts = [
            machines && `${pendingImport.machines.length} machines`,
            drills && `${pendingImport.drills.length} drills`,
            inserters && `${pendingImport.inserters.length} inserters`,
            belts && `${pendingImport.belts.length} belts`,
            chests && `${pendingImport.chests.length} chests`,
        ].filter((part) => part !== false);

        setPendingImport(null);

        if (parts.length === 0) {
            // not a failure: nothing was ticked
            notify({ severity: 'warning', text: 'No items selected for import.' });
            return;
        }

        // one Undo for the whole paste, taken before any of it is applied; its message says what was imported
        onUndoable(describePaste(parts));
        if (machines) {
            onReplaceMachines(pendingImport.machines);
        }
        if (drills) {
            onReplaceDrills(pendingImport.drills);
            // Also update mining productivity level when importing drills
            if (pendingImport.miningProductivityLevel !== undefined) {
                onUpdateMiningProductivityLevel(pendingImport.miningProductivityLevel);
            }
        }
        if (inserters) {
            onReplaceInserters(pendingImport.inserters);
        }
        if (belts) {
            onReplaceBelts(pendingImport.belts);
        }
        if (chests) {
            onReplaceChests(pendingImport.chests);
        }
        onBuildReplaced();
    }, [pendingImport, importSelections, onReplaceMachines, onReplaceDrills, onReplaceInserters, onReplaceBelts, onReplaceChests, onUpdateMiningProductivityLevel, onBuildReplaced, onUndoable, notify]);

    const handleCancelImport = useCallback(() => {
        setPendingImport(null);
    }, []);

    const handleSelectionChange = useCallback((key: keyof ImportSelections) => {
        setImportSelections(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    }, []);

    const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setMenuAnchorEl(event.currentTarget);
    }, []);

    const handleMenuClose = useCallback(() => {
        setMenuAnchorEl(null);
    }, []);

    const handleMenuPasteFromFactorio = useCallback(() => {
        handleMenuClose();
        handlePasteFromFactorio();
    }, [handleMenuClose, handlePasteFromFactorio]);

    // the file picker and the download are only allowed from the click itself: no await or timer before them
    const handleMenuImport = useCallback(() => {
        handleMenuClose();
        handleImportClick();
    }, [handleMenuClose, handleImportClick]);

    const handleMenuExport = useCallback(() => {
        handleMenuClose();
        handleExport();
    }, [handleMenuClose, handleExport]);

    const handleMenuReset = useCallback(() => {
        handleMenuClose();
        onUndoable(UNDO_RESET_MESSAGE);
        onReset();
        onBuildReplaced();
    }, [handleMenuClose, onReset, onBuildReplaced, onUndoable]);

    return (
        <>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {!narrow && (
                    <Button
                        startIcon={<Upload />}
                        onClick={handleImportClick}
                        variant="outlined"
                        size="small"
                    >
                        Import Config
                    </Button>
                )}
                {!narrow && (
                    <Button
                        startIcon={<Download />}
                        onClick={handleExport}
                        disabled={!config}
                        variant="outlined"
                        size="small"
                    >
                        Export Config
                    </Button>
                )}
                <Tooltip title="More options">
                    <IconButton
                        onClick={handleMenuOpen}
                        size="small"
                        color="inherit"
                    >
                        <MoreVert />
                    </IconButton>
                </Tooltip>
                <Menu
                    anchorEl={menuAnchorEl}
                    open={menuOpen}
                    onClose={handleMenuClose}
                    anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'right',
                    }}
                    transformOrigin={{
                        vertical: 'top',
                        horizontal: 'right',
                    }}
                >
                    <MenuItem onClick={handleMenuPasteFromFactorio}>
                        <ListItemIcon>
                            <ContentPaste fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Paste from Factorio</ListItemText>
                    </MenuItem>
                    {narrow && (
                        <MenuItem onClick={handleMenuImport}>
                            <ListItemIcon>
                                <Upload fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>Import Config</ListItemText>
                        </MenuItem>
                    )}
                    {narrow && (
                        <MenuItem onClick={handleMenuExport} disabled={!config}>
                            <ListItemIcon>
                                <Download fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>Export Config</ListItemText>
                        </MenuItem>
                    )}
                    <Divider />
                    {/* in the error colour: it throws the build away (Undo brings it back) */}
                    <MenuItem onClick={handleMenuReset} sx={{ color: 'error.main' }}>
                        <ListItemIcon sx={{ color: 'inherit' }}>
                            <RestartAlt fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Reset Configuration</ListItemText>
                    </MenuItem>
                </Menu>
            </Box>

            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />

            {/* Import Confirmation Dialog */}
            <Dialog open={pendingImport !== null} onClose={handleCancelImport} maxWidth="sm" fullWidth>
                <DialogTitle>Confirm Import from Factorio</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Select which items you want to import. Existing items of each selected type will be replaced.
                    </Typography>
                    
                    {pendingImport?.guidance && Option.match(pendingImport.guidance, {
                        none: () => null,
                        some: (message) => <Alert severity="warning" sx={{ mb: 2 }}>{message}</Alert>,
                    })}

                    {pendingImport && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={importSelections.machines}
                                        onChange={() => handleSelectionChange('machines')}
                                        disabled={pendingImport.machines.length === 0}
                                    />
                                }
                                label={`Machines (${pendingImport.machines.length})`}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={importSelections.drills}
                                        onChange={() => handleSelectionChange('drills')}
                                        disabled={pendingImport.drills.length === 0}
                                    />
                                }
                                label={`Drills (${pendingImport.drills.length})${pendingImport.miningProductivityLevel !== undefined ? ` - Mining Productivity ${pendingImport.miningProductivityLevel}` : ''}`}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={importSelections.inserters}
                                        onChange={() => handleSelectionChange('inserters')}
                                        disabled={pendingImport.inserters.length === 0}
                                    />
                                }
                                label={`Inserters (${pendingImport.inserters.length})`}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={importSelections.belts}
                                        onChange={() => handleSelectionChange('belts')}
                                        disabled={pendingImport.belts.length === 0}
                                    />
                                }
                                label={`Belts (${pendingImport.belts.length})`}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={importSelections.chests}
                                        onChange={() => handleSelectionChange('chests')}
                                        disabled={pendingImport.chests.length === 0}
                                    />
                                }
                                label={`Chests (${pendingImport.chests.length})`}
                            />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelImport}>Cancel</Button>
                    <Button 
                        onClick={handleConfirmImport} 
                        variant="contained" 
                        color="secondary"
                        disabled={!Object.values(importSelections).some(v => v)}
                    >
                        Import Selected
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
