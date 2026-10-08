import net from "net";

const PACKET_AUTH = 3;
const PACKET_COMMAND = 2;

/**
 * Minimal client for the RCON port of a Factorio server. Factorio answers every packet with exactly one packet,
 * however long, so commands are sent one at a time and each waits for its answer.
 */
export class RconClient {
    private buffer: Buffer = Buffer.alloc(0);
    private next_id = 1;
    private waiting: { id: number; resolve: (body: string) => void; reject: (error: Error) => void } | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    private constructor(private readonly socket: net.Socket) {
        socket.on("data", chunk => this.onData(chunk));
        socket.on("error", error => this.fail(error));
        socket.on("close", () => this.fail(new Error("RCON connection closed")));
    }

    static async connect(port: number, password: string, host = "127.0.0.1"): Promise<RconClient> {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
            const connecting = net.createConnection({ host, port }, () => resolve(connecting));
            connecting.once("error", reject);
        });
        const client = new RconClient(socket);
        await client.send(PACKET_AUTH, password);
        return client;
    }

    /** Runs a console command and returns what it printed with rcon.print */
    command(command: string): Promise<string> {
        const result = this.queue.then(() => this.send(PACKET_COMMAND, command));
        this.queue = result.catch(() => undefined);
        return result;
    }

    close(): void {
        this.socket.destroy();
    }

    private send(type: number, body: string): Promise<string> {
        const id = this.next_id++;
        const payload = Buffer.from(body, "utf-8");
        const packet = Buffer.alloc(14 + payload.length);
        packet.writeInt32LE(10 + payload.length, 0);
        packet.writeInt32LE(id, 4);
        packet.writeInt32LE(type, 8);
        payload.copy(packet, 12);
        return new Promise<string>((resolve, reject) => {
            this.waiting = { id, resolve, reject };
            this.socket.write(packet);
        });
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const size = this.buffer.readInt32LE(0);
            if (this.buffer.length < 4 + size) {
                return;
            }
            const id = this.buffer.readInt32LE(4);
            const body = this.buffer.toString("utf-8", 12, 4 + size - 2);
            this.buffer = this.buffer.subarray(4 + size);
            const waiting = this.waiting;
            this.waiting = null;
            if (!waiting) {
                continue;
            }
            if (id === -1) {
                waiting.reject(new Error("RCON password rejected"));
            } else {
                waiting.resolve(body);
            }
        }
    }

    private fail(error: Error): void {
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.reject(error);
    }
}
