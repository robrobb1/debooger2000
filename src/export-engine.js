import { buildPortableHtmlDocument } from './preview-engine.js';
import { chooseVisualEntry } from './project-engine.js';
import { decodeBase64ToUint8Array } from './file-utils.js';
import { encodeStoredZip } from './zip-codec.js';

function safeName(value, fallback = 'project') {
  return (String(value || fallback).replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback).slice(0, 120);
}

function externalReferenceBlocker(files) {
  for (const [path, file] of Object.entries(files || {})) {
    if (file?.binary) continue;
    const text = String(file?.content || '');
    if (/\.html?$/i.test(path)) {
      const refs = [...text.matchAll(/\b(?:src|href)\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi)];
      if (refs.length) return `${path} uses external resource ${refs[0][2]}`;
    }
    if (/\.css$/i.test(path)) {
      const ref = text.match(/url\(\s*(["']?)(https?:\/\/[^)'"\s]+)\1\s*\)/i);
      if (ref) return `${path} uses external resource ${ref[2]}`;
    }
    if (/\.(?:js|mjs|cjs)$/i.test(path)) {
      const ref = text.match(/\b(?:from\s*|import\s*\(\s*)["'](https?:\/\/[^"']+|[A-Za-z@][^"'./][^"']*)["']/);
      if (ref) return `${path} contains a non-local module import (${ref[1]})`;
    }
  }
  return '';
}

export function standaloneHtmlPlan(files, projectType = 'unknown') {
  const keys = Object.keys(files || {});
  const compiled = keys.find((path) => /(^|\/)(?:dist|build|out)\/index\.html?$/i.test(path)) || null;
  const entry = compiled || chooseVisualEntry(keys);
  if (!entry) return { supported: false, entry: null, reason: 'No browser HTML entry is available to convert.' };
  if (['react-vite', 'nextjs'].includes(projectType) && !compiled) return { supported: false, entry: null, reason: 'Compile the framework project first; raw JSX/TSX source is not converted as if it were browser-ready JavaScript.' };
  const blocker = externalReferenceBlocker(files);
  if (blocker) return { supported: false, entry: null, reason: `A fully standalone HTML cannot be made without downloading an external dependency: ${blocker}.` };
  return { supported: true, entry, reason: compiled ? 'Using verified compiled output.' : 'Using the detected browser HTML entry.' };
}

export function buildStandaloneHtml(files, projectType = 'unknown') {
  const plan = standaloneHtmlPlan(files, projectType);
  if (!plan.supported) throw new Error(plan.reason);
  return buildPortableHtmlDocument(files, plan.entry);
}

export function standaloneHtmlFilename(projectName) { return `${safeName(projectName, 'project')}.html`; }
export function projectZipFilename(projectName) { return `${safeName(projectName, 'project')}.zip`; }

export async function createProjectZip(files) {
  const encoder = new TextEncoder();
  const entries = Object.entries(files || {}).map(([path, file]) => ({
    path,
    data: file?.binary ? decodeBase64ToUint8Array(file.content) : encoder.encode(String(file?.content ?? ''))
  }));
  if (!entries.length) throw new Error('No project files are loaded.');
  return new Blob([encodeStoredZip(entries)], { type: 'application/zip' });
}
