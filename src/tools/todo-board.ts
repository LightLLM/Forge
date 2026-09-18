/** Per-task todo board (Hermes-style planning checklist). */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}

export class TodoBoard {
  private readonly byTask = new Map<string, TodoItem[]>();
  private seq = 0;

  list(taskId: string): TodoItem[] {
    return [...(this.byTask.get(taskId) ?? [])];
  }

  add(taskId: string, text: string): TodoItem {
    const item: TodoItem = {
      id: `todo-${++this.seq}`,
      text: text.trim().slice(0, 500),
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    const list = this.byTask.get(taskId) ?? [];
    list.push(item);
    this.byTask.set(taskId, list);
    return item;
  }

  complete(taskId: string, id: string): TodoItem | null {
    const list = this.byTask.get(taskId) ?? [];
    const item = list.find((t) => t.id === id);
    if (!item) return null;
    item.done = true;
    item.completedAt = new Date().toISOString();
    return item;
  }

  clear(taskId: string): number {
    const n = this.byTask.get(taskId)?.length ?? 0;
    this.byTask.delete(taskId);
    return n;
  }
}
