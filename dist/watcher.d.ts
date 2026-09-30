export interface WatcherConfig {
    projectRoot: string;
    ignorePatterns?: string[];
    debounceMs?: number;
}
export declare class ActisWatcher {
    private watcher;
    private projectRoot;
    private projectId;
    private pendingChanges;
    private debounceMs;
    private ignorePatterns;
    private isProcessing;
    private initialized;
    constructor(config: WatcherConfig);
    initialize(): Promise<void>;
    start(): void;
    stop(): Promise<void>;
    private handleChange;
    private flushPending;
    private persistChange;
}
export declare function createWatcher(config: WatcherConfig): Promise<ActisWatcher>;
//# sourceMappingURL=watcher.d.ts.map