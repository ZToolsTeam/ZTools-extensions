import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useState,
  useEffect,
  useNavigation
} from "@ztools/declarative-ui";
import { CITY_DB, type CityDef } from "./cities.js";
import {
  formatTime,
  formatDate,
  getTzLabel,
  getDayDiff,
  getDiffLabel,
  formatDateTimeInput,
  parseConversionInput
} from "./clock-utils.js";

/** 换算基准：在 tz 时区的当地时间 at（绝对时间） */
interface ConversionBase {
  label: string;
  tz: string;
  at: Date;
}

/** 本机系统时区；取不到或不是合法 IANA 时区时退回 UTC */
export function getLocalTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    /* fallback */
  }
  return "UTC";
}

function formatBaseTime(date: Date, tz: string): string {
  return formatDateTimeInput(date, tz).slice(0, 16).replace("T", " ");
}

/**
 * 换算表单：输入 tz 当地的日期时间，提交后由 onConfirm 切换主列表到换算模式
 */
export function ConvertTimeForm({
  label,
  tz,
  initial,
  onConfirm
}: {
  label: string;
  tz: string;
  initial: Date;
  onConfirm: (base: ConversionBase) => void;
}) {
  const { pop } = useNavigation();
  const [value, setValue] = useState<string>(() => formatBaseTime(initial, tz));
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (values?: Record<string, any>) => {
    const input = typeof values?.datetime === "string" ? values.datetime : value;
    const result = parseConversionInput(input, tz, new Date());
    if (!result.ok) {
      setError(result.error);
      await showToast(Toast.Style.Failure, "无法换算", result.error);
      return;
    }
    setError(undefined);
    onConfirm({ label, tz, at: result.date });
    pop();
  };

  return Form(
    {
      navigationTitle: `以${label}时间换算`,
      actions: ActionPanel({}, [
        Action.SubmitForm({
          title: "换算到各城市",
          icon: Icon.Clock,
          onSubmit: handleSubmit
        })
      ])
    },
    [
      Form.Description({
        title: "基准时区",
        text: `${label}（${tz}，${getTzLabel(initial, tz)}）`
      }),
      Form.TextField({
        id: "datetime",
        title: `${label}当地时间`,
        placeholder: "2026-10-22 09:30，或只写 09:30 表示当地今天",
        value,
        error,
        autoFocus: true,
        onChange: (txt: string) => {
          setValue(txt);
          if (error) setError(undefined);
        }
      })
    ]
  );
}

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
  const [base, setBase] = useState<ConversionBase | null>(null);
  const { push } = useNavigation();
  const localTz = getLocalTimeZone();

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    if (typeof (timer as any)?.unref === "function") {
      (timer as any).unref();
    }
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

  // 实时模式：时间取当前时刻，时差相对本机时区；换算模式：时间取基准时刻，时差相对基准时区
  const at = base ? base.at : now;
  const refTz = base ? base.tz : localTz;
  const sameLabel = base ? "与基准相同" : "与本地相同";

  const openConvertForm = (label: string, tz: string) => {
    push(() =>
      ConvertTimeForm({
        label,
        tz,
        initial: base ? base.at : new Date(),
        onConfirm: (next) => setBase(next)
      })
    );
  };

  const handleCopyTime = async (c: CityDef) => {
    const timeStr = formatTime(at, c.tz);
    const dateStr = formatDate(at, c.tz);
    const tzStr = getTzLabel(at, c.tz);
    const full = `${c.name} (${c.country}): ${dateStr} ${timeStr} (${tzStr})`;
    await Clipboard.copy(full);
    await showToast(Toast.Style.Success, `已复制: ${c.name} 时间`);
  };

  return List(
    {
      navigationTitle: "世界时钟与全球时区",
      searchBarPlaceholder: "搜索城市、国家、英文名或时区 (如: 伦敦, New York, Tokyo)...",
      searchText,
      onSearchTextChange: (txt: string) => setSearchText(txt),
      filterBar: base
        ? {
            summaryText: `换算：${base.label} ${formatBaseTime(base.at, base.tz)}（${getTzLabel(base.at, base.tz)}）时各城市的当地时间`,
            actions: [
              { id: "edit-conversion", title: "修改换算时间", onAction: () => openConvertForm(base.label, base.tz) },
              { id: "back-to-live", title: "回到实时", onAction: () => setBase(null) }
            ]
          }
        : {
            summaryText: `实时 · 时差相对本机时区 ${localTz}（${getTzLabel(now, localTz)}）`,
            actions: [{ id: "convert-time", title: "换算时间", onAction: () => openConvertForm("本机", localTz) }]
          }
    },
    [
      List.Section(
        { title: trimmed ? `匹配城市 (${matchedCities.length})` : "主要城市与时区" },
        matchedCities.map((city) => {
          const time = formatTime(at, city.tz);
          const date = formatDate(at, city.tz);
          const tz = getTzLabel(at, city.tz);
          const dayDiff = getDayDiff(at, city.tz, refTz);
          const diffLabel = getDiffLabel(at, city.tz, refTz, sameLabel);

          return List.Item({
            id: `city-${city.name}-${city.tz}`,
            title: `${city.name}  ${time}`,
            subtitle: `${city.country} • ${date}`,
            icon: Icon.Clock,
            accessories: [
              ...(dayDiff !== 0 ? [{ text: dayDiff > 0 ? `+${dayDiff}天` : `${dayDiff}天` }] : []),
              { tag: { value: diffLabel } },
              { text: tz }
            ],
            actions: ActionPanel({ title: `${city.name} 时间` }, [
              Action({
                title: "复制完整时间信息",
                icon: Icon.CopyClipboard,
                onAction: () => handleCopyTime(city)
              }),
              Action.CopyToClipboard({
                title: base ? "仅复制换算后时间 HH:MM:SS" : "仅复制当前时间 HH:MM:SS",
                content: time,
                icon: Icon.Clock
              }),
              Action.CopyToClipboard({
                title: "复制 IANA 时区标识",
                content: city.tz,
                icon: Icon.Globe
              }),
              Action({
                title: `以${city.name}时间为基准换算`,
                icon: Icon.Clock,
                shortcut: { modifiers: ["cmd"], key: "t" },
                onAction: () => openConvertForm(city.name, city.tz)
              })
            ])
          });
        })
      )
    ]
  );
}
