import {ISerializable} from "./ISerializable";
import {BinaryReader, BinaryWriter} from "./BinaryHelper";

export class UndoableState<T> implements ISerializable {

    private history: T[] = [];
	private steps: Step[] = [];
    private lastIndexActive: number = -1;

	private dirty = false;
	private activesCached: T[] = [];

	public constructor(
		private readonly serializer: (value: T, writer: BinaryWriter) => void,
		private readonly deserializer: (reader: BinaryReader) => T) {
	}

    public get actives() {
		if (this.dirty) {
			this.activesCached = this.computeActives();
		}

		return this.activesCached;
    }

    public add<T1 extends T>(change: (i: number) => T1): T1 {
        if (this.lastIndexActive != this.steps.length - 1) {
			const removedSteps = this.steps.slice(this.lastIndexActive + 1);

			for (const s of removedSteps) {
				if (s.type != StepType.ADDED) {
					continue;
				}

				this.history = this.history.slice(0, s.index);
				break;
			}

            this.steps = this.steps.slice(0, this.lastIndexActive + 1);
        }

		const res = change(this.history.length);
        this.history.push(res);
		this.steps.push({
			type: StepType.ADDED,
			index: this.history.length - 1,
		});

        this.lastIndexActive++;
		this.dirty = true;

		return res;
    }

	public remove(index: number) {
		this.steps.push({
			type: StepType.REMOVED,
			index: index,
		});

		this.lastIndexActive++;
		this.dirty = true;
	}

	public modify(index: number) {
		this.steps.push({
			type: StepType.MODIFIED,
			index: index,
		});
		this.dirty = true;
	}

    public undo() {
        if (this.steps.length <= 0) {
            return;
        }

		if (this.lastIndexActive === -1) {
			return;
		}

        this.lastIndexActive--;
		this.dirty = true;
    }

    public redo() {
        if (this.lastIndexActive === this.steps.length - 1) {
            return;
        }

        this.lastIndexActive++;
		this.dirty = true;
    }

	private computeActives() {
		this.dirty = false;
		const usedSteps = this.steps.slice(0, this.lastIndexActive + 1);
		const resultIndices = new Set<number>();

		for (const s of usedSteps) {
			switch (s.type) {
				case StepType.ADDED:
					resultIndices.add(s.index);
					break;
				case StepType.REMOVED:
					resultIndices.delete(s.index);
					break;
				case StepType.MODIFIED:
					break;
			}
		}

		const result = new Array(resultIndices.size);
		let i = 0;

		for (const s of resultIndices) {
			result[i] = this.history[s];
			i++;
		}

		return result;
	}

	public load(reader: BinaryReader): void {
		this.lastIndexActive = reader.readI32();

		const stepsLen = reader.readU32();
		const steps: Step[] = new Array(stepsLen);

		for (let i = 0; i < stepsLen; i++) {
			steps[i] = {
				index: reader.readU32(),
				type: reader.readU8() as StepType
			};
		}

		const historyLen = reader.readU32();
		const history = new Array(historyLen);

		for (let i = 0; i < historyLen; i++) {
			history[i] = this.deserializer(reader);
		}

		this.steps = steps;
		this.history = history;
		this.dirty = true;
	}

	public save(writer: BinaryWriter): void {
		writer.writeI32(this.lastIndexActive);
		writer.writeU32(this.steps.length);

		for (const step of this.steps) {
			writer.writeU32(step.index);
			writer.writeU8(step.type);
		}

		writer.writeU32(this.history.length);
		for (const ele of this.history) {
			this.serializer(ele, writer);
		}
	}
}

export interface IUndoable {
    cutoff(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
}

const enum StepType {
	ADDED = 0,
	REMOVED,
	MODIFIED
}

interface Step {
	type: StepType,
	index: number;
}
