import { FileRecord, SortOption, TypeFilter, FileQuickLookResult, FileActionResult } from "./types.js";
import {
  callHostTransport,
  isRealElectronHost,
  getRealSystemPath,
  readRealDirectory,
  listDirectChildren,
  trashRealItem,
  computeRealFileSha256
} from "./native-ipc.js";

declare const Buffer: any;

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function truncatePath(fullPath: string, maxLength = 46): string {
  if (!fullPath) return "";
  if (fullPath.length <= maxLength) return fullPath;
  const parts = fullPath.split(/[\\/]/);
  if (parts.length <= 3) return fullPath;
  return `${parts[0]}\\...\\${parts.slice(-2).join("\\")}`;
}

/**
 * 根据文件名与目录属性进行精细化 8 大类归类 (对齐 Raycast NTFS MFT 标准)
 */
export function getFileCategory(fileName: string, isDir: boolean, detailed = false): TypeFilter {
  if (isDir) return "folder";
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  // 1. 文档类
  if (["doc", "docx", "pdf", "txt", "md", "xls", "xlsx", "ppt", "pptx", "csv", "rtf", "odt", "ods"].includes(ext)) {
    return "document";
  }
  // 2. 图片类
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "psd", "raw"].includes(ext)) {
    return "image";
  }
  // 3. 视频类
  if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "rmvb"].includes(ext)) {
    return detailed ? "video" : "media";
  }
  // 4. 音频类
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "ape"].includes(ext)) {
    return detailed ? "audio" : "media";
  }
  // 5. 压缩包类
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab"].includes(ext)) {
    return "archive";
  }
  // 6. 代码与脚本类
  if ([
    "js", "ts", "tsx", "jsx", "vue", "html", "css", "scss", "less", "json",
    "py", "rs", "cpp", "c", "h", "hpp", "go", "java", "sql", "sh", "bash",
    "ps1", "bat", "cmd", "yaml", "yml", "xml", "toml", "ini"
  ].includes(ext)) {
    return "code";
  }
  // 7. 应用程序与可执行文件
  if (["exe", "msi", "cmd", "appx", "msix"].includes(ext)) {
    return "app";
  }

  return "document";
}

/**
 * 标杆文件样本库 (涵盖 8 大类真实文件、长路径与多语言)
 */
