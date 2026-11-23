import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

fs.mkdirSync(distDir, { recursive: true });

// 1. Bundle UI TypeScript into a single self-contained HTML document (works for MCP App iframe & local HTTP UI)
const uiBundle = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'ui', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  platform: 'browser',
});

const jsCode = uiBundle.outputFiles[0].text;
const cssCode = fs.readFileSync(path.join(root, 'src', 'ui', 'styles.css'), 'utf8');
const htmlTemplate = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');

const finalHtml = htmlTemplate
  .replace('/*__STYLES__*/', () => cssCode)
  .replace('/*__SCRIPT__*/', () => jsCode);

const appHtmlPath = path.join(distDir, 'app.html');
fs.writeFileSync(appHtmlPath, finalHtml, 'utf8');

// 2. Bundle MCP Server into a single self-contained Node ESM bundle (zero runtime npm deps required)
const serverOutPath = path.join(distDir, 'server.mjs');
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: serverOutPath,
  external: ['node:*'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    ].join('\n'),
  },
});

const htmlKb = (Buffer.byteLength(finalHtml, 'utf8') / 1024).toFixed(1);
const srvKb = (fs.statSync(serverOutPath).size / 1024).toFixed(1);
console.log(`Built dist/app.html (${htmlKb} KiB) and dist/server.mjs (${srvKb} KiB)`);
