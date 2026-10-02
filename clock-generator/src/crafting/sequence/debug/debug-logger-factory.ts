import { TickProvider } from "../../../control-logic";
import { Entity } from "../../../entities";
import { DebugMessageBuilder } from "./debug-message-builder";
import { DebugSettingsProvider } from "./debug-settings-provider";

export type Logger = (message: string) => void;

export class DebugLoggerFactory {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly settings_provider: DebugSettingsProvider
    ) { }

    public forEntity(entity: Entity): Logger {
        return (message: string) => {
            const settings = this.settings_provider.settings();
            if (!settings.enabled) {
                return;
            }
            const builder = new DebugMessageBuilder()
            const current_tick = this.tick_provider.getCurrentTick();
            
            builder.prependTick(current_tick)

            if (settings.relative_tick_mod) {
                const relativeTick = current_tick % settings.relative_tick_mod
                builder.appendRelativeTick(relativeTick)
            }

            builder.appendEntity(entity)
            builder.append(message)

            const finalMessage = builder.build();
            debugLog(this.settings_provider, finalMessage);
        }
    }
}

function debugLog(settings_provider: DebugSettingsProvider, message: string): void {
    const settings = settings_provider.settings();
    if (!settings.enabled) {
        return;
    }
    console.log(message);
}