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

/** 宿主返回的单条文件记录（不同通道字段名不一，逐个兼容） */
interface RawFileEntry {
  is_dir?: unknown;
  isDir?: unknown;
  isDirectory?: unknown;
  path?: unknown;
  name?: unknown;
  mtime?: unknown;
  mtimeMs?: unknown;
  size?: unknown;
  sizeBytes?: unknown;
  acronym?: unknown;
  pinyin?: unknown;
}

/** 插件窗口上可能存在的宿主全局对象（都可能缺失） */
interface HostGlobals {
  __ztoolsLauncher?: { searchFiles?: (query: string, limit: number) => Promise<unknown> };
  ztools?: {
    system?: { searchFiles?: (query: string, limit: number) => Promise<unknown> };
    clipboard?: { copyFiles?: (paths: string[]) => Promise<unknown> };
  };
}

function hostGlobals(): HostGlobals {
  return globalThis as unknown as HostGlobals;
}

/** 与原来「优先取 message、否则转字符串」的结果一致：有 message 用 message，否则整体转字符串 */
function errorText(err: unknown): string {
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  return message ? String(message) : String(err);
}

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
  // macOS 路径用 /，不能按 Windows 写法拼成 \...\（以前 /Users/a/b/c 会显示成 \...\b\c）
  const posix = fullPath.startsWith("/");
  const sep = posix ? "/" : "\\";
  const parts = fullPath.split(posix ? "/" : /[\\/]/);
  if (parts.length <= 3) return fullPath;
  const head = posix ? (parts[1] === "Users" && parts[2] ? `/Users/${parts[2]}` : `/${parts[1]}`) : parts[0];
  return `${head}${sep}...${sep}${parts.slice(-2).join(sep)}`;
}

/**
 * 根据文件名与目录属性进行精细化 8 大类归类
 */
export function getFileCategory(fileName: string, isDir: boolean, detailed = false): TypeFilter {
  if (isDir) return "folder";
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  // 1. 文档类
  if (["doc", "docx", "pdf", "txt", "md", "xls", "xlsx", "ppt", "pptx", "csv", "rtf", "odt", "ods"].includes(ext)) {
    return "document";
  }
  // 2. 图片类
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "psd", "raw", "heic", "heif", "avif"].includes(ext)) {
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
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab", "dmg", "tgz"].includes(ext)) {
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
  if (["exe", "msi", "appx", "msix", "pkg", "apk"].includes(ext)) {
    return "app";
  }

  // 认不出的扩展名（包括没有扩展名的文件）不能算作文档，否则「文档」筛选会混进任意文件
  return "other";
}

/** 不在 ZTools 客户端里运行（拿不到宿主通道）时的提示；此时不显示任何示例数据 */
export const NOT_IN_CLIENT_MESSAGE = "需要在 ZTools 客户端中使用";

/**
 * 系统快速预览只在 macOS 上可用（宿主调用 qlmanage）；Windows 上宿主会改为在资源管理器中定位，
 * 所以只在 macOS 上提供这个动作，避免提示「已调起系统快速预览」却实际打开了资源管理器。
 */
export function supportsSystemQuickLook(platform?: string): boolean {
  const nav = (globalThis as { navigator?: { platform?: string } }).navigator;
  const value = platform ?? String(nav?.platform || "");
  return /^mac/i.test(value) || value === "darwin";
}

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

function mapRawFileToRecord(raw: unknown): FileRecord {
  const f = raw as RawFileEntry | null | undefined;
  const isDir = Boolean(f?.is_dir || f?.isDir || f?.isDirectory);
  const fullPath = String(f?.path || "");
  const name = String(f?.name || fullPath.split(/[\\/]/).pop() || "");
  const category = getFileCategory(name, isDir);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const rawMtime = Number(f?.mtime ?? f?.mtimeMs ?? 0);
  // 宿主没给修改时间时记为 0（界面显示「未知」），不能用当前时间冒充
  const mtime = rawMtime > 0 && rawMtime < 1e11 ? rawMtime * 1000 : rawMtime > 0 ? rawMtime : 0;
  return {
    name,
    path: fullPath,
    isDir,
    size: Number(f?.size ?? f?.sizeBytes) || 0,
    mtime,
    category,
    extension: isDir ? undefined : ext,
    acronym: f?.acronym as FileRecord["acronym"],
    pinyin: f?.pinyin as FileRecord["pinyin"]
  };
}

/** 宿主 Windows 退回扫描的目录（electron-client scanLocalRecentFiles：用户主目录下的 Downloads / Desktop / Documents） */
const LOCAL_FALLBACK_DIRS_TEXT = "下载、桌面、文稿";

