import React from "@ztools/declarative-ui";
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  useNavigation
} from "@ztools/declarative-ui";
import { useState, useEffect } from "@ztools/declarative-ui";
import { isRealElectronHost } from "./native-ipc.js";
import {
  ProcessInfo,
  ProcessSortBy,
  KillMode,
  NOT_IN_CLIENT_MESSAGE,
  loadProcesses,
  filterAndSortProcesses,
  isSystemCriticalProcess,
  getKillCommandLine,
  confirmAndTerminate,
  revealProcessInExplorer
} from "./process-manager.js";

export * from "./process-manager.js";

function formatCpu(proc: ProcessInfo): string {
  return proc.cpuPercent === null ? "CPU 未知" : `CPU ${proc.cpuPercent.toFixed(1)}%`;
}

/**
 * 进程详情视图
 */
export function ProcessDetailView({
  process,
  onKilled
}: {
  process: ProcessInfo;
  onKilled?: (pid: number) => void;
}) {
  const { pop } = useNavigation();
  const isCritical = process.isSystemCritical || isSystemCriticalProcess(process.name) || isSystemCriticalProcess(process.pid);
  const isPosixPath = process.path?.startsWith("/") ? true : undefined;
  const gracefulCmd = getKillCommandLine(process.pid, "graceful", isPosixPath);
  const forceCmd = getKillCommandLine(process.pid, "force", isPosixPath);
  const treeCmd = getKillCommandLine(process.pid, "tree", isPosixPath);
  const facts = [
    process.user ? `**用户**: \`${process.user}\`` : "",
    process.threads !== null ? `**线程数**: \`${process.threads}\`` : "",
    process.arch ? `**架构**: \`${process.arch}\`` : ""
  ].filter(Boolean);

  const markdown = `
# 进程详情: ${process.name} (PID: ${process.pid})

${facts.length > 0 ? `> ${facts.join(" | ")}\n` : ""}
${
  isCritical
    ? `> **系统关键进程**：结束后可能导致系统无响应或桌面重启，插件不允许结束。\n`
    : ""
}

---

### 资源占用
- **内存（工作集）**: \`${process.memoryMB.toFixed(1)} MB\` (${(process.memoryMB / 1024).toFixed(2)} GB)
- **CPU**: \`${process.cpuPercent === null ? "未知" : `${process.cpuPercent.toFixed(1)}%`}\`

---

### 程序路径与命令行
\`\`\`powershell
# 程序路径
${process.path || "（客户端没有提供）"}

# 启动命令行
${process.commandLine || "（客户端没有提供）"}

# 结束进程
${gracefulCmd}

# 强制结束
${forceCmd}

# 结束进程树
${treeCmd}
\`\`\`
  `;

  const handleExecuteKill = async (mode: KillMode) => {
    const res = await confirmAndTerminate(process, mode);
    if (!res) return;
    if (!res.success) {
      await showToast(Toast.Style.Failure, "结束失败", res.message);
      return;
    }
    onKilled?.(process.pid);
    await showToast(Toast.Style.Success, res.alreadyExited ? "进程已退出" : "进程已结束", res.message);
    pop();
  };

  const handleReveal = async () => {
    const ok = await revealProcessInExplorer(process.path);
    if (ok) {
      await showToast(Toast.Style.Success, "已在资源管理器中定位", process.path);
    } else {
      await showToast(Toast.Style.Failure, "无法在资源管理器中定位", process.path);
    }
  };

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${process.name} [PID: ${process.pid}]`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="进程标识 (PID)" text={String(process.pid)} icon={Icon.Key} />
          <Detail.Metadata.Label title="CPU 占用率" text={process.cpuPercent === null ? "未知" : `${process.cpuPercent.toFixed(1)}%`} icon={Icon.Clock} />
          <Detail.Metadata.Label title="内存占用" text={`${process.memoryMB.toFixed(1)} MB`} icon={Icon.Document} />
          {process.user ? <Detail.Metadata.Label title="运行用户" text={process.user} icon={Icon.Pencil} /> : null}
          {process.threads !== null ? <Detail.Metadata.Label title="线程数量" text={String(process.threads)} icon={Icon.Pin} /> : null}
          {process.arch ? <Detail.Metadata.Label title="体系架构" text={process.arch} icon={Icon.Gear} /> : null}
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="进程安全状态">
            {isCritical ? (
              <Detail.Metadata.TagList.Item text="系统核心保护" color={Color.Red} />
            ) : (
              <Detail.Metadata.TagList.Item text="常规应用进程" color={Color.SecondaryText} />
            )}
            <Detail.Metadata.TagList.Item
              text={(process.cpuPercent ?? 0) > 15 ? "高 CPU 负载" : "正常负载"}
              color={(process.cpuPercent ?? 0) > 15 ? Color.Red : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={`进程操作: ${process.name} (PID: ${process.pid})`}>
          <Action
            title="结束进程"
            icon={Icon.Trash}
            onAction={() => handleExecuteKill("graceful")}
          />
          <Action
            title="强制结束"
            icon={Icon.XMarkCircle}
            shortcut={{ modifiers: ["ctrl"], key: "return" }}
            onAction={() => handleExecuteKill("force")}
          />
          <Action
            title="结束进程树"
            icon={Icon.Trash}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
            onAction={() => handleExecuteKill("tree")}
          />
          {process.path ? (
            <Action
              title="在资源管理器中定位"
              icon={Icon.Folder}
              shortcut={{ modifiers: ["ctrl"], key: "o" }}
              onAction={handleReveal}
            />
          ) : null}
          <Action.CopyToClipboard
            title="复制 PID"
            content={String(process.pid)}
            icon={Icon.Key}
          />
          {process.path ? (
            <Action.CopyToClipboard
              title="复制程序路径"
              content={process.path}
              icon={Icon.Document}
            />
          ) : null}
          <Action.CopyToClipboard
            title="复制强制结束命令 (taskkill)"
            content={forceCmd}
            icon={Icon.CopyClipboard}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 结束进程主命令
 */
export default function KillProcessCommand() {
  const inClient = isRealElectronHost();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loadError, setLoadError] = useState<string>(() => (inClient ? "" : NOT_IN_CLIENT_MESSAGE));
  const [isLoading, setIsLoading] = useState<boolean>(() => inClient);
  const [sortBy, setSortBy] = useState<ProcessSortBy>("memory");
  const [searchText, setSearchText] = useState("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    if (!isRealElectronHost()) {
      return () => {
        active = false;
      };
    }

    let inFlight = false;
    const syncProcesses = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const res = await loadProcesses();
        if (!active) return;
        if (res.ok) {
          setProcesses(res.processes);
          setLoadError("");
        } else {
          // 刷新失败时保留上一次的列表，并在状态条提示数据可能已过期
          setLoadError(res.error || "读取进程列表失败");
        }
      } finally {
        if (active) setIsLoading(false);
        inFlight = false;
      }
    };

    void syncProcesses();
    if (!autoRefresh) {
      return () => {
        active = false;
      };
    }

    const timer = setInterval(() => {
      void syncProcesses();
    }, 2000);
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timer);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [autoRefresh]);

  const sortedList = filterAndSortProcesses(processes, searchText, sortBy);

  const handleKill = async (proc: ProcessInfo, mode: KillMode = "force") => {
    const res = await confirmAndTerminate(proc, mode);
    if (!res) return;
    if (res.success) {
      setProcesses(prev => prev.filter(p => p.pid !== proc.pid));
      await showToast(Toast.Style.Success, res.alreadyExited ? "进程已退出" : "进程已结束", res.message);
    } else {
      await showToast(Toast.Style.Failure, "结束失败", res.message);
    }
  };

  const handleReveal = async (proc: ProcessInfo) => {
    const ok = await revealProcessInExplorer(proc.path);
    if (ok) {
      await showToast(Toast.Style.Success, "已在资源管理器中定位", proc.path);
    } else {
      await showToast(Toast.Style.Failure, "无法在资源管理器中定位", proc.path);
    }
  };

  const handleRefresh = async () => {
    if (!isRealElectronHost()) {
      await showToast(Toast.Style.Failure, "无法刷新", NOT_IN_CLIENT_MESSAGE);
      return;
    }
    const res = await loadProcesses();
    if (res.ok) {
      setProcesses(res.processes);
      setLoadError("");
      await showToast(Toast.Style.Success, "进程列表已刷新", `当前进程: ${res.processes.length}`);
    } else {
      setLoadError(res.error || "读取进程列表失败");
      await showToast(Toast.Style.Failure, "刷新失败", res.error);
    }
  };

  const totalMemory = sortedList.reduce((acc, cur) => acc + cur.memoryMB, 0);
  const summaryText = loadError
    ? processes.length > 0
      ? `数据可能已过期：${loadError}`
      : loadError
    : `进程 ${sortedList.length} 个 · 内存合计 ${(totalMemory / 1024).toFixed(2)} GB · ${autoRefresh ? "每 2 秒自动刷新" : "已暂停自动刷新"}`;

  return (
    <List
      isLoading={isLoading}
      navigationTitle="结束进程"
      searchBarPlaceholder="搜索进程名、PID 或程序路径..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filterBar={{
        summaryText,
        actions: [
          {
            id: "toggle-auto-refresh",
            label: autoRefresh ? "暂停自动刷新" : "开启自动刷新",
            style: "secondary",
            onAction: () => {
              setAutoRefresh(prev => !prev);
            }
          },
          {
            id: "refresh-proc",
            label: "立即刷新",
            style: "secondary",
            onAction: () => {
              void handleRefresh();
            }
          }
        ]
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip="排序指标"
          value={sortBy}
          onChange={newVal => setSortBy(newVal as ProcessSortBy)}
        >
          <List.Dropdown.Item title="按内存占用降序 (Memory)" value="memory" />
          <List.Dropdown.Item title="按 CPU 占用率降序 (CPU)" value="cpu" />
          <List.Dropdown.Item title="按进程名称排序 (Name)" value="name" />
          <List.Dropdown.Item title="按 PID 升序 (PID)" value="pid" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel title="全局操作">
          <Action
            title="刷新进程列表"
            icon={Icon.Repeat}
            onAction={handleRefresh}
          />
          <Action
            title={autoRefresh ? "暂停 2 秒自动刷新" : "恢复 2 秒自动刷新"}
            icon={autoRefresh ? Icon.Clock : Icon.Bolt}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "r" }}
            onAction={() => setAutoRefresh(prev => !prev)}
          />
        </ActionPanel>
      }
    >
      <List.Section title={`进程 (${sortedList.length})`}>
        {sortedList.map(proc => {
          const isHighCpu = (proc.cpuPercent ?? 0) >= 15;
          const isHighMem = proc.memoryMB >= 1000;
          const isCritical = proc.isSystemCritical || isSystemCriticalProcess(proc.name);
          const subtitleParts = [
            `${proc.memoryMB.toFixed(1)} MB`,
            formatCpu(proc),
            proc.threads !== null ? `${proc.threads} 线程` : "",
            proc.arch || ""
          ].filter(Boolean);

          return (
            <List.Item
              key={proc.pid}
              id={`proc_${proc.pid}`}
              title={`${proc.name} [PID: ${proc.pid}]`}
              subtitle={subtitleParts.join(" • ")}
              icon={isCritical ? Icon.Shield : isHighCpu ? Icon.ExclamationMark : Icon.Terminal}
              accessories={[
                ...(isCritical ? [{ tag: { value: "系统关键" } }] : []),
                ...(isHighMem ? [{ tag: { value: "高内存" } }] : []),
                ...(isHighCpu ? [{ tag: { value: "高 CPU", color: Color.Red } }] : []),
                { text: `${proc.memoryMB.toFixed(0)} MB` },
                { text: formatCpu(proc) }
              ]}
              actions={
                <ActionPanel title={`${proc.name} (PID: ${proc.pid})`}>
                  <Action
                    title="结束进程"
                    icon={Icon.Trash}
                    onAction={() => handleKill(proc, "graceful")}
                  />
                  <Action
                    title="强制结束"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "return" }}
                    onAction={() => handleKill(proc, "force")}
                  />
                  <Action
                    title="结束进程树"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
                    onAction={() => handleKill(proc, "tree")}
                  />
                  <Action.Push
                    title="查看进程详情与命令行"
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["ctrl"], key: "d" }}
                    target={
                      <ProcessDetailView
                        process={proc}
                        onKilled={pid => setProcesses(prev => prev.filter(p => p.pid !== pid))}
                      />
                    }
                  />
                  {proc.path ? (
                    <Action
                      title="在资源管理器中定位"
                      icon={Icon.Folder}
                      shortcut={{ modifiers: ["ctrl"], key: "o" }}
                      onAction={() => handleReveal(proc)}
                    />
                  ) : null}
                  <Action.CopyToClipboard
                    title="复制 PID"
                    content={String(proc.pid)}
                    icon={Icon.Key}
                    shortcut={{ modifiers: ["ctrl"], key: "c" }}
                  />
                  {proc.path ? (
                    <Action.CopyToClipboard
                      title="复制程序路径"
                      content={proc.path}
                      icon={Icon.Document}
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                    />
                  ) : null}
                  <Action.CopyToClipboard
                    title="复制 taskkill 命令"
                    content={`taskkill /F /PID ${proc.pid}`}
                    icon={Icon.CopyClipboard}
                  />
                  <Action
                    title="刷新进程列表"
                    icon={Icon.Repeat}
                    shortcut={{ modifiers: ["ctrl"], key: "r" }}
                    onAction={handleRefresh}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
