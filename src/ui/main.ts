import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps/app-with-deps';
import type { TodoBoardSnapshot, TodoCounts, TodoItem, TodoPriority, TodoSource, TodoStatus } from '../types.js';

type TabKey = 'active' | 'now' | 'inbox' | 'waiting' | 'done';

interface SyncResult extends Partial<TodoBoardSnapshot> {
  changed?: boolean;
  initialFilter?: {
    status?: string;
    person?: string;
    query?: string;
  };
}

interface Transport {
  readonly mode: 'mcp-app' | 'http';
  getBoard(sinceRevision?: number): Promise<SyncResult | null>;
  addTodo(args: Record<string, unknown>): Promise<SyncResult | null>;
  updateTodo(args: Record<string, unknown>): Promise<SyncResult | null>;
  toggleTodo(id: number): Promise<SyncResult | null>;
  deleteTodo(id: number): Promise<SyncResult | null>;
  clearCompleted(): Promise<SyncResult | null>;
  seedDemo(): Promise<SyncResult | null>;
  openLink(url: string): Promise<void>;
}

interface UiState {
  revision: number;
  todos: TodoItem[];
  counts: TodoCounts;
  people: string[];
  activeTab: TabKey;
  selectedPerson: string;
  editingId: number | null;
  freshIds: Set<number>;
  manualTheme: 'light' | 'dark' | null;
  pollInFlight: boolean;
  canOpenLinks: boolean;
}

const EMPTY_COUNTS: TodoCounts = {
  inbox: 0,
  now: 0,
  todo: 0,
  waiting: 0,
  done: 0,
  active: 0,
  total: 0,
};

const state: UiState = {
  revision: 0,
  todos: [],
  counts: { ...EMPTY_COUNTS },
  people: [],
  activeTab: 'active',
  selectedPerson: '',
  editingId: null,
  freshIds: new Set<number>(),
  manualTheme: null,
  pollInFlight: false,
  canOpenLinks: false,
};

const prevItemSignatures = new Map<number, string>();
let toastTimer: number | undefined;
let transport: Transport | null = null;

// --- DOM refs ---
const dateStampEl = document.getElementById('date-stamp') as HTMLElement;
const syncIndicatorEl = document.getElementById('sync-indicator') as HTMLElement;
const syncLabelEl = document.getElementById('sync-label') as HTMLElement;
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
const statusTabsEl = document.getElementById('status-tabs') as HTMLElement;
const peopleBarEl = document.getElementById('people-bar') as HTMLElement;
const composerForm = document.getElementById('composer') as HTMLFormElement;
const composerInput = document.getElementById('composer-input') as HTMLInputElement;
const composerExtras = document.getElementById('composer-extras') as HTMLElement;
const composerStatus = document.getElementById('composer-status') as HTMLSelectElement;
const composerPerson = document.getElementById('composer-person') as HTMLInputElement;
const composerDue = document.getElementById('composer-due') as HTMLInputElement;
const composerPriorityBtn = document.getElementById('composer-priority') as HTMLButtonElement;
const listAreaEl = document.getElementById('list-area') as HTMLElement;
const footerStatsEl = document.getElementById('footer-stats') as HTMLElement;
const clearDoneBtn = document.getElementById('clear-done-btn') as HTMLButtonElement;
const toastEl = document.getElementById('toast') as HTMLElement;

function formatTodayStamp(): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
  return formatted.replace(',', ' ·');
}

function setPaperTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-paper-theme', theme);
  try {
    applyDocumentTheme(theme);
  } catch {
    // Ignore outside MCP host context
  }
}

function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function setSyncState(mode: 'live' | 'syncing' | 'offline', label: string): void {
  syncIndicatorEl.classList.toggle('is-live', mode === 'live');
  syncIndicatorEl.classList.toggle('is-syncing', mode === 'syncing');
  syncLabelEl.textContent = label;
}

function extractStructured(result: unknown): SyncResult | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { structuredContent?: unknown };
  if (r.structuredContent && typeof r.structuredContent === 'object') {
    return r.structuredContent as SyncResult;
  }
  return null;
}

