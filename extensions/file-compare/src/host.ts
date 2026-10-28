/**
 * 调用 ZTools 宿主能力（选择文件、读取文本文件）
 */

let seq = 0;

async function callHost<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const methods = (globalThis as any).window?.__ztoolsElectron?.transport?.methods ?? (globalThis as any).__ztoolsElectron?.transport?.methods;
  const fn = methods?.[method];
  if (typeof fn !== "function") throw new Error(`当前环境不支持 ${method}`);
  seq = (seq + 1) % 1_000_000;
  const envelope = await fn({ messageId: `cmp_${Date.now()}_${seq}`, params });
  if (!envelope || typeof envelope !== "object") throw new Error("宿主返回了无法识别的结果");
  if (!envelope.success) throw new Error(envelope.error?.message || `${method} 调用失败`);
  return envelope.data as T;
}

/** 单个文本文件读取上限 */
export const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;

/**
 * 弹出系统选文件窗口并按 UTF-8 读取；用户取消时返回 null
 */
export async function pickTextFile(title: string): Promise<{ name: string; text: string } | null> {
  const picked = await callHost<{ canceled: boolean; filePath?: string }>("window_show_open_dialog", { title, properties: ["openFile"] });
  if (!picked || picked.canceled || !picked.filePath) return null;
  const sizeRes = await callHost<{ size: number }>("filesystem_get_file_size", { path: picked.filePath });
  if (Number(sizeRes?.size) > MAX_TEXT_FILE_BYTES) throw new Error("文件超过 4 MB，暂不支持对比");
  let read: { content: string };
  try {
    read = await callHost<{ content: string }>("filesystem_read_file", { path: picked.filePath, encoding: "utf8" });
  } catch (err: any) {
    throw new Error(/utf|decode|编码/i.test(String(err?.message)) ? "这个文件不是 UTF-8 文本，无法对比" : err?.message || "读取文件失败");
  }
  return { name: picked.filePath.split(/[\\/]/).pop() || picked.filePath, text: read.content };
}
