import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pluginName = 'paper-todo';
const targetDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', pluginName);

function copyFile(srcRel, dstRel = srcRel) {
  const src = path.join(root, srcRel);
  const dst = path.join(targetDir, dstRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

fs.mkdirSync(targetDir, { recursive: true });

copyFile('plugin/plugin.json', 'plugin.json');
copyFile('plugin/mcp_config.json', 'mcp_config.json');
copyFile('plugin/assets/logo.svg', 'assets/logo.svg');
copyFile('plugin/rules/AGENTS.md', 'rules/AGENTS.md');
copyFile('dist/server.mjs', 'dist/server.mjs');
copyFile('dist/app.html', 'dist/app.html');

console.log(`Installed plugin '${pluginName}' to ${targetDir}`);
