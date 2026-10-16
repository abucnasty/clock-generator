import { useTheme } from '@mui/material/styles';
import { themeTokens } from '../theme/runtimeTokens';
import { Clear, ExpandMore } from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Checkbox,
    FormControlLabel,
    IconButton,
    Paper,
    Typography,
} from '@mui/material';
import { useEffect, useId, useRef } from 'react';
import type { LogMessage, DebugSteps } from 'clock-generator/browser';

interface DebugPanelProps {
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (enabled: boolean) => void;
    onClearLogs: () => void;
}

const STEP_LABELS = {
    prepare: 'Prepare Step',
    warm_up: 'Warm Up Step',
    simulate: 'Simulate Step',
} as const;

export function DebugPanel({
    logs,
    debugSteps,
    onDebugStepsChange,
    streamLogs,
    onStreamLogsChange,
    onClearLogs,
}: DebugPanelProps) {
    const tokens = themeTokens(useTheme());
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length]);

    const handleStepToggle = (step: keyof typeof STEP_LABELS) => {
        onDebugStepsChange({
            ...debugSteps,
            [step]: !debugSteps[step],
        });
    };

    const getLogColor = (level: LogMessage['level']): string => {
        switch (level) {
            case 'error':
                return tokens.text.error;
            case 'warn':
                return tokens.role.yellow.main;
            case 'debug':
                return tokens.text.secondary;
            default:
                return 'inherit';
        }
    };

    const summaryId = useId();
    return (
        // in Developer tools' Log tab, which is there to be read: open, under the section's h2
        <Accordion defaultExpanded slotProps={{ heading: { component: 'h3' }, region: { 'aria-labelledby': summaryId } }}>
            <AccordionSummary id={summaryId} expandIcon={<ExpandMore />}>
                <Typography variant="h6" component="span">
                    Debug Output {logs.length > 0 && `(${logs.length} messages)`}
                </Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ mb: 2 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={streamLogs}
                                onChange={(e) => onStreamLogsChange(e.target.checked)}
                            />
                        }
                        label="Show generator log below"
                    />
                    <Typography variant="subtitle2" gutterBottom>
                        Enable debug logging for:
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        {Object.entries(STEP_LABELS).map(([step, label]) => (
                            <FormControlLabel
                                key={step}
                                control={
                                    <Checkbox
                                        checked={debugSteps[step as keyof typeof STEP_LABELS] ?? false}
                                        onChange={() => handleStepToggle(step as keyof typeof STEP_LABELS)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleStepToggle(step as keyof typeof STEP_LABELS);
                                            }
                                        }}
                                    />
                                }
                                label={label}
                            />
                        ))}
                    </Box>
                    <Typography variant="caption" gutterBottom>
                        The debug messages will appear in the browser console the next time you press Generate.
                    </Typography>
                </Box>

                <Paper
                    variant="outlined"
                    sx={{
                        bgcolor: tokens.surface.inset,
                        color: tokens.text.primary,
                        p: 1,
                        maxHeight: 400,
                        overflow: 'auto',
                        position: 'relative',
                    }}
                >
                    <IconButton
                        size="small"
                        onClick={onClearLogs}
                        sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            color: tokens.text.secondary,
                            '&:hover': { color: tokens.text.primary },
                        }}
                        title="Clear logs"
                    >
                        <Clear fontSize="small" />
                    </IconButton>

                    {logs.length === 0 ? (
                        <Typography
                            variant="body2"
                            sx={{ color: tokens.text.secondary, fontStyle: 'italic', py: 2, textAlign: 'center' }}
                        >
                            No logs yet. Turn on the generator log above and press Generate.
                        </Typography>
                    ) : (
                        <Box
                            component="pre"
                            sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                m: 0,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {logs.map((log, index) => (
                                <Box
                                    key={index}
                                    component="span"
                                    sx={{ color: getLogColor(log.level), display: 'block' }}
                                >
                                    {log.message}
                                </Box>
                            ))}
                            <div ref={logsEndRef} />
                        </Box>
                    )}
                </Paper>
            </AccordionDetails>
        </Accordion>
    );
}
