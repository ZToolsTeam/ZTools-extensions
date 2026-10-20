import { ToastOptions, ToastStyle, Toast as ToastNamespace } from "../constants/toast.js";
export declare class ToastHandle {
    private _id;
    private _title;
    private _message?;
    private _style;
    private _hidden;
    private _bridgeHandle?;
    constructor(options: ToastOptions);
    get id(): string;
    get title(): string;
    set title(val: string);
    get message(): string | undefined;
    set message(val: string | undefined);
    get style(): ToastStyle;
    set style(val: ToastStyle);
    hide(): Promise<void>;
}
/**
 * 弹出 Toast 提示
 */
export declare function showToast(optionsOrStyle: ToastOptions | ToastStyle, title?: string, message?: string): Promise<ToastHandle>;
export { ToastNamespace as Toast };
