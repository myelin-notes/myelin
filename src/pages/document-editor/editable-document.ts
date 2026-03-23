import {BinaryReader, BinaryWriter} from "../../lib/utils/binary-helper";
import {ISerializable} from "../../lib/utils/binary-helper";

export class EditableDocument implements ISerializable {
    load(_reader: BinaryReader): void {
    }

    save(_writer: BinaryWriter): void {
    }
}
