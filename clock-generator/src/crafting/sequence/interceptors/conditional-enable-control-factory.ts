import { EnableControl, LatchedEnableControl } from "../../../control-logic";
import {
    Condition,
    ComparisonOperator,
    EntityReference,
    EnableControlOverrideConditional,
    RuleSet,
    ValueReference
} from "../../../config/schema";
import { EntityId, Inserter } from "../../../entities";
import { assertIsInserterState, assertIsMachineState, EntityState, InserterState, MachineState, ReadableEntityStateRegistry } from "../../../state";
import assert from "../../../common/assert";

interface EvaluationContext {
    inserter: Inserter;
    source_id: EntityId;
    sink_id: EntityId;
    entity_state_registry: ReadableEntityStateRegistry;
}

export class ConditionalEnableControlFactory {

    constructor(
        private readonly entity_state_registry: ReadableEntityStateRegistry
    ) {}

    public createFromConfig(
        config: EnableControlOverrideConditional,
        inserter: Inserter
    ): EnableControl {
        const context: EvaluationContext = {
            inserter,
            source_id: inserter.source.entity_id,
            sink_id: inserter.sink.entity_id,
            entity_state_registry: this.entity_state_registry
        };

        const rule_control = this.buildRuleSet(config.rule_set, context);

        if (config.latch) {
            // In latched mode, rule_set is the base (enable) condition
            // latch.release is the release (disable) condition
            const release_control = this.buildRuleSet(config.latch.release, context);
            return LatchedEnableControl.create({ base: rule_control, release: release_control });
        }

        return rule_control;
    }

    private buildRuleSet(ruleSet: RuleSet, context: EvaluationContext): EnableControl {
        const controls = ruleSet.rules.map(rule => {
            if (this.isCondition(rule)) {
                return this.buildCondition(rule, context);
            }
            return this.buildRuleSet(rule as RuleSet, context);
        });

        return ruleSet.operator === "AND"
            ? EnableControl.all(controls)
            : EnableControl.any(controls);
    }

    private isCondition(rule: Condition | RuleSet): rule is Condition {
        return 'left' in rule && 'operator' in rule && 'right' in rule;
    }

    private buildCondition(condition: Condition, context: EvaluationContext): EnableControl {
        return EnableControl.lambda(() => {
            const left = this.resolveValue(condition.left, context);
            const right = this.resolveValue(condition.right, context);
            return this.compare(left, right, condition.operator);
        });
    }

    private compare(left: number, right: number, operator: ComparisonOperator): boolean {
        switch (operator) {
            case ">": return left > right;
            case "<": return left < right;
            case ">=": return left >= right;
            case "<=": return left <= right;
            case "==": return left === right;
            case "!=": return left !== right;
        }
    }

    private resolveValue(ref: ValueReference, context: EvaluationContext): number {
        switch (ref.type) {
            case "CONSTANT":
                return ref.value;

            case "INVENTORY_ITEM":
                return this.getInventoryItemQuantity(ref.entity, ref.item_name, context);

            case "AUTOMATED_INSERTION_LIMIT":
                return this.getAutomatedInsertionLimit(ref.entity, ref.item_name, context);

            case "OUTPUT_BLOCK":
                return this.getOutputBlockQuantity(ref.entity, context);

            case "CRAFTING_PROGRESS":
                return this.getCraftingProgress(ref.entity, context);

            case "BONUS_PROGRESS":
                return this.getBonusProgress(ref.entity, context);

            case "HAND_QUANTITY":
                return this.getHandQuantity(ref.item_name, context);

            case "MACHINE_STATUS":
                return this.getMachineStatusValue(ref.entity, ref.status, context);

            case "INSERTER_STACK_SIZE":
                return context.inserter.metadata.stack_size;
        }
    }

    private getEntityState(entity: EntityReference, context: EvaluationContext): EntityState {
        const entity_id = entity === "SOURCE" ? context.source_id : context.sink_id;
        return context.entity_state_registry.getStateByEntityIdOrThrow(entity_id);
    }

    private getMachineState(entity: EntityReference, context: EvaluationContext): MachineState {
        const state = this.getEntityState(entity, context);
        assertIsMachineState(state);
        return state;
    }

    private getInventoryItemQuantity(
        entity: EntityReference,
        item_name: string,
        context: EvaluationContext
    ): number {
        const state = this.getEntityState(entity, context);
        return state.inventoryState.getQuantity(item_name);
    }

    private getAutomatedInsertionLimit(
        entity: EntityReference,
        item_name: string,
        context: EvaluationContext
    ): number {
        const machine = this.getMachineState(entity, context);
        const input = machine.machine.getInsertableInput(item_name);
        assert(input, `Item ${item_name} not found in machine inputs`);
        return input.automated_insertion_limit.quantity;
    }

    private getOutputBlockQuantity(entity: EntityReference, context: EvaluationContext): number {
        const machine = this.getMachineState(entity, context);
        return machine.machine.output.outputBlock.quantity;
    }

    private getCraftingProgress(entity: EntityReference, context: EvaluationContext): number {
        const machine = this.getMachineState(entity, context);
        return machine.craftingProgress.progress * 100;
    }

    private getBonusProgress(entity: EntityReference, context: EvaluationContext): number {
        const machine = this.getMachineState(entity, context);
        return machine.bonusProgress.progress * 100;
    }

    private getHandQuantity(item_name: string | undefined, context: EvaluationContext): number {
        const inserter_state = context.entity_state_registry.getStateByEntityIdOrThrow(
            context.inserter.entity_id
        );
        assertIsInserterState(inserter_state);

        if (!inserter_state.held_item) {
            return 0;
        }

        if (item_name && inserter_state.held_item.item_name !== item_name) {
            return 0;
        }

        return inserter_state.held_item.quantity;
    }

    private getMachineStatusValue(
        entity: EntityReference,
        status: string,
        context: EvaluationContext
    ): number {
        const machine = this.getMachineState(entity, context);
        return machine.status === status ? 1 : 0;
    }
}
