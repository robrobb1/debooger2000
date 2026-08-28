export class ViewerController {
  constructor(elements, callbacks = {}) {
    this.el = elements;
    this.callbacks = callbacks;
    this.view = { scale: 1, left: 0, top: 0, fit: 1 };
    this.userFullscreen = false;
    this.pointer = null;
    this.boundMessage = (event) => this.onBridgeMessage(event);
    addEventListener('message', this.boundMessage);
    this.bind();
  }

  bind() {
    this.el.zoomIn.addEventListener('click', () => this.zoomBy(1.2));
    this.el.zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.2));
    this.el.fit.addEventListener('click', () => this.fit());
    this.el.full.addEventListener('click', () => this.enterFullscreen(true));
    this.el.exit.addEventListener('click', () => { if (this.callbacks.onExit) this.callbacks.onExit(); else this.hide(); });
    this.el.snapshot.addEventListener('click', () => this.requestSnapshot());
    this.el.stage.addEventListener('pointerdown', (event) => this.stagePointerDown(event));
    this.el.stage.addEventListener('pointermove', (event) => this.stagePointerMove(event));
    this.el.stage.addEventListener('pointerup', () => { this.pointer = null; });
    this.el.stage.addEventListener('pointercancel', () => { this.pointer = null; });
    this.el.stage.addEventListener('wheel', (event) => { event.preventDefault(); this.zoomBy(event.deltaY < 0 ? 1.08 : 0.92); }, { passive: false });
    addEventListener('resize', () => this.onViewportChange());
    const mq = matchMedia('(orientation: landscape)');
    const change = () => this.onViewportChange();
    mq.addEventListener?.('change', change);
  }

  show() { this.el.shell.hidden = false; document.body.classList.add('viewer-open'); this.onViewportChange(); requestAnimationFrame(() => this.fit()); }
  hide() { this.el.shell.hidden = true; document.body.classList.remove('viewer-open', 'viewer-wide'); this.userFullscreen = false; this.pointer = null; this.el.frame.removeAttribute('srcdoc'); this.el.frame.setAttribute('src', 'about:blank'); }
  setStatus(message) { this.el.status.textContent = message; }
  setFrameDocument(html) { this.el.frame.removeAttribute('src'); this.el.frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'); this.el.frame.srcdoc = html; this.show(); }
  setFrameUrl(url) { this.el.frame.removeAttribute('srcdoc'); this.el.frame.removeAttribute('sandbox'); this.el.frame.src = url; this.show(); }

  stagePointerDown(event) { if (event.target === this.el.frame) return; this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; this.el.stage.setPointerCapture?.(event.pointerId); }
  stagePointerMove(event) { if (!this.pointer || this.pointer.id !== event.pointerId) return; const dx = event.clientX - this.pointer.x; const dy = event.clientY - this.pointer.y; this.pointer.x = event.clientX; this.pointer.y = event.clientY; this.moveBy(dx, dy); }
  moveBy(dx, dy) { this.view.left += Number(dx || 0); this.view.top += Number(dy || 0); this.apply(); }
  zoomBy(factor) { const next = Math.max(this.view.fit * 0.65, Math.min(6, this.view.scale * Number(factor || 1))); this.zoomCentered(next); }
  zoomCentered(next) { const rect = this.el.stage.getBoundingClientRect(); const cx = rect.width / 2; const cy = rect.height / 2; const wx = (cx - this.view.left) / this.view.scale; const wy = (cy - this.view.top) / this.view.scale; this.view.scale = next; this.view.left = cx - wx * next; this.view.top = cy - wy * next; this.apply(); }
  fit() { const w = this.el.stage.clientWidth; const h = this.el.stage.clientHeight; if (!w || !h) return; const baseW = 1280; const baseH = 800; this.el.surface.style.width = `${baseW}px`; this.el.surface.style.height = `${baseH}px`; this.view.fit = Math.min((w - 20) / baseW, (h - 20) / baseH); this.view.scale = Math.max(0.05, this.view.fit); this.view.left = (w - baseW * this.view.scale) / 2; this.view.top = (h - baseH * this.view.scale) / 2; this.apply(); }
  apply() { this.el.surface.style.transform = `translate3d(${this.view.left}px,${this.view.top}px,0) scale(${this.view.scale})`; }

  async enterFullscreen(user = false) { this.userFullscreen = this.userFullscreen || user; document.body.classList.add('viewer-wide'); if (user) { try { await this.el.shell.requestFullscreen?.(); } catch {} } requestAnimationFrame(() => this.fit()); }
  async exitFullscreen() { this.userFullscreen = false; document.body.classList.remove('viewer-wide'); try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {} requestAnimationFrame(() => this.fit()); }
  onViewportChange() { const landscape = matchMedia('(orientation: landscape)').matches; const phone = Math.min(innerWidth, innerHeight) < 820; if (landscape && phone) document.body.classList.add('viewer-wide'); else if (!this.userFullscreen) document.body.classList.remove('viewer-wide'); setTimeout(() => this.fit(), 40); }
  requestSnapshot() { this.el.frame.contentWindow?.postMessage({ type: 'DEBOOGER_CAPTURE' }, '*'); }

  onBridgeMessage(event) {
    const data = event.data;
    if (!data || data.type !== 'DEBOOGER_VIEWER_BRIDGE' || event.source !== this.el.frame.contentWindow) return;
    if (data.event === 'drag') this.moveBy(data.dx, data.dy);
    else if (data.event === 'pinch') this.zoomBy(data.factor);
    else if (data.event === 'runtime-error') this.callbacks.onRuntimeError?.(data);
    else if (data.event === 'snapshot') this.callbacks.onSnapshot?.(data.dataUrl);
    else if (data.event === 'snapshot-error') this.callbacks.onSnapshotError?.(data.message);
  }
}
