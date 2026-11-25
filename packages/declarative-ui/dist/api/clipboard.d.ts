export declare const Clipboard: {
    /**
     * 复制内容到剪贴板。宿主写入失败（内容为空、超过上限、系统剪贴板被占用等）时抛出错误，
     * 调用方不要在失败时提示“已复制”。
     */
    copy(content: string | number | {
        text?: string;
    }): Promise<void>;
    /**
     * 复制并向原输入位置发送粘贴请求。返回只表示按键已发送，不代表目标应用已接收文本。
     * 需要出队或删除内容的插件应保留可恢复记录；发送结果未确认时不要自动重试。
     */
    paste(content: string | number | {
        text?: string;
    }): Promise<void>;
    /**
     * 读取剪贴板文本
     */
    readText(): Promise<string>;
    /**
     * 读取剪贴板中的文件路径列表（经宿主安全校验与授权后返回）
     */
    readFiles(): Promise<string[]>;
    /**
     * 读取剪贴板中的图片（支持 Base64 dataUrl 或宿主生成的临时缓存文件路径）
     */
    readImage(): Promise<{
        image?: string;
        useTempFile?: boolean;
        tempFile?: string;
        size?: number;
        width?: number;
        height?: number;
    } | null>;
    /**
     * 清空剪贴板
     */
    clear(): Promise<void>;
};
