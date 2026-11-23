import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CreateTodoInput,
  ListTodosFilter,
  TodoBoardSnapshot,
  TodoCounts,
  TodoItem,
  TodoPriority,
  TodoSource,
  TodoStatus,
  UpdateTodoInput,
} from '../types.js';

interface TodoRow {
  id: number;
  title: string;
  notes: string;
  status: string;
  priority: string;
  person: string;
  source: string;
  source_url: string;
  due: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const VALID_STATUSES = new Set<TodoStatus>(['inbox', 'now', 'todo', 'waiting', 'done']);
const VALID_PRIORITIES = new Set<TodoPriority>(['normal', 'high']);
const VALID_SOURCES = new Set<TodoSource>(['manual', 'agent', 'teams', 'outlook']);

function rowToItem(row: TodoRow): TodoItem {
  return {
    id: Number(row.id),
    title: String(row.title),
    notes: String(row.notes ?? ''),
    status: (VALID_STATUSES.has(row.status as TodoStatus) ? row.status : 'todo') as TodoStatus,
    priority: (VALID_PRIORITIES.has(row.priority as TodoPriority) ? row.priority : 'normal') as TodoPriority,
    person: String(row.person ?? ''),
    source: (VALID_SOURCES.has(row.source as TodoSource) ? row.source : 'manual') as TodoSource,
    sourceUrl: String(row.source_url ?? ''),
    due: String(row.due ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function cleanPerson(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^@+/, '').trim();
}

export class TodoStore {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, 'todos.db');
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'normal',
        person TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        source_url TEXT NOT NULL DEFAULT '',
        due TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_todos_person ON todos(person);
      INSERT OR IGNORE INTO meta(key, value) VALUES ('revision', '1');
    `);
  }

  public getRevision(): number {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'revision'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 1;
  }

  private bumpRevision(): number {
    const next = this.getRevision() + 1;
    this.db
      .prepare(`INSERT INTO meta(key, value) VALUES ('revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(String(next));
    return next;
  }

  public getById(id: number): TodoItem | null {
    const row = this.db.prepare(`SELECT * FROM todos WHERE id = ?`).get(id) as TodoRow | undefined;
    return row ? rowToItem(row) : null;
  }

  public list(filter: ListTodosFilter = {}): TodoItem[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'active') {
        clauses.push(`status != 'done'`);
      } else {
        clauses.push(`status = ?`);
        params.push(filter.status);
      }
    }

    if (filter.person && filter.person.trim()) {
      clauses.push(`LOWER(person) LIKE LOWER(?)`);
      params.push(`%${cleanPerson(filter.person)}%`);
    }

    if (filter.source) {
      clauses.push(`source = ?`);
      params.push(filter.source);
    }

    if (filter.query && filter.query.trim()) {
      const q = `%${filter.query.trim()}%`;
      clauses.push(`(LOWER(title) LIKE LOWER(?) OR LOWER(notes) LIKE LOWER(?) OR LOWER(person) LIKE LOWER(?))`);
      params.push(q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM todos
      ${whereSql}
      ORDER BY
        CASE status
          WHEN 'now' THEN 0
          WHEN 'inbox' THEN 1
          WHEN 'todo' THEN 2
          WHEN 'waiting' THEN 3
          WHEN 'done' THEN 4
          ELSE 5
        END ASC,
        CASE priority WHEN 'high' THEN 0 ELSE 1 END ASC,
        sort_order DESC,
        id DESC
    `;
    const rows = this.db.prepare(sql).all(...params) as unknown as TodoRow[];
    return rows.map(rowToItem);
  }

  public getCounts(): TodoCounts {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as cnt FROM todos GROUP BY status`)
      .all() as unknown as Array<{ status: string; cnt: number }>;

    const counts: TodoCounts = {
      inbox: 0,
      now: 0,
      todo: 0,
      waiting: 0,
      done: 0,
      active: 0,
      total: 0,
    };

    for (const row of rows) {
      const n = Number(row.cnt);
      counts.total += n;
      if (row.status === 'inbox') counts.inbox = n;
      else if (row.status === 'now') counts.now = n;
      else if (row.status === 'todo') counts.todo = n;
      else if (row.status === 'waiting') counts.waiting = n;
      else if (row.status === 'done') counts.done = n;
    }
    counts.active = counts.total - counts.done;
    return counts;
  }

  public getPeople(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT person FROM todos WHERE person != '' AND status != 'done' ORDER BY person ASC`)
      .all() as unknown as Array<{ person: string }>;
    return rows.map((r) => String(r.person));
  }

  public getSnapshot(filter: ListTodosFilter = {}): TodoBoardSnapshot {
    return {
      revision: this.getRevision(),
      todos: this.list(filter),
      counts: this.getCounts(),
      people: this.getPeople(),
      updatedAt: new Date().toISOString(),
    };
  }

  public create(input: CreateTodoInput): TodoItem {
    const title = input.title.trim();
    if (!title) {
      throw new Error('Title cannot be empty.');
    }
    const now = new Date().toISOString();
    const status: TodoStatus = input.status && VALID_STATUSES.has(input.status) ? input.status : 'todo';
    const priority: TodoPriority = input.priority && VALID_PRIORITIES.has(input.priority) ? input.priority : 'normal';
    const source: TodoSource = input.source && VALID_SOURCES.has(input.source) ? input.source : 'manual';
    const person = cleanPerson(input.person);
    const notes = (input.notes ?? '').trim();
    const sourceUrl = (input.sourceUrl ?? '').trim();
    const due = (input.due ?? '').trim();
    const completedAt = status === 'done' ? now : null;

    const maxRow = this.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM todos`).get() as { m: number };
    const nextOrder = Number(maxRow?.m ?? 0) + 1;

    const res = this.db
      .prepare(
        `INSERT INTO todos (title, notes, status, priority, person, source, source_url, due, sort_order, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(title, notes, status, priority, person, source, sourceUrl, due, nextOrder, now, now, completedAt);

    this.bumpRevision();
    const item = this.getById(Number(res.lastInsertRowid));
    if (!item) {
      throw new Error('Failed to load newly created todo.');
    }
    return item;
  }

  public update(input: UpdateTodoInput): TodoItem {
    const existing = this.getById(input.id);
    if (!existing) {
      throw new Error(`Todo #${input.id} not found.`);
    }

    const now = new Date().toISOString();
    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) {
      throw new Error('Title cannot be empty.');
    }

