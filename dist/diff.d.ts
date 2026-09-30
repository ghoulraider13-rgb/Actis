export declare function computeHash(content: string): string;
export declare function computeDiff(oldContent: string, newContent: string): string;
export declare function computeCharDiff(oldContent: string, newContent: string): string;
export declare function summarizeDiff(diff: string): {
    additions: number;
    deletions: number;
};
export declare function formatDiffForDisplay(diff: string, maxLines?: number): string;
//# sourceMappingURL=diff.d.ts.map