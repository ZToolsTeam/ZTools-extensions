import { FileRecord, FileQuickLookResult } from "./types.js";
export * from "./types.js";
export * from "./search-service.js";
/**
 * 空格即时预览视图 (Space Quick Look Detail View)
 * 选中文件后按空格即可快速预览
 */
export declare function FileQuickLookDetailView({ file, initialQuickLook }: {
    file: FileRecord;
    initialQuickLook?: FileQuickLookResult;
}): JSX.Element;
/**
 * 文件的详细信息视图 (独立卡片模式)
 */
export declare function FileDetailView({ file }: {
    file: FileRecord;
}): JSX.Element;
/**
 * 根命令：Everything 文件搜索 (左列表 + 右详情双栏，附常用文件动作)
 */
export default function EverythingFileSearchCommand(): JSX.Element;
