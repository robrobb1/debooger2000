function dirname(path) {
  const parts = String(path || '').split('/');
  parts.pop();
  return parts.join('/');
}

export function resolveProjectPath(fromPath, request) {
  const raw = String(request || '').trim();
  if (!raw || /^(?:[a-z]+:|#|\/\/)/i.test(raw)) return null;
  const base = raw.startsWith('/') ? [] : dirname(fromPath).split('/').filter(Boolean);
  for (const part of raw.replace(/^\//, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

function mimeFor(path) {
  const lower = path.toLowerCase();
  if (/\.html?$/.test(lower)) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(lower)) return 'text/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/.test(lower)) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
}

function bytesToBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size));
  return btoa(binary);
}

function asDataUrl(path, file, contentOverride = null) {
  const mime = mimeFor(path);
  if (file?.binary && contentOverride == null) {
    return `data:${mime};base64,${String(file.content || '')}`;
  }
  const text = String(contentOverride ?? file?.content ?? '');
  return `data:${mime};charset=utf-8;base64,${bytesToBase64(new TextEncoder().encode(text))}`;
}

function rewriteCss(css, path, files, materialize) {
  let next = String(css).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, quote, request) => {
    const target = resolveProjectPath(path, request);
    if (!target || !files[target]) return match;
    return `url("${materialize(target)}")`;
  });
  next = next.replace(/(@import\s+)(['"])([^'"]+)\2/gi, (match, prefix, quote, request) => {
    const target = resolveProjectPath(path, request);
    return target && files[target] ? `${prefix}${quote}${materialize(target)}${quote}` : match;
  });
  return next;
}

