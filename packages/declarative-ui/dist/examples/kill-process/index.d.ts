import { ProcessInfo } from "./process-manager.js";
export * from "./process-manager.js";
/**
 * 进程详细监控视图 (极客双栏/独立详情视图)
 */
export declare function ProcessDetailView({ process, onKilled }: {
    process: ProcessInfo;
    onKilled?: (pid: number) => void;
}): JSX.Element;
/**
 * 系统级进程管理急救箱主命令
 */
export default function KillProcessCommand(): JSX.Element;
