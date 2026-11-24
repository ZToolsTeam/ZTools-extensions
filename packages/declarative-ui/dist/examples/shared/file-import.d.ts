export interface ExampleImportedFile {
    path: string;
    name: string;
    parentDir: string;
    extension: string;
    sizeBytes: number | null;
    lastModifiedMs: number | null;
}
export interface ExampleImportRules {
    extensions?: readonly string[];
    maxDepth?: number;
    maxFiles?: number;
    maxVisitedDirs?: number;
    skipEmptyFiles?: boolean;
    excludeFile?: (name: string, filePath: string) => boolean;
    forbiddenPath?: RegExp;
}
export interface ExampleImportResult {
    files: ExampleImportedFile[];
    ignored: number;
    truncated: boolean;
    failedDirs: Array<{
        path: string;
        error: string;
    }>;
    canceled: boolean;
    error?: string;
}
export interface ExampleImportProgress {
    visitedDirs: number;
    matchedFiles: number;
}
export interface NormalizedExampleFileInput {
    paths: string[];
    directories?: string[];
    source: 'drop' | 'paste' | 'launch';
    targetFieldId?: string;
}
export declare function comparableExamplePath(p: string): string;
export declare function isExampleVolumeRoot(p: string): boolean;
export declare function friendlyExampleFileError(err: unknown): string;
export declare function pickExampleFiles(rules: ExampleImportRules | undefined, options: {
    title: string;
    filterName?: string;
    multiple?: boolean;
}, hostOverride?: unknown): Promise<ExampleImportResult>;
export declare function collectExampleFolderFiles(folderPath: string, rules?: ExampleImportRules, options?: {
    signal?: AbortSignal;
    onProgress?: (p: ExampleImportProgress) => void;
}, hostOverride?: unknown): Promise<ExampleImportResult>;
export declare function pickExampleFolderFiles(rules: ExampleImportRules | undefined, options: {
    title: string;
    signal?: AbortSignal;
    onProgress?: (p: ExampleImportProgress) => void;
    confirmVolumeRoot?: (folderPath: string) => Promise<boolean>;
}, hostOverride?: unknown): Promise<ExampleImportResult & {
    folderPath?: string;
}>;
export declare function expandExampleInputPaths(paths: readonly string[], rules?: ExampleImportRules, options?: {
    knownDirectories?: readonly string[];
    signal?: AbortSignal;
    onProgress?: (p: ExampleImportProgress) => void;
}, hostOverride?: unknown): Promise<ExampleImportResult>;
export declare function mergeExampleByPath<T>(existing: readonly T[], incoming: readonly T[], pathOf: (item: T) => string): {
    merged: T[];
    added: T[];
    duplicates: number;
};
export declare function normalizeExampleFileInput(raw: unknown): NormalizedExampleFileInput;
export declare function createExampleImportProps(onInput: (input: NormalizedExampleFileInput) => void | Promise<void>, config?: {
    allowClipboardImage?: boolean;
    dropTitle?: string;
    dropSubtitle?: string;
    onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>;
}): {
    fileInput: {
        allowClipboardImage?: boolean;
        dropTitle?: string;
        dropSubtitle?: string;
        onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>;
        allowDirectories: true;
    };
    onFileInput: (raw: unknown) => void | Promise<void>;
};
export declare function summarizeExampleImport(result: ExampleImportResult, counts: {
    added: number;
    duplicates?: number;
}, supportedText?: string): {
    ok: boolean;
    title: string;
    message?: string;
} | null;
export declare function probeExampleDriveSpace(driveLetter: string, hostBridge?: unknown): Promise<{
    freeBytes: number;
    totalBytes: number;
}>;
