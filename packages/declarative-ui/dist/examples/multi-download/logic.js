/**
 * ZTools 2.0 标杆原生插件: 多线程分块高速下载工作台 (Multi-Download 2.0，基于 Aria2 多线程分块引擎，真实宿主驱动)
 *
 * 严格遵循 ZTools Declarative UI 2.0 零模拟数据规范：
 * 1. 与 Windows 原生插件 multi-download 能力一致：
 *    - 16 / 8 / 4 线程分块并发下载配置 (`-x16 -s16 -k1M`)
 *    - 真实探测 Aria2 JSON-RPC 守护进程 (`http://127.0.0.1:6800/jsonrpc`) 与本机下载环境
 *    - 真实读取本机剪贴板自动嗅探 HTTP/HTTPS/FTP/Magnet/Torrent 下载链接
 *    - 支持显式导入本地下载目录或文件（选择文件 / 选择文件夹 / 拖入文件夹）
 *    - 真实探测下载盘符剩余可用空间，防止磁盘写满
 *    - 支持三态勾选批量移入回收站、打开文件、在 Explorer 中定位文件与发起真实下载任务
 */
import { callHostTransport, getRealFileSize, invokeHostCapability, invokePluginService, isRealElectronHost, openRealPath, resolveRealSpecialPaths, showRealItemInFolder, showRealToast, trashRealItem, writeRealClipboardText, formatBytes } from "../shared/native-ipc.js";
import { pickExampleFolderFiles, probeExampleDriveSpace } from "../shared/file-import.js";
export const MULTI_DOWNLOAD_IMPORT_RULES = {
    maxDepth: 5,
    maxFiles: 500,
    skipEmptyFiles: true,
    forbiddenPath: /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery)($|[\\/])/i
};
export { formatBytes };
export const DLL_PLUGIN_NAME = "MultiDownloadPlugin";
export const FORBIDDEN_TARGET_PATTERN = /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery)($|[\\/])/i;
export const FORBIDDEN_REASON = "禁止操作 Windows 系统核心目录中的受保护文件";
export const DOWNLOAD_CATEGORIES = [
    {
        id: "installer",
        name: "应用安装包",
        icon: "Icon.Box",
        color: "#3b82f6",
        exts: [".exe", ".msi", ".msix", ".appx", ".dmg", ".deb", ".rpm"]
    },
    {
        id: "archive",
        name: "压缩归档包",
        icon: "Icon.Archive",
        color: "#f59e0b",
        exts: [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".tgz"]
    },
    {
        id: "media",
        name: "音视频与图像",
        icon: "Icon.Video",
        color: "#ec4899",
        exts: [".mp4", ".mkv", ".mov", ".webm", ".avi", ".mp3", ".flac", ".wav", ".png", ".jpg", ".webp"]
    },
    {
        id: "iso_image",
        name: "系统镜像与模型",
        icon: "Icon.Disc",
        color: "#8b5cf6",
        exts: [".iso", ".img", ".vhd", ".vhdx", ".gguf", ".safetensors", ".onnx", ".bin"]
    },
    {
        id: "document",
        name: "办公文档与脚本",
        icon: "Icon.Document",
        color: "#10b981",
        exts: [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".txt", ".md", ".csv", ".json", ".sql"]
    },
    {
        id: "other",
        name: "其他下载文件",
        icon: "Icon.Folder",
        color: "#64748b",
        exts: []
    }
];
export const THREAD_SPLIT_PRESETS = [
    {
        id: "threads_16",
        name: "16 线程极速分块",
        threads: 16,
        splitSize: "1M",
        aria2Flags: "--max-connection-per-server=16 --split=16 --min-split-size=1M --continue=true",
        description: "Aria2 16 路并发连接与 1MB 最小分块，跑满千兆宽带与大文件直链"
    },
    {
        id: "threads_8",
        name: "8 线程均衡加速",
        threads: 8,
        splitSize: "2M",
        aria2Flags: "--max-connection-per-server=8 --split=8 --min-split-size=2M --continue=true",
        description: "兼顾高速传输与远端服务器并发连接限制（防 CDN 429 限流拦截）"
    },
    {
        id: "threads_4",
        name: "4 线程稳健省流",
        threads: 4,
        splitSize: "4M",
        aria2Flags: "--max-connection-per-server=4 --split=4 --min-split-size=4M --continue=true",
        description: "适合严格限制单 IP 连接数的镜像站与网盘直链，支持断点续传"
    },
    {
        id: "threads_1",
        name: "单线程顺序流",
        threads: 1,
        splitSize: "10M",
        aria2Flags: "--max-connection-per-server=1 --split=1 --continue=true",
        description: "针对不支持 Range 分块请求（HTTP 200 非 206）的动态签名流式下载"
    }
];
export function classifyDownloadedExtension(extRaw) {
    const ext = String(extRaw || "").toLowerCase();
    for (const cat of DOWNLOAD_CATEGORIES) {
        if (cat.id !== "other" && cat.exts.includes(ext)) {
            return cat;
        }
    }
    return DOWNLOAD_CATEGORIES[DOWNLOAD_CATEGORIES.length - 1];
}
export function detectDownloadUrlFromText(rawText) {
    const text = String(rawText || "").trim();
    if (!text)
        return { url: "", protocol: "无链接", suggestedFileName: "" };
    const magnetMatch = text.match(/magnet:\?xt=urn:[a-z0-9]+:[a-zA-Z0-9]{32,}/i);
    if (magnetMatch) {
        return {
            url: magnetMatch[0],
            protocol: "Magnet 磁力链",
            suggestedFileName: "magnet_task.torrent"
        };
    }
    const httpMatch = text.match(/(https?|ftp):\/\/[^\s"'<>]+/i);
    if (httpMatch) {
        const url = httpMatch[0];
        const cleanPath = url.split("?")[0].split("#")[0];
        const lastSeg = cleanPath.substring(cleanPath.lastIndexOf("/") + 1) || "downloaded_file.bin";
        const protocol = url.toLowerCase().startsWith("ftp") ? "FTP 协议" : "HTTPS 多线程直链";
        return {
            url,
            protocol,
            suggestedFileName: decodeURIComponent(lastSeg).slice(0, 80)
        };
    }
    return { url: "", protocol: "剪贴板未检测到下载链接", suggestedFileName: "" };
}
export async function probeAria2JsonRpc(endpoint = "http://127.0.0.1:6800/jsonrpc") {
    try {
        if (typeof fetch !== "function")
            return false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 450);
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "ztools-ping",
                method: "aria2.getVersion",
                params: []
            }),
            signal: controller.signal
        });
        clearTimeout(timer);
        return resp.ok;
    }
    catch {
        return false;
    }
}
export async function readClipboardDownloadUrl(hostBridge) {
    try {
        const ipcClip = await callHostTransport("clipboard_read_text", {}, hostBridge);
        if (ipcClip.ok && ipcClip.data) {
            const txt = typeof ipcClip.data === "string" ? ipcClip.data : String(ipcClip.data.text || "");
            return detectDownloadUrlFromText(txt);
        }
    }
    catch (err) {
        console.warn("[multi-download] readClipboardDownloadUrl fallback:", err);
    }
    return { url: "", protocol: "支持 HTTP/FTP/Magnet", suggestedFileName: "" };
}
export function toDownloadedFileItem(entry) {
    const ext = String(entry.extension || "").toLowerCase() || ".bin";
    const catMeta = classifyDownloadedExtension(ext);
    return {
        id: entry.path,
        name: entry.name,
        path: entry.path,
        ext,
        sizeBytes: Number(entry.sizeBytes ?? 0),
        mtimeMs: Number(entry.lastModifiedMs ?? 0),
        category: catMeta.id,
        categoryName: catMeta.name,
        categoryColor: "var(--rc-text-muted)",
        categoryIcon: catMeta.icon
    };
}
export function computeDownloadCategoryStats(files) {
    const catMap = new Map();
    for (const cat of DOWNLOAD_CATEGORIES) {
        catMap.set(cat.id, { sizeBytes: 0, count: 0 });
    }
    for (const f of files) {
        const stat = catMap.get(f.category) || catMap.get("other");
        stat.sizeBytes += f.sizeBytes;
        stat.count += 1;
    }
    return DOWNLOAD_CATEGORIES.map((c) => {
        const st = catMap.get(c.id) || { sizeBytes: 0, count: 0 };
        return {
            category: c.id,
            name: c.name,
            color: "var(--rc-text-muted)",
            sizeBytes: st.sizeBytes,
            count: st.count
        };
    }).filter((s) => s.sizeBytes > 0);
}
export async function ensureMultiDownloadDirectory(currentDir, hostBridge) {
    if (currentDir && currentDir.trim())
        return currentDir.trim();
    const paths = await resolveRealSpecialPaths(hostBridge);
    return paths.downloads || (paths.userProfile ? `${paths.userProfile}\\Downloads` : "");
}
export async function importMultiDownloadFolder(hostBridge) {
    const { files: imported, ...rest } = await pickExampleFolderFiles(MULTI_DOWNLOAD_IMPORT_RULES, { title: "选择下载文件夹" }, hostBridge);
    const files = imported.map(toDownloadedFileItem);
    const downloadDir = files[0]?.path ? imported[0].parentDir : "";
    return { ...rest, files, downloadDir };
}
export async function fetchMultiDownloadSnapshot(hostBridge, downloadDirHint = "") {
    const cleanDir = String(downloadDirHint || "").trim();
    const driveLetter = (cleanDir.match(/^[A-Za-z]:/) || ["C:"])[0].toUpperCase();
    const [{ freeBytes: driveFreeBytes, totalBytes: driveTotalBytes }, aria2RpcOnline] = await Promise.all([
        probeExampleDriveSpace(driveLetter, hostBridge),
        probeAria2JsonRpc()
    ]);
    return {
        downloadDir: cleanDir,
        driveLetter,
        driveFreeBytes,
        driveTotalBytes,
        aria2RpcOnline,
        aria2Endpoint: "http://127.0.0.1:6800/jsonrpc",
        sniffedClipboardUrl: "",
        sniffedProtocol: "未检测（粘贴链接或点读剪贴板）",
        files: [],
        totalSizeBytes: 0,
        categoryStats: [],
        updatedAt: new Date().toLocaleTimeString()
    };
}
export async function startMultiThreadDownloadTask(url, downloadDir, preset, hostBridge) {
    const trimmed = String(url || "").trim();
    if (!trimmed || !/^(https?|ftp|magnet):/i.test(trimmed)) {
        return {
            ok: false,
            code: -1,
            message: "未提供有效的 HTTP/HTTPS/FTP/Magnet 下载链接，请先复制下载链接到剪贴板"
        };
    }
    // 1. 优先尝试调用原生插件
    const rpcRes = await invokePluginService(DLL_PLUGIN_NAME, "AddDownloadTask", {
        url: trimmed,
        dir: downloadDir,
        threads: preset.threads,
        split: preset.threads,
        minSplitSize: preset.splitSize
    }, hostBridge);
    if (rpcRes.ok) {
        await showRealToast(`已启动 ${preset.threads} 线程高速分块下载任务`, "success");
        return rpcRes;
    }
    // 2. 尝试直连本机 Aria2 JSON-RPC
    try {
        if (typeof fetch === "function") {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 500);
            const resp = await fetch("http://127.0.0.1:6800/jsonrpc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: `ztools-${Date.now()}`,
                    method: "aria2.addUri",
                    params: [
                        [trimmed],
                        {
                            dir: downloadDir,
                            "max-connection-per-server": String(preset.threads),
                            split: String(preset.threads),
                            "min-split-size": preset.splitSize,
                            continue: "true"
                        }
                    ]
                }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (resp.ok) {
                await showRealToast(`已派发至本机 Aria2 引擎 (${preset.threads} 线程并发)`, "success");
                return { ok: true, code: 0, message: "Aria2 JSON-RPC 任务创建成功" };
            }
        }
    }
    catch (err) {
        console.warn("[multi-download] aria2 rpc fallback:", err);
    }
    // 3. 调用宿主真实 HTTP 下载通道 network_http_download
    const parsedUrl = detectDownloadUrlFromText(trimmed);
    const fileName = parsedUrl.suggestedFileName || `download_${Date.now()}.bin`;
    const sep = downloadDir.includes("/") ? "/" : "\\";
    const targetPath = `${downloadDir.replace(/[\\/]+$/, "")}${sep}${fileName}`;
    if (/^https?:/i.test(trimmed)) {
        const httpRes = await callHostTransport("network_http_download", { url: trimmed, destPath: targetPath }, hostBridge);
        if (httpRes.ok) {
            await showRealToast(`已完成下载并保存至: ${targetPath}`, "success");
            return {
                ok: true,
                code: 0,
                message: `已通过宿主网络引擎真实下载至: ${targetPath}`,
                data: { destPath: targetPath, ...(typeof httpRes.data === "object" ? httpRes.data : {}) }
            };
        }
        if (isRealElectronHost(hostBridge) || hostBridge) {
            return {
                ok: false,
                code: -1,
                message: httpRes.error || "宿主网络下载失败",
                error: httpRes.error || "宿主网络下载失败"
            };
        }
    }
    else if (isRealElectronHost(hostBridge) || hostBridge) {
        const openRes = await callHostTransport("shell_open_external", { url: trimmed }, hostBridge);
        if (!openRes.ok) {
            return {
                ok: false,
                code: -1,
                message: openRes.error || "未检测到 Aria2 守护进程且无法打开协议链接",
                error: openRes.error || "DOWNLOAD_FAILED"
            };
        }
    }
    // 4. 回退：将 Aria2 多线程命令写入剪贴板
    const cliCommand = `aria2c ${preset.aria2Flags} -d "${downloadDir}" "${trimmed}"`;
    await writeRealClipboardText(cliCommand, hostBridge);
    if (isRealElectronHost(hostBridge) || isRealElectronHost()) {
        return {
            ok: false,
            code: -1,
            message: "本机未检测到 yt-dlp/aria2c 下载引擎，已将命令复制到剪贴板",
            error: "ENGINE_NOT_FOUND"
        };
    }
    await invokeHostCapability("system.openUrl", { url: trimmed }, hostBridge);
    return {
        ok: true,
        code: 0,
        message: `已触发下载并生成命令: ${cliCommand}`
    };
}
export async function deleteDownloadedFiles(paths, knownFiles = [], hostBridge) {
    let deletedCount = 0;
    let freedBytes = 0;
    const sizeMap = new Map();
    for (const item of knownFiles) {
        if (item && item.path) {
            sizeMap.set(item.path, Number(item.sizeBytes || 0));
        }
    }
    for (const targetPath of paths) {
        if (!targetPath || FORBIDDEN_TARGET_PATTERN.test(targetPath))
            continue;
        const knownSize = sizeMap.get(targetPath) ?? (await getRealFileSize(targetPath, hostBridge));
        const res = await trashRealItem(targetPath, hostBridge);
        if (res.ok) {
            deletedCount += 1;
            freedBytes += knownSize;
        }
    }
    if (deletedCount > 0) {
        await showRealToast(`已将 ${deletedCount} 个下载文件安全移入回收站`, "success");
    }
    return { deletedCount, freedBytes };
}
export async function openDownloadedFileLocation(targetPath, hostBridge) {
    const ok = await showRealItemInFolder(targetPath, hostBridge);
    return {
        ok,
        code: ok ? 0 : -1,
        message: ok ? "已在资源管理器中定位文件" : "定位文件失败"
    };
}
export async function openDownloadedFile(targetPath, hostBridge) {
    const ok = await openRealPath(targetPath, hostBridge);
    return {
        ok,
        code: ok ? 0 : -1,
        message: ok ? "已打开文件" : "打开文件失败"
    };
}
