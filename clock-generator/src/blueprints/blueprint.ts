import { Entity, EntityWithId, Icon } from "./components";
import { entityWithId } from "./entity/entity-with-id";

const FACTORIO_VERSION: number = 562949958139904;

export type FactorioBlueprint = {
    item: "blueprint";
    label: string;
    entities: EntityWithId[];
    icons: Icon[];
    wires: number[][];
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

    public setLabel(label: string): BlueprintBuilder {
        this.blueprint.label = label;
        return this;
    }

    public setEntities(entities: Entity[]): BlueprintBuilder {
        this.blueprint.entities = entities.map((it, index) => entityWithId(it, index + 1));
        return this;
    }

    public setIcons(icons: Icon[]): BlueprintBuilder {
        this.blueprint.icons = icons;
        return this;
    }

    public setWires(wires: number[][]): BlueprintBuilder {
        this.blueprint.wires = wires;
        return this;
    }

    public build(): FactorioBlueprint {
        return {
            item: "blueprint",
            label: this.blueprint.label || "Blueprint",
            entities: this.blueprint.entities || [],
            icons: this.blueprint.icons || [],
            wires: this.blueprint.wires || [],
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