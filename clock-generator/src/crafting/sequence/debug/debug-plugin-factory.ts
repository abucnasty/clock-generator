import chalk from "chalk";
import { TickProvider } from "../../../control-logic";
import { InserterStateMachine } from "../../../control-logic/inserter/inserter-state-machine";
import { InserterMode } from "../../../control-logic/inserter/modes";
import { InserterHandContentsChangePlugin } from "../../../control-logic/inserter/plugins";
import { CraftEventListenerPlugin } from "../../../control-logic/machine/plugins";
import { ModePlugin } from "../../../control-logic/mode";
import { reasonText } from "../../../control-logic/mode/reason-table";
import { DrillState, MachineState } from "../../../state";
import { DebugLoggerFactory } from "./debug-logger-factory";
import { DebugSettingsProvider } from "./debug-settings-provider";
import type { CraftingMachineArchetype, CraftingMachineObserver } from "../../../simulation/archetypes/crafting-machine";
import type { DrillObserver } from "../../../simulation/archetypes/mining-drill";
import { drillStatusOf, machineStatusOf } from "../../../simulation/status-codes";
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

            const message = `held_item "${newContents?.item_name}"=${newContents?.quantity}`

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
                const message = `status=${new_status} \t reason="${transition.reason}"`;

                debugLog(chalk.dim(message));
            },
        }
    }


    public machineModeChangePlugin(machine_state: MachineState): CraftingMachineObserver {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        const enabled = () => this.enabled();
        return {
            onStatusChange(from, to, reason_id) {
                if (!enabled()) {
                    return;
                }
                debugLog(chalk.yellow(`${machineStatusOf(from)} -> ${machineStatusOf(to)} reason=${reasonText(reason_id)}`));
            }
        }
    }

    public machineCraftEventPlugin(machine_state: MachineState) {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        return new CraftEventListenerPlugin(machine_state, this.tick_provider, (event) => {
            if (!this.enabled()) {
                return;
            }
            const { state } = event;
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
                const input_quantity = state.ingress.ingredientQuantity(input.ingredient.name);
                message += ` \t "${input.ingredient.name}"=${input_quantity}`;
            });

            const output_quantity = state.inventoryState.getQuantity(state.machine.output.ingredient.name);
            const output_name = state.machine.output.ingredient.name;
            message += ` \t "${output_name}"=${output_quantity}`;
            debugLog(chalk.green(message));
        })
    }

    public drillModeChangePlugin(drill_state: DrillState): DrillObserver {
        const debugLog = this.log_factory.forEntity(drill_state.drill);
        const enabled = () => this.enabled();
        return {
            onStatusChange(from, to, reason_id) {
                if (!enabled()) {
                    return;
                }
                debugLog(chalk.yellow(`${drillStatusOf(from)} -> ${drillStatusOf(to)} reason=${reasonText(reason_id)}`));
            }
        }
    }

    public forMachine(machine: CraftingMachineArchetype): void {
        machine.addObserver(this.machineModeChangePlugin(machine.machine_state));
        machine.addObserver(this.machineCraftEventPlugin(machine.machine_state));
    }
}
