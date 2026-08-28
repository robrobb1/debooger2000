function lineAt(text, index) {
  return String(text).slice(0, Math.max(0, index)).split('\n').length;
}

function finding({ severity = 'warning', confidence = 'probable', file = '', line = 0, code = '', title = '', explanation = '', evidence = '' }) {
  return { severity, confidence, file, line, code, title, explanation, evidence };
}

function relativeRequest(value) {
  const v = String(value || '').trim();
  return v && !/^(?:[a-z]+:|#|\/\/|data:|blob:)/i.test(v);
}

function resolvePath(fromPath, request) {
  const base = String(fromPath).split('/');
  base.pop();
  const parts = String(request).replace(/^\//, '').split('/');
  if (String(request).startsWith('/')) base.length = 0;
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

function stripCssComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectHtmlIds(files) {
  const ids = new Set();
  for (const [path, file] of Object.entries(files || {})) {
    if (file?.binary || !/\.html?$/i.test(path)) continue;
    const text = String(file?.content ?? '');
    const regex = /<[^>]+\bid\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
    let match;
    while ((match = regex.exec(text))) ids.add(match[2]);
  }
  return ids;
}

function collectNamedFunctions(files) {
  const names = new Set();
  for (const [path, file] of Object.entries(files || {})) {
    if (file?.binary || !/\.(?:html?|js|mjs|cjs|jsx|ts|tsx)$/i.test(path)) continue;
    const text = String(file?.content ?? '');
    const regex = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = regex.exec(text))) names.add(match[1]);
  }
  return names;
}

function auditHtml(path, text, files, out, namedFunctions) {
  const idMap = new Map();
  const labelTargets = new Set();
  const idRegex = /<[^>]+\bid\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let match;

  while ((match = idRegex.exec(text))) {
    const id = match[2];
    const line = lineAt(text, match.index);
    if (idMap.has(id)) {
      out.push(finding({
        severity: 'error', confidence: 'confirmed', file: path, line,
        code: 'HTML_DUPLICATE_ID', title: `Duplicate id "${id}"`,
        explanation: 'HTML ids must be unique in one document.',
        evidence: `The id first appears on line ${idMap.get(id)} and appears again on line ${line}.`
      }));
    } else idMap.set(id, line);
  }

  const forRegex = /<label[^>]+\bfor\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  while ((match = forRegex.exec(text))) {
    labelTargets.add(match[2]);
    if (!idMap.has(match[2])) {
      out.push(finding({
        severity: 'error', confidence: 'confirmed', file: path, line: lineAt(text, match.index),
        code: 'HTML_BROKEN_LABEL', title: `Label target "${match[2]}" is missing`,
        explanation: 'The label references an id that is not present in this HTML file.',
        evidence: `for="${match[2]}" has no matching id.`
      }));
    }
  }

  const refRegex = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi;
  while ((match = refRegex.exec(text))) {
    const request = match[2];
    if (!relativeRequest(request)) continue;
    const clean = request.split(/[?#]/)[0];
    const resolved = resolvePath(path, clean);
    if (clean && !files[resolved] && !/^(?:mailto:|tel:|javascript:)/i.test(request)) {
      out.push(finding({
        severity: 'error', confidence: 'confirmed', file: path, line: lineAt(text, match.index),
        code: 'HTML_MISSING_ASSET', title: `Missing referenced file: ${clean}`,
        explanation: 'A relative HTML resource points to a file that is not in the loaded project.',
        evidence: `Resolved path: ${resolved}`
      }));
    }
  }

  const inline = /\sstyle\s*=\s*(["'])/gi;
  while ((match = inline.exec(text))) {
    out.push(finding({
      severity: 'warning', confidence: 'confirmed', file: path, line: lineAt(text, match.index),
      code: 'HTML_INLINE_STYLE', title: 'Inline style found',
      explanation: 'Inline styles can override the main stylesheet and make stale visual rules harder to control.',
      evidence: 'style attribute on an HTML element.'
    }));
  }

  const scripts = new Map();
  const scriptRegex = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  while ((match = scriptRegex.exec(text))) {
    const src = match[2].split(/[?#]/)[0];
    if (!src) continue;
    const line = lineAt(text, match.index);
    if (scripts.has(src)) {
      out.push(finding({
        severity: 'warning', confidence: 'confirmed', file: path, line,
        code: 'HTML_DUPLICATE_SCRIPT', title: `Script loaded more than once: ${src}`,
        explanation: 'Loading the same script twice can duplicate initialization and event handlers.',
        evidence: `The same script src first appears near line ${scripts.get(src)}.`
      }));
    } else scripts.set(src, line);
  }

  const imgRegex = /<img\b[^>]*>/gi;
  while ((match = imgRegex.exec(text))) {
    if (!/\balt\s*=\s*(["'])[^"']*\1/i.test(match[0])) {
      out.push(finding({
        severity: 'warning', confidence: 'confirmed', file: path, line: lineAt(text, match.index),
        code: 'A11Y_IMG_ALT', title: 'Image is missing alt text',
        explanation: 'Images need an alt attribute so assistive technology can identify or intentionally ignore them.',
        evidence: match[0].slice(0, 180)
      }));
    }
  }

  const controlRegex = /<(input|select|textarea)\b[^>]*>/gi;
  while ((match = controlRegex.exec(text))) {
    const tag = match[0];
    if (/\btype\s*=\s*(["'])hidden\1/i.test(tag)) continue;
    const idMatch = tag.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
    const id = idMatch?.[2] || '';
    const hasAccessibleName = /\baria-label\s*=|\baria-labelledby\s*=/i.test(tag) || (id && labelTargets.has(id));
    if (!hasAccessibleName) {
      out.push(finding({
        severity: 'warning', confidence: 'probable', file: path, line: lineAt(text, match.index),
        code: 'A11Y_UNLABELED_CONTROL', title: `${match[1].toLowerCase()} may be missing an accessible label`,
        explanation: 'No explicit label relationship or ARIA accessible name was found for this form control.',
        evidence: tag.slice(0, 180)
      }));
    }
  }

  const handlerRegex = /\bon(?:click|change|submit|input|keydown|keyup|touchstart|touchend)\s*=\s*(["'])\s*([A-Za-z_$][\w$]*)\s*\(/gi;
  while ((match = handlerRegex.exec(text))) {
    const name = match[2];
    if (!namedFunctions.has(name)) {
      out.push(finding({
        severity: 'warning', confidence: 'probable', file: path, line: lineAt(text, match.index),
        code: 'HTML_HANDLER_UNRESOLVED', title: `Inline handler may reference missing function: ${name}`,
        explanation: 'A literal inline event handler calls a function name that was not found in the loaded HTML/JavaScript source.',
        evidence: `${name}(...)`
      }));
    }
  }

  const hiddenLegacyRegex = /<[^>]+(?:id|class)\s*=\s*(["'])[^"']*\b(?:legacy|deprecated|backup|old-layout|old-design)\b[^"']*\1[^>]*(?:\bhidden\b|style\s*=\s*(["'])[^"']*display\s*:\s*none[^"']*\2)[^>]*>/gi;
  while ((match = hiddenLegacyRegex.exec(text))) {
    out.push(finding({
      severity: 'warning', confidence: 'probable', file: path, line: lineAt(text, match.index),
      code: 'HTML_HIDDEN_LEGACY', title: 'Hidden legacy-looking layout found',
      explanation: 'Hidden markup explicitly named as legacy/old/backup can preserve stale UI and should be reviewed before production.',
      evidence: match[0].slice(0, 180)
    }));
  }
}

function auditCss(path, text, out) {
  const clean = stripCssComments(text);
  const selectorLines = new Map();
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = block.exec(clean))) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    const line = lineAt(clean, match.index);
    if (selectorLines.has(selector)) {
      out.push(finding({
        severity: 'warning', confidence: 'probable', file: path, line,
        code: 'CSS_DUPLICATE_SELECTOR', title: `Repeated CSS selector: ${selector}`,
        explanation: 'Repeated selectors may be intentional cascade, but they can also be stale overrides.',
        evidence: `Same selector was seen near line ${selectorLines.get(selector)}.`
      }));
    } else selectorLines.set(selector, line);

    const properties = new Map();
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon <= 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (!property || property.startsWith('--')) continue;
      if (properties.has(property)) {
        out.push(finding({
          severity: 'warning', confidence: 'probable', file: path, line,
          code: 'CSS_DUPLICATE_PROPERTY', title: `Repeated CSS property: ${property}`,
          explanation: 'The same property appears more than once in one rule. This can be an intentional fallback, so it is reported as probable.',
          evidence: `Selector: ${selector}`
        }));
      } else properties.set(property, true);
    }
  }

  const important = /!important\b/g;
  while ((match = important.exec(clean))) {
    out.push(finding({
      severity: 'warning', confidence: 'confirmed', file: path, line: lineAt(clean, match.index),
      code: 'CSS_IMPORTANT', title: '!important found',
      explanation: 'This can hide selector conflicts and makes authoritative styling harder to maintain.',
      evidence: '!important declaration.'
    }));
  }
}

function auditJson(path, text, out) {
  try { JSON.parse(text); }
  catch (error) {
    out.push(finding({
      severity: 'error', confidence: 'confirmed', file: path, line: 1,
      code: 'JSON_PARSE', title: 'Invalid JSON',
      explanation: 'The file cannot be parsed as JSON.',
      evidence: String(error?.message || error)
    }));
  }
}

function auditJavaScript(path, text, out, htmlIds) {
  let match;
  const plain = !/^\s*(?:import|export)\b/m.test(text) && !/\.(?:jsx|tsx|ts)$/i.test(path);
  if (plain) {
    try { new Function(text); }
    catch (error) {
      out.push(finding({
        severity: 'error', confidence: 'confirmed', file: path, line: 0,
        code: 'JS_SYNTAX', title: 'JavaScript syntax error',
        explanation: 'The browser JavaScript parser rejected this file.',
        evidence: String(error?.message || error)
      }));
    }
  }

  const functions = new Map();
  const fn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((match = fn.exec(text))) {
    const name = match[1];
    const line = lineAt(text, match.index);
    if (functions.has(name)) {
      out.push(finding({
        severity: 'warning', confidence: 'probable', file: path, line,
        code: 'JS_DUPLICATE_FUNCTION', title: `Repeated function declaration: ${name}`,
        explanation: 'Repeated function names can replace an earlier implementation in the same scope.',
        evidence: `Another declaration appears near line ${functions.get(name)}.`
      }));
    } else functions.set(name, line);
  }

  const listenerSeen = new Map();
  const listenerRegex = /([A-Za-z_$][\w$]*)\.addEventListener\(\s*(["'])([^"']+)\2\s*,\s*([A-Za-z_$][\w$]*)/g;
  while ((match = listenerRegex.exec(text))) {
    const key = `${match[1]}|${match[3]}|${match[4]}`;
    const line = lineAt(text, match.index);
    if (listenerSeen.has(key)) {
      out.push(finding({
        severity: 'warning', confidence: 'probable', file: path, line,
        code: 'JS_DUPLICATE_LISTENER', title: `Repeated event listener: ${match[3]}`,
        explanation: 'The same target identifier, event type, and named handler are registered more than once in this file.',
        evidence: `First matching registration appears near line ${listenerSeen.get(key)}.`
      }));
    } else listenerSeen.set(key, line);
  }

  if (htmlIds.size) {
    const idRefRegex = /(?:getElementById|\bbyId)\(\s*(["'])([^"']+)\1\s*\)/g;
    while ((match = idRefRegex.exec(text))) {
      if (!htmlIds.has(match[2])) {
        out.push(finding({
          severity: 'warning', confidence: 'probable', file: path, line: lineAt(text, match.index),
          code: 'JS_MISSING_DOM_TARGET', title: `DOM id reference may be missing: ${match[2]}`,
          explanation: 'A literal DOM id lookup was found, but no matching id exists in the loaded HTML files. Dynamically created markup can make this intentional.',
          evidence: `${match[0]}`
        }));
      }
    }
    const selectorRefRegex = /querySelector\(\s*(["'])#([^"']+)\1\s*\)/g;
    while ((match = selectorRefRegex.exec(text))) {
      if (!htmlIds.has(match[2])) {
        out.push(finding({
          severity: 'warning', confidence: 'probable', file: path, line: lineAt(text, match.index),
          code: 'JS_MISSING_SELECTOR_TARGET', title: `#${match[2]} selector may have no target`,
          explanation: 'A literal id selector was found in JavaScript, but the id is absent from the loaded HTML files.',
          evidence: match[0]
        }));
      }
    }
  }

  const forbidden = [
    [/\bdebugger\s*;/g, 'JS_DEBUGGER', 'Debugger statement left in source'],
    [/\bconsole\.log\s*\(/g, 'JS_CONSOLE_LOG', 'Console logging left in source'],
    [/\b(?:alert|prompt|confirm)\s*\(/g, 'JS_BROWSER_DIALOG', 'Blocking browser dialog found']
  ];
  for (const [regex, code, title] of forbidden) {
    while ((match = regex.exec(text))) {
      out.push(finding({
        severity: 'warning', confidence: 'confirmed', file: path, line: lineAt(text, match.index), code, title,
        explanation: 'Production code should use non-blocking UI/status handling instead.',
        evidence: match[0]
      }));
    }
  }
}

function auditFramework(files, projectType, out) {
  const keys = Object.keys(files || {});
  const packagePath = keys.find((path) => /(^|\/)package\.json$/i.test(path));
  if (['react-vite', 'nextjs', 'node-service', 'electron'].includes(projectType) && !packagePath) {
    out.push(finding({
      severity: 'error', confidence: 'confirmed', file: '', line: 0,
      code: 'PROJECT_PACKAGE_MISSING', title: 'package.json is missing',
      explanation: 'The detected framework/runtime project needs package.json to install and start dependencies.',
      evidence: `Detected project type: ${projectType}`
    }));
  }
  if (projectType === 'react-vite' && !keys.some((path) => /(^|\/)index\.html?$/i.test(path)) && !keys.some((path) => /(^|\/)(?:dist|build)\/index\.html?$/i.test(path))) {
    out.push(finding({
      severity: 'warning', confidence: 'probable', file: '', line: 0,
      code: 'VITE_ENTRY_MISSING', title: 'No HTML entry detected for React/Vite',
      explanation: 'Vite normally uses an index.html entry. A custom setup is possible, so this is a warning.',
      evidence: 'No index.html or compiled dist/build index was found.'
    }));
  }
}

export function runProjectAudit(files, { projectType = 'unknown', runtimeErrors = [] } = {}) {
  const out = [];
  const htmlIds = collectHtmlIds(files);
  const namedFunctions = collectNamedFunctions(files);
  for (const [path, file] of Object.entries(files || {})) {
    if (file?.binary) continue;
    const text = String(file?.content ?? '');
    if (/\.html?$/i.test(path)) auditHtml(path, text, files, out, namedFunctions);
    else if (/\.css$/i.test(path)) auditCss(path, text, out);
    else if (/\.json$/i.test(path)) auditJson(path, text, out);
    else if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(path)) auditJavaScript(path, text, out, htmlIds);
  }
  auditFramework(files, projectType, out);
  for (const item of runtimeErrors || []) {
    out.push(finding({
      severity: 'error', confidence: 'confirmed', file: String(item.file || 'runtime'), line: Number(item.line || 0),
      code: 'RUNTIME_ERROR', title: 'Runtime error',
      explanation: String(item.message || 'Runtime failure'),
      evidence: String(item.message || 'Runtime failure')
    }));
  }
  const weight = { critical: 4, error: 3, warning: 2, info: 1 };
  out.sort((a, b) => (weight[b.severity] || 0) - (weight[a.severity] || 0) || a.file.localeCompare(b.file) || a.line - b.line);
  return out;
}

export function auditScore(findings) {
  const penalty = (findings || []).reduce((sum, item) => sum + (item.severity === 'critical' ? 25 : item.severity === 'error' ? 12 : item.severity === 'warning' ? 3 : 0), 0);
  return Math.max(0, 100 - penalty);
}

export function buildRepairPrompt(findings) {
  const actual = (findings || []).filter((item) => item.severity !== 'info');
  const lines = ['Repair only the verified issues below. Preserve unrelated working code, design, behavior, data flow, and permissions. Fix the authoritative implementation at the source; do not add patch layers, duplicate handlers, duplicate CSS, hidden replacement layouts, or fake success behavior.'];
  if (!actual.length) return `${lines[0]}\n\nNo audit findings are currently present.`;
  for (const severity of ['critical', 'error', 'warning']) {
    const group = actual.filter((item) => item.severity === severity);
    if (!group.length) continue;
    lines.push(`\n${severity.toUpperCase()}:`);
    for (const item of group) lines.push(`- ${item.file || 'project'}${item.line ? `:${item.line}` : ''} [${item.confidence}] ${item.title}. ${item.explanation} Evidence: ${item.evidence}`);
  }
  return lines.join('\n');
}

export function buildAuditReport(findings) {
  const rows = ['DEBOOGER2000 AUDIT REPORT', `Findings: ${(findings || []).length}`, `Score: ${auditScore(findings)}`, ''];
  for (const item of findings || []) rows.push(`${item.severity.toUpperCase()} | ${item.confidence.toUpperCase()} | ${item.file || 'project'}${item.line ? `:${item.line}` : ''} | ${item.title}\n${item.explanation}\nEvidence: ${item.evidence}\n`);
  return rows.join('\n');
}
