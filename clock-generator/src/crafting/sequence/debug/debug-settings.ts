export interface DebugSettings {
    enabled?: boolean;
    relative_tick_mod?: number;
    /** What the debug observers log besides the changes of status */
    observer_settings?: {
        craft_event?: CraftEventObserverSettings;
    }
}

export interface CraftEventObserverSettings {
    print_bonus_progress: boolean;
    print_craft_progress: boolean;
}