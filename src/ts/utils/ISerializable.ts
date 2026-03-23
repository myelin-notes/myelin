import {BinaryReader, BinaryWriter} from "./BinaryHelper";

export interface ISerializable {
    save(writer: BinaryWriter): void;
    load(reader: BinaryReader): void;
}
