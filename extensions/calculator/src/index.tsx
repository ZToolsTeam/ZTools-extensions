import React from "@ztools/declarative-ui";
import { confirmAlert } from "@ztools/declarative-ui";
import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard
} from "@ztools/declarative-ui";
import { useState, useEffect, useMemo, useNavigation } from "@ztools/declarative-ui";
import RmbCommand from "./rmb.js";
import CurrencyCommand from "./currency.js";
export { default as calcRmb } from "./rmb.js";
export { default as calcCurrency } from "./currency.js";
import {
  evaluateCalculatorQuery,
  evaluateMathExpression,
  inspectColor,
  convertUnits,
  evaluateDateExpression,
  getCalculatorHistory,
  addCalculatorHistory,
  togglePinCalculatorHistory,
  deleteCalculatorHistory,
  clearCalculatorHistory,
  CalculatorQueryResult,
  CalculatorHistoryItem,
  CalculatorColorResult,
  CalculationResult
} from "./calculator-engine.js";
import { usePopoutValue } from "./popout-state.js";

export * from "./calculator-engine.js";

const DEFAULT_CALC_EXAMPLES = [
  { expr: "1024 * 768", desc: "分辨率像素点四则运算", category: "数学" },
  { expr: "sqrt(65536)", desc: "平方根函数计算", category: "数学" },
  { expr: "2 ^ 16", desc: "指数幂运算", category: "数学" },
  { expr: "sin(pi / 2)", desc: "三角函数与常数", category: "数学" },
  { expr: "32px to rem", desc: "前端 CSS px 与 rem 极客换算", category: "换算" },
  { expr: "2.5rem to px", desc: "CSS rem 转像素（基于 16px）", category: "换算" },
  { expr: "10km to miles", desc: "公制与英制度量衡换算", category: "换算" },
  { expr: "5kg to lbs", desc: "重量单位千克转磅", category: "换算" },
  { expr: "100c to f", desc: "摄氏度与华氏度互转", category: "换算" },
  { expr: "1024mb to gb", desc: "计算机存储容量二进制换算", category: "换算" },
  { expr: "0xFF to dec", desc: "十六进制转十进制", category: "进制" },
  { expr: "255 to hex", desc: "十进制转十六进制（0xFF）", category: "进制" },
  { expr: "255 to bin", desc: "十进制转二进制（0b11111111）", category: "进制" },
  { expr: "now + 2 weeks", desc: "未来相对日期与时间推算", category: "日期" },
  { expr: "#3B82F6", desc: "HEX 颜色预览、互转与 WCAG 对比度", category: "色彩" },
  { expr: "rgb(59, 130, 246)", desc: "RGB 格式色彩即时检测", category: "色彩" }
];

const HISTORY_TYPE_LABELS: Record<string, string> = { math: "计算", unit: "换算", currency: "汇率", date: "日期", color: "色彩" };

/** 结果区第一行的 id：填入输入框后选中它；没有结果时返回 undefined（交给渲染器默认选第一项） */
function getResultItemId(result: CalculatorQueryResult): string | undefined {
  if (result.type === "none") return undefined;
  if (result.type === "color" && result.colorResult) return "color-hex";
  return result.error ? "calc-error" : "calc-success";
}

const HISTORY_TYPES: ReadonlyArray<CalculatorHistoryItem["type"]> = ["math", "unit", "currency", "date", "color"];
const isText = (v: unknown): v is string => typeof v === "string";
const isHistoryItem = (v: unknown): v is CalculatorHistoryItem => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const item = v as Record<string, unknown>;
  return (
    isText(item.id) &&
    isText(item.expression) &&
    isText(item.answer) &&
    HISTORY_TYPES.includes(item.type as CalculatorHistoryItem["type"]) &&
    (item.pinned === undefined || typeof item.pinned === "boolean") &&
    typeof item.timestamp === "number" &&
    Number.isFinite(item.timestamp)
  );
};
// 独立窗口带来的历史里有一项不合法（旧版本形状、篡改）就整份不用，等存储读取结果
const isHistory = (v: unknown): v is CalculatorHistoryItem[] => Array.isArray(v) && v.every(isHistoryItem);

type CalculatorProps = { unitOnly?: boolean };

/** calc-unit 命令：同一个计算器，只列单位换算示例 */
export function calcUnit() {
  return CalculatorCommand({ unitOnly: true });
}

