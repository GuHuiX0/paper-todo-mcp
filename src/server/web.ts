import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { listAdapters } from '../adapters/index.js';
import type { TodoStore } from '../storage/store.js';
import type { TodoPriority, TodoSource, TodoStatus } from '../types.js';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 256 * 1024;

export interface WebUiServerOptions {
  port: number;
  store: TodoStore;
  readHtml: () => string;
  seedDemo: () => void;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

async function probeExistingPaperTodo(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: HOST,
        port,
        path: '/api/health',
        timeout: 600,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              ok?: boolean;
              app?: string;
            };
            resolve(Boolean(data.ok && data.app === 'paper-todo-mcp'));
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

export function openUrlInBrowser(url: string): boolean {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export class PaperTodoWebServer {
  private server: http.Server | null = null;
  private boundUrl: string | null = null;
  private readonly preferredPort: number;
  private readonly store: TodoStore;
  private readonly readHtml: () => string;
  private readonly seedDemo: () => void;

  constructor(options: WebUiServerOptions) {
    this.preferredPort = options.port;
    this.store = options.store;
    this.readHtml = options.readHtml;
    this.seedDemo = options.seedDemo;
  }

  public get url(): string | null {
    return this.boundUrl;
  }

  private createHttpServer(): http.Server {
    return http.createServer(async (req, res) => {
      try {
        const method = req.method || 'GET';
        const reqUrl = new URL(req.url || '/', `http://${HOST}`);
        const pathname = reqUrl.pathname;

        if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          const html = this.readHtml();
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(html);
          return;
        }

        if (method === 'GET' && pathname === '/api/health') {
          sendJson(res, 200, {
            ok: true,
            app: 'paper-todo-mcp',
            version: '0.1.0',
            revision: this.store.getRevision(),
          });
          return;
        }

        if (method === 'GET' && pathname === '/api/board') {
          const sinceParam = reqUrl.searchParams.get('since');
          const rev = this.store.getRevision();
          if (sinceParam !== null && Number(sinceParam) === rev) {
            sendJson(res, 200, { changed: false, revision: rev });
            return;
          }
          const snapshot = this.store.getSnapshot({});
          sendJson(res, 200, {
            changed: true,
            ...snapshot,
            adapters: listAdapters(),
          });
          return;
        }

        if (method === 'POST' && pathname === '/api/todos') {
          const body = await readJsonBody(req);
          const title = typeof body.title === 'string' ? body.title : '';
          const item = this.store.create({
            title,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            status: typeof body.status === 'string' ? (body.status as TodoStatus) : 'todo',
            priority: typeof body.priority === 'string' ? (body.priority as TodoPriority) : 'normal',
            person: typeof body.person === 'string' ? body.person : undefined,
            source: typeof body.source === 'string' ? (body.source as TodoSource) : 'manual',
            sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
            due: typeof body.due === 'string' ? body.due : undefined,
          });
          sendJson(res, 201, { item, ...this.store.getSnapshot({}) });
          return;
        }

        if (method === 'POST' && pathname === '/api/todos/clear-done') {
          const deleted = this.store.clearCompleted();
          sendJson(res, 200, { deleted, ...this.store.getSnapshot({}) });
          return;
        }

        if (method === 'POST' && pathname === '/api/seed') {
          this.seedDemo();
          sendJson(res, 200, { ...this.store.getSnapshot({}) });
          return;
        }

        const toggleMatch = pathname.match(/^\/api\/todos\/(\d+)\/toggle$/);
        if (method === 'POST' && toggleMatch) {
          const id = Number(toggleMatch[1]);
          const item = this.store.toggleDone(id);
          sendJson(res, 200, { item, ...this.store.getSnapshot({}) });
          return;
        }

        const itemMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
        if (itemMatch) {
          const id = Number(itemMatch[1]);
          if (method === 'PATCH') {
            const body = await readJsonBody(req);
            const item = this.store.update({
              id,
              title: typeof body.title === 'string' ? body.title : undefined,
              notes: typeof body.notes === 'string' ? body.notes : undefined,
              status: typeof body.status === 'string' ? (body.status as TodoStatus) : undefined,
              priority: typeof body.priority === 'string' ? (body.priority as TodoPriority) : undefined,
              person: typeof body.person === 'string' ? body.person : undefined,
              source: typeof body.source === 'string' ? (body.source as TodoSource) : undefined,
              sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
              due: typeof body.due === 'string' ? body.due : undefined,
            });
            sendJson(res, 200, { item, ...this.store.getSnapshot({}) });
            return;
          }
          if (method === 'DELETE') {
            const removed = this.store.remove(id);
            sendJson(res, 200, { deletedId: removed.id, ...this.store.getSnapshot({}) });
            return;
          }
        }

        sendJson(res, 404, { error: 'Not found' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        const status = /not found/i.test(message) ? 404 : /empty|invalid|large/i.test(message) ? 400 : 500;
        sendJson(res, status, { error: message });
      }
    });
  }

  private tryListen(port: number): Promise<{ server: http.Server; actualPort: number }> {
    return new Promise((resolve, reject) => {
      const srv = this.createHttpServer();
      const onError = (err: NodeJS.ErrnoException) => {
        srv.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        const addr = srv.address() as AddressInfo;
        resolve({ server: srv, actualPort: addr.port });
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      srv.listen(port, HOST);
    });
  }

  /**
   * Ensures a local Paper Todo web UI is reachable on 127.0.0.1.
   * Safe across multiple concurrent Gemini CLI sessions: if another paper-todo-mcp
   * process already owns the preferred port, this instance reuses it seamlessly.
   */
  public async ensureRunning(): Promise<string> {
    if (this.server && this.boundUrl) {
      return this.boundUrl;
    }

    try {
      const { server, actualPort } = await this.tryListen(this.preferredPort);
      this.server = server;
      this.boundUrl = `http://${HOST}:${actualPort}`;
      return this.boundUrl;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EADDRINUSE' && this.preferredPort > 0) {
        const isPaperTodo = await probeExistingPaperTodo(this.preferredPort);
        if (isPaperTodo) {
          this.boundUrl = `http://${HOST}:${this.preferredPort}`;
          return this.boundUrl;
        }
        const { server, actualPort } = await this.tryListen(0);
        this.server = server;
        this.boundUrl = `http://${HOST}:${actualPort}`;
        return this.boundUrl;
      }
      throw err;
    }
  }

  public close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.boundUrl = null;
  }
}
