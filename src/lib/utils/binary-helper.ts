export interface ISerializable {
    save(writer: BinaryWriter): void;
    load(reader: BinaryReader): void;
}

export class BinaryWriter {
    private readonly strEncoder: TextEncoder;
    private buffer: ArrayBuffer;
    private view: DataView;

    private size: number;
    private offset: number = 0;

    public constructor(size: number) {
        this.size = size;
        this.buffer = new ArrayBuffer(size);
        this.view = new DataView(this.buffer);
        this.strEncoder = new TextEncoder();
    }

    public writeBool(value: boolean): void {
        this.writeU8(value ? 1 : 0);
    }

    public writeI32(value: number): void {
        this.checkResize(4);
        this.view.setInt32(this.offset, value, true);
        this.offset += 4;
    }

    public writeU32(value: number): void {
        this.checkResize(4);
        this.view.setUint32(this.offset, value, true);
        this.offset += 4;
    }

    public writeF32(value: number): void {
        this.checkResize(4);
        this.view.setFloat32(this.offset, value, true);
        this.offset += 4;
    }

    public writeU8(value: number): void {
        this.checkResize(1);
        this.view.setUint8(this.offset, value);
        this.offset++;
    }

    public writeString(value: string): void {
        const bytes = this.strEncoder.encode(value);
        this.writeU32(bytes.length);
        this.checkResize(bytes.length);

        const targetArray = new Uint8Array(this.buffer, this.offset, bytes.length);
        targetArray.set(bytes);
        this.offset += bytes.length;
    }

    public writeBuffer(buf: ArrayBuffer) {
        this.writeU32(buf.byteLength);
        this.checkResize(buf.byteLength);
        const newBuf = new Uint8Array(this.buffer.byteLength);
        newBuf.set(new Uint8Array(this.buffer.slice(0, this.offset)));
        newBuf.set(new Uint8Array(buf), this.offset);
        this.buffer = newBuf.buffer;
        this.view = new DataView(this.buffer);
        this.offset += buf.byteLength;
    }

    public getBuffer(): ArrayBuffer {
        return this.buffer.slice(0, this.offset);
    }

    private checkResize(spaceNeeded: number): void {
        if (this.offset + spaceNeeded < this.size) {
            return;
        }

        do {
            if (this.size === 0) {
                this.size = 16;
            }

            this.size = Math.round(this.size * 1.5);
        } while (this.offset + spaceNeeded >= this.size);

        const newBuf = new Uint8Array(this.size);
        newBuf.set(new Uint8Array(this.buffer.slice(0, this.offset)));

        this.buffer = newBuf.buffer;
        this.view = new DataView(this.buffer);
    }
}

export class BinaryReader {
    private readonly view: DataView;
    private readonly decoder: TextDecoder;
    private offset: number = 0;

    public constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
        this.decoder = new TextDecoder("utf-8");
    }

    public readBool(): boolean {
        return this.readU8() === 1;
    }

    public readI32(): number {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    public readU32(): number {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    public readF32(): number {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    public readU8(): number {
        const value = this.view.getUint8(this.offset);
        this.offset++;
        return value;
    }

    public readString(): string {
        const length = this.readU32();
        const stringBytes = this.view.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return this.decoder.decode(stringBytes);
    }

    public readBuffer(): ArrayBuffer {
        const length = this.readU32();
        return this.view.buffer.slice(this.offset, this.offset + length);
    }
}
