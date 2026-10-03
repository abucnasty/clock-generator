import { QualityIdType, SignalIdType } from "./constant";
import assert from "../../../common/assert";

export interface SignalId {
    name: string,
    type: SignalIdType,
    quality?: QualityIdType
}

export class SignalIdBuilder {

    private name?: string;
    private type?: SignalIdType;
    private quality?: QualityIdType;

    constructor() { }

    public setName(name: string): SignalIdBuilder {
        this.name = name;
        return this;
    }

    public setType(type: SignalIdType): SignalIdBuilder {
        this.type = type;
        return this;
    }

    public setQuality(quality: QualityIdType): SignalIdBuilder {
        this.quality = quality;
        return this;
    }

    public build(): SignalId {
        assert(this.name, "SignalId name is required");
        assert(this.type, "SignalId type is required");
        return {
            name: this.name!,
            type: this.type!,
            quality: this.quality,
        };
    }
}

function virtual(name: string): SignalId {
    return new SignalIdBuilder()
        .setName(name)
        .setType(SignalIdType.VIRTUAL)
        .build();
}

const clock = new SignalIdBuilder()
    .setName("signal-clock")
    .setType(SignalIdType.VIRTUAL)
    .build()

function item(name: string): SignalId {
    return new SignalIdBuilder()
        .setName(name)
        .setType(SignalIdType.ITEM)
        .build();
}

function toDescriptionString(signalId: SignalId): string {
    // rich text names virtual signals "virtual-signal", unlike the signal id type "virtual"
    const tag = signalId.type === SignalIdType.VIRTUAL ? "virtual-signal" : signalId.type;
    const entries = [
        `${tag}=${signalId.name}`
    ]
    if (signalId.quality) {
        entries.push(`quality=${signalId.quality}`);
    }
    return `[${entries.join(",")}]`;
}


export const SignalId = {
    toDescriptionString: toDescriptionString,
    item: item,
    virtual: virtual,
    clock: clock,
    each: virtual("signal-each"),
}