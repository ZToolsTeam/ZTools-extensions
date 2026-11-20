import {
  List,
  ActionPanel,
  Action,
  Icon,
  LocalStorage,
  showToast,
  Toast,
  getHostTransport,
  useState,
  useEffect,
  useRef
} from "@ztools/declarative-ui";
import {
  CURRENCIES,
  DEFAULT_SETTINGS,
  NETWORK_POLICY,
  RATE_CACHE_KEY,
  SETTINGS_KEY,
  ExchangeRateError,
  buildRows,
  calcRate,
  fetchRateSnapshot,
  formatRate,
  formatTime,
  getCurrency,
  groupDigits,
  isSupportedCurrency,
  parseCachedSnapshot,
  parseQuery,
  parseSettings,
  toInputAmount,
  toggleFavorite,
  type ConversionRow,
  type HttpRequester,
  type RateSnapshot,
  type Settings
} from "./logic.js";

/** 宿主网络请求：经插件身份通道调用 network_http_request；宿主不支持时返回 null */
function createHostRequester(): HttpRequester | null {
  const transport = getHostTransport();
  if (!transport) return null;
  return (url, timeoutMs) =>
    transport.call("network_http_request", { method: "GET", url, timeout: timeoutMs }, { timeoutMs: timeoutMs + 3000 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 汇率来源：network 刚联网获取；cache 新鲜缓存；stale 联网失败后回退或保留的旧数据 */
type RateOrigin = "network" | "cache" | "stale";

/**
 * 汇率加载：新鲜缓存 → 联网 → 失败回退 7 天内真实缓存。
 * 请求序列号保证只有最后一次加载能落盘；视图卸载后不再更新状态或弹提示。
 */
function useRates() {
  const [snapshot, setSnapshot] = useState<RateSnapshot | null>(null);
  const [origin, setOrigin] = useState<RateOrigin>("network");
  const [rateError, setRateError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const mounted = useRef<boolean>(true);
  const loadSeq = useRef<number>(0);
  const snapshotRef = useRef<RateSnapshot | null>(null);

  const applySnapshot = (next: RateSnapshot, nextOrigin: RateOrigin) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setOrigin(nextOrigin);
  };

  const readCache = async (isCurrent: () => boolean): Promise<unknown> => {
    try {
      return await LocalStorage.getItem<unknown>(RATE_CACHE_KEY);
    } catch (error: unknown) {
      // 缓存读取失败不阻断联网，但如实提示
      if (isCurrent()) await showToast(Toast.Style.Failure, "汇率缓存读取失败", errorMessage(error));
      return undefined;
    }
  };

  const loadRates = async (force: boolean): Promise<void> => {
    const seq = ++loadSeq.current;
    const isCurrent = () => mounted.current && seq === loadSeq.current;
    setLoading(true);
    setRateError("");
    const cachedRaw = await readCache(isCurrent);
    if (!isCurrent()) return;
    const now = Date.now();
    const fresh = force ? undefined : parseCachedSnapshot(cachedRaw, now, NETWORK_POLICY.cacheTtlMs);
    if (fresh) {
      applySnapshot(fresh, "cache");
      setLoading(false);
      return;
    }
    try {
      const requester = createHostRequester();
      if (!requester) throw new ExchangeRateError("HOST_UNSUPPORTED");
      const next = await fetchRateSnapshot(requester);
      if (!isCurrent()) return;
      applySnapshot(next, "network");
      try {
        await LocalStorage.setItem(RATE_CACHE_KEY, next);
      } catch (error: unknown) {
        if (isCurrent()) await showToast(Toast.Style.Failure, "汇率已更新，但缓存未保存", errorMessage(error));
      }
      if (isCurrent() && next.assetsStatus === "partial") {
        await showToast(Toast.Style.Failure, "黄金或比特币报价获取失败", "对应币种暂无报价，其余汇率正常");
      }
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const message = errorMessage(error);
      setRateError(message);
      // 已在显示的汇率保留；否则回退到 7 天内的真实缓存，并明确标注刷新失败
      const stale = snapshotRef.current ?? parseCachedSnapshot(cachedRaw, now, NETWORK_POLICY.staleMaxAgeMs);
      if (stale) applySnapshot(stale, "stale");
      await showToast(Toast.Style.Failure, "获取汇率失败", message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void loadRates(false);
    return () => {
      mounted.current = false;
    };
  }, []);

  return { snapshot, origin, rateError, loading, loadRates };
}

/** 源币种与收藏的读取 / 保存；读取失败时拒绝写回，避免覆盖用户已保存的设置 */
function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const mounted = useRef<boolean>(true);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  const apply = (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
  };

  const persistBase = async (next: Settings): Promise<void> => {
    try {
      await LocalStorage.setItem(SETTINGS_KEY, next);
    } catch (error: unknown) {
      if (mounted.current) await showToast(Toast.Style.Failure, "源币种保存失败", errorMessage(error));
    }
  };

  const load = async (): Promise<void> => {
    try {
      const parsed = parseSettings(await LocalStorage.getItem<unknown>(SETTINGS_KEY));
      if (!mounted.current) return;
      // 加载期间用户已切换过源币种时，保留用户的新选择，只合并收藏
      const merged: Settings =
        settingsRef.current === DEFAULT_SETTINGS ? parsed : { ...parsed, base: settingsRef.current.base };
      apply(merged);
      setReady(true);
      if (merged.base !== parsed.base) await persistBase(merged);
    } catch (error: unknown) {
      if (!mounted.current) return;
      setFailed(true);
      await showToast(Toast.Style.Failure, "设置读取失败，本次修改不会保存", errorMessage(error));
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);

  /** 切换源币种：界面立即切换；保存失败如实提示，本次会话内仍使用新币种 */
  const changeBase = async (code: string): Promise<void> => {
    if (!isSupportedCurrency(code) || code === settingsRef.current.base) return;
    const next: Settings = { ...settingsRef.current, base: code };
    apply(next);
    if (ready) await persistBase(next);
  };

  /** 收藏 / 取消收藏：先写入成功再更新界面；失败抛错，由客户端提示「操作失败」 */
  const toggle = async (code: string): Promise<void> => {
    if (!ready) throw new Error(failed ? "设置读取失败，暂不能保存修改" : "设置尚未加载完成");
    const current = settingsRef.current;
    const wasFavorite = current.favorites.includes(code);
    const next: Settings = { ...current, favorites: toggleFavorite(current.favorites, code) };
    await LocalStorage.setItem(SETTINGS_KEY, next);
    if (!mounted.current) return;
    apply(next);
    await showToast(Toast.Style.Success, wasFavorite ? "已取消收藏" : "已收藏，置顶显示");
  };

  return { settings, changeBase, toggle };
}

/** 单行状态条：金额与源币种、汇率时间、缓存 / 刷新失败 / 报价缺失标注 */
function buildSummary(
  snapshot: RateSnapshot | null,
  origin: RateOrigin,
  loading: boolean,
  amountText: string,
  base: string
): string {
  if (!snapshot) return loading ? "正在获取实时汇率…" : "汇率获取失败";
  const parts = [`${groupDigits(amountText)} ${base} ${getCurrency(base)?.name ?? ""}`.trim()];
  parts.push(`汇率时间 ${formatTime(snapshot.sourceUpdatedAt ?? snapshot.timestamp)}`);
  if (origin === "stale") parts.push(`刷新失败，显示 ${formatTime(snapshot.timestamp)} 获取的缓存`);
  else if (origin === "cache") parts.push(`缓存于 ${formatTime(snapshot.timestamp)}`);
  if (snapshot.assetsStatus === "partial") parts.push("黄金/比特币报价暂缺");
  return parts.join(" · ");
}

type ListChild = ReturnType<typeof List.Item> | ReturnType<typeof List.Section>;

function errorItem(id: string, title: string, subtitle: string, action: ReturnType<typeof Action>): ListChild {
  return List.Item({ id, title, subtitle, icon: Icon.ExclamationMark, actions: ActionPanel({}, [action]) });
}

export default function ExchangeRateCommand() {
  const [searchText, setSearchText] = useState<string>("");
  const { snapshot, origin, rateError, loading, loadRates } = useRates();
  const { settings, changeBase, toggle } = useSettings();

  const query = parseQuery(searchText);
  const base = query.kind === "amount" && query.from !== undefined ? query.from : settings.base;
  const amount = query.kind === "error" ? 1 : query.amount;
  const amountText = query.kind === "error" ? "1" : query.amountText;

  const refreshAction = Action({
    title: "刷新汇率",
    icon: Icon.ArrowClockwise,
    shortcut: { modifiers: ["cmd"], key: "r" },
    onAction: () => loadRates(true)
  });

  const rowItem = (row: ConversionRow) => {
    const favoriteAction = Action({
      title: row.favorite ? "取消收藏" : "收藏（置顶）",
      icon: row.favorite ? Icon.StarDisabled : Icon.Star,
      shortcut: { modifiers: ["cmd"], key: "d" },
      onAction: () => toggle(row.code)
    });
    const value = row.value;
    if (value === null) {
      return List.Item({
        id: `rate-${row.code}`,
        title: `暂无报价 ${row.code}`,
        subtitle: row.info.name,
        icon: Icon.ExclamationMark,
        accessories: [{ text: "数据源未返回该币种报价" }],
        actions: ActionPanel({}, [refreshAction, favoriteAction])
      });
    }
    return List.Item({
      id: `rate-${row.code}`,
      title: `${groupDigits(value)} ${row.code}`,
      subtitle: row.info.name,
      icon: row.favorite ? Icon.Star : Icon.Circle,
      keywords: [row.code, row.info.name, ...row.info.keywords],
      accessories: [{ text: `1 ${row.code} = ${formatRate(row.reverseRate)} ${base}` }],
      actions: ActionPanel({}, [
        Action.CopyToClipboard({ title: "复制换算结果", content: value }),
        Action.CopyToClipboard({ title: "复制换算等式", content: `${amountText} ${base} = ${value} ${row.code}` }),
        Action({
          title: `以 ${row.code} 为源币种`,
          icon: Icon.ArrowRight,
          onAction: async () => {
            setSearchText(toInputAmount(value));
            await changeBase(row.code);
          }
        }),
        favoriteAction
      ])
    });
  };

  const items: ListChild[] = [];
  if (query.kind === "error") {
    const clear = Action({ title: "清空输入", icon: Icon.Repeat, onAction: () => setSearchText("") });
    items.push(errorItem("query-error", query.message, "示例：100、100 USD、100 USD to CNY；输入币种名可筛选", clear));
  } else if (!snapshot) {
    if (rateError) items.push(errorItem("rate-error", rateError, "未获取到真实汇率，不使用估算数据；按 Enter 重试", refreshAction));
  } else if (calcRate(snapshot.rates, base, "USD") === null) {
    const name = getCurrency(base)?.name ?? base;
    items.push(errorItem("base-unavailable", `源币种 ${name} 暂无报价`, "数据源未返回该币种报价，请刷新或切换源币种", refreshAction));
  } else {
    const rows = buildRows(snapshot, base, amount, settings.favorites, {
      ...(query.kind === "amount" && query.to !== undefined ? { to: query.to } : {}),
      ...(query.kind === "filter" ? { filter: query.text } : {})
    });
    const favorites = rows.filter((r) => r.favorite);
    const others = rows.filter((r) => !r.favorite);
    if (favorites.length > 0) items.push(List.Section({ title: "收藏" }, favorites.map(rowItem)));
    if (others.length > 0) items.push(List.Section({ title: favorites.length > 0 ? "其他币种" : "换算结果" }, others.map(rowItem)));
  }

  return List(
    {
      navigationTitle: "汇率计算",
      searchBarPlaceholder: `输入金额换算（源币种 ${base}），如 100 或 100 USD to CNY；输入币种名筛选`,
      searchText,
      onSearchTextChange: setSearchText,
      isLoading: loading,
      isShowingDetail: false,
      searchBarAccessory: List.Dropdown(
        { tooltip: "源币种", value: settings.base, onChange: (value: string) => void changeBase(value) },
        CURRENCIES.map((c) => List.Dropdown.Item({ key: c.code, title: `${c.code} ${c.name}`, value: c.code }))
      ),
      filterBar: {
        summaryText: buildSummary(snapshot, origin, loading, amountText, base),
        actions: [{ id: "refresh", title: "刷新汇率", icon: Icon.ArrowClockwise, onAction: () => loadRates(true) }]
      },
      actions: ActionPanel({}, [refreshAction])
    },
    items
  );
}
