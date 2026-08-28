const TYPE_TABLE = Object.freeze({
  html: { extension: '.html', mime: 'text/html', label: 'HTML' },
  css: { extension: '.css', mime: 'text/css', label: 'CSS' },
  javascript: { extension: '.js', mime: 'text/javascript', label: 'JavaScript' },
  jsx: { extension: '.jsx', mime: 'text/jsx', label: 'JSX' },
  typescript: { extension: '.ts', mime: 'text/typescript', label: 'TypeScript' },
  tsx: { extension: '.tsx', mime: 'text/tsx', label: 'TSX' },
  json: { extension: '.json', mime: 'application/json', label: 'JSON' },
  text: { extension: '.txt', mime: 'text/plain', label: 'Text' }
});
function result(id, confidence = 'high') { return { id, confidence, ...TYPE_TABLE[id] }; }
function looksLikeDocumentHtml(text) { return /<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text) || /<(?:head|body)[\s>]/i.test(text); }
function looksLikeHtmlFragment(text) { return /<(?:main|section|div|form|button|input|script|style|p|span|article|nav|header|footer)[\s>]/i.test(text) && /<\/[a-z][^>]*>/i.test(text); }
function looksLikeCss(text) { return /(?:^|[}\s])(?:@media|@supports|@font-face|:root|[.#]?[a-z][\w-]*(?:\s+[.#]?[a-z][\w-]*)*)\s*\{[^{}]*[\w-]+\s*:\s*[^;{}]+;?/ims.test(text) && !/\b(?:function|const|let|var|import|export)\b/.test(text); }
function hasJsx(text) { return /<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9-]*)(?:\s[^<>]*?)?>[\s\S]*?<\/\1>|<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9-]*)\b[^>]*\/>/m.test(text); }
function hasTypeSyntax(text) { return /\b(?:interface|type|enum|namespace)\s+[A-Za-z_$][\w$]*\b|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$<>,\[\]| &.?]*|\([^)]*\b[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$<>,\[\]| &.?]*[^)]*\)\s*(?:=>|\{)/m.test(text); }
function looksLikeJavaScript(text) { return /\b(?:function|const|let|var|class|import|export|async|await|document|window)\b|=>|\bnew\s+[A-Z_$]/m.test(text); }
export function detectPastedType(value) { const text=String(value??'').trim(); if(!text)return result('text','low'); if(looksLikeDocumentHtml(text))return result('html'); if(/^[\[{]/.test(text)){try{JSON.parse(text);return result('json');}catch{}} const jsx=hasJsx(text),typed=hasTypeSyntax(text); if(jsx&&typed)return result('tsx'); if(jsx&&looksLikeJavaScript(text))return result('jsx'); if(typed)return result('typescript'); if(looksLikeHtmlFragment(text))return result('html'); if(looksLikeCss(text))return result('css'); if(looksLikeJavaScript(text))return result('javascript'); return result('text','low'); }
export function filenameForPasted(type,base='pasted-code'){return`${base}${type?.extension||'.txt'}`;}
export function createDownloadBlob(content,type){return new Blob([String(content??'')],{type:type?.mime||'text/plain'});}
function escapeHtml(value){return String(value).replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));}
export function buildPastedPreviewDocument(content,type){const text=String(content??'');if(type?.id==='html')return text;const label=escapeHtml(type?.label||'Text');return`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#f7f8f7;color:#20262a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}header{position:sticky;top:0;padding:10px 14px;border-bottom:1px solid #dce2dc;background:#fff;font:12px system-ui;color:#657068}pre{margin:0;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;font-size:13px;line-height:1.5}</style></head><body><header>${label} source preview</header><pre>${escapeHtml(text)}</pre></body></html>`;}
export function appendClipboardText(textarea,pastedText){const incoming=String(pastedText??'').replace(/^\n+/,'');const start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??start;if(start!==end)textarea.setRangeText(incoming,start,end,'end');else{const current=textarea.value,join=current&&!current.endsWith('\n')?'\n':'';textarea.value=`${current}${join}${incoming}`;}if(textarea.value&&!textarea.value.endsWith('\n'))textarea.value+='\n';const endPosition=textarea.value.length;textarea.setSelectionRange(endPosition,endPosition);textarea.scrollTop=textarea.scrollHeight;textarea.focus();}
