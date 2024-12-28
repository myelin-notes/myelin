import { describe, it, expect, beforeEach } from 'vitest';
import {BinaryReader, BinaryWriter} from "../src/ts/utils/BinaryHelper";

describe('BinaryReader', () => {
    let writer: BinaryWriter;

    beforeEach(() => {
        writer = new BinaryWriter(16);
    });

    describe('readU32', () => {
        it('should read unsigned 32-bit integers correctly', () => {
            writer.writeU32(42);
            writer.writeU32(0xFFFFFFFF);

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readU32()).toBe(42);
            expect(reader.readU32()).toBe(0xFFFFFFFF);
        });
    });

    describe('readF32', () => {
        it('should read 32-bit floats correctly', () => {
            writer.writeF32(3.14);
            writer.writeF32(-42.5);

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readF32()).toBeCloseTo(3.14);
            expect(reader.readF32()).toBeCloseTo(-42.5);
        });

        it('should read special float values correctly', () => {
            writer.writeF32(Infinity);
            writer.writeF32(-Infinity);
            writer.writeF32(NaN);

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readF32()).toBe(Infinity);
            expect(reader.readF32()).toBe(-Infinity);
            expect(Number.isNaN(reader.readF32())).toBe(true);
        });
    });

    describe('readString', () => {
        it('should read strings correctly', () => {
            const testStr = "Hello, World!";
            writer.writeString(testStr);

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readString()).toBe(testStr);
        });

        it('should read empty strings correctly', () => {
            writer.writeString("");

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readString()).toBe("");
        });

        it('should read UTF-8 characters correctly', () => {
            const testStr = "Hello 世界!";
            writer.writeString(testStr);

            const reader = new BinaryReader(writer.getBuffer());
            expect(reader.readString()).toBe(testStr);
        });
    });

    describe('readBuffer', () => {
        it('should read buffer correctly', () => {
            const sourceBuffer = new ArrayBuffer(8);
            const sourceView = new DataView(sourceBuffer);
            sourceView.setInt32(0, 42, true);
            sourceView.setInt32(4, 24, true);

            writer.writeBuffer(sourceBuffer);

            const reader = new BinaryReader(writer.getBuffer());
            const readBuffer = reader.readBuffer();
            const readView = new DataView(readBuffer);

            expect(readBuffer.byteLength).toBe(8);
            expect(readView.getInt32(0, true)).toBe(42);
            expect(readView.getInt32(4, true)).toBe(24);
        });

        it('should read empty buffers correctly', () => {
            const emptyBuffer = new ArrayBuffer(0);
            writer.writeBuffer(emptyBuffer);

            const reader = new BinaryReader(writer.getBuffer());
            const readBuffer = reader.readBuffer();

            expect(readBuffer.byteLength).toBe(0);
        });
    });

    describe('Error cases', () => {
        it('should throw when reading past buffer end', () => {
            writer.writeU32(42);
            const reader = new BinaryReader(writer.getBuffer());

            reader.readU32(); // Read the only value

            expect(() => reader.readU32()).toThrow();
        });
    });
});
