import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  useState
} from "@ztools/raycast-compat";
import {
  createTodo,
  toggleTodoStatus,
  deleteTodoItem,
  clearCompletedTodos,
  filterAndSearchTodos,
  type TodoItem,
  type TodoPriority,
  type TodoFilter
} from "./logic.js";

const DEFAULT_TODOS: TodoItem[] = [
  { id: "todo-1", title: "全面落地纯声明式 UI 架构规范", completed: true, priority: "high", createdAt: Date.now() - 3600000, completedAt: Date.now() - 1800000 },
  { id: "todo-2", title: "插件全面封杀原生 CSS 与直接 DOM 注入", completed: true, priority: "high", createdAt: Date.now() - 3000000, completedAt: Date.now() - 1200000 },
  { id: "todo-3", title: "选取首批轻量级应用进行新方案声明式重构", completed: false, priority: "high", createdAt: Date.now() - 600000 }
];

/**
 * 新建待办事项 Form 表单
 */
export function CreateTodoForm({ onCreated }: { onCreated: (item: TodoItem) => void }) {
  const { pop } = useNavigation();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (values: Record<string, any>) => {
    const todoTitle = values.title || title;
    const todoPriority = (values.priority || priority) as TodoPriority;

    if (!todoTitle || !todoTitle.trim()) {
      setError("待办标题不能为空");
      await showToast(Toast.Style.Failure, "请输入待办标题");
      return;
    }

    try {
      const newTodo = createTodo(todoTitle, todoPriority);
      onCreated(newTodo);
      await showToast(Toast.Style.Success, "待办事项创建成功");
      pop();
    } catch (err: any) {
      setError(err.message);
      await showToast(Toast.Style.Failure, "创建失败", err.message);
    }
  };

  return Form(
    {
      navigationTitle: "新建待办事项",
      actions: ActionPanel({ title: "表单操作" }, [
        Action.SubmitForm({
          title: "保存待办",
          icon: Icon.Check,
          onSubmit: handleSubmit
        }),
        Action({
          title: "取消返回",
          icon: Icon.ArrowLeft,
          onAction: () => pop()
        })
      ])
    },
    [
      Form.TextField({
        id: "title",
        title: "待办标题",
        placeholder: "输入待办任务内容...",
        value: title,
        error,
        onChange: (val) => {
          setTitle(val);
          if (error) setError(undefined);
        }
      }),
      Form.Dropdown(
        {
          id: "priority",
          title: "优先级",
          value: priority,
          onChange: (val) => setPriority(val as TodoPriority)
        },
        [
          Form.Dropdown.Item({ title: "高优先级", value: "high" }),
          Form.Dropdown.Item({ title: "中优先级", value: "medium" }),
          Form.Dropdown.Item({ title: "低优先级", value: "low" })
        ]
      )
    ]
  );
}

/**
 * 待办事项主列表视图
 */
export default function TodoCommand() {
  const [todos, setTodos] = useState<TodoItem[]>(DEFAULT_TODOS);
  const [filter, setFilter] = useState<TodoFilter>("all");
  const [searchText, setSearchText] = useState<string>("");
  const { push } = useNavigation();

  const filtered = filterAndSearchTodos(todos, filter, searchText);

  const handleToggle = async (id: string) => {
    setTodos((prev) => toggleTodoStatus(prev, id));
    const target = todos.find((t) => t.id === id);
    const nextStatus = target && !target.completed ? "已完成" : "未完成";
    await showToast(Toast.Style.Success, `任务标记为 ${nextStatus}`);
  };

  const handleDelete = async (id: string) => {
    setTodos((prev) => deleteTodoItem(prev, id));
    await showToast(Toast.Style.Success, "待办任务已删除");
  };

  const handleClearCompleted = async () => {
    setTodos((prev) => clearCompletedTodos(prev));
    await showToast(Toast.Style.Success, "已清空全部已完成任务");
  };

  const handleOpenCreateForm = () => {
    push(() =>
      CreateTodoForm({
        onCreated: (newTodo) => {
          setTodos((prev) => [newTodo, ...prev]);
        }
      })
    );
  };

  return List(
    {
      navigationTitle: "极简待办清单",
      searchBarPlaceholder: "搜索待办事项，或按回车快速添加...",
      searchText,
      onSearchTextChange: (text: string) => setSearchText(text),
      searchBarAccessory: List.Dropdown(
        {
          tooltip: "筛选待办状态",
          value: filter,
          onChange: (val: string) => setFilter(val as TodoFilter)
        },
        [
          List.Dropdown.Item({ title: "全部待办", value: "all" }),
          List.Dropdown.Item({ title: "进行中", value: "active" }),
          List.Dropdown.Item({ title: "已完成", value: "completed" })
        ]
      ),
      actions: ActionPanel({ title: "全局操作" }, [
        Action({
          title: "新建待办事项",
          icon: Icon.Plus,
          onAction: handleOpenCreateForm
        }),
        Action({
          title: "清空已完成待办",
          icon: Icon.Trash,
          onAction: handleClearCompleted
        })
      ])
    },
    [
      List.Section(
        {
          title: filter === "all" ? `全部待办 (${filtered.length})` : filter === "active" ? `进行中 (${filtered.length})` : `已完成 (${filtered.length})`
        },
        filtered.length > 0
          ? filtered.map((item) =>
              List.Item({
                id: item.id,
                title: item.completed ? `✓ ${item.title}` : item.title,
                subtitle: item.priority === "high" ? "高优先级" : item.priority === "medium" ? "中优先级" : "低优先级",
                icon: item.completed ? Icon.Check : Icon.Circle,
                accessories: [
                  {
                    text: item.completed ? "已完成" : "待处理"
                  },
                  {
                    text: new Date(item.createdAt).toLocaleDateString([], { month: "2-digit", day: "2-digit" })
                  }
                ],
                actions: ActionPanel({ title: "待办操作" }, [
                  Action({
                    title: item.completed ? "标为未完成" : "标为已完成",
                    icon: item.completed ? Icon.Circle : Icon.Check,
                    onAction: () => handleToggle(item.id)
                  }),
                  Action({
                    title: "新建待办事项",
                    icon: Icon.Plus,
                    onAction: handleOpenCreateForm
                  }),
                  Action.CopyToClipboard({
                    title: "复制待办标题",
                    content: item.title,
                    icon: Icon.CopyClipboard
                  }),
                  Action({
                    title: "删除此待办",
                    icon: Icon.Trash,
                    onAction: () => handleDelete(item.id)
                  }),
                  Action({
                    title: "清空所有已完成待办",
                    icon: Icon.Trash,
                    onAction: handleClearCompleted
                  })
                ])
              })
            )
          : [
              List.Item({
                id: "empty-item",
                title: "暂无相关待办事项",
                subtitle: "按 Enter 或 Ctrl+N 创建新待办",
                icon: Icon.Document,
                actions: ActionPanel({ title: "操作" }, [
                  Action({
                    title: "立即新建待办",
                    icon: Icon.Plus,
                    onAction: handleOpenCreateForm
                  })
                ])
              })
            ]
      )
    ]
  );
}
