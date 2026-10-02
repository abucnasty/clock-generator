import chalk from "chalk";
import { TickProvider } from "../../../control-logic";
import { InserterStateMachine } from "../../../control-logic/inserter/inserter-state-machine";
import { InserterMode } from "../../../control-logic/inserter/modes";
import { InserterHandContentsChangePlugin } from "../../../control-logic/inserter/plugins";
import { MachineMode } from "../../../control-logic/machine/modes";
import { CraftEventListenerPlugin } from "../../../control-logic/machine/plugins";
import { ModePlugin } from "../../../control-logic/mode";
import { DrillState, MachineState } from "../../../state";
import { DebugLoggerFactory } from "./debug-logger-factory";
import { DebugSettingsProvider } from "./debug-settings-provider";
import { DrillMode } from "../../../control-logic/drill/modes/drill-mode";
import { MachineStateMachine } from "../../../control-logic/machine/machine-state-machine";
import { CraftEventPluginSettings } from "./debug-settings";

export class DebugPluginFactory {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly settings_provider: DebugSettingsProvider
    ) { }

    private readonly log_factory: DebugLoggerFactory = new DebugLoggerFactory(this.tick_provider, this.settings_provider)

    private enabled(): boolean {
        return this.settings_provider.settings().enabled === true;
    }


    public inserterHandContentsChangePlugin(inserter_state_machine: InserterStateMachine): InserterHandContentsChangePlugin {
        const debugLog = this.log_factory.forEntity(inserter_state_machine.inserter_state.inserter);
        return new InserterHandContentsChangePlugin(inserter_state_machine.inserter_state, (oldContents, newContents) => {
            if (!newContents || !this.enabled()) {
                return;
            }

            let message = `held_item "${newContents?.item_name}"=${newContents?.quantity}`

            debugLog(chalk.dim(message));
        })
    }

    public inserterModeChangePlugin(inserter_state_machine: InserterStateMachine): ModePlugin<InserterMode> {
        const debugLog = this.log_factory.forEntity(inserter_state_machine.inserter_state.inserter);
        const enabled = () => this.enabled();
        return {
            onTransition(fromMode, transition) {
                if (!enabled()) {
                    return;
                }
                const new_status = transition.toMode.status;
                let message = `status=${new_status} \t reason="${transition.reason}"`;

                debugLog(chalk.dim(message));
            },
        }
    }


    public machineModeChangePlugin(machine_state: MachineState): ModePlugin<MachineMode> {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        const enabled = () => this.enabled();
        return {
            onTransition(fromMode, transition) {
                if (!enabled()) {
                    return;
                }
                const new_status = transition.toMode.status;
                debugLog(chalk.yellow(`${fromMode.status} -> ${new_status} reason=${transition.reason}`));
            }
        }
    }

    public machineCraftEventPlugin(machine_state: MachineState) {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        return new CraftEventListenerPlugin(machine_state, this.tick_provider, ({ state }) => {
            if (!this.enabled()) {
                return;
            }
            let message = `craft event #${machine_state.craftCount}:`;

            const options: Partial<CraftEventPluginSettings> = this.settings_provider.settings().plugin_settings?.craft_event ?? {};

            if (options.print_bonus_progress) {
                // print 14 decimal places for debugging since Lua console commands
                // only print 14 decimal places
                debugLog(message + ` \t bonus_progress=${state.bonusProgress.progress.toFixed(14)}`)
            }
            if (options.print_craft_progress) {
                // print 14 decimal places for debugging since Lua console commands
                // only print 14 decimal places
                debugLog(message + ` \t craft_progress=${state.craftingProgress.progress.toFixed(14)}`);
            }

            state.machine.inputs.forEach((input) => {
                const input_quantity = state.inventoryState.getQuantity(input.ingredient.name);
                message += ` \t "${input.ingredient.name}"=${input_quantity}`;
            });

            const output_quantity = state.inventoryState.getQuantity(state.machine.output.ingredient.name);
            const output_name = state.machine.output.ingredient.name;
            message += ` \t "${output_name}"=${output_quantity}`;
            debugLog(chalk.green(message));
        })
    }

    public drillModeChangePlugin(drill_state: DrillState): ModePlugin<DrillMode> {
        const debugLog = this.log_factory.forEntity(drill_state.drill);
        const enabled = () => this.enabled();
        return {
            onTransition(fromMode, transition) {
                if (!enabled()) {
                    return;
                }
                const new_status = transition.toMode.status;
                debugLog(chalk.yellow(`${fromMode.status} -> ${new_status} reason=${transition.reason}`));
            }
        }
    }

    public forMachine(state_machine: MachineStateMachine): void {
        state_machine.addPlugin(this.machineModeChangePlugin(state_machine.machine_state));
        state_machine.addPlugin(this.machineCraftEventPlugin(state_machine.machine_state));
    }
}
