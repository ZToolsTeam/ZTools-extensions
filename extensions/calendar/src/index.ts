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
  useState
} from "@ztools/raycast-compat";
import {
  getCalendarInfo,
  getUpcomingSpecialDays,
  searchCalendarDates,
  addDays,
  diffDays,
  type CalendarInfo
} from "./logic.js";

export default function CalendarCommand() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [searchText, setSearchText] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [detailItem, setDetailItem] = useState<CalendarInfo | null>(null);

  const todayInfo = getCalendarInfo(selectedDate);
  const activeDetail = detailItem || todayInfo;

  const handleCopyDate = async (info: CalendarInfo) => {
    const text = `${info.dateZh} (农历${info.lunar?.fullText || "未知"}) ${info.lunar?.yearGanZhi}年 属${info.lunar?.zodiac || ""} ${info.solarTerm ? "【" + info.solarTerm + "】" : ""} ${info.festivals.join(" ")}`;
    await Clipboard.copy(text.trim());
    await showToast(Toast.Style.Success, "已复制日历信息");
  };

  const handleCopyAlmanac = async (info: CalendarInfo) => {
    if (!info.almanac) {
      await showToast(Toast.Style.Failure, "当前日期暂无黄历信息");
      return;
    }
    const text = `${info.dateKey} 老黄历【${info.almanac.officer}】：宜 ${info.almanac.yi.join(" ")} | 忌 ${info.almanac.ji.join(" ")} | ${info.almanac.clash}`;
    await Clipboard.copy(text);
    await showToast(Toast.Style.Success, "已复制黄历宜忌");
  };

  // 1. 详细 Markdown 视图
  if (viewMode === "detail") {
    const info = activeDetail;
    const isToday = diffDays(info.date, new Date()) === 0;

    const mdLines = [
      `# 📅 ${info.dateZh} ${isToday ? "（今天）" : ""}`,
      ``,
      `> 🏮 **农历**: ${info.lunar?.fullText || "无"} · **岁次**: ${info.lunar?.yearGanZhi}年【属${info.lunar?.zodiac}】 · **干支日**: ${info.lunar?.dayGanZhi}日`,
      ``,
      `---`,
      ``,
      `### 🌿 节气与节日`,
      `- **二十四节气**: ${info.solarTerm ? `**${info.solarTerm}**` : "本日无交节节气"}`,
      `- **公历/农历节日**: ${info.festivals.length > 0 ? info.festivals.map((f) => `\`${f}\``).join(" ") : "无特殊节日"}`,
      `- **法定节假日状态**: ${info.holiday ? `**${info.holiday.name}** (${info.holiday.status === "holiday" ? "🏖️ 放假休息" : "💼 调休补班"})` : "常规工作日/双休日"}`,
      ``,
      `---`,
      ``,
      `### 📜 传统老黄历【${info.almanac?.officer || "平日"}】`,
      `- **✅ 宜**: ${info.almanac?.yi.join("、") || "诸事不宜"}`,
      `- **❌ 忌**: ${info.almanac?.ji.join("、") || "诸事不忌"}`,
      `- **⚡ 冲煞**: ${info.almanac?.clash || "无特殊冲煞"}`,
      ``,
      `---`,
      ``,
      `*注：万年历历法遵循国际公历与中国传统农历紫金山天文台标准。*`
    ];

    return Detail({
      navigationTitle: `${info.dateKey} 日历与老黄历详情`,
      markdown: mdLines.join("\n"),
      actions: ActionPanel({ title: "操作" }, [
        Action({
          title: "复制完整日历卡片",
          icon: Icon.CopyClipboard,
          onAction: () => handleCopyDate(info)
        }),
        Action({
          title: "复制老黄历宜忌",
          icon: Icon.Star,
          onAction: () => handleCopyAlmanac(info)
        }),
        Action({
          title: "返回日历列表",
          icon: Icon.ArrowLeft,
          onAction: () => setViewMode("list")
        })
      ]),
      metadata: Detail.Metadata({}, [
        Detail.Metadata.Label({ title: "公历日期", text: info.dateKey }),
        Detail.Metadata.Label({ title: "星期", text: info.dayOfWeek }),
        Detail.Metadata.Label({ title: "农历日期", text: info.lunar?.fullText || "无" }),
        Detail.Metadata.Label({ title: "干支岁次", text: `${info.lunar?.yearGanZhi || ""}年 属${info.lunar?.zodiac || ""}` }),
        Detail.Metadata.Label({ title: "节气", text: info.solarTerm || "无" }),
        Detail.Metadata.Separator(),
        Detail.Metadata.Label({ title: "老黄历星神", text: info.almanac?.officer || "平日" }),
        Detail.Metadata.Label({ title: "冲煞方位", text: info.almanac?.clash || "无" })
      ])
    });
  }

  // 2. 搜索过滤模式
  if (searchText.trim()) {
    const searchResults = searchCalendarDates(searchText, selectedDate);
    return List(
      {
        navigationTitle: "万年历与节气查询",
        searchBarPlaceholder: "搜索日期 (如 2026-10-01)、节日 (如 春节/国庆)、节气 (如 立秋) 或生肖...",
        searchText,
        onSearchTextChange: (t) => setSearchText(t)
      },
      [
        List.Section(
          { title: `匹配结果 (${searchResults.length} 项)` },
          searchResults.length === 0
            ? [
                List.Item({
                  id: "no-result",
                  title: "未找到匹配的节日、节气或日期",
                  subtitle: `搜索词: "${searchText}"`,
                  icon: Icon.QuestionMark,
                  actions: ActionPanel({ title: "操作" }, [
                    Action({
                      title: "清空搜索词",
                      icon: Icon.Repeat,
                      onAction: () => setSearchText("")
                    })
                  ])
                })
              ]
            : searchResults.map((item) => {
                const diff = diffDays(item.date, new Date());
                const relativeText = diff === 0 ? "今天" : diff > 0 ? `${diff}天后` : `${Math.abs(diff)}天前`;
                const label = [
                  item.solarTerm,
                  ...item.festivals,
                  item.holiday ? `${item.holiday.name}(${item.holiday.status === "holiday" ? "休" : "班"})` : ""
                ]
                  .filter(Boolean)
                  .join(" · ");

                return List.Item({
                  id: `search-${item.dateKey}`,
                  title: `${item.dateZh} · 农历 ${item.lunar?.fullText || ""}`,
                  subtitle: label || `老黄历: ${item.almanac?.officer || "平日"} · 冲${item.almanac?.clash || ""}`,
                  icon: item.holiday?.status === "holiday" ? Icon.Star : Icon.Calendar,
                  accessories: [{ text: relativeText }],
                  actions: ActionPanel({ title: "操作" }, [
                    Action({
                      title: "查看日历与黄历详情",
                      icon: Icon.Eye,
                      onAction: () => {
                        setDetailItem(item);
                        setViewMode("detail");
                      }
                    }),
                    Action({
                      title: "复制此日信息",
                      icon: Icon.CopyClipboard,
                      onAction: () => handleCopyDate(item)
                    }),
                    Action({
                      title: "设为基准日期",
                      icon: Icon.Pin,
                      onAction: () => {
                        setSelectedDate(item.date);
                        setSearchText("");
                        showToast(Toast.Style.Success, `已切换到 ${item.dateKey}`);
                      }
                    })
                  ])
                });
              })
        )
      ]
    );
  }

  // 3. 常规主列表浏览模式
  const upcoming = getUpcomingSpecialDays(selectedDate, 45);

  return List(
    {
      navigationTitle: "万年历与节气助手",
      searchBarPlaceholder: "搜索日期 (如 2026-10-01)、节日 (如 春节/国庆)、节气 (如 立秋) 或生肖...",
      searchText,
      onSearchTextChange: (t) => setSearchText(t)
    },
    [
      List.Section({ title: "当前基准日期与老黄历" }, [
        List.Item({
          id: "today-main-card",
          title: `${todayInfo.dateZh} · 农历 ${todayInfo.lunar?.fullText || ""}`,
          subtitle: `岁次 ${todayInfo.lunar?.yearGanZhi}年【属${todayInfo.lunar?.zodiac}】 · ${todayInfo.lunar?.dayGanZhi}日 ${todayInfo.solarTerm ? "· 节气: " + todayInfo.solarTerm : ""}`,
          icon: Icon.Calendar,
          accessories: [
            {
              text: todayInfo.holiday
                ? `${todayInfo.holiday.name} (${todayInfo.holiday.status === "holiday" ? "放假" : "补班"})`
                : todayInfo.festivals[0] || todayInfo.dayOfWeek
            }
          ],
          actions: ActionPanel({ title: "日期操作" }, [
            Action({
              title: "查看完整日历详情",
              icon: Icon.Eye,
              onAction: () => {
                setDetailItem(todayInfo);
                setViewMode("detail");
              }
            }),
            Action({
              title: "后一天 (+1天)",
              icon: Icon.ArrowRight,
              onAction: () => setSelectedDate(addDays(selectedDate, 1))
            }),
            Action({
              title: "前一天 (-1天)",
              icon: Icon.ArrowLeft,
              onAction: () => setSelectedDate(addDays(selectedDate, -1))
            }),
            Action({
              title: "重置为今天",
              icon: Icon.Repeat,
              onAction: () => {
                setSelectedDate(new Date());
                showToast(Toast.Style.Success, "已重置为今天");
              }
            }),
            Action({
              title: "复制今日摘要",
              icon: Icon.CopyClipboard,
              onAction: () => handleCopyDate(todayInfo)
            })
          ])
        }),
        List.Item({
          id: "today-almanac-card",
          title: `老黄历【${todayInfo.almanac?.officer || "平日"}】· ${todayInfo.almanac?.clash || ""}`,
          subtitle: `宜: ${todayInfo.almanac?.yi.join(" ") || "诸事不宜"} · 忌: ${todayInfo.almanac?.ji.join(" ") || "诸事不忌"}`,
          icon: Icon.Star,
          accessories: [{ text: "老黄历" }],
          actions: ActionPanel({ title: "黄历操作" }, [
            Action({
              title: "查看老黄历详情",
              icon: Icon.Eye,
              onAction: () => {
                setDetailItem(todayInfo);
                setViewMode("detail");
              }
            }),
            Action({
              title: "复制黄历宜忌",
              icon: Icon.CopyClipboard,
              onAction: () => handleCopyAlmanac(todayInfo)
            })
          ])
        })
      ]),
      List.Section(
        { title: `近期节气与节假日安排 (${upcoming.length} 个关注日)` },
        upcoming.map((item) => {
          const diff = diffDays(item.date, selectedDate);
          const relativeText = diff === 0 ? "今天" : `${diff}天后`;
          const tag = [
            item.solarTerm ? `节气:${item.solarTerm}` : "",
            ...item.festivals,
            item.holiday ? `${item.holiday.name}(${item.holiday.status === "holiday" ? "放假" : "补班"})` : ""
          ]
            .filter(Boolean)
            .join(" · ");

          return List.Item({
            id: `upcoming-${item.dateKey}`,
            title: `${item.dateZh} · 农历 ${item.lunar?.fullText || ""}`,
            subtitle: tag || `老黄历【${item.almanac?.officer}】`,
            icon: item.holiday?.status === "holiday" ? Icon.Star : Icon.Calendar,
            accessories: [{ text: relativeText }],
            actions: ActionPanel({ title: "操作" }, [
              Action({
                title: "查看该日详情",
                icon: Icon.Eye,
                onAction: () => {
                  setDetailItem(item);
                  setViewMode("detail");
                }
              }),
              Action({
                title: "跳转到该日期",
                icon: Icon.Pin,
                onAction: () => {
                  setSelectedDate(item.date);
                  showToast(Toast.Style.Success, `已跳转到 ${item.dateKey}`);
                }
              }),
              Action({
                title: "复制该日信息",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopyDate(item)
              })
            ])
          });
        })
      )
    ]
  );
}
