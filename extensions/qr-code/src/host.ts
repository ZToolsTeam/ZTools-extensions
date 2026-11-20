import { getLocale } from "@ztools/declarative-ui";

/**
 * 调用 ZTools 宿主能力（复制图片到剪贴板、另存为文件）
 */

const QR_HOST_MESSAGES: Record<string, {
  methodUnsupported: (method: string) => string;
  unrecognizedResult: string;
  methodFailed: (method: string) => string;
  saveDialogTitle: string;
  saveDialogFilters: string;
  imagePathEmpty: string;
  decodeFailed: string;
}> = {
  "zh-CN": {
    methodUnsupported: (method) => `当前环境不支持 ${method}`,
    unrecognizedResult: "宿主返回了无法识别的结果",
    methodFailed: (method) => `${method} 调用失败`,
    saveDialogTitle: "保存二维码图片",
    saveDialogFilters: "PNG 图片|png",
    imagePathEmpty: "二维码图片路径不能为空",
    decodeFailed: "未能从图片中识别出二维码"
  },
  "en-US": {
    methodUnsupported: (method) => `${method} is not supported in the current environment`,
    unrecognizedResult: "Host returned an unrecognized result",
    methodFailed: (method) => `${method} call failed`,
    saveDialogTitle: "Save QR Code Image",
    saveDialogFilters: "PNG Image|png",
    imagePathEmpty: "QR code image path cannot be empty",
    decodeFailed: "No QR code detected in the image"
  }
};

function qrHostStrings() {
  const locale = getLocale();
  return QR_HOST_MESSAGES[locale] ?? QR_HOST_MESSAGES["en-US"];
}

let seq = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callHost<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const s = qrHostStrings();
  const g = globalThis as {
    window?: { __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } } };
    __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } };
  };
  const methods = g.window?.__ztoolsElectron?.transport?.methods ?? g.__ztoolsElectron?.transport?.methods;
  const fn = methods?.[method];
  if (typeof fn !== "function") throw new Error(s.methodUnsupported(method));
  seq = (seq + 1) % 1_000_000;
  const envelope = await (fn as (req: Record<string, unknown>) => Promise<unknown>)({
    messageId: `qr_${Date.now()}_${seq}`,
    params
  });
  if (!isRecord(envelope)) throw new Error(s.unrecognizedResult);
  if (envelope.success === false) {
    const err = envelope.error;
    const msg = isRecord(err) ? String(err.message || err.code || s.methodFailed(method)) : String(err || s.methodFailed(method));
    throw new Error(msg);
  }
  return ("data" in envelope ? envelope.data : envelope) as T;
}

export async function copyPngToClipboard(pngBase64: string): Promise<void> {
  await callHost("clipboard_copy_image", { image: `data:image/png;base64,${pngBase64}` });
}

/** 弹出系统保存窗口并写入 PNG；用户取消时返回 null */
export async function savePngFile(pngBase64: string, defaultName: string): Promise<string | null> {
  const s = qrHostStrings();
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_save_dialog", {
    title: s.saveDialogTitle,
    defaultName,
    filters: s.saveDialogFilters
  });
  if (!picked || picked.canceled || !picked.filePath) return null;
  await callHost("filesystem_write_file", { path: picked.filePath, content: pngBase64, encoding: "base64" });
  return picked.filePath;
}

/** 调用宿主识别图片文件中的二维码内容 */
export async function decodeQrImageFile(filePath: string): Promise<string> {
  const s = qrHostStrings();
  const normalizedPath = (filePath ?? "").trim();
  if (!normalizedPath) throw new Error(s.imagePathEmpty);
  const raw = await callHost<unknown>("qr_scan", { path: normalizedPath, imagePath: normalizedPath });
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (isRecord(raw)) {
    const candidate =
      typeof raw.text === "string"
        ? raw.text
        : typeof raw.content === "string"
        ? raw.content
        : typeof raw.data === "string"
        ? raw.data
        : Array.isArray(raw.results) && raw.results.length > 0
        ? typeof raw.results[0] === "string"
          ? raw.results[0]
          : isRecord(raw.results[0]) && typeof raw.results[0].text === "string"
          ? raw.results[0].text
          : ""
        : "";
    if (candidate.trim()) return candidate.trim();
  }
  throw new Error(s.decodeFailed);
}
