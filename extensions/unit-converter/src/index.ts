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
  unitCategories,
  getCategory,
  unitSystemLabels,
  parseUnitInput,
  convertToAllUnits,
  type UnitCategoryId,
  type UnitCategory,
  type UnitDefinition,
} from "./logic.js";

export default function UnitConverterCommand() {
  const [categoryId, setCategoryId] = useState<UnitCategoryId>("length");
  const [fromUnitId, setFromUnitId] = useState<string>("meter");
  const [searchText, setSearchText] = useState<string>("1");
  const [precision, setPrecision] = useState<number>(4);

  const currentCategory: UnitCategory = getCategory(categoryId) || unitCategories[0]!;
  const fromUnit: UnitDefinition =
    currentCategory.units.find((u) => u.id === fromUnitId) || currentCategory.units[0]!;

  const trimmed = searchText.trim();
  const parsedVal = trimmed ? parseUnitInput(trimmed) : 1;
  const isInputValid = parsedVal !== null;
  const activeValue = isInputValid ? parsedVal : 1;

  const conversionResults = convertToAllUnits(activeValue, categoryId, fromUnit.id, precision);

  const handleCategoryChange = (catId: string) => {
    const nextCatId = catId as UnitCategoryId;
    const cat = getCategory(nextCatId);
    if (cat) {
      setCategoryId(nextCatId);
      setFromUnitId(cat.defaultFrom);
      showToast(Toast.Style.Success, `已切换到【${cat.name}】单位分类`);
    }
  };

  const handleCopy = async (val: string, label: string) => {
    await Clipboard.copy(val);
    await showToast(Toast.Style.Success, `已复制 ${label}: ${val}`);
  };

  const handleSetBaseUnit = async (u: UnitDefinition) => {
    setFromUnitId(u.id);
    await showToast(Toast.Style.Success, `已将基准单位设为: ${u.name} (${u.symbol})`);
  };

  return List(
    {
      navigationTitle: "度量衡与单位换算",
      searchBarPlaceholder: `输入数值换算 (当前基准: ${fromUnit.name} [${fromUnit.symbol}])...`,
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text),
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "选择单位分类",
          value: categoryId,
          onChange: handleCategoryChange,
        },
        unitCategories.map((c) =>
          List.Dropdown.Item({
            key: c.id,
            title: `${c.name} (${c.units.length} 个单位)`,
            value: c.id,
          })
        )
      ),
    },
    [
      // 1. 换算结果明细列表
      List.Section(
        {
          title: `${currentCategory.name}换算 (基准: ${activeValue} ${fromUnit.name} [${fromUnit.symbol}] - 保留 ${precision} 位小数)`,
        },
        !isInputValid && trimmed
          ? [
              List.Item({
                id: "item-input-error",
                title: "请输入有效的数值 (例如 100, 2.5, 1e4)",
                subtitle: trimmed,
                icon: Icon.ExclamationMark,
                accessories: [{ text: "数值格式异常" }],
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "重置为 1",
                    icon: Icon.Repeat,
                    onAction: () => setSearchText("1"),
                  }),
                ]),
              }),
            ]
          : conversionResults.map((item) => {
              const isBase = item.unit.id === fromUnit.id;
              const systemLabel = item.unit.system ? unitSystemLabels[item.unit.system] : "通用";
              return List.Item({
                id: `unit-${item.unit.id}`,
                title: `${item.formatted} ${item.unit.symbol}`,
                subtitle: `${item.unit.name} · ${systemLabel}`,
                icon: isBase ? Icon.Check : Icon.Circle,
                accessories: [
                  { text: item.unit.symbol },
                  ...(isBase ? [{ text: "基准单位" }] : [{ text: "回车复制", icon: Icon.CopyClipboard }]),
                ],
                actions: ActionPanel({ title: "单位操作" }, [
                  Action({
                    title: `复制此结果 (${item.formatted} ${item.unit.symbol})`,
                    icon: Icon.CopyClipboard,
                    onAction: () =>
                      handleCopy(`${item.formatted} ${item.unit.symbol}`, item.unit.name),
                  }),
                  Action({
                    title: "复制纯数值",
                    icon: Icon.CopyClipboard,
                    onAction: () => handleCopy(item.formatted, item.unit.name),
                  }),
                  Action({
                    title: `设为基准单位 (${item.unit.name})`,
                    icon: Icon.ArrowRight,
                    onAction: () => handleSetBaseUnit(item.unit),
                  }),
                  ActionPanel.Submenu(
                    {
                      title: "调整保留小数位数",
                      icon: Icon.Gear,
                    },
                    [2, 4, 6, 8, 10].map((p) =>
                      Action({
                        key: `prec-${p}`,
                        title: `保留 ${p} 位小数`,
                        icon: p === precision ? Icon.Check : Icon.Circle,
                        onAction: () => setPrecision(p),
                      })
                    )
                  ),
                ]),
              });
            })
      ),

      // 2. 常用物理量分类快捷选择
      List.Section(
        { title: "切换单位分类" },
        unitCategories.map((c) =>
          List.Item({
            id: `cat-${c.id}`,
            title: c.name,
            subtitle: `${c.description} (含 ${c.units.map((u) => u.name).slice(0, 4).join("、")} 等)`,
            icon: c.id === categoryId ? Icon.Check : Icon.Circle,
            accessories: [{ text: c.id === categoryId ? "当前选中" : "回车切换" }],
            actions: ActionPanel({ title: "分类操作" }, [
              Action({
                title: `切换至【${c.name}】`,
                icon: Icon.Check,
                onAction: () => handleCategoryChange(c.id),
              }),
            ]),
          })
        )
      ),
    ]
  );
}