function applySnapshot(data: SyncResult, highlightChanges: boolean): void {
  if (!data.todos || !data.counts) return;

  const fresh = new Set<number>();
  if (highlightChanges && prevItemSignatures.size > 0) {
    for (const item of data.todos) {
      const sig = `${item.title}|${item.notes}|${item.status}|${item.priority}|${item.person}|${item.due}`;
      if (prevItemSignatures.get(item.id) !== sig) {
        fresh.add(item.id);
      }
    }
  }

  prevItemSignatures.clear();
  for (const item of data.todos) {
    prevItemSignatures.set(
      item.id,
      `${item.title}|${item.notes}|${item.status}|${item.priority}|${item.person}|${item.due}`
    );
  }

  state.revision = data.revision ?? state.revision;
  state.todos = data.todos;
  state.counts = data.counts;
  state.people = data.people ?? [];
  state.freshIds = fresh;

  if (data.initialFilter?.status) {
    const s = data.initialFilter.status;
    if (s === 'active' || s === 'now' || s === 'inbox' || s === 'waiting' || s === 'done') {
      state.activeTab = s;
    }
  }
  if (data.initialFilter?.person !== undefined) {
    state.selectedPerson = data.initialFilter.person;
  }

  if (state.selectedPerson && !state.people.includes(state.selectedPerson)) {
    state.selectedPerson = '';
  }

  setSyncState('live', 'Synced');
  render();

  if (fresh.size > 0) {
    window.setTimeout(() => {
      state.freshIds.clear();
    }, 1500);
  }
}

async function runMutation(fn: (t: Transport) => Promise<SyncResult | null>): Promise<void> {
  if (!transport) {
    showToast('Not connected to Paper Todo server');
    return;
  }
  setSyncState('syncing', 'Saving…');
  try {
    const data = await fn(transport);
    if (data && data.todos && data.counts) {
      applySnapshot(data, false);
    } else {
      setSyncState('live', 'Synced');
    }
  } catch (err) {
    console.error('[paper-todo-ui] mutation failed:', err);
    showToast('Could not save change — please try again');
    setSyncState('offline', 'Reconnecting');
  }
}

async function pollBoard(): Promise<void> {
  if (!transport || state.pollInFlight || state.editingId !== null) return;
  if (document.visibilityState === 'hidden') return;
  state.pollInFlight = true;
  try {
    const data = await transport.getBoard(state.revision);
    if (data && data.changed && data.todos && data.counts) {
      applySnapshot(data, true);
    } else if (data) {
      setSyncState('live', 'Synced');
    }
  } catch {
    setSyncState('offline', 'Reconnecting');
  } finally {
    state.pollInFlight = false;
  }
}

