import { Database } from 'sql.js';
export interface FileEvent {
    id?: number;
    path: string;
    event_type: 'create' | 'modify' | 'delete' | 'rename';
    timestamp: number;
    diff?: string;
    size_before?: number;
    size_after?: number;
    hash_before?: string;
    hash_after?: string;
    project_id: number;
}
export interface Project {
    id?: number;
    name: string;
    root_path: string;
    created_at: number;
    is_active: number;
}
export interface QueryResult {
    events: FileEvent[];
    total: number;
}
export declare function getDb(): Promise<Database>;
export declare function saveDb(): void;
export declare function createProject(name: string, rootPath: string): Promise<Project>;
export declare function getProjectByPath(rootPath: string): Promise<Project | undefined>;
export declare function getActiveProjects(): Promise<Project[]>;
export declare function logEvent(event: Omit<FileEvent, 'id'>, options?: {
    persist?: boolean;
}): Promise<number>;
export declare function queryEvents(projectId: number, options?: {
    since?: number;
    until?: number;
    path?: string;
    eventType?: string;
    limit?: number;
    offset?: number;
}): Promise<QueryResult>;
export declare function getEventById(id: number): Promise<FileEvent | undefined>;
export declare function closeDb(): void;
//# sourceMappingURL=db.d.ts.map