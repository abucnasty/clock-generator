import { Box } from '@mui/material';
import type { ClockInsight, SwingBackoffReport } from 'clock-generator/browser';
import type { FuelViewData, ShiftOptionsView } from '../worker/types';
import { FuelPanel } from './FuelPanel';
import { Disclosure } from './Disclosure';
import { InsightsPanel } from './InsightsPanel';
import { ShiftRangePanel } from './ShiftRangePanel';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';

interface DetailsPanelProps {
    insights: ClockInsight[];
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
    fuelView: FuelViewData | null;
}

/** Findings are part of Overview directly, without another set of tabs. */
export function DetailsPanel(props: DetailsPanelProps) {
    return <Box sx={{ mt: 2 }} data-details="" data-build-anchor="details">
        <SwingBackoffReportDisplay report={props.swingBackoffReport} />
        <InsightsPanel insights={props.insights}>
            {props.shiftOptions && <ShiftRangePanel options={props.shiftOptions} />}
        </InsightsPanel>
        {props.fuelView && <Disclosure summary="Fuel use" sx={{ mt: 2 }}>
            <FuelPanel fuel={props.fuelView} />
        </Disclosure>}
    </Box>;
}
