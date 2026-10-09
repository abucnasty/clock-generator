import { Download, Upload, ContentPaste, MoreVert, RestartAlt } from '@mui/icons-material';
import { Box, Button, Snackbar, Alert, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Typography, IconButton, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { useRef, useState, useCallback } from 'react';
import type { Config } from 'clock-generator/browser';
import { checkSidecarImport, Option, MachineConfigurationSchema, MiningDrillConfigSchema, InserterConfigSchema, BeltConfigSchema, ChestConfigSchema } from 'clock-generator/browser';
import type { z } from 'zod';

type MachineConfiguration = z.infer<typeof MachineConfigurationSchema>;
type MiningDrillConfiguration = z.infer<typeof MiningDrillConfigSchema>;
type InserterConfiguration = z.infer<typeof InserterConfigSchema>;
type BeltConfiguration = z.infer<typeof BeltConfigSchema>;
type ChestConfiguration = z.infer<typeof ChestConfigSchema>;

interface PendingImport {
    machines: MachineConfiguration[];
    drills: MiningDrillConfiguration[];
    inserters: InserterConfiguration[];
    belts: BeltConfiguration[];
    chests: ChestConfiguration[];
    miningProductivityLevel?: number;
    /** Guidance for the user from the import pipeline, e.g. that the sidecar mod is too old to export something */
    guidance?: Option<string>;
}

interface ImportSelections {
    machines: boolean;
    drills: boolean;
    inserters: boolean;
    belts: boolean;
    chests: boolean;
}

interface ConfigImportExportProps {
    config: Config;
    onImport: (config: Config) => void;
    onReplaceMachines: (machines: MachineConfiguration[]) => void;
    onReplaceDrills: (drills: MiningDrillConfiguration[]) => void;
    onReplaceInserters: (inserters: InserterConfiguration[]) => void;
    onReplaceBelts: (belts: BeltConfiguration[]) => void;
    onReplaceChests: (chests: ChestConfiguration[]) => void;
    onUpdateMiningProductivityLevel: (level: number) => void;
    onReset: () => void;
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
}: ConfigImportExportProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error';
    }>({ open: false, message: '', severity: 'success' });

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
        setSnackbar({
            open: true,
            message: 'Configuration exported successfully!',
            severity: 'success',
        });
    }, [config]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                const content = await file.text();
                
                const parsedConfig = JSON.parse(content) as Config;

                onImport(parsedConfig);
                setSnackbar({
                    open: true,
                    message: 'Configuration imported successfully!',
                    severity: 'success',
                });
            } catch (error) {
                console.error('Import error:', error);
                setSnackbar({
                    open: true,
                    message: `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    severity: 'error',
                });
            }

            // Reset the input so the same file can be imported again
            event.target.value = '';
        },
        [onImport]
    );

    const handleSnackbarClose = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

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

                // Validate machines (IDs are already assigned by the mod)
                const validatedMachines: MachineConfiguration[] = [];
                if (Array.isArray(data.machines)) {
                    for (let i = 0; i < data.machines.length; i++) {
                        const entry = data.machines[i];
                        const result = MachineConfigurationSchema.safeParse(entry);
                        if (!result.success) {
                            throw new Error(`Invalid machine at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                        }
                        validatedMachines.push(result.data);
                    }
                }

                // Validate drills (IDs are already assigned by the mod)
                const validatedDrills: MiningDrillConfiguration[] = [];
                if (Array.isArray(drillConfigs)) {
                    for (let i = 0; i < drillConfigs.length; i++) {
                        const entry = drillConfigs[i];
                        const result = MiningDrillConfigSchema.safeParse(entry);
                        if (!result.success) {
                            throw new Error(`Invalid drill at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                        }
                        validatedDrills.push(result.data);
                    }
                }

                // Validate inserters
                const validatedInserters: InserterConfiguration[] = [];
                if (Array.isArray(data.inserters)) {
                    for (let i = 0; i < data.inserters.length; i++) {
                        const entry = data.inserters[i];
                        const result = InserterConfigSchema.safeParse(entry);
                        if (!result.success) {
                            throw new Error(`Invalid inserter at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                        }
                        validatedInserters.push(result.data);
                    }
                }

                // Validate belts
                const validatedBelts: BeltConfiguration[] = [];
                if (Array.isArray(data.belts)) {
                    for (let i = 0; i < data.belts.length; i++) {
                        const entry = data.belts[i];
                        const result = BeltConfigSchema.safeParse(entry);
                        if (!result.success) {
                            throw new Error(`Invalid belt at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                        }
                        validatedBelts.push(result.data);
                    }
                }

                // Validate chests
                const validatedChests: ChestConfiguration[] = [];
                if (Array.isArray(data.chests)) {
                    for (let i = 0; i < data.chests.length; i++) {
                        const entry = data.chests[i];
                        const result = ChestConfigSchema.safeParse(entry);
                        if (!result.success) {
                            throw new Error(`Invalid chest at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                        }
                        validatedChests.push(result.data);
                    }
                }

                // Store pending import and show confirmation modal
                setPendingImport({
                    machines: validatedMachines,
                    drills: validatedDrills,
                    inserters: validatedInserters,
                    belts: validatedBelts,
                    chests: validatedChests,
                    miningProductivityLevel,
                    guidance: checkSidecarImport(data.sidecar_version, validatedMachines),
                });
                // Reset selections to include all available items
                setImportSelections({
                    machines: validatedMachines.length > 0,
                    drills: validatedDrills.length > 0,
                    inserters: validatedInserters.length > 0,
                    belts: validatedBelts.length > 0,
                    chests: validatedChests.length > 0,
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

            // Validate each machine entry (IDs are already assigned by the mod)
            const validatedMachines: MachineConfiguration[] = [];
            
            for (let i = 0; i < parsed.length; i++) {
                const entry = parsed[i];
                const result = MachineConfigurationSchema.safeParse(entry);
                if (!result.success) {
                    throw new Error(`Invalid machine at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
                }
                validatedMachines.push(result.data);
            }

            // Store pending import and show confirmation modal (legacy format - machines only)
            setPendingImport({
                machines: validatedMachines,
                drills: [],
                inserters: [],
                belts: [],
                chests: [],
                guidance: checkSidecarImport(undefined, validatedMachines),
            });
            setImportSelections({
                machines: true,
                drills: false,
                inserters: false,
                belts: false,
                chests: false,
            });
        } catch (error) {
            console.error('Paste from Factorio error:', error);
            setSnackbar({
                open: true,
                message: `Failed to paste: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'error',
            });
        }
    }, []);

    const handleConfirmImport = useCallback(() => {
        if (!pendingImport) return;

        const parts: string[] = [];

        if (importSelections.machines && pendingImport.machines.length > 0) {
            onReplaceMachines(pendingImport.machines);
            parts.push(`${pendingImport.machines.length} machines`);
        }
        if (importSelections.drills && pendingImport.drills.length > 0) {
            onReplaceDrills(pendingImport.drills);
            parts.push(`${pendingImport.drills.length} drills`);
            // Also update mining productivity level when importing drills
            if (pendingImport.miningProductivityLevel !== undefined) {
                onUpdateMiningProductivityLevel(pendingImport.miningProductivityLevel);
            }
        }
        if (importSelections.inserters && pendingImport.inserters.length > 0) {
            onReplaceInserters(pendingImport.inserters);
            parts.push(`${pendingImport.inserters.length} inserters`);
        }
        if (importSelections.belts && pendingImport.belts.length > 0) {
            onReplaceBelts(pendingImport.belts);
            parts.push(`${pendingImport.belts.length} belts`);
        }
        if (importSelections.chests && pendingImport.chests.length > 0) {
            onReplaceChests(pendingImport.chests);
            parts.push(`${pendingImport.chests.length} chests`);
        }

        setPendingImport(null);

        if (parts.length > 0) {
            setSnackbar({
                open: true,
                message: `Imported ${parts.join(', ')} from Factorio!`,
                severity: 'success',
            });
        } else {
            setSnackbar({
                open: true,
                message: 'No items selected for import.',
                severity: 'error',
            });
        }
    }, [pendingImport, importSelections, onReplaceMachines, onReplaceDrills, onReplaceInserters, onReplaceBelts, onReplaceChests, onUpdateMiningProductivityLevel]);

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
    }, [handlePasteFromFactorio]);

    const handleMenuReset = useCallback(() => {
        handleMenuClose();
        onReset();
    }, [onReset]);

    return (
        <>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Button
                    startIcon={<Upload />}
                    onClick={handleImportClick}
                    variant="outlined"
                    size="small"
                >
                    Import Config
                </Button>
                <Button
                    startIcon={<Download />}
                    onClick={handleExport}
                    variant="outlined"
                    size="small"
                >
                    Export Config
                </Button>
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
                    <MenuItem onClick={handleMenuReset}>
                        <ListItemIcon>
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

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={handleSnackbarClose} severity={snackbar.severity}>
                    {snackbar.message}
                </Alert>
            </Snackbar>

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
