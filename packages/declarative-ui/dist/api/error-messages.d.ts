declare const API_ERROR_MESSAGES: {
    readonly "zh-CN": {
        readonly clipboardPasteUnsupported: "当前宿主不支持粘贴到前台应用，内容已复制到剪贴板";
        readonly processInvalidPid: "pid 必须是 2–4294967295 的整数";
        readonly processTerminateUnsupported: "当前宿主不支持结束任意进程，请升级 ZTools";
        readonly secureStorageInvalidKey: "SecureStorage 的 key 必须是 1–128 个字符，以字母或数字开头，只含字母、数字和 . _ : -";
        readonly secureStorageUnavailable: "当前宿主不支持加密存储，请升级 ZTools";
        readonly storageConflict: "数据正在被其他窗口修改，请重试";
        readonly storageAtomicUnsupported: "当前宿主不支持原子存储，请升级 ZTools";
    };
    readonly "en-US": {
        readonly clipboardPasteUnsupported: "The current host does not support pasting into the frontmost app; content has been copied to the clipboard";
        readonly processInvalidPid: "pid must be an integer between 2 and 4294967295";
        readonly processTerminateUnsupported: "The current host does not support terminating arbitrary processes; please upgrade ZTools";
        readonly secureStorageInvalidKey: "SecureStorage key must be 1–128 characters, start with a letter or digit, and contain only letters, digits, and . _ : -";
        readonly secureStorageUnavailable: "The current host does not support encrypted storage; please upgrade ZTools";
        readonly storageConflict: "The data is being modified by another window; please retry";
        readonly storageAtomicUnsupported: "The current host does not support atomic storage; please upgrade ZTools";
    };
};
export type ApiErrorMessages = Record<keyof (typeof API_ERROR_MESSAGES)["en-US"], string>;
export declare const tApiError: import("../runtime/locale.js").Translator<"clipboardPasteUnsupported" | "processInvalidPid" | "processTerminateUnsupported" | "secureStorageInvalidKey" | "secureStorageUnavailable" | "storageAtomicUnsupported" | "storageConflict">;
export {};
