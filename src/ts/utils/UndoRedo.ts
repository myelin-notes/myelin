export class UndoableState<T> {
    private history: T[] = [];
	private steps: Step[] = [];
    private lastIndexActive: number = -1;

	private dirty = false;
	private activesCached: T[] = [];
    
    public get actives() {
		if (this.dirty) {
			this.activesCached = this.computeActives();
		}

		return this.activesCached;
    }

    public add<T1 extends T>(change: (i: number) => T1): T1 {
        // if the lastIndexActive is not at the end, it means the history needs to be chopped
        if (this.lastIndexActive != this.steps.length - 1) {
			const removedSteps = this.steps.slice(this.lastIndexActive + 1);

			for (const s of removedSteps) {
				if (s.type != "Added") {
					continue;
				}

				// if stuff was added after the cutoff point, they will all be gone.
				this.history = this.history.slice(0, s.index);

				// break because new stuff added are sequential,
				// so if the first one that has been added should be removed
				// everything behind it should be removed also
				break;
			}


            this.steps = this.steps.slice(0, this.lastIndexActive + 1);
        }

		const res = change(this.history.length);
        this.history.push(res);
		this.steps.push({
			type: "Added",
			index: this.history.length - 1,
		});

        this.lastIndexActive++;
		this.dirty = true;

		return res;
    }

	public remove(index: number) {
		this.steps.push({
			type: "Removed",
			index: index,
		});
		
		this.lastIndexActive++;
		this.dirty = true;
	}

	public modify(index: number) {
		this.steps.push({
			type: "Modified",
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

    private isUndoable(object: any): object is IUndoable {
        return (
            typeof object === "object" &&
            object !== null &&
            typeof object.cutoff === "function" &&
            typeof object.canUndo === "function" &&
            typeof object.canRedo === "function" &&
            typeof object.undo === "function" &&
            typeof object.redo === "function"
        );
    }

	private computeActives() {
		this.dirty = false;
		const usedSteps = this.steps.slice(0, this.lastIndexActive + 1);
		const resultIndices = new Set<number>();

		for (const s of usedSteps) {
			switch (s.type) {
				case "Added":
					resultIndices.add(s.index);
					break;
				case "Removed":
					resultIndices.delete(s.index);
					break;
				case "Modified":
					break;
			}
		}

		const result = new Array(resultIndices.size);

		for (const s of resultIndices) {
			result.push(this.history[s]);
		}

		return result;
	}
}

export interface IUndoable {
    cutoff(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
}

interface Step {
	type: "Added" | "Removed" | "Modified",
	index: number;
}
