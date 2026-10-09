import { BlueprintWire, Entity, EntityWithId, Icon, Wire, WireConnection } from "./components";
import { entityWithId } from "./entity/entity-with-id";

/** Factorio 2.1.0: the else outputs of a decider combinator, which clocks need, come with 2.1 */
const FACTORIO_VERSION: number = 562954248388608;

export type FactorioBlueprint = {
    item: "blueprint";
    label: string;
    /** Shown under the label in the blueprint library; rich text such as [item=iron-plate] is rendered */
    description?: string;
    entities: EntityWithId[];
    icons: Icon[];
    wires: BlueprintWire[];
    /**
     * factorio version
     */
    version: number;
}

export type FactorioBlueprintBook = {
    item: "blueprint-book";
    label: string;
    blueprints: { index: number, blueprint: FactorioBlueprint }[];
    active_index: number;
    description?: string;
    /**
     * factorio version
     */
    version: number;
}

export type FactorioBlueprintFile = {
    blueprint_book?: FactorioBlueprintBook
    blueprint?: FactorioBlueprint
}

export class BlueprintFileBuilder {
    private blueprintFile: Partial<FactorioBlueprintFile> = {};

    public setBlueprint(blueprint: FactorioBlueprint): BlueprintFileBuilder {
        this.blueprintFile.blueprint = blueprint;
        return this;
    }

    public setBlueprintBook(blueprintBook: FactorioBlueprintBook): BlueprintFileBuilder {
        this.blueprintFile.blueprint_book = blueprintBook;
        return this;
    }

    public build(): FactorioBlueprintFile {
        return this.blueprintFile;
    }
}
    
export class BlueprintBuilder {
    private blueprint: Partial<FactorioBlueprint> = {};
    private entityNumbers = new Map<Entity, number>();
    private wires: WireConnection[] = [];

    public setLabel(label: string): BlueprintBuilder {
        this.blueprint.label = label;
        return this;
    }

    public setDescription(description: string): BlueprintBuilder {
        this.blueprint.description = description;
        return this;
    }

    public setEntities(entities: Entity[]): BlueprintBuilder {
        this.entityNumbers = new Map(entities.map((it, index) => [it, index + 1]));
        this.blueprint.entities = entities.map((it, index) => entityWithId(it, index + 1));
        return this;
    }

    public setIcons(icons: Icon[]): BlueprintBuilder {
        this.blueprint.icons = icons;
        return this;
    }

    /** Wire endpoints must be entities passed to setEntities */
    public setWires(wires: WireConnection[]): BlueprintBuilder {
        this.wires = wires;
        return this;
    }

    public build(): FactorioBlueprint {
        const entityNumber = (entity: Entity): number => {
            const number = this.entityNumbers.get(entity);
            if (number === undefined) {
                throw new Error(`Wired entity ${entity.name} at (${entity.position.x}, ${entity.position.y}) is not in the blueprint`);
            }
            return number;
        };
        return {
            item: "blueprint",
            label: this.blueprint.label || "Blueprint",
            ...(this.blueprint.description ? { description: this.blueprint.description } : {}),
            entities: this.blueprint.entities || [],
            icons: this.blueprint.icons || [],
            wires: this.wires.map(wire => Wire.toBlueprintWire(wire, entityNumber)),
            version: FACTORIO_VERSION,
        }
    }
}

export class BlueprintBookBuilder {
    private blueprintBook: Partial<FactorioBlueprintBook> = {};

    public setLabel(label: string): BlueprintBookBuilder {
        this.blueprintBook.label = label;
        return this;
    }

    public addBlueprint(blueprint: FactorioBlueprint): BlueprintBookBuilder {
        this.blueprintBook.blueprints ??= [];
        const index = this.blueprintBook.blueprints.length;
        this.blueprintBook.blueprints.push({ index, blueprint });
        return this;
    }

    public setActiveIndex(active_index: number): BlueprintBookBuilder {
        this.blueprintBook.active_index = active_index;
        return this;
    }

    public build(): FactorioBlueprintBook {
        return {
            item: "blueprint-book",
            label: this.blueprintBook.label || "Blueprint Book",
            blueprints: this.blueprintBook.blueprints || [],
            active_index: this.blueprintBook.active_index || 0,
            version: FACTORIO_VERSION,
        }
    }
}