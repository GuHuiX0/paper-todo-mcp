import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listAdapters } from '../adapters/index.js';
import { TodoStore } from '../storage/store.js';
import type { TodoBoardSnapshot, TodoItem, TodoPriority, TodoSource, TodoStatus } from '../types.js';
import { ensureNativeAppBuilt, launchNativeApp } from './desktop.js';
import { PaperTodoWebServer, openUrlInBrowser } from './web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_URI = 'ui://paper-todo/app.html';
const APP_MIME_TYPE = 'text/html;profile=mcp-app';
const DEFAULT_PORT = 4789;

const PANE_META: Record<string, unknown> = {
  ui: { resourceUri: APP_URI },
  'ui/resourceUri': APP_URI,
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: 'Paper Todo' },
      { type: 'global', title: 'Paper Todo' },
    ],
  },
};

const APP_ONLY_META: Record<string, unknown> = {
  ui: { visibility: ['app'] },
};

const StatusEnum = z.enum(['inbox', 'now', 'todo', 'waiting', 'done']);
const FilterStatusEnum = z.enum(['active', 'all', 'inbox', 'now', 'todo', 'waiting', 'done']);
const PriorityEnum = z.enum(['normal', 'high']);
const SourceEnum = z.enum(['manual', 'agent', 'teams', 'outlook']);

interface CliOptions {
  dataDir: string;
  htmlPath: string;
  port: number;
  enableWeb: boolean;
  uiOnly: boolean;
  apiOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let dataDir = process.env.PAPER_TODO_DATA_DIR || path.join(os.homedir(), '.paper-todo-mcp');
  let htmlPath = process.env.PAPER_TODO_HTML || path.join(__dirname, 'app.html');
  let port = Number(process.env.PAPER_TODO_PORT || DEFAULT_PORT);
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    port = DEFAULT_PORT;
  }
  let enableWeb = process.env.PAPER_TODO_NO_WEB !== '1';
  let uiOnly = false;
  let apiOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--data-dir' || arg === '--data_dir') && argv[i + 1]) {
      dataDir = argv[++i];
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
    } else if (arg.startsWith('--data_dir=')) {
      dataDir = arg.slice('--data_dir='.length);
    } else if ((arg === '--html' || arg === '--app-html') && argv[i + 1]) {
      htmlPath = argv[++i];
    } else if (arg.startsWith('--html=')) {
      htmlPath = arg.slice('--html='.length);
    } else if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
    } else if (arg === '--no-web') {
      enableWeb = false;
    } else if (arg === '--ui-only') {
      uiOnly = true;
      enableWeb = true;
    } else if (arg === '--api-only') {
      apiOnly = true;
      enableWeb = true;
    }
  }

  return { dataDir, htmlPath, port, enableWeb, uiOnly, apiOnly };
}

function formatTodoLine(item: TodoItem): string {
  const mark =
    item.status === 'done'
      ? '[x]'
      : item.status === 'now'
        ? '[*]'
        : item.status === 'waiting'
          ? '[~]'
          : '[ ]';
  const tags: string[] = [];
  if (item.priority === 'high') tags.push('!');
  if (item.status !== 'todo' && item.status !== 'done') tags.push(item.status);
  if (item.person) tags.push(`@${item.person}`);
  if (item.due) tags.push(`due:${item.due}`);
  if (item.source === 'teams' || item.source === 'outlook') tags.push(item.source);
  const meta = tags.length > 0 ? ` (${tags.join(' · ')})` : '';
  const notes = item.notes ? ` — ${item.notes}` : '';
  return `${mark} #${item.id} ${item.title}${meta}${notes}`;
}

function extractPortFromUrl(url: string | null, fallbackPort: number): number {
  if (!url) return fallbackPort;
  try {
    const parsed = new URL(url);
    const p = Number(parsed.port);
    return Number.isFinite(p) && p > 0 ? p : fallbackPort;
  } catch {
    return fallbackPort;
  }
}

