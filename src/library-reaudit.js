import { auditScore, runProjectAudit } from './audit-engine.js';
import { listLibraryItems, saveLibraryItem } from './storage.js';

function auditStatus(findings) {
  return (findings || []).some((item) => item.severity === 'critical' || item.severity === 'error') ? 'issues' : 'clean';
}

export async function reauditLibraryItems(items, {
  audit = runProjectAudit,
  save = saveLibraryItem,
  onProgress = null,
  yieldEvery = 8
} = {}) {
  const source = Array.isArray(items) ? items : [];
  let processed = 0;
  for (const item of source) {
    const findings = audit(item?.files || Object.create(null), {
      projectType: String(item?.projectType || 'unknown'),
      runtimeErrors: []
    });
    const next = {
      ...item,
      auditFindings: findings,
      auditScore: auditScore(findings),
      auditStatus: auditStatus(findings)
    };
    await save(next);
    processed += 1;
    onProgress?.(processed, source.length, next);
    if (yieldEvery > 0 && processed < source.length && processed % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { processed, total: source.length };
}

function setStatus(message, isError = false, doc = globalThis.document) {
  const status = doc?.getElementById?.('status');
  if (!status) return;
  status.textContent = String(message || '');
  status.classList.toggle('error', Boolean(isError));
}

function refreshMainLibrary(doc = globalThis.document) {
  doc?.getElementById?.('library-search')?.dispatchEvent?.(new Event('input', { bubbles: true }));
}

export async function reauditLibrary(doc = globalThis.document) {
  const button = doc?.getElementById?.('reaudit-library');
  if (button) button.disabled = true;
  try {
    const items = await listLibraryItems();
    if (!items.length) {
      setStatus('There are no saved library items to re-audit.', false, doc);
      return { processed: 0, total: 0 };
    }
    setStatus(`Re-auditing 0 of ${items.length}…`, false, doc);
    const result = await reauditLibraryItems(items, {
      onProgress: (done, total) => setStatus(`Re-auditing ${done} of ${total}…`, false, doc)
    });
    refreshMainLibrary(doc);
    setStatus(`Re-audited ${result.processed} saved item${result.processed === 1 ? '' : 's'}.`, false, doc);
    return result;
  } catch (error) {
    setStatus(error?.message || 'The saved library could not be re-audited.', true, doc);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

export function registerLibraryReaudit(doc = globalThis.document) {
  const button = doc?.getElementById?.('reaudit-library');
  if (!button) return false;
  button.addEventListener('click', () => { reauditLibrary(doc); });
  return true;
}

function start() { registerLibraryReaudit(); }
if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
