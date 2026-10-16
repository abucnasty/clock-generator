import { Tab, Tabs } from '@mui/material';
import { useState } from 'react';
import type { ClockInsight, SwingBackoffReport } from 'clock-generator/browser';
import type { FuelViewData, ShiftOptionsView } from '../worker/types';
import type { GeneratedFor } from '../utils/resultsStaleness';
import { TABLIST_NAMES } from '../utils/a11yLabels';
import { BlueprintOutput } from './BlueprintOutput';
import { FuelPanel } from './FuelPanel';
import { InsightsPanel } from './InsightsPanel';
import { Panel } from './Panel';
import { ShiftRangePanel } from './ShiftRangePanel';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';
import { TabBody } from './TabBody';
import { tabProps } from '../utils/tabIds';

type DetailsTab = 'insights' | 'fuel' | 'blueprint';

const DETAILS_COPY = {
    heading: 'Details',
    insights: 'Insights',
    fuel: 'Fuel',
    blueprint: 'Blueprint string',
};

/** The tabs' ids start with this */
const PREFIX = 'details';

interface DetailsPanelProps {
    /** The selected clock's findings */
    insights: ClockInsight[];
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
    /** Fuel use and the exported fuel clocks of the selected clock; null when no inserter only fills a fuel slot */
    fuelView: FuelViewData | null;
    blueprintString: string | null;
    simulationDurationTicks: number | null;
    rateWarning: string | null;
    staleFor: GeneratedFor | null;
    copied: boolean;
    onCopy: () => void;
}

/**
 * What there is to know about the selected clock beyond the answer at the top: its insights (the default), its fuel
 * (only for a build with fuel inserters) and its blueprint string.
 */
export function DetailsPanel(props: DetailsPanelProps) {
    const [tab, setTab] = useState<DetailsTab>('insights');
    const { fuelView } = props;
    // the fuel tab is only there for a build with fuel inserters
    const shownTab: DetailsTab = tab === 'fuel' && fuelView === null ? 'insights' : tab;

    return (
        <Panel title={DETAILS_COPY.heading} level={3} sx={{ mt: 2, mb: 0 }} data-details="">
            <Tabs
                value={shownTab}
                onChange={(_, value: DetailsTab) => setTab(value)}
                // the arrow keys show the tab they move to
                selectionFollowsFocus
                aria-label={TABLIST_NAMES.details}
                sx={{ borderBottom: 1, borderColor: 'divider',
                    // Ordinary navigation stays in the narrow view; Tab's existing labels can wrap.
                    '& .MuiTab-root': { minWidth: { xs: 0, sm: 90 }, flex: { xs: '1 1 0', sm: '0 0 auto' }, px: { xs: 1, sm: 2 } },
                }}
            >
                <Tab value="insights" label={DETAILS_COPY.insights} {...tabProps(PREFIX, 'insights')} />
                {fuelView !== null && <Tab value="fuel" label={DETAILS_COPY.fuel} {...tabProps(PREFIX, 'fuel')} />}
                <Tab value="blueprint" label={DETAILS_COPY.blueprint} {...tabProps(PREFIX, 'blueprint')} />
            </Tabs>

            <TabBody prefix={PREFIX} tab="insights" shown={shownTab === 'insights'}>
                <SwingBackoffReportDisplay report={props.swingBackoffReport} />
                <InsightsPanel insights={props.insights}>
                    {props.shiftOptions && <ShiftRangePanel options={props.shiftOptions} />}
                </InsightsPanel>
            </TabBody>

            {fuelView !== null && (
                <TabBody prefix={PREFIX} tab="fuel" shown={shownTab === 'fuel'}>
                    <FuelPanel fuel={fuelView} />
                </TabBody>
            )}

            <TabBody prefix={PREFIX} tab="blueprint" shown={shownTab === 'blueprint'}>
                <BlueprintOutput
                    rateWarning={props.rateWarning}
                    blueprintString={props.blueprintString}
                    simulationDurationTicks={props.simulationDurationTicks ?? undefined}
                    staleFor={props.staleFor}
                    copied={props.copied}
                    onCopy={props.onCopy}
                />
            </TabBody>
        </Panel>
    );
}