function parseQuickInput(raw: string): {
  title: string;
  person: string;
  priority: TodoPriority;
  status: TodoStatus;
} {
  let text = raw.trim();
  let status: TodoStatus = (composerStatus.value as TodoStatus) || 'todo';
  let priority: TodoPriority = composerPriorityBtn.dataset.active === 'true' ? 'high' : 'normal';
  let person = composerPerson.value.trim().replace(/^@+/, '');

  if (text.startsWith('~')) {
    status = 'waiting';
    text = text.slice(1).trim();
  } else if (text.startsWith('*')) {
    status = 'now';
    text = text.slice(1).trim();
  }

  if (/(^|\s)!(?=\s|$)/.test(text) || /!$/.test(text)) {
    priority = 'high';
    text = text.replace(/(^|\s)!(?=\s|$)/g, ' ').replace(/!+$/, '').trim();
  }

  const personMatch = text.match(/(?:^|\s)@([^\s@#!]+)/);
  if (personMatch) {
    if (!person) person = personMatch[1];
    text = text.replace(personMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  return { title: text, person, priority, status };
}

function getFilteredTodos(): TodoItem[] {
  return state.todos.filter((item) => {
    if (state.activeTab === 'active') {
      if (item.status === 'done') return false;
    } else if (item.status !== state.activeTab) {
      return false;
    }

    if (state.selectedPerson && item.person !== state.selectedPerson) {
      return false;
    }
    return true;
  });
}

function createCheckSvg(checked: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  if (checked) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 8.5L6.5 12L13.5 4.5');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.1');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}

function renderEditorDrawer(item: TodoItem): HTMLElement {
  const drawer = document.createElement('div');
  drawer.className = 'editor-drawer';

  const titleInput = document.createElement('input');
  titleInput.className = 'editor-input';
  titleInput.value = item.title;
  titleInput.placeholder = 'Task title';

  const notesInput = document.createElement('textarea');
  notesInput.className = 'editor-textarea';
  notesInput.value = item.notes;
  notesInput.placeholder = 'Notes, context, or next action…';

  const grid = document.createElement('div');
  grid.className = 'editor-grid';

  const statusLabel = document.createElement('label');
  statusLabel.className = 'mini-field';
  statusLabel.append('Status');
  const statusSel = document.createElement('select');
  const statusOptions: Array<[TodoStatus, string]> = [
    ['now', 'Focus'],
    ['todo', 'Todo'],
    ['waiting', 'Waiting'],
    ['inbox', 'Inbox'],
    ['done', 'Done'],
  ];
  for (const [val, text] of statusOptions) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (item.status === val) opt.selected = true;
    statusSel.appendChild(opt);
  }
  statusLabel.appendChild(statusSel);

  const personLabel = document.createElement('label');
  personLabel.className = 'mini-field';
  personLabel.append('Person');
  const personIn = document.createElement('input');
  personIn.type = 'text';
  personIn.value = item.person;
  personIn.placeholder = 'Alex';
  personLabel.appendChild(personIn);

  const dueLabel = document.createElement('label');
  dueLabel.className = 'mini-field';
  dueLabel.append('Due');
  const dueIn = document.createElement('input');
  dueIn.type = 'text';
  dueIn.value = item.due;
  dueIn.placeholder = 'Today 5pm';
  dueLabel.appendChild(dueIn);

  const prioBtn = document.createElement('button');
  prioBtn.type = 'button';
  prioBtn.className = 'mini-toggle';
  prioBtn.textContent = '! Urgent';
  prioBtn.dataset.active = String(item.priority === 'high');
  prioBtn.addEventListener('click', () => {
    prioBtn.dataset.active = prioBtn.dataset.active === 'true' ? 'false' : 'true';
  });

  grid.append(statusLabel, personLabel, dueLabel, prioBtn);

  const footer = document.createElement('div');
  footer.className = 'editor-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    state.editingId = null;
    render();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-ink';
  saveBtn.textContent = 'Save';

  const commitSave = async () => {
    const nextTitle = titleInput.value.trim();
    if (!nextTitle) {
      titleInput.focus();
      return;
    }
    state.editingId = null;
    await runMutation((t) =>
      t.updateTodo({
        id: item.id,
        title: nextTitle,
        notes: notesInput.value.trim(),
        status: statusSel.value as TodoStatus,
        priority: prioBtn.dataset.active === 'true' ? 'high' : 'normal',
        person: personIn.value.trim(),
        due: dueIn.value.trim(),
      })
    );
  };

  saveBtn.addEventListener('click', () => {
    void commitSave();
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitSave();
    } else if (e.key === 'Escape') {
      state.editingId = null;
      render();
    }
  });

  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.editingId = null;
      render();
    }
  });

  footer.append(cancelBtn, saveBtn);
  drawer.append(titleInput, notesInput, grid, footer);

  window.setTimeout(() => titleInput.focus(), 0);
  return drawer;
}

