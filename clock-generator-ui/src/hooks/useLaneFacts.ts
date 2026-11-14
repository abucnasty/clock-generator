import { useEffect, useMemo, useRef, useState } from 'react';
import type { Config } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';
import { formLaneFactsOf, laneRolesKeyOf, type FormLaneFacts } from '../utils/laneFacts';
import type { LaneRoleOfLane } from '../worker/types';

/**
 * The lanes of the build as the engine reads them, and the roles the worker gave: the roles from the worker (they need the game data), asked again only
 * when a field they come from changes, and the rest from the light entry at once. Until the worker answers for the build
 * as it is, or where it cannot tell (a machine with no recipe yet), each lane's role and end are unknown.
 */
export function useLaneFacts(config: Config, enabled = true): { facts: FormLaneFacts | null; roles: LaneRoleOfLane[] | null } {
    const key = useMemo(() => laneRolesKeyOf(config), [config]);
    const latest = useRef(config);
    useEffect(() => {
        latest.current = config;
    });
    const [answer, setAnswer] = useState<{ key: string; roles: LaneRoleOfLane[] | null } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'lane-roles', config: latest.current }).then(
                roles => { if (current) setAnswer({ key, roles }); },
                () => { if (current) setAnswer({ key, roles: null }); },
            );
        }, 120);
        return () => { current = false; clearTimeout(timer); };
    }, [enabled, key]);

    const roles = answer?.key === key ? answer.roles : null;
    const facts = useMemo(() => formLaneFactsOf(config, roles), [config, roles]);
    return { facts, roles };
}
