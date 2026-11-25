/**
 * 核心系统服务实现
 * 处理版本检查、Release Notes 与公告通知
 */
import { ReleaseNoteItem, AnnouncementItem, UpdateCheckResult } from "./types.js";
export declare const DISMISSED_ANNOUNCEMENTS_KEY = "ztools_dismissed_announcements_v1";
export declare const CURRENT_APP_VERSION = "2.7.3-ztools";
export declare const SAMPLE_RELEASE_NOTES: ReleaseNoteItem[];
export declare const INITIAL_ANNOUNCEMENTS: AnnouncementItem[];
/**
 * 获取 Release Notes 清单
 */
export declare function getReleaseNotes(): ReleaseNoteItem[];
/**
 * 检查最新版本升级
 */
export declare function checkForUpdates(): Promise<UpdateCheckResult>;
/**
 * 读取系统公告列表（过滤已忽略公告）
 */
export declare function getActiveAnnouncements(): Promise<AnnouncementItem[]>;
/**
 * 忽略特定公告
 */
export declare function dismissAnnouncement(id: string): Promise<void>;