/**
 * 按宿主返回的 degraded / source 说明本次搜索的真实范围；搜索覆盖完整时返回空字符串。
 * - source = "local-fs"：Windows 全盘索引（ztools-indexer）未运行（degraded = true）或索引查询为空，宿主只扫描了下载、桌面、文稿
 * - source = "macos-fs" / "macos-spotlight" 且 degraded = true：Spotlight（mdfind）失败或超时，结果只含已返回部分与本地目录补充
 */
export function describeSearchScope(raw: unknown, query: string): string {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  if (!record) return "";
  const degraded = record.degraded === true;
  const source = typeof record.source === "string" ? record.source : "";
  const hasQuery = String(query || "").trim().length > 0;
  if (source === "local-fs") {
    if (degraded) return `全盘索引不可用，仅搜索了${LOCAL_FALLBACK_DIRS_TEXT}`;
    if (hasQuery) return `全盘索引没有返回结果（可能尚未建立），仅搜索了${LOCAL_FALLBACK_DIRS_TEXT}`;
    return "";
  }
  if (!degraded) return "";
  if (source === "macos-fs" || source === "macos-spotlight") {
    return `Spotlight 搜索失败或超时，结果可能不完整（仅含已返回部分及应用、${LOCAL_FALLBACK_DIRS_TEXT}中的匹配）`;
  }
  return "文件搜索处于降级模式，结果可能不完整";
}

export interface FileSearchOutcome {
  readonly files: FileRecord[];
  /** 搜索范围受限时的真实说明（来自宿主 degraded / source）；完整搜索时为空字符串 */
  readonly scopeNotice: string;
}

/**
 * 检索文件：交给客户端的文件搜索接口（Windows 上由原生索引组件 ztools-indexer 提供，macOS 上用 Spotlight）。
 * 同时透传宿主的降级标记，界面据此提示搜索范围。拿不到任何宿主通道时抛出 NOT_IN_CLIENT_MESSAGE，不返回示例数据。
 */
export async function searchLocalFilesDetailed(
  query: string,
  limit = 50,
  hostOverride?: unknown
): Promise<FileSearchOutcome> {
  const trimmed = (query || "").trim();
  const realHost = isRealElectronHost(hostOverride);

  // 1. 在真实宿主环境或注入了 hostOverride 时，调用客户端的 filesearch_query（Windows 上由 C++ 原生索引组件 ztools-indexer 提供结果）。
  //    必须走插件自己的通道（callHostTransport，带本插件会话）：宿主只把这样拿到的普通文件结果授权给本插件移入回收站；
  //    __ztoolsLauncher.searchFiles 不带插件身份，结果只能打开 / 定位 / 预览，所以只在没有宿主通道时才用。
  if (hostOverride || realHost) {
    const errors: string[] = [];
    for (const method of ["filesearch_query", "system_search_files"]) {
      // 空关键词原样发送：宿主把空查询当作「最近文件」（Spotlight 最近修改 / 用户目录最近文件）；
      // 改成 "." 会被当成普通关键词去匹配文件名里的点号，首屏就成了无关文件
      const result = await callHostTransport<unknown>(method, { query: trimmed, limit }, hostOverride);
      const data = result.data;
      const record = data && typeof data === "object" ? data as Record<string, unknown> : undefined;
      const files = Array.isArray(data) ? data : Array.isArray(record?.files) ? record.files : Array.isArray(record?.items) ? record.items : null;
      if (result.ok && files) return { files: files.map(mapRawFileToRecord), scopeNotice: describeSearchScope(data, trimmed) };
      errors.push(result.error || `${method} 返回无效结果`);
    }
    throw new Error(`文件搜索不可用：${errors.join("；")}`);
  } else {
    const launcher = hostGlobals().__ztoolsLauncher;
    const system = hostGlobals().ztools?.system;
    let res: unknown;
    if (launcher?.searchFiles) {
      res = await launcher.searchFiles(trimmed, limit);
      const wrapped = res && typeof res === "object" ? (res as { data?: unknown }).data : undefined;
      if (wrapped) res = wrapped;
    } else if (system?.searchFiles) {
      res = await system.searchFiles(trimmed, limit);
    } else {
      throw new Error(NOT_IN_CLIENT_MESSAGE);
    }
    const listed = res && typeof res === "object" ? (res as { files?: unknown }).files : undefined;
    const rawFiles = Array.isArray(res) ? res : Array.isArray(listed) ? listed : null;
    // 返回结构不对时如实报错，不能当成「没有匹配的文件」
    if (!rawFiles) throw new Error("文件搜索返回了无效结果");
    return { files: rawFiles.map(mapRawFileToRecord), scopeNotice: describeSearchScope(res, trimmed) };
  }
}

