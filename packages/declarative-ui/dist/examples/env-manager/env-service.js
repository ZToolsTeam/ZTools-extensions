import { callHostTransport } from '../shared/native-ipc.js';
export function expandEnvVariablesInString(rawValue, envMap) {
    return String(rawValue ?? '').replace(/%([^%]+)%/g, (full, varName) => {
        const found = envMap[varName] ?? envMap[varName.toUpperCase()] ?? envMap[varName.toLowerCase()];
        return typeof found === 'string' && found ? found : full;
    });
}
export async function loadAllEnvVariables(customEnv, hostOverride) {
    const res = await callHostTransport('dllplugin_call', {
        plugin: 'EnvManagerPlugin',
        func: 'loadAllEnvVariables',
        params: customEnv ? { customEnv } : {}
    }, hostOverride);
    return res.data?.items ?? [];
}
export async function cleanInvalidPathEntries(options, hostOverride) {
    const res = await callHostTransport('dllplugin_call', {
        plugin: 'EnvManagerPlugin',
        func: 'cleanInvalidPathEntries',
        params: options || {}
    }, hostOverride);
    return {
        removedCount: res.data?.removedCount ?? 0,
        cleanedPath: res.data?.cleanedPath ?? '',
        remainingEntries: res.data?.remainingEntries ?? []
    };
}
export async function writeEnvVariable(key, value, scope = 'user', options, hostOverride) {
    const res = await callHostTransport('dllplugin_call', {
        plugin: 'EnvManagerPlugin',
        func: 'writeEnvVariable',
        params: { key, value, scope, ...options }
    }, hostOverride);
    if (!res.ok) {
        return {
            ok: false,
            errorCode: res.data?.errorCode || 'ADMIN_REQUIRED',
            error: res.error || res.data?.error || '写入环境变量失败'
        };
    }
    return { ok: true };
}
export function exportEnvSnapshot(items) {
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        count: items.length,
        items
    }, null, 2);
}
export function filterEnvItems(items, searchText, category) {
    const byCat = items.filter((item) => {
        if (category === 'path')
            return item.isPathItem;
        if (category === 'path-invalid')
            return item.isPathItem && item.isInvalid;
        if (category === 'user')
            return !item.isPathItem && item.scope === 'user';
        if (category === 'system')
            return !item.isPathItem && item.scope === 'system';
        return true;
    });
    const q = String(searchText ?? '').trim().toLowerCase();
    if (!q)
        return byCat;
    return byCat.filter((item) => item.key.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q) ||
        (item.expandedValue && item.expandedValue.toLowerCase().includes(q)));
}
