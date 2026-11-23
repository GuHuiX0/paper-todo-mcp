export type TodoStatus = 'inbox' | 'now' | 'todo' | 'waiting' | 'done';

export type TodoPriority = 'normal' | 'high';

export type TodoSource = 'manual' | 'agent' | 'teams' | 'outlook';

export interface TodoItem {
  id: number;
  title: string;
  notes: string;
  status: TodoStatus;
  priority: TodoPriority;
  person: string;
  source: TodoSource;
  sourceUrl: string;
  due: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateTodoInput {
  title: string;
  notes?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  person?: string;
  source?: TodoSource;
  sourceUrl?: string;
  due?: string;
}

export interface UpdateTodoInput {
  id: number;
  title?: string;
  notes?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  person?: string;
  source?: TodoSource;
  sourceUrl?: string;
  due?: string;
}

export interface ListTodosFilter {
  status?: TodoStatus | 'active' | 'all';
  person?: string;
  source?: TodoSource;
  query?: string;
}

export interface TodoCounts {
  inbox: number;
  now: number;
  todo: number;
  waiting: number;
  done: number;
  active: number;
  total: number;
}

export interface TodoBoardSnapshot {
  revision: number;
  todos: TodoItem[];
  counts: TodoCounts;
  people: string[];
  updatedAt: string;
}
