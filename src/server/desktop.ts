import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LaunchNativeAppOptions {
  port: number;
  dataDir: string;
  serverScript: string;
}

function findFrameworkDir(): string | null {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'csc.exe'))) {
      return dir;
    }
  }
  return null;
}

export function findNativeAppPath(distDir: string): string | null {
  const envPath = process.env.PAPER_TODO_APP_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    path.join(distDir, 'PaperTodo.exe'),
    path.join(os.homedir(), '.paper-todo-mcp', 'PaperTodo.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getLatestSourceMtimeMs(srcDir: string): number {
  let latest = 0;
  for (const entry of fs.readdirSync(srcDir)) {
    if (entry.endsWith('.cs') || entry.endsWith('.manifest') || entry.endsWith('.ico')) {
      const stat = fs.statSync(path.join(srcDir, entry));
      if (stat.mtimeMs > latest) {
        latest = stat.mtimeMs;
      }
    }
  }
  return latest;
}

function compileWithCsc(fwDir: string, srcDir: string, outExe: string): boolean {
  const csFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.cs'))
    .sort()
    .map((f) => path.join(srcDir, f));

  if (csFiles.length === 0) {
    return false;
  }

  const manifestPath = path.join(srcDir, 'app.manifest');
  const iconPath = path.join(srcDir, 'icon.ico');
  const refs = [
    path.join(fwDir, 'WPF', 'PresentationCore.dll'),
    path.join(fwDir, 'WPF', 'PresentationFramework.dll'),
    path.join(fwDir, 'WPF', 'WindowsBase.dll'),
    path.join(fwDir, 'System.Xaml.dll'),
    path.join(fwDir, 'System.Windows.Forms.dll'),
    path.join(fwDir, 'System.Drawing.dll'),
    path.join(fwDir, 'System.Web.Extensions.dll'),
    path.join(fwDir, 'System.Net.Http.dll'),
  ];

  fs.mkdirSync(path.dirname(outExe), { recursive: true });

  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/utf8output',
    `/out:${outExe}`,
    ...(fs.existsSync(manifestPath) ? [`/win32manifest:${manifestPath}`] : []),
    ...(fs.existsSync(iconPath) ? [`/win32icon:${iconPath}`] : []),
    ...refs.map((r) => `/reference:${r}`),
    ...csFiles,
  ];

  const res = spawnSync(path.join(fwDir, 'csc.exe'), args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (res.status !== 0) {
    const details = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    console.error(`[paper-todo-mcp] csc.exe failed (${outExe}):\n${details}`);
    return false;
  }

  return fs.existsSync(outExe);
}

/**
 * Ensures the native Windows WPF executable exists and is up-to-date.
 * Compiles from `desktop/win-native/*.cs` using Windows' built-in .NET Framework csc.exe (~1.5s)
 * with zero external SDKs or compilers required.
 */
export function ensureNativeAppBuilt(distDir: string): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const envPath = process.env.PAPER_TODO_APP_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const projectRoot = path.resolve(distDir, '..');
  const srcDir = path.join(projectRoot, 'desktop', 'win-native');
  if (!fs.existsSync(srcDir)) {
    return findNativeAppPath(distDir);
  }

  const latestSourceMtime = getLatestSourceMtimeMs(srcDir);
  const targets = [
    path.join(distDir, 'PaperTodo.exe'),
    path.join(os.homedir(), '.paper-todo-mcp', 'PaperTodo.exe'),
  ];

  for (const candidate of targets) {
    if (fs.existsSync(candidate)) {
      try {
        if (fs.statSync(candidate).mtimeMs >= latestSourceMtime) {
          return candidate;
        }
      } catch {
        // Recompile if stat fails
      }
    }
  }

  const fwDir = findFrameworkDir();
  if (!fwDir) {
    console.error('[paper-todo-mcp] Built-in Windows csc.exe not found; falling back to existing binary or browser.');
    return findNativeAppPath(distDir);
  }

  for (const target of targets) {
    try {
      if (compileWithCsc(fwDir, srcDir, target)) {
        return target;
      }
    } catch (err) {
      console.error(`[paper-todo-mcp] Failed to compile native app to ${target}:`, err);
    }
  }

  return findNativeAppPath(distDir);
}

export function launchNativeApp(exePath: string, options: LaunchNativeAppOptions): boolean {
  try {
    const child = spawn(
      exePath,
      ['--port', String(options.port), '--data-dir', options.dataDir, '--server', options.serverScript],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }
    );
    child.unref();
    return true;
  } catch (err) {
    console.error('[paper-todo-mcp] Failed to launch native desktop app:', err);
    return false;
  }
}
