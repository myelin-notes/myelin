import {BinaryReader, BinaryWriter} from "../utils/BinaryHelper";
import {ISerializable} from "../utils/ISerializable";

export class EditableDocument implements ISerializable {
    load(_reader: BinaryReader): void {
    }

    save(_writer: BinaryWriter): void {
    }
}
