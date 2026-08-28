import { decodeBase64ToUint8Array, normalizeVirtualPath } from './file-utils.js';
import { evaluateWebContainerEnvironment } from './runtime-router.js';
import { readPackageJson } from './package-utils.js';

const API_URL = 'https://unpkg.com/@webcontainer/api@1.2.4/dist/index.js';

export function createMountTree(files) {
  const tree = {};
  const ignored = /(^|\/)(?:node_modules|\.git|\.next|\.cache|coverage)(?:\/|$)/i;
  for (const [rawPath, file] of Object.entries(files || {})) {
    const path = normalizeVirtualPath(rawPath);
    if (!path || ignored.test(path)) continue;
    const parts = path.split('/');
    let cursor = tree;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!cursor[part]) cursor[part] = { directory: {} };
      if (!cursor[part].directory) throw new Error(`Path collision while mounting ${path}.`);
      cursor = cursor[part].directory;
    }
    cursor[parts.at(-1)] = { file: { contents: file?.binary ? decodeBase64ToUint8Array(file.content) : String(file?.content ?? '') } };
  }
  return tree;
}

export function chooseStartSpec(pkg) {
  const scripts = pkg?.scripts || {};
  if (scripts.dev) return { command: 'npm', args: ['run', 'dev'], label: 'npm run dev' };
  if (scripts.start) return { command: 'npm', args: ['run', 'start'], label: 'npm run start' };
  if (scripts.serve) return { command: 'npm', args: ['run', 'serve'], label: 'npm run serve' };
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.vite) return { command: 'npx', args: ['vite'], label: 'Vite' };
  if (deps.next) return { command: 'npx', args: ['next', 'dev'], label: 'Next.js' };
  throw new Error('No runnable dev/start/serve script was found in package.json.');
}

function timeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export class WebContainerEngine {
  constructor(onRuntimeError = () => undefined) {
    this.container = null;
    this.process = null;
    this.onRuntimeError = onRuntimeError;
    this.unsubscribers = [];
  }

  async dispose() {
    for (const unsubscribe of this.unsubscribers.splice(0)) { try { unsubscribe?.(); } catch {} }
    if (this.process) { try { this.process.kill(); } catch {} this.process = null; }
    if (this.container) { try { this.container.teardown(); } catch {} this.container = null; }
  }

  async run(files, env) {
    const support = evaluateWebContainerEnvironment(env);
    if (!support.supported) throw new Error(support.reason);
    const pkg = readPackageJson(files);
    if (!pkg) throw new Error('package.json could not be parsed.');
    await this.dispose();
    const mod = await timeout(import(API_URL), 30000, 'WebContainer API load');
    if (!mod?.WebContainer?.boot) throw new Error('WebContainer API did not expose WebContainer.boot().');
    this.container = await timeout(mod.WebContainer.boot({ forwardPreviewErrors: true, coep: window.crossOriginIsolated ? 'require-corp' : 'none' }), 30000, 'WebContainer boot');
    this.unsubscribers.push(this.container.on('error', (error) => this.onRuntimeError(String(error?.message || error || 'WebContainer error'))));
    await this.container.mount(createMountTree(files));
    const install = await this.container.spawn('npm', ['install', '--no-audit', '--no-fund']);
    if (await install.exit !== 0) throw new Error('npm install failed inside WebContainer.');
    const spec = chooseStartSpec(pkg);
    let unsubscribeReady = null;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${spec.label} did not become ready within 120 seconds.`)), 120000);
      unsubscribeReady = this.container.on('server-ready', (port, url) => { clearTimeout(timer); if (url) resolve({ port, url: String(url) }); else reject(new Error(`Server opened port ${port} without a preview URL.`)); });
    });
    this.process = await this.container.spawn(spec.command, spec.args);
    this.process.exit.then((code) => { if (code !== 0) this.onRuntimeError(`${spec.label} exited with code ${code}.`); }).catch(() => undefined);
    const result = await ready;
    try { unsubscribeReady?.(); } catch {}
    return result;
  }
}
