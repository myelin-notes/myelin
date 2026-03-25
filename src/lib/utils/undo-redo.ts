export interface UndoCommand {
	execute(): void;
	undo(): void;
}

export class UndoRedoStack {
	private undoStack: UndoCommand[] = [];
	private redoStack: UndoCommand[] = [];
	private groupBuffer: UndoCommand[] | null = null;

	push(command: UndoCommand) {
		command.execute();
		if (this.groupBuffer) {
			this.groupBuffer.push(command);
		} else {
			this.undoStack.push(command);
			this.redoStack = [];
		}
	}

	beginGroup() {
		this.groupBuffer = [];
	}

	pushApplied(command: UndoCommand) {
		if (this.groupBuffer) {
			this.groupBuffer.push(command);
		} else {
			this.undoStack.push(command);
			this.redoStack = [];
		}
	}

	endGroup() {
		if (!this.groupBuffer) return;
		if (this.groupBuffer.length > 0) {
			this.undoStack.push(
				this.groupBuffer.length === 1
					? this.groupBuffer[0]
					: new CompoundCommand(this.groupBuffer)
			);
			this.redoStack = [];
		}
		this.groupBuffer = null;
	}

	undo() {
		const cmd = this.undoStack.pop();
		if (!cmd) return;
		cmd.undo();
		this.redoStack.push(cmd);
	}

	redo() {
		const cmd = this.redoStack.pop();
		if (!cmd) return;
		cmd.execute();
		this.undoStack.push(cmd);
	}

	collapse() {
		this.undoStack = [];
		this.redoStack = [];
		this.groupBuffer = null;
	}

	canUndo() { return this.undoStack.length > 0; }
	canRedo() { return this.redoStack.length > 0; }
}

class CompoundCommand implements UndoCommand {
	constructor(private commands: UndoCommand[]) {}

	execute() {
		for (const cmd of this.commands) cmd.execute();
	}

	undo() {
		for (let i = this.commands.length - 1; i >= 0; i--) {
			this.commands[i].undo();
		}
	}
}
