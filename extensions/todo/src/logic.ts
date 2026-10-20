/**
 * ZTools 极简待办事项业务逻辑 (纯函数)
 */

export type TodoPriority = "high" | "medium" | "low";
export type TodoFilter = "all" | "active" | "completed";

export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  priority: TodoPriority;
  createdAt: number;
  completedAt?: number;
}

export function createTodo(title: string, priority: TodoPriority = "medium"): TodoItem {
  const trimmed = (title || "").trim();
  if (!trimmed) {
    throw new Error("待办事项标题不能为空");
  }
  return {
    id: "todo_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9),
    title: trimmed,
    completed: false,
    priority,
    createdAt: Date.now()
  };
}

export function toggleTodoStatus(todos: TodoItem[], id: string): TodoItem[] {
  return todos.map((item) => {
    if (item.id === id) {
      const nextCompleted = !item.completed;
      return {
        ...item,
        completed: nextCompleted,
        completedAt: nextCompleted ? Date.now() : undefined
      };
    }
    return item;
  });
}

export function deleteTodoItem(todos: TodoItem[], id: string): TodoItem[] {
  return todos.filter((item) => item.id !== id);
}

export function clearCompletedTodos(todos: TodoItem[]): TodoItem[] {
  return todos.filter((item) => !item.completed);
}

export function filterAndSearchTodos(
  todos: TodoItem[],
  filter: TodoFilter = "all",
  searchQuery = ""
): TodoItem[] {
  let list = todos;

  // 1. 状态过滤
  if (filter === "active") {
    list = list.filter((item) => !item.completed);
  } else if (filter === "completed") {
    list = list.filter((item) => item.completed);
  }

  // 2. 关键词检索
  const q = (searchQuery || "").trim().toLowerCase();
  if (q) {
    list = list.filter((item) => item.title.toLowerCase().includes(q));
  }

  // 3. 排序：未完成在前（高优先级排前），已完成在后
  const priorityWeight: Record<TodoPriority, number> = {
    high: 3,
    medium: 2,
    low: 1
  };

  return [...list].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    const diff = priorityWeight[b.priority] - priorityWeight[a.priority];
    if (diff !== 0) return diff;
    return b.createdAt - a.createdAt;
  });
}

export const TODOS_STORAGE_KEY = "todo.items.v1";

/**
 * 校验从存储读回的待办列表：结构不对的条目直接丢弃，不让损坏数据导致整个列表崩溃
 */
export function sanitizeStoredTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || seen.has(t.id)) continue;
    if (typeof t.title !== "string" || !t.title.trim()) continue;
    seen.add(t.id);
    const priority: TodoPriority = t.priority === "high" || t.priority === "low" ? t.priority : "medium";
    out.push({
      id: t.id,
      title: t.title,
      completed: t.completed === true,
      priority,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
      ...(t.completed === true && typeof t.completedAt === "number" ? { completedAt: t.completedAt } : {})
    });
  }
  return out;
}
