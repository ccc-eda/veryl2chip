// A pan/zoom canvas for netlist and chip views: boxes, lines, labels,
// click hit-testing. World coordinates are arbitrary units; the view keeps
// a scale and offset (wheel = zoom around the cursor, drag = pan).

export interface Box {
  id: number;
  x: number; y: number; w: number; h: number;
  fill: string;
  stroke?: string;
  label?: string;
  /** drawn with a thicker highlight border */
  hl?: boolean;
}

export interface Line {
  pts: number[]; // x0 y0 x1 y1 ...
  color: string;
  width?: number;
}

export interface Text { x: number; y: number; s: string; color: string; size?: number; align?: CanvasTextAlign }

export interface Scene {
  boxes: Box[];
  lines: Line[];
  texts: Text[];
  /** drawn under the boxes */
  under?: Line[];
  bg?: { x: number; y: number; w: number; h: number; fill: string }[];
}

export class CanvasView {
  private ctx: CanvasRenderingContext2D;
  scene: Scene = { boxes: [], lines: [], texts: [] };
  scale = 1;
  tx = 0;
  ty = 0;
  onPick: (b: Box | null) => void = () => {};
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.redraw()).observe(canvas.parentElement!);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      this.zoomAt(mx, my, f);
    }, { passive: false });
    canvas.addEventListener('pointerdown', e => {
      this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      this.tx = this.drag.tx + dx;
      this.ty = this.drag.ty + dy;
      this.redraw();
    });
    canvas.addEventListener('pointerup', e => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) {
        const r = canvas.getBoundingClientRect();
        this.onPick(this.hit(e.clientX - r.left, e.clientY - r.top));
      }
    });
    canvas.addEventListener('dblclick', () => this.fit());
  }

  zoomAt(mx: number, my: number, f: number): void {
    const s = Math.min(Math.max(this.scale * f, 0.02), 400);
    const k = s / this.scale;
    this.tx = mx - (mx - this.tx) * k;
    this.ty = my - (my - this.ty) * k;
    this.scale = s;
    this.redraw();
  }

  zoom(f: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(r.width / 2, r.height / 2, f);
  }

  /** world bounding box of the scene */
  bounds(): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const b of this.scene.boxes) { add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
    for (const b of this.scene.bg ?? []) { add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
    for (const t of this.scene.texts) add(t.x, t.y);
    if (x0 === Infinity) return [0, 0, 100, 100];
    return [x0, y0, x1, y1];
  }

  fit(): void {
    const r = this.canvas.getBoundingClientRect();
    const [x0, y0, x1, y1] = this.bounds();
    const pad = 20;
    const s = Math.min((r.width - 2 * pad) / Math.max(x1 - x0, 1), (r.height - 2 * pad) / Math.max(y1 - y0, 1));
    this.scale = Math.min(Math.max(s, 0.02), 40);
    this.tx = pad - x0 * this.scale + Math.max(0, (r.width - 2 * pad - (x1 - x0) * this.scale) / 2);
    this.ty = pad - y0 * this.scale;
    this.redraw();
  }

  set(scene: Scene, fit = true): void {
    this.scene = scene;
    if (fit) this.fit(); else this.redraw();
  }

  hit(px: number, py: number): Box | null {
    const x = (px - this.tx) / this.scale, y = (py - this.ty) / this.scale;
    const bs = this.scene.boxes;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  redraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  private paint(): void {
    const c = this.canvas, ctx = this.ctx;
    const r = c.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = r.width + 'px';
      c.style.height = r.height + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#171c24';
    ctx.fillRect(0, 0, r.width, r.height);
    const s = this.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.tx, dpr * this.ty);
    // visible world rectangle (to skip what is off screen)
    const vx0 = -this.tx / s, vy0 = -this.ty / s, vx1 = vx0 + r.width / s, vy1 = vy0 + r.height / s;
    for (const b of this.scene.bg ?? []) { ctx.fillStyle = b.fill; ctx.fillRect(b.x, b.y, b.w, b.h); }
    const lines = (ls: Line[]) => {
      for (const l of ls) {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = (l.width ?? 1) / s;
        ctx.beginPath();
        ctx.moveTo(l.pts[0], l.pts[1]);
        for (let i = 2; i < l.pts.length; i += 2) ctx.lineTo(l.pts[i], l.pts[i + 1]);
        ctx.stroke();
      }
    };
    lines(this.scene.under ?? []);
    for (const b of this.scene.boxes) {
      if (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) continue;
      ctx.fillStyle = b.fill;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      if (b.stroke || b.hl) {
        ctx.strokeStyle = b.hl ? '#ffd479' : b.stroke!;
        ctx.lineWidth = (b.hl ? 2.5 : 1) / s;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
    lines(this.scene.lines);
    // labels only when they are readable
    ctx.textBaseline = 'middle';
    for (const b of this.scene.boxes) {
      if (!b.label || b.h * s < 9 || b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) continue;
      const fs = Math.min(b.h * 0.62, 11 / s * 1.0 + b.h * 0.2);
      ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = '#0f1318';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2, b.w - 2 / s);
    }
    for (const t of this.scene.texts) {
      const fs = (t.size ?? 11) / s;
      if (fs * s < 6) continue;
      ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align ?? 'left';
      ctx.fillText(t.s, t.x, t.y);
    }
  }
}
