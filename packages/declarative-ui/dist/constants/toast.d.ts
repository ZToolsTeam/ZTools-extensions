/**
 * Raycast Toast Styles
 */
export declare enum ToastStyle {
    Success = "SUCCESS",
    Failure = "FAILURE",
    Animated = "ANIMATED"
}
export declare const Toast: {
    Style: typeof ToastStyle;
};
export interface ToastOptions {
    style: ToastStyle;
    title: string;
    message?: string;
    primaryAction?: {
        title: string;
        onAction: () => void;
    };
    secondaryAction?: {
        title: string;
        onAction: () => void;
    };
}