export default function CalculatorCommand(props?: CalculatorProps) {
  const unitOnly = props?.unitOnly === true;
  const examples = DEFAULT_CALC_EXAMPLES
    .map((eg, idx) => ({ ...eg, idx }))
    .filter(eg => !unitOnly || eg.category === "换算");
  const { push } = useNavigation();
  // 当前算式与历史随独立窗口带走：新窗口首帧就能显示，不闪空列表
  const [searchText, setSearchText] = usePopoutValue("searchText", () => "", isText);
  // 填入输入框后要选中的结果行 id（受控 selectedItemId）；用户自己输入或移动选中项后清空
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(undefined);
  const [history, setHistory] = usePopoutValue<CalculatorHistoryItem[]>("history", () => [], isHistory);

  // 历史以插件存储为准：带来的那份只用于首帧，读到存储后覆盖
  useEffect(() => {
    let active = true;
    void getCalculatorHistory().then(items => { if (active) setHistory(items); }).catch(error => {
      if (active) void showToast(Toast.Style.Failure, "读取计算历史失败，原数据保留", error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, []);

  const queryResult: CalculatorQueryResult = useMemo(() => {
    return evaluateCalculatorQuery(searchText);
  }, [searchText]);

  // 用户在输入框里打字：只更新文字，选中项由渲染器重置到第一项
  const handleSearchTextChange = (text: string) => {
    setSearchText(text);
    setSelectedItemId(undefined);
  };

  // 「填入搜索框」类动作：写回受控输入框，并选中新算出的结果行，按 Enter 即可复制新结果。
  // 填入的文字算不出结果时（如旧版本存下、现已不支持的历史算式）选中来源条目本身，
  // 不能交给渲染器默认选第一行，否则 Enter 会作用于不相关的历史项。
  const fillSearch = (text: string, sourceItemId?: string) => {
    setSearchText(text);
    setSelectedItemId(getResultItemId(evaluateCalculatorQuery(text)) ?? sourceItemId);
  };

  // 修改历史记录：存储读写失败时提示，界面保持原样，不能当作成功
  const updateHistory = async (task: () => Promise<CalculatorHistoryItem[]>): Promise<boolean> => {
    try {
      setHistory(await task());
      return true;
    } catch (err: unknown) {
      await showToast(Toast.Style.Failure, "历史记录保存失败", err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const recordCurrentQuery = async () => {
    if (queryResult.type !== "none" && !queryResult.error) {
      const type = queryResult.type;
      await updateHistory(() => addCalculatorHistory(queryResult.expression, queryResult.formattedAnswer, type));
    }
  };

  // record：只有复制 / 粘贴「当前输入的计算结果」才记入历史；
  // 复制历史项、置顶项或示例时不能把输入框里另一条无关算式顺带写进历史
  const handleCopy = async (text: string, label: string, record = true) => {
    await Clipboard.copy(text);
    await showToast(Toast.Style.Success, `已复制 ${label}`, text);
    if (record) await recordCurrentQuery();
  };

  const handlePaste = async (text: string, record = true) => {
    await Clipboard.paste(text);
    await showToast(Toast.Style.Success, "已发送粘贴请求", text);
    if (record) await recordCurrentQuery();
  };

  const handleTogglePin = async (id: string) => {
    await updateHistory(() => togglePinCalculatorHistory(id));
  };

  const handleDeleteHistory = async (id: string) => {
    if (await updateHistory(() => deleteCalculatorHistory(id))) {
      await showToast(Toast.Style.Success, "已删除历史记录");
    }
  };

  const handleClearHistory = async () => {
    const confirmed = await confirmAlert({
      title: "清空全部计算历史？",
      message: `将删除全部 ${history.length} 条记录（含已固定的），且无法恢复。`,
      primaryAction: { title: "清空", style: "destructive" },
      dismissAction: { title: "取消" }
    });
    if (!confirmed) return;
    if (await updateHistory(async () => { await clearCalculatorHistory(); return []; })) {
      await showToast(Toast.Style.Success, "已清空所有历史计算记录");
    }
  };

  const pinnedItems = history.filter(item => item.pinned);
  const recentItems = history.filter(item => !item.pinned);

  return (
    <List
      actions={ActionPanel({}, [Action({ title: "人民币大写…", icon: Icon.Text, onAction: () => push(RmbCommand) }), Action({ title: "汇率换算…", icon: Icon.Globe, onAction: () => push(CurrencyCommand) })])}
      searchBarPlaceholder={unitOnly ? "输入换算，如 10km to miles、5kg to lbs、100c to f、1024mb to gb" : "输入算式，如 128*1024、32px to rem、0xFF to dec、now + 2 weeks"}
      searchText={searchText}
      onSearchTextChange={handleSearchTextChange}
      selectedItemId={selectedItemId}
      onSelectionChange={() => setSelectedItemId(undefined)}
    >
      {/* 1. 色彩速查与双向转换 */}
      {queryResult.type === "color" && queryResult.colorResult && (
        <List.Section title="色彩识别与即时转换">
          <List.Item
            id="color-hex"
            title={queryResult.colorResult.hex}
            subtitle={`HEX 色彩代码 | 对比度 白:${queryResult.colorResult.contrastWhite}:1 黑:${queryResult.colorResult.contrastBlack}:1`}
            icon={Icon.Eye}
            accessories={[{ text: "HEX" }]}
            actions={
              <ActionPanel title="色彩动作">
                <Action
                  title="复制 HEX"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.hex, "HEX")}
                />
                <Action
                  title="复制 RGB"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.rgb, "RGB")}
                />
                <Action
                  title="复制 HSL"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.hsl, "HSL")}
                />
                <Action
                  title="复制 CMYK"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.cmyk, "CMYK")}
                />
                <Action
                  title="粘贴到前台应用"
                  icon={Icon.Checkmark}
                  onAction={() => handlePaste(queryResult.colorResult!.hex)}
                />
              </ActionPanel>
            }
          />
          <List.Item
            id="color-rgb"
            title={queryResult.colorResult.rgb}
            subtitle="RGB 格式"
            icon={Icon.Document}
            accessories={[{ text: "RGB" }]}
            actions={
              <ActionPanel title="色彩动作">
                <Action
                  title="复制 RGB"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.rgb, "RGB")}
                />
              </ActionPanel>
            }
          />
          <List.Item
            id="color-hsl"
            title={queryResult.colorResult.hsl}
            subtitle="HSL 格式"
            icon={Icon.Document}
            accessories={[{ text: "HSL" }]}
            actions={
              <ActionPanel title="色彩动作">
                <Action
                  title="复制 HSL"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.hsl, "HSL")}
                />
              </ActionPanel>
            }
          />
          <List.Item
            id="color-cmyk"
            title={queryResult.colorResult.cmyk}
            subtitle="印刷 CMYK 格式"
            icon={Icon.Document}
            accessories={[{ text: "CMYK" }]}
            actions={
              <ActionPanel title="色彩动作">
                <Action
                  title="复制 CMYK"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(queryResult.colorResult!.cmyk, "CMYK")}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {/* 2. 数学运算、单位换算与日期结果 */}
      {queryResult.type !== "none" && queryResult.type !== "color" && (
        <List.Section title="计算与换算结果">
          {queryResult.error ? (
            <List.Item
              id="calc-error"
              title="输入算式有误"
              subtitle={queryResult.error}
              icon={Icon.ExclamationMark}
            />
          ) : (
            <List.Item
              id="calc-success"
              title={`= ${queryResult.formattedAnswer}`}
              subtitle={queryResult.details ? `${queryResult.expression} (${queryResult.details})` : queryResult.expression}
              icon={Icon.Terminal}
              accessories={[{ text: "回车复制结果" }]}
              actions={
                <ActionPanel title="计算器操作">
                  <Action
                    title="复制计算结果"
                    icon={Icon.CopyClipboard}
                    onAction={() => handleCopy(queryResult.formattedAnswer, "计算结果")}
                  />
                  <Action
                    title="粘贴到前台应用"
                    icon={Icon.Checkmark}
                    shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                    onAction={() => handlePaste(queryResult.formattedAnswer)}
                  />
                  <Action
                    title="复制完整算式与结果"
                    icon={Icon.CopyClipboard}
                    shortcut={{ modifiers: ["ctrl", "alt"], key: "c" }}
                    onAction={() => handleCopy(`${queryResult.expression} = ${queryResult.formattedAnswer}`, "完整算式")}
                  />
                  {queryResult.fillText !== undefined && (
                    <Action
                      title="将结果填入输入框"
                      icon={Icon.Pencil}
                      shortcut={{ modifiers: ["ctrl"], key: "e" }}
                      onAction={() => fillSearch(queryResult.fillText!)}
                    />
                  )}
                  <Action
                    title="保存到历史算式"
                    icon={Icon.Pin}
                    shortcut={{ modifiers: ["ctrl"], key: "p" }}
                    onAction={async () => {
                      const saved = await updateHistory(() => addCalculatorHistory(
                        queryResult.expression,
                        queryResult.formattedAnswer,
                        (queryResult.type === "none" ? "math" : queryResult.type) as CalculatorHistoryItem["type"]
                      ));
                      if (saved) await showToast(Toast.Style.Success, "已保存到历史记录");
                    }}
                  />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      )}

      {/* 3. 已置顶算式 */}
      {pinnedItems.length > 0 && (
        <List.Section title="已置顶常用数字与算式">
          {pinnedItems.map(item => (
            <List.Item
              key={item.id}
              id={item.id}
              title={`= ${item.answer}`}
              subtitle={item.expression}
              icon={Icon.Pin}
              accessories={[{ text: "置顶" }]}
              actions={
                <ActionPanel title="置顶项操作">
                  <Action
                    title="复制结果"
                    icon={Icon.CopyClipboard}
                    onAction={() => handleCopy(item.answer, "置顶结果", false)}
                  />
                  <Action
                    title="粘贴到前台"
                    icon={Icon.Checkmark}
                    onAction={() => handlePaste(item.answer, false)}
                  />
                  <Action
                    title="取消置顶"
                    icon={Icon.Pin}
                    onAction={() => handleTogglePin(item.id)}
                  />
                  <Action
                    title="填入搜索框"
                    icon={Icon.Pencil}
                    onAction={() => fillSearch(item.expression, item.id)}
                  />
                  <Action
                    title="删除此项"
                    icon={Icon.Trash}
                    onAction={() => handleDeleteHistory(item.id)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* 4. 最近计算历史 */}
      {recentItems.length > 0 && (
        <List.Section title="近期计算历史">
          {recentItems.slice(0, 15).map(item => (
            <List.Item
              key={item.id}
              id={item.id}
              title={`= ${item.answer}`}
              subtitle={item.expression}
              icon={Icon.Clock}
              accessories={[{ text: HISTORY_TYPE_LABELS[item.type] ?? "计算" }]}
              actions={
                <ActionPanel title="历史项操作">
                  <Action
                    title="复制结果"
                    icon={Icon.CopyClipboard}
                    onAction={() => handleCopy(item.answer, "历史结果", false)}
                  />
                  <Action
                    title="粘贴到前台"
                    icon={Icon.Checkmark}
                    onAction={() => handlePaste(item.answer, false)}
                  />
                  <Action
                    title="置顶此算式"
                    icon={Icon.Pin}
                    shortcut={{ modifiers: ["ctrl"], key: "p" }}
                    onAction={() => handleTogglePin(item.id)}
                  />
                  <Action
                    title="填入搜索框"
                    icon={Icon.Pencil}
                    onAction={() => fillSearch(item.expression, item.id)}
                  />
                  <Action
                    title="删除此项"
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => handleDeleteHistory(item.id)}
                  />
                  <Action
                    title="清空全部历史记录"
                    icon={Icon.Trash}
                    onAction={handleClearHistory}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* 5. 快速计算、换算与语法示例 */}
      <List.Section title={unitOnly ? "单位换算示例" : "计算、单位换算与语法示例"}>
        {examples.map(({ idx, ...eg }) => (
          <List.Item
            key={idx}
            id={`eg-${idx}`}
            title={eg.expr}
            subtitle={eg.desc}
            icon={Icon.Terminal}
            // 单位换算入口里每一行都是“换算”，标签不提供区分信息，只在混合示例里显示分类
            accessories={unitOnly ? [] : [{ text: eg.category }]}
            actions={
              <ActionPanel title="快速示例">
                <Action
                  title="填入搜索框并计算"
                  icon={Icon.Pencil}
                  onAction={() => fillSearch(eg.expr, `eg-${idx}`)}
                />
                <Action
                  title="复制表达式"
                  icon={Icon.CopyClipboard}
                  onAction={() => handleCopy(eg.expr, "表达式", false)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