export const SAMPLE_FILES: FileRecord[] = [
  {
    name: "ZTools-Architecture-Design.docx",
    path: "C:\\Users\\User\\Documents\\ZTools\\ZTools-Architecture-Design.docx",
    isDir: false,
    size: 4520192,
    mtime: Date.now() - 3600000 * 2,
    category: "document",
    extension: "docx",
    acronym: "zad",
    pinyin: "ztools architecture"
  },
  {
    name: "raycast-windows-deep-reverse-analysis.md",
    path: "E:\\csdwork3\\git\\ZTools\\docs\\raycast-windows-deep-reverse-analysis.md",
    isDir: false,
    size: 25451,
    mtime: Date.now() - 3600000 * 5,
    category: "document",
    extension: "md",
    acronym: "rwdra",
    pinyin: "raycast windows"
  },
  {
    name: "Development-Plan-2026.pdf",
    path: "C:\\Users\\User\\Downloads\\Development-Plan-2026.pdf",
    isDir: false,
    size: 1845120,
    mtime: Date.now() - 3600000 * 12,
    category: "document",
    extension: "pdf",
    acronym: "dp2",
    pinyin: "development plan"
  },
  {
    name: "architecture-diagram.png",
    path: "E:\\csdwork3\\git\\ZTools\\docs\\images\\architecture-diagram.png",
    isDir: false,
    size: 382910,
    mtime: Date.now() - 3600000 * 8,
    category: "image",
    extension: "png",
    acronym: "adp",
    pinyin: "architecture diagram"
  },
  {
    name: "product-demo-walkthrough.mp4",
    path: "D:\\Videos\\ScreenRecordings\\product-demo-walkthrough.mp4",
    isDir: false,
    size: 88473600,
    mtime: Date.now() - 3600000 * 24,
    category: "video",
    extension: "mp4",
    acronym: "pdw",
    pinyin: "product demo"
  },
  {
    name: "keynote-speech-recording.mp3",
    path: "D:\\Music\\Conferences\\keynote-speech-recording.mp3",
    isDir: false,
    size: 12582912,
    mtime: Date.now() - 86400000 * 2,
    category: "audio",
    extension: "mp3",
    acronym: "ksr",
    pinyin: "keynote speech"
  },
  {
    name: "wechat-backup-2026.zip",
    path: "D:\\Backup\\wechat-backup-2026.zip",
    isDir: false,
    size: 852910240,
    mtime: Date.now() - 86400000 * 6,
    category: "archive",
    extension: "zip",
    acronym: "wb",
    pinyin: "wechat backup"
  },
  {
    name: "indexer.rs",
    path: "E:\\csdwork3\\git\\ZTools\\electron-client\\native\\indexer\\src\\main.rs",
    isDir: false,
    size: 14208,
    mtime: Date.now() - 3600000 * 3,
    category: "code",
    extension: "rs",
    acronym: "ir",
    pinyin: "indexer rs"
  },
  {
    name: "ztools-indexer.exe",
    path: "E:\\csdwork3\\git\\ZTools\\electron-client\\out\\native\\win32-x64\\bin\\ztools-indexer.exe",
    isDir: false,
    size: 891240,
    mtime: Date.now() - 3600000 * 18,
    category: "app",
    extension: "exe",
    acronym: "zi",
    pinyin: "ztools indexer"
  },
  {
    name: "Projects",
    path: "D:\\Workspace\\Projects",
    isDir: true,
    size: 0,
    mtime: Date.now() - 86400000 * 3,
    category: "folder",
    acronym: "p",
    pinyin: "projects"
  },
  {
    name: "中文测试-超长路径-深度测试文档-2026-年度战略方案-核心资产清单-密级公开.docx",
    path: "C:\\Company\\Confidential\\Archive\\VeryLongDirectoryNameThatExceedsNormalLengthLimitsToVerifyPathHandlingWithoutCrashing\\2026\\Q4\\中文测试-超长路径-深度测试文档-2026-年度战略方案-核心资产清单-密级公开.docx",
    isDir: false,
    size: 145200,
    mtime: Date.now() - 3600000 * 1,
    category: "document",
    extension: "docx",
    acronym: "zwcs",
    pinyin: "zhongwen ceshi"
  }
];

export function sortAndFilterFiles(
  files: FileRecord[],
  sortOption: SortOption,
  typeFilter: TypeFilter
): FileRecord[] {
  let result = files;

  if (typeFilter === "video") {
    result = result.filter((f) => getFileCategory(f.name, f.isDir, true) === "video");
  } else if (typeFilter === "audio") {
    result = result.filter((f) => getFileCategory(f.name, f.isDir, true) === "audio");
  } else if (typeFilter === "media") {
    // 兼容历史 media 分类
    result = result.filter((f) => getFileCategory(f.name, f.isDir) === "media");
  } else if (typeFilter !== "all") {
    result = result.filter((f) => getFileCategory(f.name, f.isDir) === typeFilter);
  }

  const sorted = [...result];
  switch (sortOption) {
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name, "zh-CN"));
      break;
    case "size-desc":
      sorted.sort((a, b) => b.size - a.size);
      break;
    case "size-asc":
      sorted.sort((a, b) => a.size - b.size);
      break;
    case "mtime-desc":
      sorted.sort((a, b) => b.mtime - a.mtime);
      break;
    case "mtime-asc":
      sorted.sort((a, b) => a.mtime - b.mtime);
      break;
  }
  return sorted;
}

