import { FileRecord, SortOption, TypeFilter, FileQuickLookResult, FileActionResult } from "./types.js";
export declare function formatBytes(bytes: number): string;
export declare function truncatePath(fullPath: string, maxLength?: number): string;
/**
 * 根据文件名与目录属性进行精细化 8 大类归类
 */
export declare function getFileCategory(fileName: string, isDir: boolean, detailed?: boolean): TypeFilter;
/**
 * 标杆文件样本库 (涵盖 8 大类真实文件、长路径与多语言)
 */
export declare const SAMPLE_FILES: FileRecord[];
export declare function sortAndFilterFiles(files: FileRecord[], sortOption: SortOption, typeFilter: TypeFilter): FileRecord[];
export declare function searchLocalFiles(query: string, limit?: number, hostOverride?: unknown): Promise<FileRecord[]>;
/**
 * 极客空格即时预览 (Space Quick Look Selection) 核心数据抽取器
 */
export declare function getFileQuickLook(file: FileRecord, hostOverride?: unknown): Promise<FileQuickLookResult>;
export declare function calculateFileSha256(filePath: string): Promise<string>;
/**
 * 计算文件 MD5 哈希值
 */
export declare function calculateFileMd5(filePath: string): Promise<string>;
/**
 * 打开文件 (Open File)
 */
export declare function openFile(filePath: string): Promise<FileActionResult>;
/**
 * 选择关联打开程序 (Open With...)
 */
export declare function openWith(filePath: string, appPath?: string): Promise<FileActionResult>;
/**
 * 在资源管理器中定位选定文件 (Show in Explorer)
 */
export declare function revealFile(filePath: string): Promise<FileActionResult>;
/**
 * 移入回收站 (Move to Trash)
 */
export declare function moveToTrash(filePath: string): Promise<FileActionResult>;
/**
 * 复制文件本身到剪贴板 (Copy File to Clipboard)
 */
export declare function copyFileToClipboard(filePath: string): Promise<FileActionResult>;
/**
 * 调用系统原生 Quick Look 快速预览 (macOS qlmanage -p / Windows 预览桥接)
 */
export declare function quickLookFile(filePath: string, hostOverride?: unknown): Promise<FileActionResult>;
