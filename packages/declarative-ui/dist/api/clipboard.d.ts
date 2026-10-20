export declare const Clipboard: {
    /**
     * 复制内容到剪贴板
     */
    copy(content: string | number | {
        text?: string;
    }): Promise<void>;
    /**
     * 复制并直接粘贴到当前前台活跃应用程序 (Raycast 原生标准能力)
     */
    paste(content: string | number | {
        text?: string;
    }): Promise<void>;
    /**
     * 读取剪贴板文本
     */
    readText(): Promise<string>;
    /**
     * 清空剪贴板
     */
    clear(): Promise<void>;
};
