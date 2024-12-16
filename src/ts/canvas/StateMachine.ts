
export type Subscribers<T extends number> = Partial<Record<T, Callback>>;
export type Callback = (args?: any) => void;

export class StateMachine<T extends number> {
    
    private currentState: T;
    private onStart: Subscribers<T>;
    private onUpdate: Subscribers<T>;
    private onEnd: Subscribers<T>;
    
    public constructor(starting: T) {
        this.currentState = starting;
        this.onStart = {};
        this.onUpdate = {};
        this.onEnd = {};
    }
    
    public addStart(state: T, callback: Callback) {
        this.onStart[state] = callback;   
    }
    
    public addUpdate(state: T, callback: Callback) {
        this.onUpdate[state] = callback;
    }
    
    public addEnd(state: T, callback: Callback) {
        this.onEnd[state] = callback;
    }
    
    public update(args: any) {
        this.run(this.onUpdate, this.currentState, args);
    }
    
    public change(state: T) {
        this.run(this.onEnd, this.currentState);
        this.currentState = state;
        this.run(this.onStart, this.currentState);
    }
    
    private run(record: Subscribers<T>, state: T, args?: any) {
        const s = record[state];

        if (s === null || s === undefined) {
            return;
        }

        s(args);
    }
}