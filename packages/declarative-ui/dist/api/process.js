import { getDeclarativeBridge } from "./bridge.js";
import { tApiError } from "./error-messages.js";
import { ZToolsHostError } from "./host-error.js";
/**
 * 结束本机任意进程。插件必须在 plugin.json 声明 "process" 权限。
 *
 * 失败抛 ZToolsHostError，常见 code：
 * PROCESS_PROTECTED（details.reason: system / host-self / host-ancestor / host-child）、PROCESS_NOT_FOUND、
 * PROCESS_ACCESS_DENIED、PROCESS_IDENTITY_MISMATCH、PROCESS_TERMINATE_TIMEOUT（details.stillRunning；宿主不会自动升级 force）、
 * PLUGIN_PERMISSION_REQUIRED、PLUGIN_IDENTITY_REQUIRED、HOST_FEATURE_UNAVAILABLE（宿主过旧）。
 */
export async function terminateProcess(pid, options = {}) {
    if (!Number.isInteger(pid) || pid < 2 || pid > 0xffff_ffff) {
        throw new ZToolsHostError("INVALID_REQUEST", tApiError("processInvalidPid"));
    }
    const impl = getDeclarativeBridge()?.terminateProcess;
    if (!impl)
        throw new ZToolsHostError("HOST_FEATURE_UNAVAILABLE", tApiError("processTerminateUnsupported"));
    return impl(pid, options);
}
export function getHostTransport() {
    return getDeclarativeBridge()?.hostTransport ?? null;
}
