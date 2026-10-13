import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useState,
  useEffect
} from "@ztools/raycast-compat";
import { CITY_DB, type CityDef } from "./cities.js";
import {
  formatTime,
  formatDate,
  getTzLabel,
  cityEmoji
} from "./clock-utils.js";

const DEFAULT_CITIES = [
  "北京",
  "东京",
  "伦敦",
  "纽约",
  "旧金山",
  "巴黎",
  "悉尼",
  "新加坡"
];

export default function WorldClockCommand() {
  const [searchText, setSearchText] = useState<string>("");
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const trimmed = searchText.trim().toLowerCase();

  const matchedCities = trimmed
    ? CITY_DB.filter(
        (c) =>
          c.name.toLowerCase().includes(trimmed) ||
          c.country.toLowerCase().includes(trimmed) ||
          (c.en && c.en.toLowerCase().includes(trimmed)) ||
          c.tz.toLowerCase().includes(trimmed)
      ).slice(0, 30)
    : CITY_DB.filter((c) => DEFAULT_CITIES.includes(c.name));

  const handleCopyTime = async (c: CityDef) => {
    const timeStr = formatTime(now, c.tz);
    const dateStr = formatDate(now, c.tz);
    const tzStr = getTzLabel(now, c.tz);
    const full = `${c.name} (${c.country}): ${dateStr} ${timeStr} (${tzStr})`;
    await Clipboard.copy(full);
    await showToast(Toast.Style.Success, `已复制: ${c.name} 时间`);
  };

  return List(
    {
      navigationTitle: "世界时钟与全球时区",
      searchBarPlaceholder: "搜索城市、国家、英文名或时区 (如: 伦敦, New York, Tokyo)...",
      searchText,
      onSearchTextChange: (txt: string) => setSearchText(txt)
    },
    [
      List.Section(
        { title: trimmed ? `匹配城市 (${matchedCities.length})` : "主要城市与时区" },
        matchedCities.map((city) => {
          const time = formatTime(now, city.tz);
          const date = formatDate(now, city.tz);
          const tz = getTzLabel(now, city.tz);
          const emoji = cityEmoji(city.tz);

          return List.Item({
            id: `city-${city.name}-${city.tz}`,
            title: `${emoji} ${city.name}  ${time}`,
            subtitle: `${city.country} • ${date}`,
            icon: Icon.Clock,
            accessories: [
              { text: tz }
            ],
            actions: ActionPanel({ title: `${city.name} 时间` }, [
              Action({
                title: "复制完整时间信息",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopyTime(city)
              }),
              Action.CopyToClipboard({
                title: "仅复制当前时间 HH:MM:SS",
                content: time,
                icon: Icon.Clock
              }),
              Action.CopyToClipboard({
                title: "复制 IANA 时区标识",
                content: city.tz,
                icon: Icon.Globe
              })
            ])
          });
        })
      )
    ]
  );
}