function mapRawFileToRecord(f: any): FileRecord {
  const isDir = Boolean(f?.is_dir || f?.isDir || f?.isDirectory);
  const fullPath = String(f?.path || "");
  const name = String(f?.name || fullPath.split(/[\\/]/).pop() || "");
  const category = getFileCategory(name, isDir);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const rawMtime = Number(f?.mtime ?? f?.mtimeMs ?? 0);
  const mtime = rawMtime > 0 && rawMtime < 1e11 ? rawMtime * 1000 : rawMtime > 0 ? rawMtime : Date.now();
  return {
    name,
    path: fullPath,
    isDir,
    size: Number(f?.size ?? f?.sizeBytes) || 0,
    mtime,
    category,
    extension: isDir ? undefined : ext,
    acronym: f?.acronym,
    pinyin: f?.pinyin
  };
}

/**
 * 检索文件 (深度联动 Rust 预编译侧车 ztools-indexer.exe 或系统 IPC)
 */
export async function searchLocalFiles(
  query: string,
  limit = 50,
  hostOverride?: any
): Promise<FileRecord[]> {
  const trimmed = (query || "").trim().toLowerCase();
  const realHost = isRealElectronHost(hostOverride);

  // 1. 若在真实宿主环境或注入了 hostOverride，优先调度底层 Rust 侧车 ztools-indexer / filesearch_query。
  //    必须走插件自己的通道（callHostTransport，带本插件会话）：宿主只把这样拿到的普通文件结果授权给本插件移入回收站；
  //    __ztoolsLauncher.searchFiles 不带插件身份，结果只能打开 / 定位 / 预览，所以只在没有宿主通道时才用。
  try {
    let rawFiles: any[] = [];
    if (hostOverride || realHost) {
      const fsQueryRes = await callHostTransport<any>(
        "filesearch_query",
        { query: trimmed, limit },
        hostOverride
      );
      if (fsQueryRes.ok && fsQueryRes.data) {
        if (Array.isArray(fsQueryRes.data)) rawFiles = fsQueryRes.data;
        else if (Array.isArray(fsQueryRes.data?.files)) rawFiles = fsQueryRes.data.files;
        else if (Array.isArray(fsQueryRes.data?.items)) rawFiles = fsQueryRes.data.items;
      }

      if (rawFiles.length === 0) {
        const ipcRes = await callHostTransport<any>(
          "system_search_files",
          { query: trimmed || ".", limit },
          hostOverride
        );
        if (ipcRes.ok && ipcRes.data) {
          if (Array.isArray(ipcRes.data)) rawFiles = ipcRes.data;
          else if (Array.isArray(ipcRes.data?.files)) rawFiles = ipcRes.data.files;
          else if (Array.isArray(ipcRes.data?.items)) rawFiles = ipcRes.data.items;
        }
      }
    } else {
      const launcher = (globalThis as any).__ztoolsLauncher;
      const system = (globalThis as any).ztools?.system;
      if (launcher?.searchFiles) {
        const res = await launcher.searchFiles(trimmed, limit);
        const unwrapped = res && typeof res === "object" && "data" in res && res.data ? res.data : res;
        if (Array.isArray(unwrapped)) rawFiles = unwrapped;
        else if (Array.isArray(unwrapped?.files)) rawFiles = unwrapped.files;
      } else if (system?.searchFiles) {
        const res = await system.searchFiles(trimmed, limit);
        if (Array.isArray(res)) rawFiles = res;
        else if (Array.isArray(res?.files)) rawFiles = res.files;
      }
    }

    if (rawFiles.length > 0) {
      return rawFiles.map(mapRawFileToRecord);
    }

    // 在真实宿主环境下，如果索引查询为空（例如空关键词刚打开或索引尚未构建完成），读取真实的用户常用目录
    if (realHost) {
      const [downloadsDir, desktopDir, documentsDir] = await Promise.all([
        getRealSystemPath("downloads", hostOverride),
        getRealSystemPath("desktop", hostOverride),
        getRealSystemPath("documents", hostOverride)
      ]);
      const dirs = [downloadsDir, desktopDir, documentsDir].filter(Boolean);
      const lists = await Promise.all(dirs.map((d) => readRealDirectory(d, hostOverride)));
      const seen = new Set<string>();
      const collected: FileRecord[] = [];
      for (const entries of lists) {
        for (const entry of entries) {
          if (!entry.path || seen.has(entry.path)) continue;
          const rec = mapRawFileToRecord(entry);
          if (
            !trimmed ||
            rec.name.toLowerCase().includes(trimmed) ||
            rec.path.toLowerCase().includes(trimmed) ||
            (rec.extension && rec.extension.toLowerCase().includes(trimmed))
          ) {
            seen.add(rec.path);
            collected.push(rec);
            if (collected.length >= limit) break;
          }
        }
        if (collected.length >= limit) break;
      }
      return collected;
    }
  } catch (err) {
    console.warn("[EverythingFileSearch] 调用宿主 Rust 索引引擎异常，转入回退引擎:", err);
    if (realHost) {
      return [];
    }
  }

  // 2. 离线/测试/降级兜底引擎 (仅在非真实宿主环境下启用)
  if (realHost) {
    return [];
  }
  if (!trimmed) {
    return SAMPLE_FILES;
  }
  return SAMPLE_FILES.filter(
    (f) =>
      f.name.toLowerCase().includes(trimmed) ||
      f.path.toLowerCase().includes(trimmed) ||
      (f.extension && f.extension.toLowerCase().includes(trimmed)) ||
      (f.acronym && f.acronym.includes(trimmed)) ||
      (f.pinyin && f.pinyin.includes(trimmed))
  );
}

