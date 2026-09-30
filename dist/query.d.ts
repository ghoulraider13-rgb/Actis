import { FileEvent, Project } from './db.js';
export interface ParsedQuery {
    since?: number;
    until?: number;
    path?: string;
    eventType?: 'create' | 'modify' | 'delete' | 'rename';
    limit?: number;
    projectName?: string;
}
export declare function parseNaturalQuery(query: string, projectRoot?: string): ParsedQuery;
export declare function executeQuery(parsed: ParsedQuery, projectRoot?: string): Promise<{
    events: FileEvent[];
    total: number;
    project: Project | undefined;
}>;
export declare function formatEvent(event: FileEvent, projectRoot: string): string;
export declare function formatEventsForDisplay(events: FileEvent[], projectRoot: string): string;
//# sourceMappingURL=query.d.ts.map