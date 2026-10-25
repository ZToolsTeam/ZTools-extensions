export interface ConfirmAlertOptions {
    title: string;
    message?: string;
    primaryActionTitle?: string;
    dismissActionTitle?: string;
    primaryAction?: {
        title: string;
        style?: "default" | "destructive";
        onAction?: () => void;
    };
    dismissAction?: {
        title?: string;
        onAction?: () => void;
    };
}
/**
 * 弹出确认警告对话框，返回用户是否点击了 primaryAction
 */
export declare function confirmAlert(options: ConfirmAlertOptions): Promise<boolean>;