// 常见文本/代码后缀集合
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "vue", "html", "htm", "css", "scss", "less", "py", "rs", "cpp", "c", "h",
  "hpp", "go", "java", "sql", "yaml", "yml", "xml", "toml", "ini", "conf",
  "bat", "cmd", "ps1", "sh", "bash", "log", "csv"
]);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  vue: "vue",
  json: "json",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  cpp: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  html: "html",
  css: "css",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  toml: "toml"
};

const MAX_TEXT_PREVIEW_BYTES = 64 * 1024;
/** 宿主单次分块读取上限是 2 MiB，应用内图片预览只读一块 */
const MAX_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;

/** 浏览器能直接显示的图片格式；psd / raw / tiff 等不在应用内预览 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml"
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 通过宿主只读读取文件头部（filesystem_read_file_chunk，返回 base64）。
 * 宿主拒绝（例如路径未授权）、文件不存在或返回结构不对时返回 ok:false 与真实原因，绝不当成二进制文件处理。
 */
async function readHostFileHead(
  filePath: string,
  maxBytes: number,
  hostOverride?: any
): Promise<{ ok: true; base64: string; bytes: Uint8Array; totalSize: number } | { ok: false; error: string }> {
  const res = await callHostTransport<any>(
    "filesystem_read_file_chunk",
    { path: filePath, offset: 0, length: maxBytes },
    hostOverride
  );
  if (!res.ok) {
    return { ok: false, error: res.error || "宿主拒绝读取该文件" };
  }
  const content = res.data?.content;
  if (typeof content !== "string") {
    return { ok: false, error: "宿主返回的文件内容格式无效" };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(content);
  } catch {
    return { ok: false, error: "宿主返回的文件内容不是有效的 base64" };
  }
  const totalSize = Number(res.data?.totalSize);
  return { ok: true, base64: content, bytes, totalSize: Number.isFinite(totalSize) ? totalSize : bytes.length };
}

/**
 * 极客空格即时预览 (Space Quick Look Selection) 核心数据抽取器
 */
