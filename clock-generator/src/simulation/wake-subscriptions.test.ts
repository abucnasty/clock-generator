import {expect, test} from "vitest";
import {WakeSubscriptions} from "./wake-subscriptions";

test("a destination Alarm clears both waits and the next sleep changes source delivery order", () => {
    const waits = new WakeSubscriptions();
    waits.register("b", ["destination-b", "source"]);
    waits.register("a", ["source"]);
    const initial = waits.state();
    const source = new WakeSubscriptions(initial);
    expect(source.take("source")).toEqual(["a", "b"]);
    expect(source.state()).toEqual([]);
    expect(waits.take("destination-b")).toEqual(["b"]);
    waits.register("b", ["source"]);
    expect(waits.take("source")).toEqual(["b", "a"]);
    expect(waits.state()).toEqual([]);
    expect(initial).toEqual([
        {channel: "destination-b", entities: ["b"]}, {channel: "source", entities: ["a", "b"]},
    ]);
});

test("an unrelated Alarm unlinks every registration without changing the independent hydrated copy", () => {
    const waits = new WakeSubscriptions();
    waits.register("a", ["source", "destination"]);
    const copy = new WakeSubscriptions(waits.state());
    waits.clear("a");
    expect(waits.take("source")).toEqual([]);
    expect(copy.take("destination")).toEqual(["a"]);
    expect(copy.take("source")).toEqual([]);
});