function formatBoardText(
  snapshot: TodoBoardSnapshot,
  heading = 'Paper Todo',
  uiUrl?: string | null,
  launchedNative?: boolean
): string {
  const { counts, todos } = snapshot;
  const header = `${heading} · active ${counts.active} (focus ${counts.now}, todo ${counts.todo}, waiting ${counts.waiting}, inbox ${counts.inbox}, done ${counts.done})`;
  const lines: string[] = [header];
  if (launchedNative) {
    lines.push('Desktop app: launched');
  }
  if (uiUrl) {
    lines.push(`UI: ${uiUrl}`);
  }
  if (todos.length === 0) {
    lines.push('(empty)');
  } else {
    lines.push(todos.map(formatTodoLine).join('\n'));
  }
  return lines.join('\n');
}

function readAppHtml(htmlPath: string): string {
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Paper Todo UI bundle not found at ${htmlPath}. Run "npm run build" first.`);
  }
  return fs.readFileSync(htmlPath, 'utf8');
}

function seedDemoItems(store: TodoStore): void {
  if (store.getCounts().total > 0) return;
  store.create({
    title: 'Reply to auth timeout investigation',
    notes: 'Share the prod connection pool findings for confirmation',
    status: 'now',
    priority: 'high',
    person: 'Alex',
    source: 'teams',
    due: 'Today 5pm',
  });
  store.create({
    title: 'Draft rollback notes for refactor PR',
    notes: 'Add feature flag fallback steps before merge',
    status: 'todo',
    priority: 'normal',
    source: 'agent',
    due: 'Tomorrow',
  });
  store.create({
    title: 'Waiting on staging DB allowlist approval',
    notes: 'Ticket submitted; run regression suite once confirmed',
    status: 'waiting',
    priority: 'normal',
    person: 'Maya',
    source: 'outlook',
  });
  store.create({
    title: 'Confirm agenda topics for Thursday review',
    notes: 'Captured from email thread — accept to queue or dismiss',
    status: 'inbox',
    priority: 'normal',
    person: 'Sam',
    source: 'outlook',
    due: 'Thu',
  });
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = new TodoStore(options.dataDir);
  const webServer = options.enableWeb
    ? new PaperTodoWebServer({
        port: options.port,
        store,
        readHtml: () => readAppHtml(options.htmlPath),
        seedDemo: () => seedDemoItems(store),
      })
    : null;

  const ensureWebUrl = async (): Promise<string | null> => {
    if (!webServer) return null;
    try {
      return await webServer.ensureRunning();
    } catch (err) {
      console.error('[paper-todo-mcp] Local web UI unavailable:', err);
      return null;
    }
  };

  const serverScriptPath = fileURLToPath(import.meta.url);

  const tryLaunchNative = (uiUrl: string | null): boolean => {
    if (process.platform !== 'win32') return false;
    const exePath = ensureNativeAppBuilt(__dirname);
    if (!exePath) return false;
    const targetPort = extractPortFromUrl(uiUrl, options.port);
    return launchNativeApp(exePath, {
      port: targetPort,
      dataDir: options.dataDir,
      serverScript: serverScriptPath,
    });
  };

  if (options.apiOnly) {
    const url = await ensureWebUrl();
    if (!url) {
      console.error('[paper-todo-mcp] Failed to start local API server.');
      process.exit(1);
    }
    const shutdown = () => {
      webServer?.close();
      store.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  if (options.uiOnly) {
    const url = await ensureWebUrl();
    if (!url) {
      console.error('[paper-todo-mcp] Failed to start local web UI.');
      process.exit(1);
    }
    console.log(`Paper Todo backend running at ${url} (db: ${store.dbPath})`);
    if (!tryLaunchNative(url)) {
      openUrlInBrowser(url);
    }
    const shutdown = () => {
      webServer?.close();
      store.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // Start or reuse the local HTTP UI server eagerly for Gemini CLI sessions
  await ensureWebUrl();

  const server = new McpServer(
    {
      name: 'paper-todo',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // --- UI Resource (MCP Apps SEP-1865) ---
  server.registerResource(
    'Paper Todo App',
    APP_URI,
    {
      title: 'Paper Todo',
      description: 'Minimalist paper-style interactive to-do sheet.',
      mimeType: APP_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async () => {
      const html = readAppHtml(options.htmlPath);
      return {
        contents: [
          {
            uri: APP_URI,
            mimeType: APP_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      };
    }
  );

  // --- Primary UI Entrypoint Tool (MCP App pane + Native Windows App / Localhost Web UI for Gemini CLI) ---
  server.registerTool(
    'open_todos',
    {
      title: 'Paper Todo',
      description:
        'Open or refresh the interactive Paper Todo sheet. Returns the board snapshot and local UI URL. Set openNativeApp=true (or openInBrowser=true) in terminal clients like Gemini CLI to launch or focus the native Windows Paper Todo app (or open in the browser on non-Windows).',
      inputSchema: {
        status: FilterStatusEnum.optional().describe(
          'Optional initial filter tab: active, inbox, now, todo, waiting, done, or all.'
        ),
        person: z.string().optional().describe('Optional person filter (without leading @).'),
        query: z.string().optional().describe('Optional search query.'),
        openNativeApp: z
          .boolean()
          .optional()
          .describe('Set true in terminal MCP clients on Windows (such as Gemini CLI) to launch or focus the native Windows Paper Todo desktop app.'),
        openInBrowser: z
          .boolean()
          .optional()
          .describe('Fallback flag to open the UI; on Windows this also prefers the native desktop app unless unavailable.'),
      },
      _meta: PANE_META,
    },
    async (args) => {
      const uiUrl = await ensureWebUrl();
      let launchedNative = false;
      if (args?.openNativeApp || args?.openInBrowser) {
        launchedNative = tryLaunchNative(uiUrl);
        if (!launchedNative && uiUrl) {
          openUrlInBrowser(uiUrl);
        }
      }

      const snapshot = store.getSnapshot({});
      const initialFilter = {
        status: args?.status ?? 'active',
        person: args?.person ?? '',
        query: args?.query ?? '',
      };
      const filteredTodos = store.list({
        status: initialFilter.status as TodoStatus | 'active' | 'all',
        person: initialFilter.person || undefined,
        query: initialFilter.query || undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: formatBoardText({ ...snapshot, todos: filteredTodos }, 'Paper Todo', uiUrl, launchedNative),
          },
        ],
        structuredContent: {
          ...snapshot,
          uiUrl,
          launchedNative,
          initialFilter,
          adapters: listAdapters(),
        },
      };
    }
  );

  // --- Model-facing CRUD Tools ---
  server.registerTool(
    'list_todos',
    {
      title: 'List Todos',
      description:
        'List or search todos by status, person, source, or keyword. Always call this before updating, completing, or deleting an item described in natural language.',
      inputSchema: {
        status: FilterStatusEnum.optional().describe('Filter by status (default: active). Use "all" to include done items.'),
        person: z.string().optional().describe('Filter by teammate or contact name.'),
        source: SourceEnum.optional().describe('Filter by source: manual, agent, teams, or outlook.'),
        query: z.string().optional().describe('Substring search across title, notes, and person.'),
      },
    },
    async (args) => {
      const status = (args?.status ?? 'active') as TodoStatus | 'active' | 'all';
      const todos = store.list({
        status,
        person: args?.person,
        source: args?.source as TodoSource | undefined,
        query: args?.query,
      });
      const snapshot = store.getSnapshot({});
      const uiUrl = webServer?.url ?? null;
      return {
        content: [
          {
            type: 'text',
            text: formatBoardText({ ...snapshot, todos }, `Todos (${status})`, uiUrl),
          },
        ],
        structuredContent: {
          ...snapshot,
          todos,
          uiUrl,
        },
      };
    }
  );

  server.registerTool(
    'add_todo',
    {
      title: 'Add Todo',
      description: 'Create a new to-do item on the shared Paper Todo sheet.',
      inputSchema: {
        title: z.string().min(1).describe('Short, actionable task title.'),
        notes: z.string().optional().describe('Optional details, context, or next action.'),
        status: StatusEnum.optional().describe('Initial status: now (focus), todo (default), waiting, inbox, or done.'),
        priority: PriorityEnum.optional().describe('Priority: normal (default) or high.'),
        person: z.string().optional().describe('Related teammate or contact name (without @).'),
        source: SourceEnum.optional().describe('Origin: agent (default), teams, outlook, or manual.'),
        sourceUrl: z.string().optional().describe('Optional link to the source message or email.'),
        due: z.string().optional().describe('Optional concise due note, e.g. "Today 5pm", "Fri", or "2026-11-26".'),
      },
    },
    async (args) => {
      const item = store.create({
        title: args.title,
        notes: args.notes,
        status: (args.status as TodoStatus | undefined) ?? 'todo',
        priority: (args.priority as TodoPriority | undefined) ?? 'normal',
        person: args.person,
        source: (args.source as TodoSource | undefined) ?? 'agent',
        sourceUrl: args.sourceUrl,
        due: args.due,
      });
      const uiUrl = await ensureWebUrl();
      const snapshot = store.getSnapshot({});
      return {
        content: [
          {
            type: 'text',
            text: `Added ${formatTodoLine(item)}${uiUrl ? `\nUI: ${uiUrl}` : ''}`,
          },
        ],
        structuredContent: {
          action: 'added',
          item,
          uiUrl,
          ...snapshot,
        },
      };
    }
  );

  server.registerTool(
    'update_todo',
    {
      title: 'Update Todo',
      description: 'Update an existing to-do item by its numeric ID.',
      inputSchema: {
        id: z.number().int().positive().describe('Numeric ID of the todo item.'),
        title: z.string().min(1).optional().describe('Updated title.'),
        notes: z.string().optional().describe('Updated notes (pass empty string to clear).'),
        status: StatusEnum.optional().describe('Updated status: inbox, now, todo, waiting, or done.'),
        priority: PriorityEnum.optional().describe('Updated priority: normal or high.'),
        person: z.string().optional().describe('Updated person/contact name (pass empty string to clear).'),
        source: SourceEnum.optional().describe('Updated source.'),
        sourceUrl: z.string().optional().describe('Updated source link.'),
        due: z.string().optional().describe('Updated due label (pass empty string to clear).'),
      },
    },
    async (args) => {
      const item = store.update({
        id: args.id,
        title: args.title,
        notes: args.notes,
        status: args.status as TodoStatus | undefined,
        priority: args.priority as TodoPriority | undefined,
        person: args.person,
        source: args.source as TodoSource | undefined,
        sourceUrl: args.sourceUrl,
        due: args.due,
      });
      const uiUrl = await ensureWebUrl();
      const snapshot = store.getSnapshot({});
      return {
        content: [
          {
            type: 'text',
            text: `Updated ${formatTodoLine(item)}`,
          },
        ],
        structuredContent: {
          action: 'updated',
          item,
          uiUrl,
          ...snapshot,
        },
      };
    }
  );

  server.registerTool(
    'complete_todo',
    {
      title: 'Complete Todo',
      description: 'Mark a to-do item as done (or reopen it if done=false).',
      inputSchema: {
        id: z.number().int().positive().describe('Numeric ID of the todo item.'),
        done: z.boolean().optional().describe('True to complete (default), false to reopen to todo.'),
      },
    },
    async (args) => {
      const targetStatus: TodoStatus = args.done === false ? 'todo' : 'done';
      const item = store.update({ id: args.id, status: targetStatus });
      const uiUrl = await ensureWebUrl();
      const snapshot = store.getSnapshot({});
      return {
        content: [
          {
            type: 'text',
            text: `${targetStatus === 'done' ? 'Completed' : 'Reopened'} ${formatTodoLine(item)}`,
          },
        ],
        structuredContent: {
          action: targetStatus === 'done' ? 'completed' : 'reopened',
          item,
          uiUrl,
          ...snapshot,
        },
      };
    }
  );

  server.registerTool(
    'delete_todo',
    {
      title: 'Delete Todo',
      description: 'Permanently delete a to-do item by its numeric ID.',
      inputSchema: {
        id: z.number().int().positive().describe('Numeric ID of the todo item.'),
      },
    },
    async (args) => {
      const removed = store.remove(args.id);
      const uiUrl = await ensureWebUrl();
      const snapshot = store.getSnapshot({});
      return {
        content: [
          {
            type: 'text',
            text: `Deleted #${removed.id} ${removed.title}`,
          },
        ],
        structuredContent: {
          action: 'deleted',
          deletedId: removed.id,
          uiUrl,
          ...snapshot,
        },
      };
    }
  );

  // --- App-only Tools (called directly by embedded MCP App UI via app.callServerTool) ---
  server.registerTool(
    'app_get_board',
    {
      title: 'App Get Board',
      description: 'Internal UI tool: fetch board snapshot if revision changed.',
      inputSchema: {
        sinceRevision: z.number().int().nonnegative().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const rev = store.getRevision();
      if (args?.sinceRevision !== undefined && args.sinceRevision === rev) {
        return {
          content: [{ type: 'text', text: 'unchanged' }],
          structuredContent: {
            changed: false,
            revision: rev,
          },
        };
      }
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `revision ${snapshot.revision}` }],
        structuredContent: {
          changed: true,
          ...snapshot,
          adapters: listAdapters(),
        },
      };
    }
  );

  server.registerTool(
    'app_add_todo',
    {
      title: 'App Add Todo',
      description: 'Internal UI tool: add a todo item manually.',
      inputSchema: {
        title: z.string().min(1),
        notes: z.string().optional(),
        status: StatusEnum.optional(),
        priority: PriorityEnum.optional(),
        person: z.string().optional(),
        source: SourceEnum.optional(),
        sourceUrl: z.string().optional(),
        due: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const item = store.create({
        title: args.title,
        notes: args.notes,
        status: (args.status as TodoStatus | undefined) ?? 'todo',
        priority: (args.priority as TodoPriority | undefined) ?? 'normal',
        person: args.person,
        source: (args.source as TodoSource | undefined) ?? 'manual',
        sourceUrl: args.sourceUrl,
        due: args.due,
      });
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Added #${item.id}` }],
        structuredContent: { item, ...snapshot },
      };
    }
  );

  server.registerTool(
    'app_update_todo',
    {
      title: 'App Update Todo',
      description: 'Internal UI tool: update a todo item manually.',
      inputSchema: {
        id: z.number().int().positive(),
        title: z.string().min(1).optional(),
        notes: z.string().optional(),
        status: StatusEnum.optional(),
        priority: PriorityEnum.optional(),
        person: z.string().optional(),
        source: SourceEnum.optional(),
        sourceUrl: z.string().optional(),
        due: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const item = store.update({
        id: args.id,
        title: args.title,
        notes: args.notes,
        status: args.status as TodoStatus | undefined,
        priority: args.priority as TodoPriority | undefined,
        person: args.person,
        source: args.source as TodoSource | undefined,
        sourceUrl: args.sourceUrl,
        due: args.due,
      });
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Updated #${item.id}` }],
        structuredContent: { item, ...snapshot },
      };
    }
  );

  server.registerTool(
    'app_toggle_todo',
    {
      title: 'App Toggle Todo',
      description: 'Internal UI tool: toggle a todo item done/undone.',
      inputSchema: {
        id: z.number().int().positive(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const item = store.toggleDone(args.id);
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Toggled #${item.id}` }],
        structuredContent: { item, ...snapshot },
      };
    }
  );

  server.registerTool(
    'app_delete_todo',
    {
      title: 'App Delete Todo',
      description: 'Internal UI tool: delete a todo item.',
      inputSchema: {
        id: z.number().int().positive(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const removed = store.remove(args.id);
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Deleted #${removed.id}` }],
        structuredContent: { deletedId: removed.id, ...snapshot },
      };
    }
  );

  server.registerTool(
    'app_clear_completed',
    {
      title: 'App Clear Completed',
      description: 'Internal UI tool: remove all completed items.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const deleted = store.clearCompleted();
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Cleared ${deleted}` }],
        structuredContent: { deleted, ...snapshot },
      };
    }
  );

  server.registerTool(
    'app_seed_demo',
    {
      title: 'App Seed Demo',
      description: 'Internal UI tool: populate sample items when the sheet is empty.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      seedDemoItems(store);
      const snapshot = store.getSnapshot({});
      return {
        content: [{ type: 'text', text: `Seeded ${snapshot.counts.total} items` }],
        structuredContent: { ...snapshot },
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    webServer?.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[paper-todo-mcp] Fatal error:', err);
  process.exit(1);
});
