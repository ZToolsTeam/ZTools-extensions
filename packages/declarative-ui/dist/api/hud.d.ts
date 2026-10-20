export interface ShowHUDOptions {
    icon?: string;
    durationMs?: number;
}
/**
 * 弹出 HUD 简短提示
 */
export declare function showHUD(title: string, options?: ShowHUDOptions | string): Promise<void>;