function renderTodoRow(item: TodoItem): HTMLElement {
  const row = document.createElement('article');
  row.className = 'todo-row';
  if (item.status === 'done') row.classList.add('is-done');
  if (item.status === 'waiting') row.classList.add('is-waiting');
  if (item.status === 'inbox') row.classList.add('is-inbox');
  if (item.priority === 'high') row.classList.add('is-high');
  if (state.editingId === item.id) row.classList.add('is-editing');
  if (state.freshIds.has(item.id)) row.classList.add('is-fresh');

  const line = document.createElement('div');
  line.className = 'todo-line';

  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'check-btn';
  checkBtn.title = item.status === 'done' ? 'Reopen task' : 'Mark as done';
  checkBtn.setAttribute('aria-label', checkBtn.title);
  checkBtn.appendChild(createCheckSvg(item.status === 'done'));
  checkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void runMutation((t) => t.toggleTodo(item.id));
  });

  const body = document.createElement('div');
  body.className = 'todo-body';
  body.addEventListener('click', () => {
    state.editingId = state.editingId === item.id ? null : item.id;
    render();
  });

  const titleRow = document.createElement('div');
  titleRow.className = 'todo-title-row';

  if (item.priority === 'high' && item.status !== 'done') {
    const bang = document.createElement('span');
    bang.className = 'priority-mark';
    bang.textContent = '!';
    titleRow.appendChild(bang);
  }

  const titleEl = document.createElement('span');
  titleEl.className = 'todo-title';
  titleEl.textContent = item.title;
  titleRow.appendChild(titleEl);
  body.appendChild(titleRow);

  if (item.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'todo-notes';
    notesEl.textContent = item.notes;
    body.appendChild(notesEl);
  }

  const metaEl = document.createElement('div');
  metaEl.className = 'todo-meta';

  if (item.person) {
    const p = document.createElement('span');
    p.className = 'meta-person';
    p.textContent = `@${item.person}`;
    metaEl.appendChild(p);
  }

  if (item.due) {
    const d = document.createElement('span');
    d.className = 'meta-due';
    d.textContent = item.due;
    metaEl.appendChild(d);
  }

  if (item.source === 'teams' || item.source === 'outlook' || item.source === 'agent') {
    const src = document.createElement('span');
    src.className = `meta-source is-${item.source}`;
    src.textContent = item.source === 'agent' ? 'AI' : item.source;
    metaEl.appendChild(src);
  }

  if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && state.canOpenLinks) {
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'meta-link';
    linkBtn.textContent = 'Source ↗';
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (transport) void transport.openLink(item.sourceUrl);
    });
    metaEl.appendChild(linkBtn);
  }

  const idSpan = document.createElement('span');
  idSpan.className = 'meta-id';
  idSpan.textContent = `#${item.id}`;
  metaEl.appendChild(idSpan);

  body.appendChild(metaEl);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (item.status === 'inbox') {
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'act-btn is-accept';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runMutation((t) => t.updateTodo({ id: item.id, status: 'todo' }));
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'act-btn is-danger';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runMutation((t) => t.deleteTodo(item.id));
    });

    actions.append(acceptBtn, dismissBtn);
  } else if (item.status !== 'done') {
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = `act-btn ${item.status === 'now' ? 'is-active' : ''}`;
    focusBtn.title = item.status === 'now' ? 'Remove from Focus' : 'Move to Focus';
    focusBtn.textContent = 'Focus';
    focusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runMutation((t) =>
        t.updateTodo({
          id: item.id,
          status: item.status === 'now' ? 'todo' : 'now',
        })
      );
    });

    const waitBtn = document.createElement('button');
    waitBtn.type = 'button';
    waitBtn.className = `act-btn ${item.status === 'waiting' ? 'is-active' : ''}`;
    waitBtn.title = item.status === 'waiting' ? 'Move back to Todo' : 'Mark as Waiting';
    waitBtn.textContent = 'Wait';
    waitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runMutation((t) =>
        t.updateTodo({
          id: item.id,
          status: item.status === 'waiting' ? 'todo' : 'waiting',
        })
      );
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'act-btn is-danger';
    delBtn.title = 'Delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.editingId === item.id) state.editingId = null;
      void runMutation((t) => t.deleteTodo(item.id));
    });

    actions.append(focusBtn, waitBtn, delBtn);
  } else {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'act-btn is-danger';
    delBtn.title = 'Delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runMutation((t) => t.deleteTodo(item.id));
    });
    actions.append(delBtn);
  }

  line.append(checkBtn, body, actions);
  row.appendChild(line);

  if (state.editingId === item.id) {
    row.appendChild(renderEditorDrawer(item));
  }

  return row;
}

function renderEmptyState(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const title = document.createElement('p');
  title.className = 'empty-title';

  const desc = document.createElement('p');
  desc.className = 'empty-desc';

  if (state.counts.total === 0) {
    title.textContent = 'Blank sheet';
    desc.textContent =
      'Write a task above, or tell any AI agent session "Add a todo..." — updates appear here automatically.';
    wrap.append(title, desc);

    const demoBtn = document.createElement('button');
    demoBtn.type = 'button';
    demoBtn.className = 'btn-ghost';
    demoBtn.textContent = 'Load 4 sample tasks';
    demoBtn.addEventListener('click', () => {
      void runMutation((t) => t.seedDemo());
    });
    wrap.appendChild(demoBtn);
  } else {
    title.textContent = 'Nothing here';
    desc.textContent = state.selectedPerson
      ? `No items involving @${state.selectedPerson} in this view.`
      : 'This section is clear.';
    wrap.append(title, desc);
  }

  return wrap;
}

