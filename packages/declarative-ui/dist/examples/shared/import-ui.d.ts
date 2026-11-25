/**
 * 示例通用列表导入 UI 状态 Hook 与标准动作生成辅助
 * 统一封装批次号防竞态、AbortController 取消、顶栏 2 按钮与 ActionPanel 列表管理区，避免 13 个示例重复实现
 */
import { Action } from '../../index.js';
import { type ExampleImportProgress, type ExampleImportRules, type ExampleImportedFile, type NormalizedExampleFileInput } from './file-import.js';
export interface UseExampleImportQueueOptions<TItem> {
    rules: ExampleImportRules;
    toItem: (file: ExampleImportedFile, index: number) => TItem;
    pathOf: (item: TItem) => string;
    idOf: (item: TItem) => string;
    fileTitle: string;
    folderTitle: string;
    filterName?: string;
    supportedText?: string;
    defaultChecked?: boolean;
    isBusy?: () => boolean;
    dropTitle?: string;
    dropSubtitle?: string;
    onImported?: (added: TItem[], merged: TItem[]) => void | Promise<void>;
    onCleared?: () => void;
    onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>;
    allowClipboardImage?: boolean;
}
export declare function buildTopImportActions(onPickFiles: () => void, onPickFolder: () => void): {
    id: string;
    label: string;
    title: string;
    style: string;
    onAction: () => void;
}[];
export declare function buildImportEmptyActionPanel(onPickFiles: () => void, onPickFolder: () => void, extraActions?: ReturnType<typeof Action>[]): import("../../index.js").ViewDescriptor<import("../../index.js").ActionPanelProps>;
export declare function buildListManagementSection(opts: {
    onRemove?: () => void;
    canRemove?: boolean;
    onPickFiles: () => void;
    onPickFolder: () => void;
    onToggleAll?: () => void;
    allSelected?: boolean;
    onClear: () => void;
}): import("../../index.js").ViewDescriptor<import("../../index.js").ActionPanelSectionProps>;
export declare function useExampleImportQueue<TItem>(options: UseExampleImportQueueOptions<TItem>): {
    items: TItem[];
    itemsRef: {
        current: TItem[];
    };
    setItems: (updater: TItem[] | ((prev: TItem[]) => TItem[])) => void;
    checkedIds: string[];
    setCheckedIds: (action: string[] | ((prevState: string[]) => string[])) => void;
    isImporting: boolean;
    importProgress: ExampleImportProgress | null;
    importStatusText: string;
    fileInputProps: {
        fileInput: {
            allowDirectories: true;
            allowClipboardImage?: boolean;
            dropTitle?: string;
            dropSubtitle?: string;
            onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>;
        };
        onFileInput: (raw: unknown) => void | Promise<void>;
    };
    handlePickFiles: () => void;
    handlePickFolder: () => void;
    handleFileInput: (input: NormalizedExampleFileInput) => void;
    removeItem: (id: string) => void;
    clearQueue: () => void;
    toggleCheck: (id: string, checked?: boolean) => void;
    toggleAllVisible: (visibleItems: readonly TItem[]) => void;
    topBarActions: {
        id: string;
        label: string;
        title: string;
        style: string;
        onAction: () => void;
    }[];
    emptyActions: import("../../index.js").ViewDescriptor<import("../../index.js").ActionPanelProps>;
};
