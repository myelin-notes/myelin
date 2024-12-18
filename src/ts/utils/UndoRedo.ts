export class UndoableState<T> {
    private history: T[] = [];
    private lastIndexActive: number = -1;

    public constructor() {
    }
    
    public get actives() {
        return this.history.slice(0, this.lastIndexActive + 1);
    }

    public do(change: T) {
        // if the lastIndexActive is not at the end, it means the history needs to be chopped
        if (this.lastIndexActive != this.history.length - 1) {
            this.history = this.history.slice(0, this.lastIndexActive + 1);
        }
        
        const last = this.history[this.lastIndexActive];
        if (this.isUndoable(last)) {
            last.cutoff();
        }

        this.history = [...this.history, change];
        this.lastIndexActive++;
    }
    
    public undo() {
        if (this.history.length <= 0) {
            return;
        }
        
        const last = this.history[this.lastIndexActive];
        if (this.isUndoable(last) && last.canUndo()) {
            last.undo();
            return;
        }
        
        this.lastIndexActive--;
    }
    
    public redo() {
        const last = this.history[this.lastIndexActive];
        if (this.isUndoable(last) && last.canRedo()) {
            last.redo();
            return;
        }

        if (this.lastIndexActive === this.history.length - 1) {
            return;
        }
        
        this.lastIndexActive++;
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
}

export interface IUndoable {
    cutoff(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
}