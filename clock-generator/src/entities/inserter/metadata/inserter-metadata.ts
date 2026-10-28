import { QualityIdType } from "../../../blueprints/components";
import { inserterSpecFor } from "./inserter-spec";
import { DEFAULT_INSERTER_QUALITY, InserterType } from "./inserter-type";
import { InserterStackSize } from "./stack-size";
import { ItemName } from "../../../data";
import { BeltDropMetadata, InserterAnimationMetadata } from "./animation";
import { InserterAnimationOverrideConfig } from "../../../config";
import { EntityType } from "../../entity-type";


/** The prototype and quality of an inserter, as the config names them; each defaults to the legendary stack inserter's */
export interface InserterKind {
    prototype?: InserterType;
    quality?: QualityIdType;
}

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
    beltDropMetadata?: BeltDropMetadata,
    kind: InserterKind = {}
): InserterMetadata {
    
    // assert(Object.values<number>(InserterStackSize).includes(stackSize), `Inserter has an invalid stack size of ${stackSize}`)

    // a config that names no prototype or quality runs the legendary stack inserter, as before
    const qualityIdType: QualityIdType = kind.quality ?? DEFAULT_INSERTER_QUALITY;
    const inserterType: InserterType = kind.prototype ?? InserterType.STACK_INSERTER;

    const definition = inserterSpecFor(inserterType, qualityIdType);

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