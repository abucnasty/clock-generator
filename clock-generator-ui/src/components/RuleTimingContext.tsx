import { createContext, useContext } from 'react';
import { NO_TIMING, type RuleTiming } from '../utils/ruleTiming';

/**
 * The crafting cycle, the clock period and the clock's windows the rule editor checks a rule against. App provides it;
 * a rule form outside a provider knows none of them and says so.
 */
export const RuleTimingContext = createContext<RuleTiming>(NO_TIMING);

export function useRuleTiming(): RuleTiming {
    return useContext(RuleTimingContext);
}
