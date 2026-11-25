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
  useNavigation,
  useLocale
} from "@ztools/declarative-ui";
import { useState, useEffect } from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import { isRealElectronHost } from "./native-ipc.js";
import {
  ProcessInfo,
  ProcessSortBy,
  KillMode,
  loadProcesses,
  filterAndSortProcesses,
  isSystemCriticalProcess,
  getKillCommandLine,
  confirmAndTerminate,
  revealProcessInExplorer
} from "./process-manager.js";
import { resolveErrorMessage } from './error-i18n.js'

export * from "./process-manager.js";

function formatCpu(proc: ProcessInfo): string {
  return proc.cpuPercent === null ? t("cpuUnknown") : `CPU ${proc.cpuPercent.toFixed(1)}%`;
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
  useLocale();
  const { pop } = useNavigation();
  const isCritical = process.isSystemCritical || isSystemCriticalProcess(process.name) || isSystemCriticalProcess(process.pid);
  const isPosixPath = process.path?.startsWith("/") ? true : undefined;
  const gracefulCmd = getKillCommandLine(process.pid, "graceful", isPosixPath);
  const forceCmd = getKillCommandLine(process.pid, "force", isPosixPath);
  const treeCmd = getKillCommandLine(process.pid, "tree", isPosixPath);
  const facts = [
    process.user ? t("userFact", { val: process.user }) : "",
    process.threads !== null ? t("threadsFact", { val: process.threads }) : "",
    process.arch ? t("archFact", { val: process.arch }) : ""
  ].filter(Boolean);

  const markdown = `
${t("detailHeading", { name: process.name, pid: process.pid })}

${facts.length > 0 ? `> ${facts.join(" | ")}\n` : ""}
${
  isCritical
    ? t("criticalWarn")
    : ""
}

---

${t("resHeading")}
${t("memLine", { mb: process.memoryMB.toFixed(1), gb: (process.memoryMB / 1024).toFixed(2) })}
- **CPU**: \`${process.cpuPercent === null ? t("unknown") : `${process.cpuPercent.toFixed(1)}%`}\`

---

${t("pathHeading")}
\`\`\`powershell
${t("commentPath")}
${process.path || t("notProvided")}

${t("commentCmd")}
${process.commandLine || t("notProvided")}

${t("commentGraceful")}
${gracefulCmd}

${t("commentForce")}
${forceCmd}

${t("commentTree")}
${treeCmd}
\`\`\`
  `;

  const handleExecuteKill = async (mode: KillMode) => {
    const res = await confirmAndTerminate(process, mode);
    if (!res) return;
    if (!res.success) {
      await showToast(Toast.Style.Failure, t("killFailed"), res.message);
      return;
    }
    onKilled?.(process.pid);
    await showToast(Toast.Style.Success, res.alreadyExited ? t("procExited") : t("procKilled"), res.message);
    pop();
  };

  const handleReveal = async () => {
    const ok = await revealProcessInExplorer(process.path);
    if (ok) {
      await showToast(Toast.Style.Success, t("revealedToast"), process.path);
    } else {
      await showToast(Toast.Style.Failure, t("revealFailedToast"), process.path);
    }
  };

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${process.name} [PID: ${process.pid}]`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={t("metaPid")} text={String(process.pid)} icon={Icon.Key} />
          <Detail.Metadata.Label title={t("metaCpu")} text={process.cpuPercent === null ? t("unknown") : `${process.cpuPercent.toFixed(1)}%`} icon={Icon.Clock} />
          <Detail.Metadata.Label title={t("metaMem")} text={`${process.memoryMB.toFixed(1)} MB`} icon={Icon.Document} />
          {process.user ? <Detail.Metadata.Label title={t("metaUser")} text={process.user} icon={Icon.Pencil} /> : null}
          {process.threads !== null ? <Detail.Metadata.Label title={t("metaThreads")} text={String(process.threads)} icon={Icon.Pin} /> : null}
          {process.arch ? <Detail.Metadata.Label title={t("metaArch")} text={process.arch} icon={Icon.Gear} /> : null}
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title={t("metaSecurity")}>
            {isCritical ? (
              <Detail.Metadata.TagList.Item text={t("tagCritical")} color={Color.Red} />
            ) : (
              <Detail.Metadata.TagList.Item text={t("tagNormalProc")} color={Color.SecondaryText} />
            )}
            <Detail.Metadata.TagList.Item
              text={(process.cpuPercent ?? 0) > 15 ? t("tagHighCpu") : t("tagNormalLoad")}
              color={(process.cpuPercent ?? 0) > 15 ? Color.Red : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={t("procActionsTitle", { name: process.name, pid: process.pid })}>
          <Action
            title={t("killGraceful")}
            icon={Icon.Trash}
            onAction={() => handleExecuteKill("graceful")}
          />
          <Action
            title={t("killForce")}
            icon={Icon.XMarkCircle}
            shortcut={{ modifiers: ["ctrl"], key: "return" }}
            onAction={() => handleExecuteKill("force")}
          />
          <Action
            title={t("killTree")}
            icon={Icon.Trash}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
            onAction={() => handleExecuteKill("tree")}
          />
          {process.path ? (
            <Action
              title={t("revealInExplorer")}
              icon={Icon.Folder}
              shortcut={{ modifiers: ["ctrl"], key: "o" }}
              onAction={handleReveal}
            />
          ) : null}
          <Action.CopyToClipboard
            title={t("copyPid")}
            content={String(process.pid)}
            icon={Icon.Key}
          />
          {process.path ? (
            <Action.CopyToClipboard
              title={t("copyPath")}
              content={process.path}
              icon={Icon.Document}
            />
          ) : null}
          <Action.CopyToClipboard
            title={t("copyForceCmd")}
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
  useLocale();
  const inClient = isRealElectronHost();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loadError, setLoadError] = useState<string>("");
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
          setLoadError(resolveErrorMessage(res, t("loadFailed")));
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
      await showToast(Toast.Style.Success, res.alreadyExited ? t("procExited") : t("procKilled"), res.message);
    } else {
      await showToast(Toast.Style.Failure, t("killFailed"), res.message);
    }
  };

  const handleReveal = async (proc: ProcessInfo) => {
    const ok = await revealProcessInExplorer(proc.path);
    if (ok) {
      await showToast(Toast.Style.Success, t("revealedToast"), proc.path);
    } else {
      await showToast(Toast.Style.Failure, t("revealFailedToast"), proc.path);
    }
  };

  const handleRefresh = async () => {
    if (!isRealElectronHost()) {
      await showToast(Toast.Style.Failure, t("cannotRefresh"), t("notInClient"));
      return;
    }
    const res = await loadProcesses();
    if (res.ok) {
      setProcesses(res.processes);
      setLoadError("");
      await showToast(Toast.Style.Success, t("refreshedToast"), t("refreshedDesc", { count: res.processes.length }));
    } else {
      setLoadError(resolveErrorMessage(res, t("loadFailed")));
      await showToast(Toast.Style.Failure, t("refreshFailed"), res.error);
    }
  };

  const totalMemory = sortedList.reduce((acc, cur) => acc + cur.memoryMB, 0);
  const effectiveError = !inClient ? t("notInClient") : loadError;
  const summaryText = effectiveError
    ? processes.length > 0
      ? t("staleSummary", { error: effectiveError })
      : effectiveError
    : t("summaryText", {
        count: sortedList.length,
        gb: (totalMemory / 1024).toFixed(2),
        refreshState: autoRefresh ? t("autoRefreshOn") : t("autoRefreshOff")
      });

  return (
    <List
      isLoading={isLoading}
      navigationTitle={t("navTitle")}
      searchBarPlaceholder={t("searchPlaceholder")}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filterBar={{
        summaryText,
        actions: [
          {
            id: "toggle-auto-refresh",
            label: autoRefresh ? t("pauseAutoRefresh") : t("resumeAutoRefresh"),
            style: "secondary",
            onAction: () => {
              setAutoRefresh(prev => !prev);
            }
          },
          {
            id: "refresh-proc",
            label: t("refreshNow"),
            style: "secondary",
            onAction: () => {
              void handleRefresh();
            }
          }
        ]
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip={t("sortTooltip")}
          value={sortBy}
          onChange={newVal => setSortBy(newVal as ProcessSortBy)}
        >
          <List.Dropdown.Item title={t("sortMem")} value="memory" />
          <List.Dropdown.Item title={t("sortCpu")} value="cpu" />
          <List.Dropdown.Item title={t("sortName")} value="name" />
          <List.Dropdown.Item title={t("sortPid")} value="pid" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel title={t("globalActions")}>
          <Action
            title={t("refreshList")}
            icon={Icon.Repeat}
            onAction={handleRefresh}
          />
          <Action
            title={autoRefresh ? t("pause2sRefresh") : t("resume2sRefresh")}
            icon={autoRefresh ? Icon.Clock : Icon.Bolt}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "r" }}
            onAction={() => setAutoRefresh(prev => !prev)}
          />
        </ActionPanel>
      }
    >
      <List.Section title={t("sectionProcs", { count: sortedList.length })}>
        {sortedList.map(proc => {
          const isHighCpu = (proc.cpuPercent ?? 0) >= 15;
          const isHighMem = proc.memoryMB >= 1000;
          const isCritical = proc.isSystemCritical || isSystemCriticalProcess(proc.name);
          const subtitleParts = [
            `${proc.memoryMB.toFixed(1)} MB`,
            formatCpu(proc),
            proc.threads !== null ? t("threadsUnit", { count: proc.threads }) : "",
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
                ...(isCritical ? [{ tag: { value: t("badgeCritical") } }] : []),
                ...(isHighMem ? [{ tag: { value: t("badgeHighMem") } }] : []),
                ...(isHighCpu ? [{ tag: { value: t("badgeHighCpu"), color: Color.Red } }] : []),
                { text: `${proc.memoryMB.toFixed(0)} MB` },
                { text: formatCpu(proc) }
              ]}
              actions={
                <ActionPanel title={`${proc.name} (PID: ${proc.pid})`}>
                  <Action
                    title={t("killGraceful")}
                    icon={Icon.Trash}
                    onAction={() => handleKill(proc, "graceful")}
                  />
                  <Action
                    title={t("killForce")}
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "return" }}
                    onAction={() => handleKill(proc, "force")}
                  />
                  <Action
                    title={t("killTree")}
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
                    onAction={() => handleKill(proc, "tree")}
                  />
                  <Action.Push
                    title={t("viewDetails")}
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
                      title={t("revealInExplorer")}
                      icon={Icon.Folder}
                      shortcut={{ modifiers: ["ctrl"], key: "o" }}
                      onAction={() => handleReveal(proc)}
                    />
                  ) : null}
                  <Action.CopyToClipboard
                    title={t("copyPid")}
                    content={String(proc.pid)}
                    icon={Icon.Key}
                    shortcut={{ modifiers: ["ctrl"], key: "c" }}
                  />
                  {proc.path ? (
                    <Action.CopyToClipboard
                      title={t("copyPath")}
                      content={proc.path}
                      icon={Icon.Document}
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                    />
                  ) : null}
                  <Action.CopyToClipboard
                    title={t("copyTaskkillCmd")}
                    content={`taskkill /F /PID ${proc.pid}`}
                    icon={Icon.CopyClipboard}
                  />
                  <Action
                    title={t("refreshList")}
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
