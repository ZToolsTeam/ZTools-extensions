export declare const Clipboard: {
    /**
     * 复制内容到剪贴板。宿主写入失败（内容为空、超过上限、系统剪贴板被占用等）时抛出错误，
     * 调用方不要在失败时提示“已复制”。
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