/** 只要文件列表时使用；需要提示搜索范围的界面用 searchLocalFilesDetailed */
export async function searchLocalFiles(
  query: string,
  limit = 50,
  hostOverride?: unknown
): Promise<FileRecord[]> {
  return (await searchLocalFilesDetailed(query, limit, hostOverride)).files;
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

/** 应用内不能预览时提示用户改用什么方式查看（系统快速预览只在 macOS 上有） */
function openElsewhereHint(): string {
  return supportsSystemQuickLook() ? "可用「Quick Look 快速预览」或直接打开查看。" : "可按 Enter 直接打开查看。";
}

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
  hostOverride?: unknown
): Promise<{ ok: true; base64: string; bytes: Uint8Array; totalSize: number } | { ok: false; error: string }> {
  const res = await callHostTransport<{ content?: unknown; totalSize?: unknown } | null>(
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
  hostOverride?: unknown
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
    } catch (err: unknown) {
      return {
        path: file.path,
        name: file.name,
        isDir: true,
        size: file.size,
        mtime: file.mtime,
        category,
        previewType: "error",
        error: `无法读取文件夹: ${errorText(err)}`
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
        content: `图片较大 (${formatBytes(file.size)})，不在应用内预览。${openElsewhereHint()}`
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
        content: `图片较大 (${formatBytes(read.totalSize)})，不在应用内预览。${openElsewhereHint()}`
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
export async function calculateFileSha256(filePath: string, hostOverride?: unknown): Promise<string> {
  if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("文件路径无效或为空");
  }
  // 先直接问宿主 filesearch_sha256 拿到失败原因（未授权 / 文件已删除要如实提示），其余情况再走公共实现（含 Windows DLL 兜底）
  const direct = await callHostTransport<string | { sha256?: unknown; hash?: unknown }>("filesearch_sha256", { path: filePath.trim() }, hostOverride);
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
export async function openFile(filePath: string, hostOverride?: unknown): Promise<FileActionResult> {
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
export async function revealFile(filePath: string, hostOverride?: unknown): Promise<FileActionResult> {
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
export async function moveToTrash(filePath: string, hostOverride?: unknown, isDir = false): Promise<FileActionResult> {
  const invalid = invalidPathResult(filePath);
  if (invalid) return invalid;
  const mac = supportsSystemQuickLook();
  const trash = mac ? "废纸篓" : "回收站";
  if (isDir) {
    return { success: false, message: `文件夹不能在这里移入${trash}，请在${mac ? "访达" : "资源管理器"}中操作`, path: filePath, error: "TRASH_DIRECTORY" };
  }
  const tr = await trashRealItem(filePath, hostOverride);
  if (tr.ok) {
    return { success: true, message: `已移入${trash}`, path: filePath };
  }
  const reason = describeHostFileError(
    tr.error,
    filePath,
    "只能回收本次搜索到的普通文件，系统目录与链接除外，授权可能已过期，请重新搜索后再试"
  );
  return { success: false, message: `移入${trash}失败: ${reason}`, path: filePath, error: "TRASH_FAILED" };
}

/**
 * 复制文件本身到剪贴板 (Copy File to Clipboard)
 */
export async function copyFileToClipboard(filePath: string): Promise<FileActionResult> {
  if (!filePath) {
    return { success: false, message: "文件路径为空", path: "", error: "INVALID_PATH" };
  }

  try {
    const clipboard = hostGlobals().ztools?.clipboard;
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
  } catch (err: unknown) {
    return { success: false, message: `复制文件失败: ${errorText(err)}`, path: filePath, error: "COPY_FILE_FAILED" };
  }
}

/**
 * 调用系统快速预览（仅 macOS：宿主执行 qlmanage -p）。Windows 上宿主没有快速预览，这里直接报不支持，
 * 不调用宿主（宿主在 Windows 上会改为在资源管理器中定位，不能当作预览成功）。
 */
export async function quickLookFile(filePath: string, hostOverride?: unknown): Promise<FileActionResult> {
  if (!filePath || !filePath.trim()) {
    return { success: false, message: "文件路径无效或为空", path: filePath || "", error: "INVALID_PATH" };
  }
  if (!supportsSystemQuickLook()) {
    return { success: false, message: "系统快速预览只在 macOS 上可用，可改用「即时预览」或在资源管理器中定位", path: filePath, error: "QUICK_LOOK_UNSUPPORTED" };
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

