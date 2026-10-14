import { QualityIdType } from "../../../blueprints/components";
import { INSERTER_SPECS } from "./inserter-spec";
import { InserterType } from "./inserter-type";
import { InserterStackSize } from "./stack-size";
import { ItemName } from "../../../data";
import { BeltDropMetadata, InserterAnimationMetadata } from "./animation";
import { InserterAnimationOverrideConfig } from "../../../config";
import { EntityType } from "../../entity-type";


export interface InserterMetadata {
    animation: InserterAnimationMetadata;
    quality: QualityIdType;
    type: InserterType;
    stack_size: InserterStackSize;
    filters: Set<ItemName>
}

function create(
    source: EntityType, 
    sink: EntityType, 
    stackSize: number, 
    filters: ItemName[],
    overrides: InserterAnimationOverrideConfig,
    beltDropMetadata?: BeltDropMetadata
): InserterMetadata {
    
    // assert(Object.values<number>(InserterStackSize).includes(stackSize), `Inserter has an invalid stack size of ${stackSize}`)

    // only support legendary for now
    const qualityIdType: QualityIdType = "legendary";
    // only support stack inserter for now
    const inserterType: InserterType = InserterType.STACK_INSERTER;

    const definition = INSERTER_SPECS[inserterType][qualityIdType];

    const animationMetadata = InserterAnimationMetadata.create(
        definition,
        source,
        sink,
        overrides,
        beltDropMetadata
    )

    return {
        animation: animationMetadata,
        quality: qualityIdType,
        type: inserterType,
        stack_size: stackSize as InserterStackSize,
        filters: new Set(filters)
    }
}


export const InserterMetadata = {
    create: create
}