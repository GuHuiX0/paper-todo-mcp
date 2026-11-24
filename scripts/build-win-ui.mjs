import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function findFrameworkDir() {
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

export function buildWindowsNativeApp(outPath = path.join(root, 'dist', 'PaperTodo.exe')) {
  if (process.platform !== 'win32') {
    console.log('Skipping native Windows WPF build on non-Windows host.');
    return null;
  }

  const fwDir = findFrameworkDir();
  if (!fwDir) {
    throw new Error('Could not find built-in Windows .NET Framework 4.x csc.exe.');
  }

  const srcDir = path.join(root, 'desktop', 'win-native');
  const csFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.cs'))
    .sort()
    .map((f) => path.join(srcDir, f));

  if (csFiles.length === 0) {
    throw new Error(`No C# source files found in ${srcDir}`);
  }

  const manifestPath = path.join(srcDir, 'app.manifest');
  const iconPath = path.join(srcDir, 'icon.ico');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

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

  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/utf8output',
    `/out:${outPath}`,
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
    throw new Error(`csc.exe failed (exit ${res.status}):\n${details}`);
  }

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Built native Windows app ${outPath} (${kb} KiB)`);
  return outPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWindowsNativeApp();
}