function rewriteJavaScript(code, path, files, materialize) {
  const replaceRequest = (request) => {
    const target = resolveProjectPath(path, request);
    return target && files[target] ? materialize(target) : request;
  };
  let next = String(code);
  next = next.replace(/(\bfrom\s*['"])([^'"]+)(['"])/g, (m, a, req, b) => `${a}${replaceRequest(req)}${b}`);
  next = next.replace(/(\bimport\s*['"])([^'"]+)(['"])/g, (m, a, req, b) => `${a}${replaceRequest(req)}${b}`);
  next = next.replace(/(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, (m, a, req, b) => `${a}${replaceRequest(req)}${b}`);
  return next;
}

function rewriteHtml(html, path, files, materialize) {
  let next = String(html);
  next = next.replace(/\b(src|href)\s*=\s*(['"])([^'"]+)\2/gi, (match, attr, quote, request) => {
    const target = resolveProjectPath(path, request);
    return target && files[target] ? `${attr}=${quote}${materialize(target)}${quote}` : match;
  });
  next = next.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, open, css, close) => `${open}${rewriteCss(css, path, files, materialize)}${close}`);
  next = next.replace(/\bstyle\s*=\s*(['"])([\s\S]*?)\1/gi, (match, quote, css) => `style=${quote}${rewriteCss(css, path, files, materialize)}${quote}`);
  return next;
}

export function createMaterializer(files) {
  const cache = new Map();
  const working = new Set();
  const materialize = (path) => {
    if (cache.has(path)) return cache.get(path);
    const file = files[path];
    if (!file) return path;
    if (working.has(path)) return asDataUrl(path, file);
    working.add(path);
    let value;
    if (file.binary) value = asDataUrl(path, file);
    else if (/\.html?$/i.test(path)) value = asDataUrl(path, file, rewriteHtml(file.content, path, files, materialize));
    else if (path.toLowerCase().endsWith('.css')) value = asDataUrl(path, file, rewriteCss(file.content, path, files, materialize));
    else if (/\.(?:js|mjs|cjs)$/i.test(path)) value = asDataUrl(path, file, rewriteJavaScript(file.content, path, files, materialize));
    else value = asDataUrl(path, file);
    working.delete(path);
    cache.set(path, value);
    return value;
  };
  return materialize;
}

function bridgeScript() {
  return `<script>(function(){
    const send=(payload)=>parent.postMessage(Object.assign({type:'DEBOOGER_VIEWER_BRIDGE'},payload),'*');
    const active=new Map(); let drag=false; let last=null; let pinchDistance=0; let capturePromise=null;
    addEventListener('error',e=>send({event:'runtime-error',message:String(e.message||'Runtime error'),source:String(e.filename||'preview'),line:Number(e.lineno||0)}));
    addEventListener('unhandledrejection',e=>send({event:'runtime-error',message:String(e.reason&&e.reason.message||e.reason||'Unhandled promise rejection'),source:'promise',line:0}));
    addEventListener('pointerdown',e=>{ active.set(e.pointerId,{x:e.clientX,y:e.clientY}); last={x:e.clientX,y:e.clientY}; pinchDistance=0; });
    addEventListener('pointermove',e=>{
      if(!active.has(e.pointerId)) return;
      active.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const pts=[...active.values()];
      if(pts.length>=2){ e.preventDefault(); const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y); if(pinchDistance) send({event:'pinch',factor:d/pinchDistance}); pinchDistance=d; drag=true; return; }
      if(!last) return; const dx=e.clientX-last.x,dy=e.clientY-last.y; if(drag||Math.hypot(dx,dy)>5){ drag=true; e.preventDefault(); send({event:'drag',dx,dy}); last={x:e.clientX,y:e.clientY}; }
    },{passive:false});
    const end=e=>{ active.delete(e.pointerId); if(active.size<2) pinchDistance=0; if(active.size===1){const p=[...active.values()][0];last={x:p.x,y:p.y};drag=false;} else if(!active.size){drag=false;last=null;} };
    addEventListener('pointerup',end); addEventListener('pointercancel',end);
    const loadCapture=()=>{ if(typeof html2canvas==='function') return Promise.resolve(); if(capturePromise) return capturePromise; capturePromise=new Promise((resolve,reject)=>{ const script=document.createElement('script'); const timer=setTimeout(()=>reject(new Error('Snapshot library timed out')),15000); script.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; script.onload=()=>{clearTimeout(timer);typeof html2canvas==='function'?resolve():reject(new Error('Snapshot library did not initialize'));}; script.onerror=()=>{clearTimeout(timer);reject(new Error('Snapshot library could not load'));}; document.head.appendChild(script); }).finally(()=>{capturePromise=null;}); return capturePromise; };
    addEventListener('message',e=>{ if(e.data&&e.data.type==='DEBOOGER_CAPTURE'){ loadCapture().then(()=>html2canvas(document.documentElement,{backgroundColor:null,useCORS:true,logging:false,scale:Math.min(2,1600/Math.max(document.documentElement.scrollWidth,1))})).then(c=>send({event:'snapshot',dataUrl:c.toDataURL('image/jpeg',.92)})).catch(err=>send({event:'snapshot-error',message:String(err&&err.message||err)})); }});
  })();<\/script>`;
}

function injectBridge(html) {
  const injected = bridgeScript();
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>${injected}`);
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/(<!doctype[^>]*>)/i, `$1${injected}`);
  return injected + html;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function sourceText(path, file) {
  const raw = String(file?.content ?? '');
  if (/\.json$/i.test(path)) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch {}
  }
  return raw;
}

function buildSourcePreview(path, file) {
  const content = escapeHtml(sourceText(path, file));
  const title = escapeHtml(path);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#f6f7f6;color:#202529;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.file-head{position:sticky;top:0;z-index:1;padding:10px 14px;border-bottom:1px solid #d9ded9;background:rgba(255,255,255,.96);font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#5e6861}.source{margin:0;padding:18px;min-width:max-content;white-space:pre;tab-size:2}
  </style></head><body><div class="file-head">${title}</div><pre class="source">${content}</pre></body></html>`;
}

function buildImagePreview(files, path) {
  const title = escapeHtml(path);
  const url = createMaterializer(files)(path);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#202528}.file-head{position:fixed;top:0;left:0;right:0;z-index:1;padding:9px 12px;background:rgba(248,250,248,.94);border-bottom:1px solid #d7ddd8;color:#505b54;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.image-wrap{width:100%;min-height:100%;display:grid;place-items:center;padding:52px 22px 22px}.image-wrap img{display:block;max-width:100%;height:auto;object-fit:contain;background:transparent}
  </style></head><body><div class="file-head">${title}</div><div class="image-wrap"><img src="${url}" alt="${title}"></div></body></html>`;
}

export function buildPortableHtmlDocument(files, entryPath) {
  const entry = files?.[entryPath];
  if (!entry || entry.binary) throw new Error('The selected preview entry is not readable HTML.');
  const materialize = createMaterializer(files);
  return rewriteHtml(entry.content, entryPath, files, materialize);
}

export function buildStaticPreviewDocument(files, entryPath) {
  const entry = files?.[entryPath];
  if (!entry) throw new Error('The selected preview file is missing.');
  if (/\.html?$/i.test(entryPath)) return injectBridge(buildPortableHtmlDocument(files, entryPath));
  if (/\.(?:svg|png|jpe?g|gif|webp|ico)$/i.test(entryPath)) return injectBridge(buildImagePreview(files, entryPath));
  if (!entry.binary) return injectBridge(buildSourcePreview(entryPath, entry));
  throw new Error('This binary file type does not have a safe browser preview in DEBOOGER yet.');
}
