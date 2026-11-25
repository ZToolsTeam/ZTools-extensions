import { ObsidianNote, ObsidianVaultInfo, DailyNoteAppendOptions } from "./types.js";
export declare const DEFAULT_VAULTS: ObsidianVaultInfo[];
export declare const SAMPLE_OBSIDIAN_NOTES: ObsidianNote[];
/**
 * 自动嗅探 Obsidian 配置文件 (%APPDATA%/obsidian/obsidian.json) 与自定义 Vaults
 */
export declare function sniffObsidianVaults(): Promise<ObsidianVaultInfo[]>;
export declare function getVaultNotes(vaultName?: string): Promise<ObsidianNote[]>;
export declare function saveVaultNote(note: Omit<ObsidianNote, "id" | "createdAt" | "updatedAt" | "wordCount">): Promise<ObsidianNote[]>;
export declare function deleteVaultNote(id: string): Promise<ObsidianNote[]>;
/**
 * 追加内容至今日 Daily Note (每日笔记)
 */
export declare function appendToDailyNote(options: DailyNoteAppendOptions): Promise<{
    note: ObsidianNote;
    allNotes: ObsidianNote[];
}>;
export declare function searchVaultNotes(notes: ObsidianNote[], query: string, vault?: string): ObsidianNote[];
