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
  Clipboard,
  useNavigation
} from "@ztools/declarative-ui";
import { useState } from "@ztools/declarative-ui";
import {
  ProcessInfo,
  SAMPLE_PROCESSES,
  filterAndSortProcesses
} from "./process-manager.js";

export * from "./process-manager.js";

/**
 * 进程详细监控视图 (现代纯正 TSX 模式)
 */
export function ProcessDetailView({
  process,
  onKilled
}: {
  process: ProcessInfo;
  onKilled?: (pid: number) => void;
}) {
  const { pop } = useNavigation();
  const killCmd = `taskkill /F /PID ${process.pid}`;

  const markdown = `
# 进程详情: ${process.name} (PID: ${process.pid})

> **用户**: \`${process.user}\` | **状态**: \`${process.status.toUpperCase()}\` | **活动线程**: \`${process.threads}\`

---

### 资源占用
- **工作集物理内存**: \`${process.memoryMB.toFixed(1)} MB\` (${(process.memoryMB / 1024).toFixed(2)} GB)
- **CPU 占用率**: \`${process.cpuPercent.toFixed(1)}%\`

---

### 可执行路径与启动命令
\`\`\`powershell
# 可执行文件路径
${process.path}

# 命令行启动参数
${process.commandLine}

# 强制终止命令
${killCmd}
\`\`\`
  `;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${process.name} [PID: ${process.pid}]`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="进程标识 (PID)" text={String(process.pid)} icon={Icon.Key} />
          <Detail.Metadata.Label title="CPU 占用" text={`${process.cpuPercent.toFixed(1)}%`} icon={Icon.Clock} />
          <Detail.Metadata.Label title="内存占用" text={`${process.memoryMB.toFixed(1)} MB`} icon={Icon.Document} />
          <Detail.Metadata.Label title="运行用户" text={process.user} icon={Icon.Pencil} />
          <Detail.Metadata.Label title="线程数量" text={String(process.threads)} icon={Icon.Pin} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="健康状态">
            <Detail.Metadata.TagList.Item
              text={process.cpuPercent > 20 ? "高 CPU 负载" : "正常运行"}
              color={process.cpuPercent > 20 ? Color.Red : Color.Green}
            />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title="进程操作">
          <Action
            title="立即强制结束该进程"
            icon={Icon.Trash}
            onAction={async () => {
              onKilled?.(process.pid);
              await showToast(
                Toast.Style.Success,
                "进程已强制结束",
                `已终止 ${process.name} (PID: ${process.pid})`
              );
              pop();
            }}
          />
          <Action.CopyToClipboard
            title="复制结束命令 (taskkill)"
            content={killCmd}
            icon={Icon.CopyClipboard}
          />
          <Action.CopyToClipboard
            title="复制 PID"
            content={String(process.pid)}
            icon={Icon.Key}
          />
          <Action.CopyToClipboard
            title="复制可执行文件路径"
            content={process.path}
            icon={Icon.Folder}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 进程管理急救箱主命令 (现代纯正 TSX 模式)
 */
export default function KillProcessCommand() {
  const [processes, setProcesses] = useState<ProcessInfo[]>(SAMPLE_PROCESSES);
  const [sortBy, setSortBy] = useState<"memory" | "cpu" | "name" | "pid">("memory");
  const [searchText, setSearchText] = useState("");
  const { push } = useNavigation();

  const sortedList = filterAndSortProcesses(processes, searchText, sortBy);

  const handleKillProcess = async (proc: ProcessInfo) => {
    setProcesses((prev) => prev.filter((p) => p.pid !== proc.pid));
    await showToast(
      Toast.Style.Success,
      "进程已强制结束",
      `已释放 ${proc.memoryMB.toFixed(1)} MB 内存并终止 PID ${proc.pid} (${proc.name})`
    );
  };

  const handleRefresh = async () => {
    await showToast(Toast.Style.Success, "进程列表已刷新");
  };

  const totalMemory = sortedList.reduce((acc, cur) => acc + cur.memoryMB, 0);

  return (
    <List
      navigationTitle="进程管理急救箱"
      searchBarPlaceholder="搜索进程名、PID 或运行用户..."
      searchText={searchText}
      onSearchTextChange={(val) => setSearchText(val)}
      searchBarAccessory={
        <List.Dropdown
          tooltip="排序指标"
          value={sortBy}
          onChange={(newVal) => setSortBy(newVal as any)}
        >
          <List.Dropdown.Item title="按物理内存占用排序" value="memory" />
          <List.Dropdown.Item title="按 CPU 占用率排序" value="cpu" />
          <List.Dropdown.Item title="按进程名字母排序" value="name" />
          <List.Dropdown.Item title="按 PID 编号排序" value="pid" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel title="全局操作">
          <Action
            title="刷新系统进程"
            icon={Icon.Repeat}
            onAction={handleRefresh}
          />
        </ActionPanel>
      }
    >
      <List.Section
        title={`活动进程列表 (${sortedList.length}) — 累计消耗 ${(
          totalMemory / 1024
        ).toFixed(2)} GB`}
      >
        {sortedList.map((proc) => {
          const isHighCpu = proc.cpuPercent >= 15;
          const isHighMem = proc.memoryMB >= 1000;

          return (
            <List.Item
              key={proc.pid}
              id={`proc_${proc.pid}`}
              title={`${proc.name} [PID: ${proc.pid}]`}
              subtitle={`${proc.memoryMB.toFixed(1)} MB • CPU ${proc.cpuPercent.toFixed(1)}% • ${proc.threads} 线程`}
              icon={isHighCpu ? Icon.ExclamationMark : Icon.Terminal}
              accessories={[
                ...(isHighMem ? [{ text: "高内存", tag: "high-mem" }] : []),
                ...(isHighCpu ? [{ text: "高 CPU", tag: "high-cpu" }] : []),
                { text: `${proc.memoryMB.toFixed(0)} MB` },
                { text: `CPU ${proc.cpuPercent.toFixed(1)}%` }
              ]}
              actions={
                <ActionPanel title={`${proc.name} (PID: ${proc.pid})`}>
                  <Action
                    title="一键强制结束进程"
                    icon={Icon.Trash}
                    onAction={() => handleKillProcess(proc)}
                  />
                  <Action.Push
                    title="查看进程详情与命令行"
                    icon={Icon.Eye}
                    target={() => (
                      <ProcessDetailView
                        process={proc}
                        onKilled={(pid) =>
                          setProcesses((prev) => prev.filter((p) => p.pid !== pid))
                        }
                      />
                    )}
                  />
                  <Action.CopyToClipboard
                    title="复制 PID"
                    content={String(proc.pid)}
                    icon={Icon.Key}
                  />
                  <Action.CopyToClipboard
                    title="复制 taskkill 命令"
                    content={`taskkill /F /PID ${proc.pid}`}
                    icon={Icon.CopyClipboard}
                  />
                  <Action.CopyToClipboard
                    title="复制进程可执行路径"
                    content={proc.path}
                    icon={Icon.Folder}
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
