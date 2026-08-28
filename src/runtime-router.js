import { state } from './state.js';
import { chooseVisualEntry } from './project-engine.js';
import { readPackageJson } from './package-utils.js';

const DIRECT_SOURCE_RE = /\.(?:css|js|mjs|cjs|jsx|ts|tsx|json|md|txt|xml|py|sh|vbs|yml|yaml|env|gitignore)$/i;
const DIRECT_IMAGE_RE = /\.(?:svg|png|jpe?g|gif|webp|ico)$/i;

function runnablePackage(pkg) {
  if (!pkg) return false;
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Boolean(scripts.dev || scripts.start || scripts.serve || deps.vite || deps.next || deps.react || deps['react-dom'] || deps.express || deps.fastify || deps.koa);
}

function directFileRoute(files, keys) {
  if (keys.length !== 1) return null;
  const path = keys[0];
  const file = files?.[path];
  if (/\.html?$/i.test(path)) return null;
  if (DIRECT_IMAGE_RE.test(path)) return { mode: 'file-image', entry: path, runnable: true, reason: 'Showing the saved image directly in the viewer.' };
  if (!file?.binary && DIRECT_SOURCE_RE.test(path)) return { mode: 'file-source', entry: path, runnable: true, reason: 'Showing the saved source/text file without executing it.' };
  return null;
}

export function evaluateWebContainerEnvironment(env) {
  if (env.embedded) return { supported: false, reason: 'Embedded preview hosts are not used for real Node.js runtime.' };
  if (env.protocol === 'file:') return { supported: false, reason: 'Real Node.js preview cannot boot from file://; use localhost or HTTPS.' };
  if (!env.secure && env.hostname !== 'localhost' && env.hostname !== '127.0.0.1') return { supported: false, reason: 'WebContainer requires HTTPS or localhost.' };
  if (!env.webAssembly || !env.worker || !env.readableStream || !env.writableStream) return { supported: false, reason: 'This browser is missing a required WebContainer capability.' };
  return { supported: true, reason: '' };
}

export function currentWebContainerEnvironment() {
  let embedded = true;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  return {
    embedded,
    protocol: location.protocol,
    hostname: location.hostname,
    secure: window.isSecureContext,
    webAssembly: 'WebAssembly' in window,
    worker: 'Worker' in window,
    readableStream: 'ReadableStream' in window,
    writableStream: 'WritableStream' in window
  };
}

export function selectPreviewRoute(files = state.files, projectType = state.projectType, env = null) {
  const keys = Object.keys(files || {});
  const entry = chooseVisualEntry(keys);
  const compiledEntry = keys.find((path) => /(^|\/)(?:dist|build|out)\/index\.html?$/i.test(path)) || null;
  if (compiledEntry) return { mode: 'static-compiled', entry: compiledEntry, runnable: true, reason: 'Using existing compiled output.' };

  const direct = directFileRoute(files, keys);
  if (direct) return direct;

  if (projectType === 'backend-service') return { mode: 'analysis-only', entry: null, runnable: false, reason: 'Backend-only project has no browser page to preview. Multi-file backend projects remain analysis-only.' };
  if (projectType === 'electron') {
    if (entry) return { mode: 'electron-renderer-static', entry, runnable: true, reason: 'Previewing browser-compatible renderer content only.' };
    return { mode: 'analysis-only', entry: null, runnable: false, reason: 'Electron main/preload code cannot run as a normal browser page.' };
  }

  const pkg = readPackageJson(files);
  if (['react-vite', 'nextjs', 'node-service'].includes(projectType) && runnablePackage(pkg)) {
    const environment = evaluateWebContainerEnvironment(env || currentWebContainerEnvironment());
    if (environment.supported) return { mode: 'webcontainer', entry: entry || 'package.json', runnable: true, reason: 'Project has a runnable package and the host supports WebContainer.' };
    if (projectType === 'node-service' && entry) return { mode: 'static-fallback', entry, runnable: true, reason: `Backend runtime is unavailable; previewing only the browser-compatible HTML entry. ${environment.reason}` };
    return { mode: 'analysis-only', entry: null, runnable: false, reason: `${environment.reason} Uncompiled ${projectType === 'nextjs' ? 'Next.js' : 'React/Vite'} source is not shown as a fake static preview; add compiled output or use a supported real runtime.` };
  }

  if (entry) return { mode: 'static', entry, runnable: true, reason: 'Using detected HTML entry.' };
  return { mode: 'analysis-only', entry: null, runnable: false, reason: 'No browser-renderable entry was found.' };
}