    const notes = input.notes !== undefined ? input.notes.trim() : existing.notes;
    const status: TodoStatus =
      input.status !== undefined && VALID_STATUSES.has(input.status) ? input.status : existing.status;
    const priority: TodoPriority =
      input.priority !== undefined && VALID_PRIORITIES.has(input.priority) ? input.priority : existing.priority;
    const person = input.person !== undefined ? cleanPerson(input.person) : existing.person;
    const source: TodoSource =
      input.source !== undefined && VALID_SOURCES.has(input.source) ? input.source : existing.source;
    const sourceUrl = input.sourceUrl !== undefined ? input.sourceUrl.trim() : existing.sourceUrl;
    const due = input.due !== undefined ? input.due.trim() : existing.due;

    let completedAt = existing.completedAt;
    if (status === 'done' && existing.status !== 'done') {
      completedAt = now;
    } else if (status !== 'done' && existing.status === 'done') {
      completedAt = null;
    }

    this.db
      .prepare(
        `UPDATE todos
         SET title = ?, notes = ?, status = ?, priority = ?, person = ?, source = ?, source_url = ?, due = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(title, notes, status, priority, person, source, sourceUrl, due, now, completedAt, input.id);

    this.bumpRevision();
    return this.getById(input.id)!;
  }

  public toggleDone(id: number): TodoItem {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Todo #${id} not found.`);
    }
    const nextStatus: TodoStatus = existing.status === 'done' ? 'todo' : 'done';
    return this.update({ id, status: nextStatus });
  }

  public remove(id: number): TodoItem {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Todo #${id} not found.`);
    }
    this.db.prepare(`DELETE FROM todos WHERE id = ?`).run(id);
    this.bumpRevision();
    return existing;
  }

  public clearCompleted(): number {
    const res = this.db.prepare(`DELETE FROM todos WHERE status = 'done'`).run();
    const deleted = Number(res.changes ?? 0);
    if (deleted > 0) {
      this.bumpRevision();
    }
    return deleted;
  }

  public close(): void {
    this.db.close();
  }
}
