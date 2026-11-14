import { Box } from '@mui/material';
import type { ClockInsight, SwingBackoffReport } from 'clock-generator/browser';
import type { FuelViewData, ShiftOptionsView } from '../worker/types';
import { FuelPanel } from './FuelPanel';
import { Disclosure } from './Disclosure';
import type { NoteInserter } from './ClockNoteLine';
import { InsightsPanel } from './InsightsPanel';
import { hasShiftPlaces } from '../utils/clockNotes';
import { ShiftRangePanel } from './ShiftRangePanel';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';

interface DetailsPanelProps {
    insights: ClockInsight[];
    /** What the clock's notes say when it has none here */
    nothing?: string;
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
    fuelView: FuelViewData | null;
    /** The saved configuration's inserters, which the notes' chips draw */
    inserters?: readonly NoteInserter[];
}

/** Findings are part of Overview directly, without another set of tabs. */
export function DetailsPanel(props: DetailsPanelProps) {
    return <Box sx={{ mt: 2 }} data-details="" data-build-anchor="details">
        {/* a back-off that found a swing count that holds is in Model and tested starts */}
        <SwingBackoffReportDisplay report={props.swingBackoffReport} shows="failed" />
        <InsightsPanel insights={props.insights} nothing={props.nothing} inserters={props.inserters}>
            {props.shiftOptions && hasShiftPlaces(props.shiftOptions) && <ShiftRangePanel options={props.shiftOptions} />}
        </InsightsPanel>
        {props.fuelView && <Disclosure summary="Fuel use" sx={{ mt: 2 }}>
            <FuelPanel fuel={props.fuelView} />
        </Disclosure>}
    </Box>;
}
