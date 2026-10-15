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
import { parseTimeInput } from "./logic.js";

export default function TimestampCommand() {
  const [searchText, setSearchText] = useState<string>("");

  const parsed = parseTimeInput(searchText);

  const handleCopy = async (val: string | number, label: string) => {
    await Clipboard.copy(String(val));
    await showToast(Toast.Style.Success, `已复制 ${label}: ${val}`);
  };

  return List(
    {
      navigationTitle: "时间戳转换助手",
      searchBarPlaceholder: "输入10/13位时间戳或日期字符串 (留空即实时当前时间)...",
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text)
    },
    [
      parsed.valid
        ? List.Section(
            { title: searchText ? "指定时间解析结果" : "当前实时时间" },
            [
              List.Item({
                id: "item-seconds",
                title: String(parsed.unixSeconds),
                subtitle: "秒级 Unix 时间戳 (10位)",
                icon: Icon.Key,
                accessories: [{ text: "10位 秒" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制秒级时间戳",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.unixSeconds!, "秒级时间戳")
                  }),
                  Action({
                    title: "刷新并重置为当前时间",
                    icon: Icon.Repeat,
                    onAction: () => setSearchText("")
                  })
                ])
              }),
              List.Item({
                id: "item-ms",
                title: String(parsed.unixMilliseconds),
                subtitle: "毫秒级 Unix 时间戳 (13位)",
                icon: Icon.Key,
                accessories: [{ text: "13位 毫秒" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制毫秒级时间戳",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.unixMilliseconds!, "毫秒级时间戳")
                  }),
                  Action({
                    title: "刷新并重置为当前时间",
                    icon: Icon.Repeat,
                    onAction: () => setSearchText("")
                  })
                ])
              }),
              List.Item({
                id: "item-local",
                title: parsed.localDateTime || "",
                subtitle: `本地格式化时间 (${parsed.dayOfWeek})`,
                icon: Icon.Calendar,
                accessories: [{ text: parsed.dayOfWeek || "本地时间" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制本地格式化时间",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.localDateTime!, "本地时间")
                  }),
                  Action({
                    title: "刷新并重置为当前时间",
                    icon: Icon.Repeat,
                    onAction: () => setSearchText("")
                  })
                ])
              }),
              List.Item({
                id: "item-beijing",
                title: parsed.beijingDateTime || "",
                subtitle: "北京时间 (UTC+8)",
                icon: Icon.Globe,
                accessories: [{ text: "UTC+8" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制北京时间",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.beijingDateTime!, "北京时间")
                  })
                ])
              }),
              List.Item({
                id: "item-utc",
                title: parsed.utcIso || "",
                subtitle: "国际标准 ISO 8601 时间 (UTC)",
                icon: Icon.Document,
                accessories: [{ text: "ISO 8601" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制 ISO 8601 时间",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.utcIso!, "UTC标准时间")
                  })
                ])
              }),
              List.Item({
                id: "item-relative",
                title: parsed.relativeTime || "",
                subtitle: "相对友好时间",
                icon: Icon.Clock,
                accessories: [{ text: "相对时间" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "复制相对时间",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(parsed.relativeTime!, "相对时间")
                  })
                ])
              })
            ]
          )
        : List.Section(
            { title: "解析错误" },
            [
              List.Item({
                id: "item-error",
                title: parsed.error || "无法解析的时间格式",
                subtitle: searchText,
                icon: Icon.ExclamationMark,
                accessories: [{ text: "格式异常" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "清空输入并恢复当前时间",
                    icon: Icon.Repeat,
                    onAction: () => setSearchText("")
                  })
                ])
              })
            ]
          )
    ]
  );
}
