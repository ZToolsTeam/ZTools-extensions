import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState
} from "@ztools/declarative-ui";
import {
  generateUuids,
  formatUuid,
  FORMAT_OPTIONS,
  VERSION_OPTIONS,
  type UuidVersion,
  type UuidFormat
} from "./logic.js";

export default function UuidGeneratorCommand() {
  const [version, setVersion] = useState<UuidVersion>("v4");
  const [format, setFormat] = useState<UuidFormat>("standard");
  const [count, setCount] = useState<number>(5);
  const [searchText, setSearchText] = useState<string>("");
  const [rawUuids, setRawUuids] = useState<string[]>(() =>
    generateUuids({ version: "v4", format: "standard", count: 5 })
  );

  const formattedUuids = rawUuids.map((u) => formatUuid(u, format));

  // 搜索过滤或数量调节：如果用户输入纯数字 1..100，则自动调整生成数量并重新生成
  const trimmed = searchText.trim();
  const numericCount = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null;

  const handleRegenerate = (newCount: number = count, newVer: UuidVersion = version, newFmt: UuidFormat = format) => {
    try {
      const clampedCount = Math.min(100, Math.max(1, newCount));
      const fresh = generateUuids({ version: newVer, format: "standard", count: clampedCount });
      setRawUuids(fresh);
      setCount(clampedCount);
      showToast(Toast.Style.Success, `已生成 ${clampedCount} 条 ${newVer} UUID`);
    } catch (err) {
      showToast(Toast.Style.Failure, err instanceof Error ? err.message : "生成失败");
    }
  };

  const handleVersionChange = (newVer: string) => {
    const v = newVer as UuidVersion;
    setVersion(v);
    handleRegenerate(count, v, format);
  };

  const handleFormatChange = async (newFmt: UuidFormat) => {
    setFormat(newFmt);
    await showToast(Toast.Style.Success, `已切换格式: ${newFmt}`);
  };

  const handleCopySingle = async (val: string) => {
    await Clipboard.copy(val);
    await showToast(Toast.Style.Success, "UUID 已复制到剪贴板");
  };

  const handleCopyAll = async () => {
    const text = formattedUuids.join("\n");
    await Clipboard.copy(text);
    await showToast(Toast.Style.Success, `已复制全部 ${formattedUuids.length} 条 UUID`);
  };

  // 结果过滤
  const displayUuids = numericCount !== null
    ? formattedUuids
    : formattedUuids.filter((item) =>
        trimmed ? item.toLowerCase().includes(trimmed.toLowerCase()) : true
      );

  const currentFormatLabel = FORMAT_OPTIONS.find((f) => f.value === format)?.label || format;

  return List(
    {
      navigationTitle: "UUID 生成器",
      searchBarPlaceholder: "输入数字快速切换数量 (1-100) 或按关键词搜索...",
      searchText,
      onSearchTextChange: (text: string) => {
        setSearchText(text);
        const parsed = parseInt(text.trim(), 10);
        if (/^\d+$/.test(text.trim()) && parsed >= 1 && parsed <= 100 && parsed !== count) {
          handleRegenerate(parsed, version, format);
        }
      },
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "选择 UUID 版本",
          value: version,
          onChange: handleVersionChange,
        },
        VERSION_OPTIONS.map((opt) =>
          List.Dropdown.Item({
            key: opt.value,
            title: opt.label,
            value: opt.value,
          })
        )
      ),
    },
    [
      // 1. 生成结果列表
      List.Section(
        {
          title: `生成结果 (${displayUuids.length} 条 | ${version.toUpperCase()} | ${currentFormatLabel})`,
        },
        displayUuids.length > 0
          ? displayUuids.map((uuid, idx) =>
              List.Item({
                id: `uuid-item-${idx}`,
                title: uuid,
                subtitle: `#${idx + 1} (${version})`,
                icon: Icon.Key,
                accessories: [
                  { text: format },
                  { text: "回车复制", icon: Icon.CopyClipboard },
                ],
                actions: ActionPanel({ title: "UUID 操作" }, [
                  Action({
                    title: "复制此 UUID",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopySingle(uuid),
                  }),
                  Action({
                    title: "复制全部结果 (换行分隔)",
                    icon: Icon.Document,
                    shortcut: { modifiers: ["ctrl"], key: "a" },
                    onAction: handleCopyAll,
                  }),
                  Action({
                    title: "重新生成当前批次",
                    icon: Icon.Repeat,
                    shortcut: { modifiers: ["ctrl"], key: "r" },
                    onAction: () => handleRegenerate(count, version, format),
                  }),
                  ActionPanel.Submenu(
                    {
                      title: "切换输出格式",
                      icon: Icon.Gear,
                    },
                    FORMAT_OPTIONS.map((f) =>
                      Action({
                        key: `fmt-${f.value}`,
                        title: `${f.label} (例: ${f.example.slice(0, 18)}...)`,
                        icon: f.value === format ? Icon.Check : Icon.Circle,
                        onAction: () => handleFormatChange(f.value),
                      })
                    )
                  ),
                  ActionPanel.Submenu(
                    {
                      title: "快速调节生成数量",
                      icon: Icon.List,
                    },
                    [1, 5, 10, 20, 50, 100].map((c) =>
                      Action({
                        key: `cnt-${c}`,
                        title: `生成 ${c} 条`,
                        icon: c === count ? Icon.Check : Icon.Circle,
                        onAction: () => handleRegenerate(c, version, format),
                      })
                    )
                  ),
                ]),
              })
            )
          : [
              List.Item({
                id: "empty-result",
                title: "未找到匹配的 UUID",
                subtitle: "按 Esc 清除过滤或按回车重新生成",
                icon: Icon.MagnifyingGlass,
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "清除过滤条件",
                    icon: Icon.Trash,
                    onAction: () => setSearchText(""),
                  }),
                  Action({
                    title: "重新生成",
                    icon: Icon.Repeat,
                    onAction: () => handleRegenerate(count, version, format),
                  }),
                ]),
              }),
            ]
      ),

      // 2. 格式与选项快捷面板
      List.Section(
        { title: "格式与设置" },
        FORMAT_OPTIONS.map((f) =>
          List.Item({
            id: `format-switch-${f.value}`,
            title: f.label,
            subtitle: f.example,
            icon: f.value === format ? Icon.Check : Icon.Circle,
            accessories: [{ text: f.value === format ? "当前选中" : "回车切换" }],
            actions: ActionPanel({ title: "格式操作" }, [
              Action({
                title: `设为 ${f.label}`,
                icon: Icon.Check,
                onAction: () => handleFormatChange(f.value),
              }),
              Action({
                title: "重新生成并应用此格式",
                icon: Icon.Repeat,
                onAction: () => {
                  setFormat(f.value);
                  handleRegenerate(count, version, f.value);
                },
              }),
            ]),
          })
        )
      ),
    ]
  );
}
