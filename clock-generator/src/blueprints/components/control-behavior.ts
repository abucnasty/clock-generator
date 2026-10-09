import { ConstantCombinatorSection } from "./constant-combinator";
import {
    DeciderCombinatorCondition,
    DeciderCombinatorOutput
} from "./decider-combinator";
import { SignalId } from "./signal";


export interface DeciderConditions {
    readonly conditions?: DeciderCombinatorCondition[],
    readonly outputs?: DeciderCombinatorOutput[],
}

export interface ArithmeticConditions {
    readonly first_signal: SignalId,
    readonly second_constant: number,
    readonly operation: "*" | "%",
    readonly output_signal: SignalId,
}

export interface ControlBehavior {
    readonly decider_conditions?: DeciderConditions
    readonly arithmetic_conditions?: ArithmeticConditions
    /** The logistic sections of a constant combinator, nested as a blueprint stores them */
    readonly sections?: { readonly sections: ConstantCombinatorSection[] }
}

export class ControlBehaviorBuilder {
    private deciderConditions?: DeciderCombinatorCondition[] = undefined;
    private sections?: ConstantCombinatorSection[] = undefined;
    private outputs?: DeciderCombinatorOutput[] = undefined;

    public setDeciderConditions(conditions: DeciderCombinatorCondition[]): ControlBehaviorBuilder {
        this.deciderConditions = conditions;
        return this;
    }

    public setOutputs(outputs: DeciderCombinatorOutput[]): ControlBehaviorBuilder {
        this.outputs = outputs;
        return this;
    }

    public setSections(sections: ConstantCombinatorSection[]): ControlBehaviorBuilder {
        this.sections = sections;
        return this;
    }

    public build(): ControlBehavior {

        // for constant combinators
        if (this.sections) {
            return {
                sections: { sections: this.sections },
            }
        }

        if (this.deciderConditions === undefined && this.outputs === undefined) {
            return {};
        }

        if (this.deciderConditions?.length === 0 && this.outputs?.length === 0) {
            return {};
        }

        return {
            decider_conditions: {
                conditions: this.deciderConditions,
                outputs: this.outputs,
            },
        };
    }
}