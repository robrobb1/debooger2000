import { decodeBase64ToUint8Array } from './file-utils.js';

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
  return String(css).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, quote, request) => {
    const target = resolveProjectPath(path, request);
    if (!target || !files[target]) return match;
    return `url("${materialize(target)}")`;
  });
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
    const active=new Map(); let drag=false; let last=null; let pinchDistance=0;
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
    const end=e=>{ active.delete(e.pointerId); if(active.size<2) pinchDistance=0; if(!active.size){drag=false;last=null;} };
    addEventListener('pointerup',end); addEventListener('pointercancel',end);
    addEventListener('message',e=>{ if(e.data&&e.data.type==='DEBOOGER_CAPTURE'){ if(typeof html2canvas!=='function'){send({event:'snapshot-error',message:'Snapshot library unavailable'});return;} html2canvas(document.documentElement,{backgroundColor:null,useCORS:true,logging:false,scale:Math.min(2,1600/Math.max(document.documentElement.scrollWidth,1))}).then(c=>send({event:'snapshot',dataUrl:c.toDataURL('image/jpeg',.92)})).catch(err=>send({event:'snapshot-error',message:String(err&&err.message||err)})); }});
  })();<\/script>`;
}

export function buildPortableHtmlDocument(files, entryPath) {
  const entry = files?.[entryPath];
  if (!entry || entry.binary) throw new Error('The selected preview entry is not readable HTML.');
  const materialize = createMaterializer(files);
  let html = String(entry.content || '');
  html = html.replace(/\b(src|href)\s*=\s*(['"])([^'"]+)\2/gi, (match, attr, quote, request) => {
    const target = resolveProjectPath(entryPath, request);
    if (!target || !files[target]) return match;
    return `${attr}=${quote}${materialize(target)}${quote}`;
  });
  return html;
}

export function buildStaticPreviewDocument(files, entryPath) {
  let html = buildPortableHtmlDocument(files, entryPath);
  const injected = `<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>${bridgeScript()}`;
  if (/<head[\s>]/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
  else html = injected + html;
  return html;
}

export function decodeVirtualBinary(file) {
  return decodeBase64ToUint8Array(file?.content || '');
}
