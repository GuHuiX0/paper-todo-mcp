import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'dist', 'server.mjs');
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-todo-test-'));
const testPort = 14789;
const apiOnlyPort = 14790;

async function connectClient(extraArgs = []) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverPath, '--data-dir', tempDataDir, '--port', String(testPort), ...extraArgs],
  });
  const client = new Client({ name: 'smoke-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

try {
  // 1. Connect primary MCP client (also starts local HTTP Paper UI on testPort)
  const { client } = await connectClient();

  const resources = await client.listResources();
  const appRes = resources.resources.find((r) => r.uri === 'ui://paper-todo/app.html');
  assert.ok(appRes, 'UI resource ui://paper-todo/app.html must exist');
  assert.equal(appRes.mimeType, 'text/html;profile=mcp-app');

  const readRes = await client.readResource({ uri: 'ui://paper-todo/app.html' });
  assert.equal(readRes.contents.length, 1);
  assert.equal(readRes.contents[0].mimeType, 'text/html;profile=mcp-app');
  const html = readRes.contents[0].text;
  assert.ok(typeof html === 'string' && html.includes('Paper Todo') && html.includes('lang="en"'));

  const tools = await client.listTools();
  const openTool = tools.tools.find((t) => t.name === 'open_todos');
  assert.ok(openTool, 'open_todos tool must exist');
  assert.equal(openTool._meta?.ui?.resourceUri, 'ui://paper-todo/app.html');

  const appGet = tools.tools.find((t) => t.name === 'app_get_board');
  assert.deepEqual(appGet?._meta?.ui?.visibility, ['app']);

  // 2. Entrypoint launch with empty {} args returns uiUrl
  const opened = await client.callTool({ name: 'open_todos', arguments: {} });
  assert.ok(!opened.isError);
  assert.equal(opened.structuredContent.counts.total, 0);
  const uiUrl = opened.structuredContent.uiUrl;
  assert.equal(uiUrl, `http://127.0.0.1:${testPort}`);

  // 3. Verify local HTTP Paper UI endpoints
  const htmlResp = await fetch(`${uiUrl}/`);
  assert.equal(htmlResp.status, 200);
  const servedHtml = await htmlResp.text();
  assert.ok(servedHtml.includes('Paper Todo'));

  const health = await (await fetch(`${uiUrl}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.app, 'paper-todo-mcp');

  // 4. Verify multi-session sharing: a second MCP server reuses the same HTTP port cleanly
  const { client: session2 } = await connectClient();
  const addedViaSession2 = await session2.callTool({
    name: 'add_todo',
    arguments: {
      title: 'Reply to Alex on Teams about auth timeout',
      person: 'Alex',
      priority: 'high',
      status: 'now',
      source: 'teams',
      due: 'Today 5pm',
    },
  });
  assert.ok(!addedViaSession2.isError);
  const itemId = addedViaSession2.structuredContent.item.id;
  assert.equal(addedViaSession2.structuredContent.uiUrl, uiUrl);

  // 5. Verify HTTP board sees the item written by session 2 & revision polling works
  const board1 = await (await fetch(`${uiUrl}/api/board`)).json();
  assert.equal(board1.changed, true);
  assert.equal(board1.counts.now, 1);

  const boardUnchanged = await (await fetch(`${uiUrl}/api/board?since=${board1.revision}`)).json();
  assert.equal(boardUnchanged.changed, false);

  // 6. Verify manual HTTP UI write is immediately visible to MCP session 1
  const manualResp = await fetch(`${uiUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Waiting on Maya for staging DB allowlist', status: 'waiting', person: 'Maya' }),
  });
  assert.equal(manualResp.status, 201);

  const listActive = await client.callTool({ name: 'list_todos', arguments: { status: 'active' } });
  assert.equal(listActive.structuredContent.todos.length, 2);

  // 7. Complete via MCP, verify via HTTP, then check persistence across restart
  await client.callTool({ name: 'complete_todo', arguments: { id: itemId } });
  const boardAfterComplete = await (await fetch(`${uiUrl}/api/board?since=${board1.revision}`)).json();
  assert.equal(boardAfterComplete.changed, true);
  assert.equal(boardAfterComplete.counts.done, 1);
  assert.equal(boardAfterComplete.counts.waiting, 1);

  await session2.close();
  await client.close();

  // 8. Verify SQLite persistence across restart
  const { client: restarted } = await connectClient();
  const afterRestart = await restarted.callTool({ name: 'open_todos', arguments: {} });
  assert.equal(afterRestart.structuredContent.counts.total, 2);
  assert.equal(afterRestart.structuredContent.counts.done, 1);
  assert.equal(afterRestart.structuredContent.counts.waiting, 1);
  await restarted.close();

  // 9. Verify --api-only mode used when PaperTodo.exe boots standalone
  const apiChild = spawn(
    'node',
    ['--no-warnings', serverPath, '--api-only', '--port', String(apiOnlyPort), '--data-dir', tempDataDir],
    { stdio: 'ignore', windowsHide: true }
  );
  try {
    let apiHealthy = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const res = await fetch(`http://127.0.0.1:${apiOnlyPort}/api/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok === true && data.app === 'paper-todo-mcp') {
            apiHealthy = true;
            break;
          }
        }
      } catch {
        // Retry until ready
      }
    }
    assert.ok(apiHealthy, '--api-only server must respond cleanly on /api/health');

    const apiBoard = await (await fetch(`http://127.0.0.1:${apiOnlyPort}/api/board`)).json();
    assert.equal(apiBoard.counts.total, 2);
  } finally {
    const exited = new Promise((resolve) => {
      if (apiChild.exitCode !== null || apiChild.signalCode !== null) {
        resolve();
        return;
      }
      apiChild.once('exit', () => resolve());
      setTimeout(resolve, 1500);
    });
    apiChild.kill();
    await exited;
  }

  console.log('ALL MCP + MULTI-SESSION HTTP SMOKE TESTS PASSED!');
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