export async function getFileQuickLook(
  file: FileRecord,
  hostOverride?: any
): Promise<FileQuickLookResult> {
  const category = getFileCategory(file.name, file.isDir);
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const base = {
    path: file.path,
    name: file.name,
    isDir: false,
    size: file.size,
    mtime: file.mtime,
    category
  };

  // 1. 文件夹预览
  if (file.isDir) {
    try {
      if (hostOverride || isRealElectronHost()) {
        // 只列直接子项（子目录在前），不能用 dir: 扫描的深层 Top-N 大文件冒充文件夹内容
        const { entries, partial } = await listDirectChildren(file.path, hostOverride);
        if (entries.length > 0) {
          const dirEntries = entries.slice(0, 25).map((e) => ({
            name: e.name,
            isDir: Boolean(e.isDir || e.isDirectory)
          }));
          return {
            path: file.path,
            name: file.name,
            isDir: true,
            size: file.size,
            mtime: file.mtime,
            category,
            previewType: "directory",
            dirEntries,
            totalLines: entries.length,
            truncated: entries.length > 25,
            partial
          };
        }
      }
    } catch (err: any) {
      return {
        path: file.path,
        name: file.name,
        isDir: true,
        size: file.size,
        mtime: file.mtime,
        category,
        previewType: "error",
        error: `无法读取文件夹: ${err.message || String(err)}`
      };
    }

    return {
      path: file.path,
      name: file.name,
      isDir: true,
      size: file.size,
      mtime: file.mtime,
      category,
      previewType: "directory",
      dirEntries: []
    };
  }

  // 2. 空文件拦截 (0 字节)
  if (file.size === 0) {
    return {
      path: file.path,
      name: file.name,
      isDir: false,
      size: 0,
      mtime: file.mtime,
      category,
      previewType: "empty",
      content: "(空文件，0 字节)"
    };
  }

  // 3. 图片文件预览：由宿主读出真实字节，转成 data:image URL（渲染器只放行 data:image / https / ztools 图片地址，
  //    也禁止插件用 file:// 访问本地文件）。宿主拒绝读取时如实显示读取异常。
  const imageMime = IMAGE_MIME[ext];
  if (category === "image" && imageMime) {
    if (file.size > MAX_IMAGE_PREVIEW_BYTES) {
      return {
        ...base,
        previewType: "binary",
        content: `图片较大 (${formatBytes(file.size)})，不在应用内预览。可用「系统快速预览」或直接打开查看。`
      };
    }
    const read = await readHostFileHead(file.path, MAX_IMAGE_PREVIEW_BYTES, hostOverride);
    if (!read.ok) {
      return { ...base, previewType: "error", error: read.error };
    }
    if (read.totalSize > read.bytes.length) {
      return {
        ...base,
        previewType: "binary",
        content: `图片较大 (${formatBytes(read.totalSize)})，不在应用内预览。可用「系统快速预览」或直接打开查看。`
      };
    }
    return { ...base, previewType: "image", content: `data:${imageMime};base64,${read.base64}` };
  }

  // 4. 文本与代码文件快速安全预览（只读文件头 64KB，截取前 200 行）
  if (TEXT_EXTS.has(ext)) {
    const read = await readHostFileHead(file.path, MAX_TEXT_PREVIEW_BYTES, hostOverride);
    if (!read.ok) {
      return { ...base, previewType: "error", error: read.error };
    }
    const bytes = read.bytes;
    if (bytes.includes(0)) {
      return {
        ...base,
        previewType: "binary",
        content: `文件内容不是文本 (.${ext.toUpperCase()})，暂不支持文本预览。可按 Enter 直接在默认关联应用中打开。`
      };
    }
    // stream:true 丢弃被 64KB 截断的半个多字节字符，避免末尾出现乱码
    const textData = new TextDecoder("utf-8").decode(bytes, { stream: true });
    const allLines = textData.split(/\r?\n/);
    const maxLines = 200;
    const truncated = allLines.length > maxLines || read.totalSize > bytes.length;
    return {
      ...base,
      previewType: ext === "md" || ext === "markdown" ? "markdown" : "code",
      codeLanguage: EXT_TO_LANG[ext] || "plaintext",
      content: allLines.slice(0, maxLines).join("\n"),
      totalLines: allLines.length,
      truncated
    };
  }

  // 5. 其他二进制/多媒体格式，安全降级
  return {
    path: file.path,
    name: file.name,
    isDir: false,
    size: file.size,
    mtime: file.mtime,
    category,
    previewType: "binary",
    content: `多媒体或二进制文件 (.${ext.toUpperCase() || "BIN"})，暂不支持文本预览。可按 Enter 直接在默认关联应用中打开。`
  };
}

