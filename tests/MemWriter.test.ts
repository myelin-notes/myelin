import { describe, it, expect, beforeEach } from 'vitest';
import {BinaryWriter} from "../src/ts/utils/BinaryHelper";

describe('BinaryWriter', () => {
    let writer: BinaryWriter;

    beforeEach(() => {
        writer = new BinaryWriter(16); // Start with small buffer to test resizing
    });

    describe('writeU32', () => {
        it('should write unsigned 32-bit integers correctly', () => {
            writer.writeU32(42);
            writer.writeU32(0xFFFFFFFF);
            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            expect(view.getUint32(0, true)).toBe(42);
            expect(view.getUint32(4, true)).toBe(0xFFFFFFFF);
        });

        it('should handle multiple writes and auto-resize', () => {
            // Write enough U32s to force a resize
            for (let i = 0; i < 5; i++) {
                writer.writeU32(i);
            }

            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            for (let i = 0; i < 5; i++) {
                expect(view.getUint32(i * 4, true)).toBe(i);
            }
        });
    });

    describe('writeF32', () => {
        it('should write 32-bit floats correctly', () => {
            writer.writeF32(3.14);
            writer.writeF32(-42.5);
            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            expect(view.getFloat32(0, true)).toBeCloseTo(3.14);
            expect(view.getFloat32(4, true)).toBeCloseTo(-42.5);
        });

        it('should handle special float values', () => {
            writer.writeF32(Infinity);
            writer.writeF32(-Infinity);
            writer.writeF32(NaN);

            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            expect(view.getFloat32(0, true)).toBe(Infinity);
            expect(view.getFloat32(4, true)).toBe(-Infinity);
            expect(Number.isNaN(view.getFloat32(8, true))).toBe(true);
        });
    });

    describe('writeString', () => {
        it('should write strings correctly with length prefix', () => {
            const testStr = "Hello, World!";
            writer.writeString(testStr);

            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            // Check string length
            expect(view.getUint32(0, true)).toBe(testStr.length);

            // Check string content
            const decoder = new TextDecoder();
            const content = decoder.decode(buffer.slice(4));
            expect(content).toBe(testStr);
        });

        it('should handle empty strings', () => {
            writer.writeString("");
            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            expect(view.getUint32(0, true)).toBe(0);
            expect(() => view.getUint8(4)).toThrowError();
        });

        it('should handle UTF-8 characters', () => {
            const testStr = "Hello 世界!";
            writer.writeString(testStr);

            const buffer = writer.getBuffer();
            const decoder = new TextDecoder();
            const content = decoder.decode(buffer.slice(4));
            expect(content).toBe(testStr);
        });
    });

    describe('writeBuffer', () => {
        it('should write buffer correctly with length prefix', () => {
            const sourceBuffer = new ArrayBuffer(8);
            const sourceView = new DataView(sourceBuffer);
            sourceView.setInt32(0, 42, true);
            sourceView.setInt32(4, 24, true);

            writer.writeBuffer(sourceBuffer);
            const buffer = writer.getBuffer();
            const view = new DataView(buffer);
            
            // Check buffer length
            expect(view.getUint32(0, true)).toBe(8);
            // Check buffer content
            expect(view.getInt32(4, true)).toBe(42);
            expect(view.getInt32(8, true)).toBe(24);
        });

        it('should handle empty buffers', () => {
            const emptyBuffer = new ArrayBuffer(0);
            writer.writeBuffer(emptyBuffer);

            const buffer = writer.getBuffer();
            const view = new DataView(buffer);

            expect(view.getUint32(0, true)).toBe(0);
        });
    });
});