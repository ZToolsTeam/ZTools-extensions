/**
 * 示例通用文件/文件夹导入辅助（仅面向 packages/declarative-ui/src/examples）
 * - 选择文件：window_show_open_dialog + "名称|ext1;ext2" 过滤串
 * - 选择文件夹：只用 window_show_select_folder_dialog + filesystem_get_directory_contents 逐层读取
 */
import { callHostTransport, getRealFileSize, invokeHostCapability } from './native-ipc.js';
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '$recycle.bin', 'system volume information']);
const SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', 'icon\r']);
function isWin(p) {
    return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'));
}
export function comparableExamplePath(p) {
    const s = String(p || '').trim().replace(/[\\/]+$/, '');
    return isWin(s) ? s.replace(/\//g, '\\').toLowerCase() : s;
}
export function isExampleVolumeRoot(p) {
    const s = String(p || '').trim();
    return /^[A-Za-z]:[\\/]?$/.test(s) || s === '/';
}
function baseNameOf(p) {
    return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}
function parentDirOf(p) {
    const s = String(p || '').replace(/[\\/]+$/, '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    if (i < 0)
        return '';
    if (i === 0)
        return s.slice(0, 1);
    const parent = s.slice(0, i);
    return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}
function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i).toLowerCase() : '';
}
function normExts(exts) {
    if (!Array.isArray(exts))
        return [];
    const set = new Set();
    for (const raw of exts) {
        const clean = String(raw || '').trim().toLowerCase().replace(/^\*?\./, '');
        if (/^[a-z0-9][a-z0-9+_-]{0,31}$/.test(clean))
            set.add(`.${clean}`);
    }
    return [...set];
}
function asObj(val) {
    return val && typeof val === 'object' && !Array.isArray(val) ? val : null;
}
function testPattern(re, val) {
    if (!re)
        return false;
    re.lastIndex = 0;
    return re.test(val);
}
export function friendlyExampleFileError(err) {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (/capability\s*数量超过上限/i.test(msg))
        return '文件过多导致授权超限，请改用「选择文件夹」导入';
    if (/路径未由当前窗口授权|文件授权窗口已关闭/.test(msg))
        return '文件授权已过期，请重新选择文件或文件夹';
    if (/目录条目超过\s*10000/.test(msg))
        return '目录条目超过 10000 项，请选择更具体的子文件夹';
    if (/METHOD_NOT_FOUND|METHOD_NOT_AVAILABLE|未知方法|is not a function/.test(msg))
        return '当前 ZTools 客户端版本不支持此操作';
    return msg || '文件操作失败';
}
function makeEmpty(extra = {}) {
    return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, ...extra };
}
function acceptFile(name, fullPath, exts, rules) {
    if (!name || name.startsWith('.') || name.startsWith('~$') || SYSTEM_FILES.has(name.toLowerCase()))
        return false;
    if (exts.length > 0 && !exts.includes(extOf(name)))
        return false;
    if (testPattern(rules.forbiddenPath, fullPath))
        return false;
    if (rules.excludeFile?.(name, fullPath))
        return false;
    return true;
}
async function queryFileSize(filePath, hostOverride) {
    const res = await callHostTransport('filesystem_get_file_size', { path: filePath }, hostOverride);
    if (!res.ok)
        return null;
    const rec = asObj(res.data);
    const size = typeof res.data === 'number' ? res.data : Number(rec?.size);
    if (Number.isFinite(size) && size >= 0)
        return size;
    const fallback = await getRealFileSize(filePath, hostOverride);
    return fallback > 0 ? fallback : null;
}
async function acceptPaths(paths, rules, out, maxFiles, hostOverride) {
    const exts = normExts(rules.extensions);
    const skipEmpty = rules.skipEmptyFiles !== false;
    for (const filePath of paths) {
        const name = baseNameOf(filePath);
        if (!acceptFile(name, filePath, exts, rules)) {
            out.ignored += 1;
            continue;
        }
        if (out.files.length >= maxFiles) {
            out.truncated = true;
            break;
        }
        const size = await queryFileSize(filePath, hostOverride);
        if (skipEmpty && size === 0) {
            out.ignored += 1;
            continue;
        }
        out.files.push({ path: filePath, name, parentDir: parentDirOf(filePath), extension: extOf(name), sizeBytes: size, lastModifiedMs: null });
    }
}
export async function pickExampleFiles(rules = {}, options, hostOverride) {
    const exts = normExts(rules.extensions);
    const maxFiles = rules.maxFiles && rules.maxFiles > 0 ? rules.maxFiles : 500;
    const params = {
        title: options.title,
        properties: options.multiple === false ? ['openFile'] : ['openFile', 'multiSelections']
    };
    if (exts.length > 0) {
        params.filters = `${options.filterName || '支持的文件'}|${exts.map(e => e.slice(1)).join(';')}`;
    }
    const res = await callHostTransport('window_show_open_dialog', params, hostOverride);
    if (!res.ok)
        return makeEmpty({ error: friendlyExampleFileError(res.error || '无法打开文件选择框') });
    const rec = asObj(res.data);
    if (rec?.canceled === true)
        return makeEmpty({ canceled: true });
    const rawPaths = [];
    if (typeof rec?.filePath === 'string' && rec.filePath.trim())
        rawPaths.push(rec.filePath.trim());
    if (Array.isArray(rec?.filePaths)) {
        for (const item of rec.filePaths) {
            const p = typeof item === 'string' ? item : String(asObj(item)?.path ?? '');
            if (p.trim())
                rawPaths.push(p.trim());
        }
    }
    if (rawPaths.length === 0)
        return makeEmpty({ error: '文件选择框未返回有效路径' });
    const result = makeEmpty();
    await acceptPaths(rawPaths, rules, result, maxFiles, hostOverride);
    return result;
}
async function readDirEntries(dir, hostOverride) {
    const res = await callHostTransport('filesystem_get_directory_contents', { path: dir }, hostOverride);
    if (!res.ok)
        return { ok: false, entries: [], error: friendlyExampleFileError(res.error || '读取目录失败') };
    const rec = asObj(res.data);
    const rawList = Array.isArray(res.data) ? res.data : Array.isArray(rec?.files) ? rec.files : null;
    if (!rawList)
        return { ok: false, entries: [], error: '目录内容格式无效' };
    const dirKey = comparableExamplePath(dir);
    const sep = isWin(dir) ? '\\' : '/';
    const cleanDir = dir.replace(/[\\/]+$/, '');
    const entries = [];
    for (const raw of rawList) {
        if (typeof raw === 'string') {
            const full = raw.trim();
            if (!full)
                continue;
            const name = baseNameOf(full);
            const isDirRes = await callHostTransport('filesystem_directory_exists', { path: full }, hostOverride);
            const isDir = isDirRes.ok && (isDirRes.data === true || asObj(isDirRes.data)?.exists === true);
            const size = isDir ? 0 : await queryFileSize(full, hostOverride);
            entries.push({ name, path: full, isDir: isDir || (size === 0 && !name.includes('.')), size, mtimeMs: null });
            continue;
        }
        const obj = asObj(raw);
        if (!obj || typeof obj.name !== 'string')
            continue;
        const rawName = obj.name.trim();
        if (!rawName || rawName === '.' || rawName === '..')
            continue;
        const full = /[\\/]/.test(rawName) ? rawName : `${cleanDir}${sep}${rawName}`;
        if (comparableExamplePath(parentDirOf(full)) !== dirKey)
            continue;
        const isDir = obj.isDirectory === true || obj.isDir === true;
        const numSize = Number(obj.size);
        const parsedTime = Date.parse(String(obj.lastModified ?? ''));
        entries.push({
            name: baseNameOf(full),
            path: full,
            isDir,
            size: !isDir && Number.isFinite(numSize) && numSize >= 0 ? numSize : null,
            mtimeMs: Number.isFinite(parsedTime) ? parsedTime : null
        });
    }
    return { ok: true, entries };
}
export async function collectExampleFolderFiles(folderPath, rules = {}, options = {}, hostOverride) {
    const root = String(folderPath || '').trim();
    if (!root)
        return makeEmpty({ error: '未选择文件夹' });
    if (testPattern(rules.forbiddenPath, root))
        return makeEmpty({ error: '该文件夹属于受保护的系统目录，禁止导入' });
    const exts = normExts(rules.extensions);
    const maxDepth = rules.maxDepth && rules.maxDepth > 0 ? rules.maxDepth : 5;
    const maxFiles = rules.maxFiles && rules.maxFiles > 0 ? rules.maxFiles : 500;
    const maxDirs = rules.maxVisitedDirs && rules.maxVisitedDirs > 0 ? rules.maxVisitedDirs : 300;
    const skipEmpty = rules.skipEmptyFiles !== false;
    const out = makeEmpty();
    const queue = [{ dir: root, depth: 1 }];
    let visitedDirs = 0;
    while (queue.length > 0) {
        if (options.signal?.aborted)
            return makeEmpty({ canceled: true });
        if (visitedDirs >= maxDirs) {
            out.truncated = true;
            break;
        }
        const current = queue.shift();
        visitedDirs += 1;
        const listing = await readDirEntries(current.dir, hostOverride);
        if (options.signal?.aborted)
            return makeEmpty({ canceled: true });
        if (!listing.ok) {
            if (current.dir === root)
                return makeEmpty({ error: listing.error });
            out.failedDirs.push({ path: current.dir, error: listing.error || '读取失败' });
            continue;
        }
        listing.entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
        for (const item of listing.entries) {
            if (item.isDir) {
                if (current.depth < maxDepth && !item.name.startsWith('.') && !SKIP_DIRS.has(item.name.toLowerCase()) && !testPattern(rules.forbiddenPath, item.path)) {
                    queue.push({ dir: item.path, depth: current.depth + 1 });
                }
                continue;
            }
            if (!acceptFile(item.name, item.path, exts, rules) || (skipEmpty && item.size === 0)) {
                out.ignored += 1;
                continue;
            }
            if (out.files.length >= maxFiles) {
                out.truncated = true;
                break;
            }
            out.files.push({
                path: item.path,
                name: item.name,
                parentDir: parentDirOf(item.path),
                extension: extOf(item.name),
                sizeBytes: item.size,
                lastModifiedMs: item.mtimeMs
            });
        }
        options.onProgress?.({ visitedDirs, matchedFiles: out.files.length });
        if (out.truncated)
            break;
    }
    return out;
}
export async function pickExampleFolderFiles(rules = {}, options, hostOverride) {
    const res = await callHostTransport('window_show_select_folder_dialog', { title: options.title }, hostOverride);
    if (!res.ok)
        return makeEmpty({ error: friendlyExampleFileError(res.error || '无法打开选择文件夹对话框') });
    const rec = asObj(res.data);
    if (rec?.canceled === true)
        return makeEmpty({ canceled: true });
    const folderPath = typeof rec?.folderPath === 'string' ? rec.folderPath.trim() : '';
    if (!folderPath)
        return makeEmpty({ error: '未获取到有效的文件夹路径' });
    if (isExampleVolumeRoot(folderPath) && options.confirmVolumeRoot) {
        const ok = await options.confirmVolumeRoot(folderPath);
        if (!ok)
            return makeEmpty({ canceled: true });
    }
    const collected = await collectExampleFolderFiles(folderPath, rules, options, hostOverride);
    return { ...collected, folderPath };
}
export async function expandExampleInputPaths(paths, rules = {}, options = {}, hostOverride) {
    const maxFiles = rules.maxFiles && rules.maxFiles > 0 ? rules.maxFiles : 500;
    const knownSet = options.knownDirectories ? new Set(options.knownDirectories.map(comparableExamplePath)) : null;
    const out = makeEmpty();
    const singleFiles = [];
    for (const raw of paths) {
        if (options.signal?.aborted)
            return makeEmpty({ canceled: true });
        const p = String(raw || '').trim();
        if (!p)
            continue;
        let isDir = false;
        if (knownSet) {
            isDir = knownSet.has(comparableExamplePath(p));
        }
        else {
            const probe = await callHostTransport('filesystem_directory_exists', { path: p }, hostOverride);
            isDir = probe.ok && (probe.data === true || asObj(probe.data)?.exists === true);
        }
        if (!isDir) {
            singleFiles.push(p);
            continue;
        }
        if (out.files.length >= maxFiles) {
            out.truncated = true;
            continue;
        }
        const sub = await collectExampleFolderFiles(p, { ...rules, maxFiles: maxFiles - out.files.length }, options, hostOverride);
        if (sub.canceled)
            return makeEmpty({ canceled: true });
        if (sub.error) {
            out.failedDirs.push({ path: p, error: sub.error });
            continue;
        }
        out.files.push(...sub.files);
        out.ignored += sub.ignored;
        out.truncated = out.truncated || sub.truncated;
        out.failedDirs.push(...sub.failedDirs);
    }
    await acceptPaths(singleFiles, rules, out, maxFiles, hostOverride);
    const seen = new Set();
    out.files = out.files.filter(f => {
        const key = comparableExamplePath(f.path);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    return out;
}
export function mergeExampleByPath(existing, incoming, pathOf) {
    const seen = new Set(existing.map(item => comparableExamplePath(pathOf(item))));
    const added = [];
    let duplicates = 0;
    for (const item of incoming) {
        const key = comparableExamplePath(pathOf(item));
        if (seen.has(key)) {
            duplicates += 1;
            continue;
        }
        seen.add(key);
        added.push(item);
    }
    return { merged: [...existing, ...added], added, duplicates };
}
export function normalizeExampleFileInput(raw) {
    if (Array.isArray(raw)) {
        return { paths: raw.map(v => String(v ?? '').trim()).filter(Boolean), source: 'drop' };
    }
    const obj = asObj(raw) ?? {};
    const inner = asObj(obj.payload) ?? obj;
    const readList = (v) => Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : String(asObj(x)?.path ?? ''))).map(s => s.trim()).filter(Boolean) : [];
    const paths = readList(Array.isArray(inner.files) ? inner.files : inner.paths);
    const source = inner.source === 'paste' || inner.source === 'launch' ? inner.source : 'drop';
    return {
        paths,
        ...(Array.isArray(inner.directories) ? { directories: readList(inner.directories) } : {}),
        source,
        ...(typeof inner.targetFieldId === 'string' && inner.targetFieldId ? { targetFieldId: inner.targetFieldId } : {})
    };
}
export function createExampleImportProps(onInput, config = {}) {
    return {
        fileInput: { ...config, allowDirectories: true },
        onFileInput: (raw) => {
            const input = normalizeExampleFileInput(raw);
            if (input.paths.length > 0)
                return onInput(input);
        }
    };
}
export function summarizeExampleImport(result, counts, supportedText) {
    if (result.canceled)
        return null;
    if (result.error)
        return { ok: false, title: '导入失败', message: result.error };
    const duplicates = counts.duplicates ?? 0;
    const notes = [];
    if (duplicates > 0)
        notes.push(`${duplicates} 个已在列表中`);
    if (result.ignored > 0)
        notes.push(`忽略 ${result.ignored} 个不支持的文件`);
    if (result.truncated)
        notes.push('文件较多，仅导入前一批');
    if (result.failedDirs.length > 0)
        notes.push(`${result.failedDirs.length} 个子文件夹读取失败`);
    if (counts.added > 0)
        return { ok: true, title: `已添加 ${counts.added} 个文件`, message: notes.join('；') || undefined };
    if (duplicates > 0 && result.files.length > 0)
        return { ok: false, title: '这些文件已在列表中', message: notes.join('；') || undefined };
    return {
        ok: false,
        title: '没有找到可导入的文件',
        message: [supportedText ? `支持 ${supportedText}` : '', ...notes].filter(Boolean).join('；') || undefined
    };
}
export async function probeExampleDriveSpace(driveLetter, hostBridge) {
    const [diskRes, sysRes] = await Promise.all([
        callHostTransport('system_get_disk_usage', { drive: `${driveLetter}\\` }, hostBridge),
        invokeHostCapability('system.info', { includeStorage: true }, hostBridge)
    ]);
    let freeBytes = 0;
    let totalBytes = 0;
    if (diskRes.ok && diskRes.data && typeof diskRes.data === 'object') {
        const d = diskRes.data;
        totalBytes = Number(d.total ?? d.size ?? d.totalBytes ?? 0);
        const used = Number(d.used ?? d.usedBytes ?? 0);
        const avail = Number(d.available ?? d.free ?? d.availableBytes ?? d.freeBytes ?? Math.max(0, totalBytes - used));
        if (Number.isFinite(avail) && avail > 0)
            freeBytes = avail;
    }
    if (freeBytes <= 0 && sysRes.ok && sysRes.data) {
        const storageArr = Array.isArray(sysRes.data.storage)
            ? (sysRes.data.storage)
            : [];
        const matched = storageArr.find(d => String(d.mount || d.fs || '').toUpperCase().startsWith(driveLetter)) || storageArr[0];
        if (matched) {
            totalBytes = Number(matched.size || matched.total || 0);
            const used = Number(matched.used || 0);
            freeBytes = Number(matched.available || matched.free || Math.max(0, totalBytes - used));
        }
    }
    return { freeBytes, totalBytes };
}