/**
 * 计算文件 SHA-256 哈希值：由宿主读取文件真实字节计算（filesearch_sha256）。
 * 宿主算不出来时如实报错，不返回编造的值（以前会按路径拼一个看起来像哈希的字符串）。
 */
export async function calculateFileSha256(filePath: string, hostOverride?: any): Promise<string> {
  if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("文件路径无效或为空");
  }
  // 先直接问宿主 filesearch_sha256 拿到失败原因（未授权 / 文件已删除要如实提示），其余情况再走公共实现（含 Windows DLL 兜底）
  const direct = await callHostTransport<any>("filesearch_sha256", { path: filePath.trim() }, hostOverride);
  if (direct.ok && direct.data) {
    const value = typeof direct.data === "string" ? direct.data : String(direct.data?.sha256 || direct.data?.hash || "");
    if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  } else if (!direct.ok && classifyHostFileError(direct.error)) {
    throw new Error(describeHostFileError(direct.error, filePath));
  }
  const hash = await computeRealFileSha256(filePath, hostOverride);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("宿主没有返回 SHA-256 结果");
  }
  return hash;
}

/**
 * 宿主文件操作失败原因转成用户能看懂的提示。宿主只放行本窗口搜索结果里的路径（结果授权 30 分钟过期，
 * 换窗口不带走），所以 PERMISSION_DENIED 时提示重新搜索；FILE_ERROR / 不存在说明文件已被移动或删除。
 * callHostTransport 只回传错误文本（宿主 message 优先，没有时是错误码），两种都要识别。
 */
export function classifyHostFileError(error: string | undefined): "permission" | "missing" | null {
  const raw = String(error || "").trim();
  if (/PERMISSION_DENIED|未由当前窗口授权|权限不足|未授权|capability/i.test(raw)) return "permission";
  if (/FILE_ERROR|FILE_NOT_FOUND|ENOENT|不存在|文件操作失败|目标不是文件/i.test(raw)) return "missing";
  return null;
}

/** 保留宿主原话（只有错误码时不显示码），再补一句该怎么办 */
export function describeHostFileError(error: string | undefined, fallback: string, permissionHint?: string): string {
  const raw = String(error || "").trim();
  const kind = classifyHostFileError(raw);
  if (!kind) return raw || fallback;
  const hint = kind === "permission"
    ? permissionHint || "只能操作本次搜索到的文件，授权可能已过期，请重新搜索后再试"
    : "文件可能已被移动或删除，请重新搜索";
  return /^[A-Z_]+$/.test(raw) ? hint : `${raw}（${hint}）`;
}

function invalidPathResult(filePath: string): FileActionResult | null {
  if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
    return { success: false, message: "文件路径无效或为空", path: filePath || "", error: "INVALID_PATH" };
  }
  if (filePath.length > 1024) {
    return { success: false, message: "路径长度超出支持上限 (>1024字符)", path: filePath, error: "PATH_TOO_LONG" };
  }
  return null;
}

/**
 * 打开文件 / 文件夹 (Open File)
 * 走宿主文件秒搜服务 filesearch_open：宿主返回 { success:false, error } 时如实报失败（文件不存在、系统打不开等），
 * 不能像以前那样只要调用没抛异常就提示「已成功打开」。
 */
export async function openFile(filePath: string, hostOverride?: any): Promise<FileActionResult> {
  const invalid = invalidPathResult(filePath);
  if (invalid) return invalid;
  const res = await callHostTransport("filesearch_open", { path: filePath }, hostOverride);
  if (res.ok) {
    return { success: true, message: "已打开", path: filePath };
  }
  return { success: false, message: `打开失败: ${describeHostFileError(res.error, filePath)}`, path: filePath, error: "OPEN_FAILED" };
}

