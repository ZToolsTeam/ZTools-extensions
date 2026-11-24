import { ClipboardItem, ClipboardFilterOptions, ClipboardContentType, ClipboardPreferences, PasteSequenceState } from "./types.js";
/**
 * 计算字符串的香农信息熵 (Shannon Entropy)
 * 用于高熵密码、API Key、Token 脱敏识别
 */
export declare function calculateShannonEntropy(str: string): number;
/**
 * 敏感内容安全脱敏识别与遮罩 (OpenAI Key, GitHub Token, AWS, Private Key, JWT, High-Entropy Passwords)
 */
export declare function maskSensitiveContent(text: string): {
    isSensitive: boolean;
    masked: string;
    reason?: string;
};
/**
 * 智能识别剪贴板内容类型 (Smart Content Detection)
 */
export declare function detectClipboardContentType(content: string, rawFormat?: string): ClipboardContentType;
/**
 * 解析颜色详情并计算换算值
 */
export declare function parseColorDetails(colorStr: string): {
    hex: string;
    rgb: string;
    hsl: string;
} | null;
export declare const SAMPLE_CLIPBOARD_ITEMS: ClipboardItem[];
/**
 * 流水粘贴状态机
 */
export declare class PasteSequenceManager {
    private offset;
    private lastInvocation;
    private topItemId;
    private lastPastedId;
    private timeoutSeconds;
    constructor(timeoutSeconds?: number);
    setTimeoutSeconds(timeout: number): void;
    pasteNext(items: ClipboardItem[], options?: {
        addNewLine?: boolean;
    }): {
        item: ClipboardItem | null;
        remaining: number;
        offset: number;
    };
    reset(): void;
    getState(): PasteSequenceState;
}
export declare const pasteSequenceManager: PasteSequenceManager;
/**
 * 获取真实或本地剪贴板历史
 */
export declare function getClipboardHistory(hostOverride?: any): Promise<ClipboardItem[]>;
/**
 * 主动读取当前系统剪贴板并写入历史记录
 */
export declare function syncCurrentSystemClipboard(currentItems?: ClipboardItem[], hostOverride?: any): Promise<{
    added: boolean;
    item?: ClipboardItem;
    items: ClipboardItem[];
}>;
/**
 * 保存剪贴板历史列表到本地缓存
 */
export declare function saveClipboardHistory(items: ClipboardItem[]): Promise<void>;
/**
 * 切换条目置顶状态
 */
export declare function toggleClipboardItemPin(id: string, hostOverride?: any): Promise<boolean>;
/**
 * 删除剪贴板单条记录
 */
export declare function deleteClipboardItem(id: string, hostOverride?: any): Promise<boolean>;
/**
 * 清空所有未置顶历史
 */
export declare function clearUnpinnedClipboardHistory(hostOverride?: any): Promise<number>;
/**
 * 连续流水粘贴 (Paste Sequentially)
 */
export declare function pasteSequentialClipboard(items: ClipboardItem[], options?: {
    addNewLine?: boolean;
    timeoutSeconds?: number;
}): Promise<{
    success: boolean;
    item?: ClipboardItem;
    remaining: number;
    offset: number;
    message?: string;
}>;
/**
 * 重置流水粘贴指针
 */
export declare function resetPasteSequence(): Promise<void>;
/**
 * 偏好设置获取与持久化
 */
export declare function getClipboardPreferences(): Promise<ClipboardPreferences>;
export declare function saveClipboardPreferences(prefs: ClipboardPreferences): Promise<void>;
/**
 * 过滤与排序剪贴板条目（支持拼音缩写与模糊检索）
 */
export declare function filterClipboardItems(items: ClipboardItem[], options: ClipboardFilterOptions): ClipboardItem[];
export declare function formatCopiedTime(timestamp: number): string;
