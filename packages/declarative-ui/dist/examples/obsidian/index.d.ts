import { ObsidianNote } from "./types.js";
export * from "./types.js";
export * from "./vault.js";
/**
 * 查看 Obsidian Markdown 笔记详情视图 (现代纯正 TSX 模式)
 */
export declare function ObsidianNoteDetailView({ note, onDeleted }: {
    note: ObsidianNote;
    onDeleted?: () => void;
}): JSX.Element;
/**
 * 追加至今日 Daily Note 表单视图
 */
export declare function ObsidianDailyNoteForm({ onAppended }: {
    onAppended?: (note: ObsidianNote) => void;
}): JSX.Element;
/**
 * 追加 Obsidian 随手记表单视图 (现代纯正 TSX 模式)
 */
export declare function ObsidianQuickNoteForm({ onCreated }: {
    onCreated: (updatedList: ObsidianNote[]) => void;
}): JSX.Element;
/**
 * Obsidian 知识库管理主命令 (现代纯正 TSX 模式)
 */
export default function ObsidianCommand(): JSX.Element;
