import chalk from "chalk";
import { TickProvider } from "../../../control-logic";
import { reasonText } from "../../../control-logic/mode/reason-table";
import { DrillState, MachineState } from "../../../state";
import { DebugLoggerFactory } from "./debug-logger-factory";
import { DebugSettingsProvider } from "./debug-settings-provider";
import type { InserterArchetype } from "../../../simulation/archetypes/inserter";
import { CraftEventListener } from "../../../simulation/observers/craft-event-listener";
import { HandChangeListener } from "../../../simulation/observers/hand-change-listener";
import type { CraftingMachineObserver, DrillObserver, InserterObserver } from "../../../simulation/observers/observer";
import { drillStatusOf, inserterStatusOf, machineStatusOf } from "../../../simulation/status-codes";
import type { SimulationContext } from "../simulation-context";
import { CraftEventObserverSettings } from "./debug-settings";

/**
 * The observers that write a run's debug log: each entity's changes of status with their reasons, a machine's crafts
 * and an inserter's hand. They log, and ask for a reason's text, only while debugging is switched on.
 */
export class DebugObserverFactory {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly settings_provider: DebugSettingsProvider
    ) { }

    private readonly log_factory: DebugLoggerFactory = new DebugLoggerFactory(this.tick_provider, this.settings_provider)

    private enabled(): boolean {
        return this.settings_provider.settings().enabled === true;
    }

    /** Every debug observer onto every entity of a context: machines, then inserters, then drills */
    public attachTo(context: SimulationContext): void {
        context.machines.forEach(it => {
            it.observers.add(this.machineStatusChange(it.machine_state));
            it.observers.add(this.machineCraftEvents(it.machine_state));
        });

        context.inserters.forEach(it => {
            it.observers.add(this.inserterPhaseChange(it));
            it.observers.add(this.inserterHandChange(it));
        });

        context.drills.forEach(it => {
            it.observers.add(this.drillStatusChange(it.drill_state));
        });
    }

    private inserterHandChange(inserter: InserterArchetype): HandChangeListener {
        const debugLog = this.log_factory.forEntity(inserter.inserter_state.inserter);
        return new HandChangeListener(inserter.inserter_state, (current) => {
            if (!current || !this.enabled()) {
                return;
            }

            const message = `held_item "${current?.item_name}"=${current?.quantity}`

            debugLog(chalk.dim(message));
        })
    }

    private inserterPhaseChange(inserter: InserterArchetype): InserterObserver {
        const debugLog = this.log_factory.forEntity(inserter.inserter_state.inserter);
        const enabled = () => this.enabled();
        return {
            onStatusChange(from, to, reason) {
                if (!enabled()) {
                    return;
                }
                const message = `status=${inserterStatusOf(to)} \t reason="${reasonText(reason.reasonId(from, to))}"`;

                debugLog(chalk.dim(message));
            },
        }
    }


    private machineStatusChange(machine_state: MachineState): CraftingMachineObserver {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        const enabled = () => this.enabled();
        return {
            onStatusChange(from, to, reason) {
                if (!enabled()) {
                    return;
                }
                debugLog(chalk.yellow(`${machineStatusOf(from)} -> ${machineStatusOf(to)} reason=${reasonText(reason.reasonId(from, to))}`));
            }
        }
    }

    private machineCraftEvents(machine_state: MachineState): CraftEventListener {
        const debugLog = this.log_factory.forEntity(machine_state.machine);
        return new CraftEventListener(machine_state, this.tick_provider, (event) => {
            if (!this.enabled()) {
                return;
            }
            const { state } = event;
            let message = `craft event #${machine_state.craftCount}:`;

            const options: Partial<CraftEventObserverSettings> = this.settings_provider.settings().observer_settings?.craft_event ?? {};

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

    private drillStatusChange(drill_state: DrillState): DrillObserver {
        const debugLog = this.log_factory.forEntity(drill_state.drill);
        const enabled = () => this.enabled();
        return {
            onStatusChange(from, to, reason) {
                if (!enabled()) {
                    return;
                }
                debugLog(chalk.yellow(`${drillStatusOf(from)} -> ${drillStatusOf(to)} reason=${reasonText(reason.reasonId(from, to))}`));
            }
        }
    }
}
