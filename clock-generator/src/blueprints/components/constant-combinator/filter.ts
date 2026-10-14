import { ComparatorString } from "../decider-combinator"
import { QualityIdType, SignalId } from "../signal"
import assert from "../../../common/assert"

export interface ConstantCombinatorFilter extends SignalId {
    index: number
    name: string
    quality: QualityIdType
    comparator: ComparatorString
    count: number
}

export class ConstantCombinatorFilterBuilder {
    private filter: Partial<ConstantCombinatorFilter> = {}

    constructor(index: number) {
        this.filter.index = index
    }

    withSignal(signal: SignalId): ConstantCombinatorFilterBuilder {
        this.filter.type = signal.type
        this.filter.name = signal.name
        this.filter.quality = signal.quality
        return this
    }

    withCount(count: number): ConstantCombinatorFilterBuilder {
        this.filter.count = count
        return this
    }

    withComparator(comparator: ComparatorString): ConstantCombinatorFilterBuilder {
        this.filter.comparator = comparator
        return this
    }

    build(): ConstantCombinatorFilter {
        assert(this.filter.index !== undefined, "Index is required");
        assert(this.filter.type !== undefined, "Type is required");
        assert(this.filter.name !== undefined, "Name is required");
        assert(this.filter.count !== undefined, "Count is required");
        return {
            index: this.filter.index,
            type: this.filter.type,
            name: this.filter.name,
            quality: this.filter.quality || QualityIdType.normal,
            count: this.filter.count,
            comparator: this.filter.comparator ?? ComparatorString.EQUAL_TO,
        }
    }    
}