function render(): void {
  const tabs = statusTabsEl.querySelectorAll<HTMLButtonElement>('.tab');
  tabs.forEach((btn) => {
    const key = btn.dataset.tab as TabKey;
    btn.classList.toggle('is-active', key === state.activeTab);
    const countSpan = btn.querySelector<HTMLElement>('.tab-count');
    if (countSpan) {
      const val = state.counts[key] ?? 0;
      countSpan.textContent = String(val);
      btn.classList.toggle('has-items', val > 0);
    }
  });

  peopleBarEl.replaceChildren();
  if (state.people.length > 0 && state.activeTab !== 'done') {
    peopleBarEl.hidden = false;
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = `person-chip ${state.selectedPerson === '' ? 'is-active' : ''}`;
    allChip.textContent = 'Everyone';
    allChip.addEventListener('click', () => {
      state.selectedPerson = '';
      render();
    });
    peopleBarEl.appendChild(allChip);

    for (const p of state.people) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `person-chip ${state.selectedPerson === p ? 'is-active' : ''}`;
      chip.textContent = `@${p}`;
      chip.addEventListener('click', () => {
        state.selectedPerson = state.selectedPerson === p ? '' : p;
        render();
      });
      peopleBarEl.appendChild(chip);
    }
  } else {
    peopleBarEl.hidden = true;
  }

  const items = getFilteredTodos();
  listAreaEl.replaceChildren();

  if (items.length === 0) {
    listAreaEl.appendChild(renderEmptyState());
  } else if (state.activeTab === 'active') {
    const sections: Array<{ key: TodoStatus; label: string; cls: string }> = [
      { key: 'now', label: 'Focus', cls: 'is-now' },
      { key: 'inbox', label: 'Inbox', cls: 'is-inbox' },
      { key: 'todo', label: 'Todo', cls: '' },
      { key: 'waiting', label: 'Waiting', cls: 'is-waiting' },
    ];

    for (const sec of sections) {
      const groupItems = items.filter((i) => i.status === sec.key);
      if (groupItems.length === 0) continue;

      const groupEl = document.createElement('div');
      groupEl.className = 'section-group';

      const heading = document.createElement('div');
      heading.className = `section-heading ${sec.cls}`;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = sec.label;
      const countSpan = document.createElement('span');
      countSpan.className = 'section-count';
      countSpan.textContent = String(groupItems.length);
      heading.append(labelSpan, countSpan);

      groupEl.appendChild(heading);
      for (const item of groupItems) {
        groupEl.appendChild(renderTodoRow(item));
      }
      listAreaEl.appendChild(groupEl);
    }
  } else {
    for (const item of items) {
      listAreaEl.appendChild(renderTodoRow(item));
    }
  }

  footerStatsEl.textContent = `${state.counts.active} active · ${state.counts.now} focus · ${state.counts.waiting} waiting · ${state.counts.done} done`;
  clearDoneBtn.hidden = state.counts.done === 0;
}

// --- Event wiring ---
statusTabsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab');
  if (!btn || !btn.dataset.tab) return;
  state.activeTab = btn.dataset.tab as TabKey;
  state.editingId = null;
  render();
});

composerInput.addEventListener('focus', () => {
  composerExtras.hidden = false;
});

document.addEventListener('click', (e) => {
  if (
    !composerExtras.hidden &&
    !composerForm.contains(e.target as Node) &&
    !composerInput.value.trim() &&
    !composerPerson.value.trim() &&
    !composerDue.value.trim()
  ) {
    composerExtras.hidden = true;
  }
});

composerPriorityBtn.addEventListener('click', () => {
  composerPriorityBtn.dataset.active = composerPriorityBtn.dataset.active === 'true' ? 'false' : 'true';
});

composerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = composerInput.value.trim();
  if (!raw) return;

  const parsed = parseQuickInput(raw);
  if (!parsed.title) return;

  const due = composerDue.value.trim();
  composerInput.value = '';
  composerPerson.value = '';
  composerDue.value = '';
  composerStatus.value = 'todo';
  composerPriorityBtn.dataset.active = 'false';

  await runMutation((t) =>
    t.addTodo({
      title: parsed.title,
      person: parsed.person || undefined,
      priority: parsed.priority,
      status: parsed.status,
      due: due || undefined,
      source: 'manual' as TodoSource,
    })
  );
});

clearDoneBtn.addEventListener('click', () => {
  void runMutation((t) => t.clearCompleted());
});

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-paper-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  state.manualTheme = next;
  setPaperTheme(next);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void pollBoard();
  }
});

// --- Transports: MCP App (iframe host) vs Local HTTP (Gemini CLI browser UI) ---
async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function createHttpTransport(): Transport {
  return {
    mode: 'http',
    getBoard: (sinceRevision) =>
      httpJson<SyncResult>(sinceRevision ? `/api/board?since=${sinceRevision}` : '/api/board'),
    addTodo: (args) => httpJson<SyncResult>('/api/todos', { method: 'POST', body: JSON.stringify(args) }),
    updateTodo: (args) =>
      httpJson<SyncResult>(`/api/todos/${Number(args.id)}`, { method: 'PATCH', body: JSON.stringify(args) }),
    toggleTodo: (id) => httpJson<SyncResult>(`/api/todos/${id}/toggle`, { method: 'POST' }),
    deleteTodo: (id) => httpJson<SyncResult>(`/api/todos/${id}`, { method: 'DELETE' }),
    clearCompleted: () => httpJson<SyncResult>('/api/todos/clear-done', { method: 'POST' }),
    seedDemo: () => httpJson<SyncResult>('/api/seed', { method: 'POST' }),
    openLink: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

async function connectMcpAppTransport(): Promise<Transport> {
  const app = new App({ name: 'Paper Todo', version: '0.1.0' }, {});

  app.ontoolinput = () => {
    setSyncState('syncing', 'Loading…');
  };

  app.ontoolresult = (result) => {
    const data = extractStructured(result);
    if (data && data.todos && data.counts) {
      applySnapshot(data, true);
    }
  };

  app.onhostcontextchanged = (ctx) => {
    if (!state.manualTheme && ctx.theme) {
      setPaperTheme(ctx.theme === 'dark' ? 'dark' : 'light');
    }
  };

  await app.connect();

  const caps = app.getHostCapabilities();
  state.canOpenLinks = Boolean(caps?.openLinks);

  const ctx = app.getHostContext();
  if (!state.manualTheme && ctx?.theme) {
    setPaperTheme(ctx.theme === 'dark' ? 'dark' : 'light');
  }

  const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<SyncResult | null> => {
    const res = await app.callServerTool({ name, arguments: args });
    if (res.isError) throw new Error(`Tool ${name} failed`);
    return extractStructured(res);
  };

  return {
    mode: 'mcp-app',
    getBoard: (sinceRevision) =>
      callTool('app_get_board', sinceRevision !== undefined ? { sinceRevision } : {}),
    addTodo: (args) => callTool('app_add_todo', args),
    updateTodo: (args) => callTool('app_update_todo', args),
    toggleTodo: (id) => callTool('app_toggle_todo', { id }),
    deleteTodo: (id) => callTool('app_delete_todo', { id }),
    clearCompleted: () => callTool('app_clear_completed', {}),
    seedDemo: () => callTool('app_seed_demo', {}),
    openLink: async (url) => {
      await app.openLink({ url });
    },
  };
}

// --- Boot ---
dateStampEl.textContent = formatTodayStamp();

async function boot(): Promise<void> {
  const isEmbeddedMcpApp = window.parent !== window;

  try {
    if (isEmbeddedMcpApp) {
      transport = await connectMcpAppTransport();
    } else {
      transport = createHttpTransport();
      state.canOpenLinks = true;
      if (!state.manualTheme && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        setPaperTheme('dark');
      }
    }

    if (state.revision === 0) {
      const initial = await transport.getBoard();
      if (initial && initial.todos && initial.counts) {
        applySnapshot(initial, false);
      }
    }

    window.setInterval(() => {
      void pollBoard();
    }, 2200);
  } catch (err) {
    console.error('[paper-todo-ui] boot failed:', err);
    setSyncState('offline', 'Offline');
    render();
  }
}

void boot();
