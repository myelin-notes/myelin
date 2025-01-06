import {BinaryReader, BinaryWriter, ISerializable} from "../utils/BinaryHelper.ts";

export class EditableDocument implements ISerializable {
    public constructor(content?: ArrayBuffer) {
        if (!content) {
            return;
        }
        
        this.read(new BinaryReader(content));
    }
    
    public read(_reader: BinaryReader): void {
    }

    public write(_writer: BinaryWriter): void {
    }

    get reservedSize(): number {
        return 128;
    }
}