/**
 * 在访达 / 资源管理器中定位选定文件 (Show in Finder)，同样以宿主 filesearch_reveal 的真实结果为准
 */
export async function revealFile(filePath: string, hostOverride?: any): Promise<FileActionResult> {
  const invalid = invalidPathResult(filePath);
  if (invalid) return invalid;
  const res = await callHostTransport("filesearch_reveal", { path: filePath }, hostOverride);
  if (res.ok) {
    return { success: true, message: "已在文件管理器中定位", path: filePath };
  }
  return { success: false, message: `定位失败: ${describeHostFileError(res.error, filePath)}`, path: filePath, error: "REVEAL_FAILED" };
}

/**
 * 移入回收站 / 废纸篓 (Move to Trash)：以宿主 shell_trash_item 的真实结果为准。
 * 宿主只允许回收本插件搜索到的普通文件（不含文件夹、符号链接与系统目录），文件夹不在这里处理。
 */
export async function moveToTrash(filePath: string, hostOverride?: any, isDir = false): Promise<FileActionResult> {
  const invalid = invalidPathResult(filePath);
  if (invalid) return invalid;
  if (isDir) {
    return { success: false, message: "文件夹不能在这里移入废纸篓，请在访达 / 资源管理器中操作", path: filePath, error: "TRASH_DIRECTORY" };
  }
  const tr = await trashRealItem(filePath, hostOverride);
  if (tr.ok) {
    return { success: true, message: "已移入废纸篓 / 回收站", path: filePath };
  }
  const reason = describeHostFileError(
    tr.error,
    filePath,
    "只能回收本次搜索到的普通文件，系统目录与链接除外，授权可能已过期，请重新搜索后再试"
  );
  return { success: false, message: `移入废纸篓失败: ${reason}`, path: filePath, error: "TRASH_FAILED" };
}

/**
 * 复制文件本身到剪贴板 (Copy File to Clipboard)
 */
export async function copyFileToClipboard(filePath: string): Promise<FileActionResult> {
  if (!filePath) {
    return { success: false, message: "文件路径为空", path: "", error: "INVALID_PATH" };
  }

  try {
    const clipboard = (globalThis as any).ztools?.clipboard;
    if (clipboard?.copyFiles) {
      await clipboard.copyFiles([filePath]);
      return { success: true, message: `已将文件本身复制到剪贴板`, path: filePath };
    }

    // 由宿主把文件本身放进系统剪贴板（粘贴到访达 / 资源管理器即是文件）；以前在这里只写了一段 file:/// 文本却提示已复制文件
    const res = await callHostTransport("clipboard_copy_file", { filePath });
    if (res.ok) {
      return { success: true, message: `已将文件本身复制到剪贴板`, path: filePath };
    }
    return { success: false, message: res.error || `复制文件失败: ${filePath}`, path: filePath, error: "COPY_FILE_FAILED" };
  } catch (err: any) {
    return { success: false, message: `复制文件失败: ${err.message || String(err)}`, path: filePath, error: "COPY_FILE_FAILED" };
  }
}

/**
 * 调用系统原生 Quick Look 快速预览 (macOS qlmanage -p / Windows 预览桥接)
 */
export async function quickLookFile(filePath: string, hostOverride?: any): Promise<FileActionResult> {
  if (!filePath || !filePath.trim()) {
    return { success: false, message: "文件路径无效或为空", path: filePath || "", error: "INVALID_PATH" };
  }
  const res = await callHostTransport("filesearch_quick_look", { path: filePath }, hostOverride);
  if (res.ok) {
    return { success: true, message: "已调起系统快速预览", path: filePath };
  }
  return {
    success: false,
    message: `快速预览失败: ${describeHostFileError(res.error, filePath)}`,
    path: filePath,
    error: "QUICK_LOOK_FAILED"
  };
}

