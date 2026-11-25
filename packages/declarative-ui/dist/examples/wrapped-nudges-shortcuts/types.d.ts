/**
 * Raycast Wrapped, Trial Nudges & Shortcuts 类型契约
 * 对标 Raycast 年度战报、技术特权引导与系统快捷指令管理器
 */
export interface WrappedUsageStats {
    year: number;
    totalLaunches: number;
    totalKeystrokesSaved: number;
    timeSavedMinutes: number;
    timeSavedHours: number;
    manualHoursEstimate: number;
    ztoolsHoursSpent: number;
    netHoursSaved: number;
    efficiencyRatio: string;
    topExtensions: Array<{
        name: string;
        id: string;
        count: number;
        percentage: number;
        barChart: string;
        category?: string;
    }>;
    topShortcuts: Array<{
        key: string;
        name: string;
        count: number;
    }>;
    aiTokenCount: number;
    tokensUsed?: number;
    geekMasteryTier: "Apprentice" | "Specialist" | "Master" | "Grandmaster" | "Legendary";
    rankLevel?: string;
    badgeTitle: string;
    badgeCardMarkdown: string;
    isLocalFirst?: boolean;
    generatedAt?: number;
}
export interface FeatureNudgeItem {
    id: string;
    featureKey: string;
    title: string;
    subtitle: string;
    description: string;
    iconName: string;
    badge: string;
    benefits: string[];
}
export interface NativeSidecarHealth {
    name: string;
    binary: string;
    pid: number;
    status: "running" | "healthy" | "degraded" | "stopped";
    latencyMs: number;
    slaTargetMs: number;
    memoryMb: number;
    features: string[];
}
export interface SystemPrivilegeDiagnostic {
    uiaccess: {
        status: "active" | "inactive" | "restricted";
        uipiBypassVerified: boolean;
        activeTabUrlCapture: boolean;
        elevatedWindowTextCapture: boolean;
        latencyMs: number;
    };
    mftIndexer: {
        status: "healthy" | "indexing" | "unsupported";
        indexedFilesCount: number;
        indexedDrives: string[];
        avgRecallLatencyMs: number;
        usnJournalActive: boolean;
        memoryMb: number;
    };
    sidecars: NativeSidecarHealth[];
    overallSlaMet: boolean;
    diagnosedAt: string;
}
export interface WindowsShortcutItem {
    id: string;
    name: string;
    description: string;
    targetPath: string;
    arguments?: string;
    commandType: "lnk" | "powershell" | "cmd" | "task_scheduler" | "uri" | "apple_shortcut";
    commandScript: string;
    category: "apps" | "system" | "network" | "dev" | "productivity";
    iconName: string;
    requiresAdmin?: boolean;
    destructive?: boolean;
    folder?: string;
}
export interface AppleShortcutItem {
    id: string;
    name: string;
    folder?: string;
    description: string;
    category: "apps" | "system" | "network" | "dev" | "productivity";
    iconName: string;
    acceptsInput?: boolean;
}
