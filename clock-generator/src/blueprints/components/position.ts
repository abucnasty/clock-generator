export interface Position {
    readonly x: number;
    readonly y: number;
}

class PositionBuilder {
    private x: number = 0;
    private y: number = 0;

    public setX(x: number): PositionBuilder {
        this.x = x;
        return this;
    }

    public setY(y: number): PositionBuilder {
        this.y = y;
        return this;
    }

    public build(): Position {
        return {
            x: this.x,
            y: this.y,
        };
    }
}

export const Position = {
    zero: new PositionBuilder().setX(0).setY(0).build(),
    builder(): PositionBuilder {
        return new PositionBuilder();
    },
    fromXY(x: number, y: number): Position {
        return new PositionBuilder().setX(x).setY(y).build();
    }
}