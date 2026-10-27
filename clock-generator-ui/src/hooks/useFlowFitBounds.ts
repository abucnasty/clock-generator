import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import { flowGraphBounds, type FlowMeasurements, type FlowRoute } from '../utils/flowRouting';

/** Fit actual card bounds on opening and on explicit Fit View; ordinary edits keep the viewport. */
export function useFlowFitBounds(nodes: Node[], routes: ReadonlyMap<string, FlowRoute>, measurements: FlowMeasurements, autoFit = true) {
    const { fitBounds } = useReactFlow();
    const bounds = useMemo(() => flowGraphBounds(nodes, routes, measurements), [nodes, routes, measurements]);
    const x = bounds?.x, y = bounds?.y, width = bounds?.width, height = bounds?.height;
    const fit = useCallback(() => x === undefined || y === undefined || width === undefined || height === undefined
        ? Promise.resolve(false) : fitBounds({ x, y, width, height }, { padding: 0.1 }), [fitBounds, x, y, width, height]);
    const refitUntil = useRef(0);
    useEffect(() => { refitUntil.current = Date.now() + 2000; }, []);
    const measuredCount = Object.keys(measurements).length;
    useEffect(() => { if (autoFit && measuredCount && Date.now() < refitUntil.current) void fit(); }, [autoFit, fit, measuredCount]);
    return fit;
}
