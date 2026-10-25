"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/api.ts
  function fromBase64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  var Veryl = class _Veryl {
    constructor(mod2) {
      __publicField(this, "mod", mod2);
      __publicField(this, "x");
      __publicField(this, "chipdb", null);
      this.reset();
    }
    static async load(bytes) {
      return new _Veryl(await WebAssembly.compile(bytes));
    }
    static fromModule(mod2) {
      return new _Veryl(mod2);
    }
    /** chip database text (IceStorm chipdb-5k.txt) for place and route */
    loadChipdb(text) {
      this.chipdb = text;
      this.pushChipdb();
    }
    pushChipdb() {
      if (!this.chipdb) return;
      const x = this.x;
      const p = x.alloc(this.chipdb.length);
      new Uint8Array(x.memory.buffer, p, this.chipdb.length).set(this.chipdb);
      const r = x.load_chipdb(p, this.chipdb.length);
      x.dealloc(p, this.chipdb.length);
      if (r !== 0) throw new Error(this.text(x.panic_message()));
    }
    /** a trap (Rust panic) leaves the instance unusable: start a fresh one */
    reset() {
      this.x = new WebAssembly.Instance(this.mod, {}).exports;
      if (this.chipdb) this.pushChipdb();
    }
    text(ptr) {
      return new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, ptr, this.x.result_len()).slice());
    }
    call(req) {
      const enc = new TextEncoder().encode(JSON.stringify(req));
      const x = this.x;
      const p = x.alloc(enc.length);
      new Uint8Array(x.memory.buffer, p, enc.length).set(enc);
      let out;
      try {
        out = x.call(p, enc.length);
      } catch (e) {
        let msg = String(e);
        try {
          msg = this.text(x.panic_message()) || msg;
        } catch {
        }
        this.reset();
        throw new Error(msg);
      }
      const s = this.text(out);
      x.dealloc(p, enc.length);
      const r = JSON.parse(s);
      if (!r.ok) throw new Error(r.error);
      return r;
    }
    list(files) {
      return this.call({ cmd: "list", files }).modules;
    }
    simulate(files, top, opts = {}) {
      return this.call({ cmd: "simulate", files, top: top || null, max_time: opts.maxTime ?? 1e6, vcd: !!opts.vcd });
    }
  };
  async function gunzip(gz) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([gz]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // src/client.ts
  async function startCore(wasm) {
    const mod2 = await WebAssembly.compile(wasm);
    try {
      return await workerCore(mod2);
    } catch {
      return directCore(mod2);
    }
  }
  function chipdbGz() {
    if (typeof VERYL_CHIPDB_GZ_B64 === "undefined") throw new Error("chipdb.js (\u6676\u7247\u8CC7\u6599\u5EAB) \u6C92\u6709\u8F09\u5165");
    return fromBase64(VERYL_CHIPDB_GZ_B64);
  }
  async function workerCore(mod2) {
    const url = URL.createObjectURL(new Blob(['"use strict";\n(() => {\n  var __defProp = Object.defineProperty;\n  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;\n  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);\n\n  // src/api.ts\n  var Veryl = class _Veryl {\n    constructor(mod) {\n      __publicField(this, "mod", mod);\n      __publicField(this, "x");\n      __publicField(this, "chipdb", null);\n      this.reset();\n    }\n    static async load(bytes) {\n      return new _Veryl(await WebAssembly.compile(bytes));\n    }\n    static fromModule(mod) {\n      return new _Veryl(mod);\n    }\n    /** chip database text (IceStorm chipdb-5k.txt) for place and route */\n    loadChipdb(text) {\n      this.chipdb = text;\n      this.pushChipdb();\n    }\n    pushChipdb() {\n      if (!this.chipdb) return;\n      const x = this.x;\n      const p = x.alloc(this.chipdb.length);\n      new Uint8Array(x.memory.buffer, p, this.chipdb.length).set(this.chipdb);\n      const r = x.load_chipdb(p, this.chipdb.length);\n      x.dealloc(p, this.chipdb.length);\n      if (r !== 0) throw new Error(this.text(x.panic_message()));\n    }\n    /** a trap (Rust panic) leaves the instance unusable: start a fresh one */\n    reset() {\n      this.x = new WebAssembly.Instance(this.mod, {}).exports;\n      if (this.chipdb) this.pushChipdb();\n    }\n    text(ptr) {\n      return new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, ptr, this.x.result_len()).slice());\n    }\n    call(req) {\n      const enc = new TextEncoder().encode(JSON.stringify(req));\n      const x = this.x;\n      const p = x.alloc(enc.length);\n      new Uint8Array(x.memory.buffer, p, enc.length).set(enc);\n      let out;\n      try {\n        out = x.call(p, enc.length);\n      } catch (e) {\n        let msg = String(e);\n        try {\n          msg = this.text(x.panic_message()) || msg;\n        } catch {\n        }\n        this.reset();\n        throw new Error(msg);\n      }\n      const s = this.text(out);\n      x.dealloc(p, enc.length);\n      const r = JSON.parse(s);\n      if (!r.ok) throw new Error(r.error);\n      return r;\n    }\n    list(files) {\n      return this.call({ cmd: "list", files }).modules;\n    }\n    simulate(files, top, opts = {}) {\n      return this.call({ cmd: "simulate", files, top: top || null, max_time: opts.maxTime ?? 1e6, vcd: !!opts.vcd });\n    }\n  };\n  async function gunzip(gz) {\n    const ds = new DecompressionStream("gzip");\n    const stream = new Blob([gz]).stream().pipeThrough(ds);\n    return new Uint8Array(await new Response(stream).arrayBuffer());\n  }\n\n  // src/worker.ts\n  var core = null;\n  self.onmessage = async (e) => {\n    const m = e.data;\n    try {\n      if (m.type === "init") {\n        core = Veryl.fromModule(m.module);\n        self.postMessage({ id: m.id, res: true });\n      } else if (m.type === "chipdb") {\n        core.loadChipdb(await gunzip(m.gz));\n        self.postMessage({ id: m.id, res: true });\n      } else {\n        self.postMessage({ id: m.id, res: core.call(m.req) });\n      }\n    } catch (err) {\n      self.postMessage({ id: m.id, error: String(err.message ?? err) });\n    }\n  };\n})();\n'], { type: "text/javascript" }));
    const w = new Worker(url);
    let next = 1;
    const pending = /* @__PURE__ */ new Map();
    w.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error !== void 0) p.fail(new Error(e.data.error));
      else p.ok(e.data.res);
    };
    const send = (msg, transfer = []) => new Promise((ok, fail) => {
      const id = next++;
      pending.set(id, { ok, fail });
      w.postMessage({ ...msg, id }, transfer);
    });
    w.onerror = () => {
      for (const p of pending.values()) p.fail(new Error("worker \u932F\u8AA4"));
      pending.clear();
    };
    await Promise.race([send({ type: "init", module: mod2 }), new Promise((_, f) => setTimeout(() => f(new Error("worker timeout")), 5e3))]);
    let db = null;
    return {
      inWorker: true,
      call: (req) => send({ type: "call", req }),
      chipdb: () => {
        if (!db) {
          const gz = chipdbGz();
          db = send({ type: "chipdb", gz }, [gz.buffer]).then(() => {
          });
          db.catch(() => {
            db = null;
          });
        }
        return db;
      }
    };
  }
  function directCore(mod2) {
    const v = Veryl.fromModule(mod2);
    let db = null;
    return {
      inWorker: false,
      call: (req) => new Promise((ok, fail) => setTimeout(() => {
        try {
          ok(v.call(req));
        } catch (e) {
          fail(e);
        }
      }, 10)),
      chipdb: () => db ?? (db = gunzip(chipdbGz()).then((t) => v.loadChipdb(t)))
    };
  }

  // src/examples.ts
  function examples() {
    return typeof VERYL_EXAMPLES === "undefined" ? [] : VERYL_EXAMPLES;
  }

  // src/view/canvas.ts
  var CanvasView = class {
    constructor(canvas) {
      __publicField(this, "canvas", canvas);
      __publicField(this, "ctx");
      __publicField(this, "scene", { boxes: [], lines: [], texts: [] });
      __publicField(this, "scale", 1);
      __publicField(this, "tx", 0);
      __publicField(this, "ty", 0);
      __publicField(this, "onPick", () => {
      });
      __publicField(this, "drag", null);
      __publicField(this, "raf", 0);
      /** keep fitting the scene to the canvas until the user pans or zooms */
      __publicField(this, "autoFit", true);
      this.ctx = canvas.getContext("2d");
      new ResizeObserver(() => {
        if (this.autoFit) this.fit();
        else this.redraw();
      }).observe(canvas.parentElement);
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const f = Math.exp(-e.deltaY * 15e-4);
        this.autoFit = false;
        this.zoomAt(mx, my, f);
      }, { passive: false });
      canvas.addEventListener("pointerdown", (e) => {
        this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          this.drag.moved = true;
          this.autoFit = false;
        }
        this.tx = this.drag.tx + dx;
        this.ty = this.drag.ty + dy;
        this.redraw();
      });
      canvas.addEventListener("pointerup", (e) => {
        const d = this.drag;
        this.drag = null;
        if (d && !d.moved) {
          const r = canvas.getBoundingClientRect();
          this.onPick(this.hit(e.clientX - r.left, e.clientY - r.top));
        }
      });
      canvas.addEventListener("dblclick", () => this.fit());
    }
    zoomAt(mx, my, f) {
      const s = Math.min(Math.max(this.scale * f, 0.02), 400);
      const k = s / this.scale;
      this.tx = mx - (mx - this.tx) * k;
      this.ty = my - (my - this.ty) * k;
      this.scale = s;
      this.redraw();
    }
    zoom(f) {
      this.autoFit = false;
      const r = this.canvas.getBoundingClientRect();
      this.zoomAt(r.width / 2, r.height / 2, f);
    }
    /** world bounding box of the scene */
    bounds() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (x, y) => {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      };
      for (const b of this.scene.boxes) {
        add(b.x, b.y);
        add(b.x + b.w, b.y + b.h);
      }
      for (const b of this.scene.bg ?? []) {
        add(b.x, b.y);
        add(b.x + b.w, b.y + b.h);
      }
      for (const t of this.scene.texts) add(t.x, t.y);
      if (x0 === Infinity) return [0, 0, 100, 100];
      return [x0, y0, x1, y1];
    }
    fit() {
      this.autoFit = true;
      const r = this.canvas.parentElement.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const [x0, y0, x1, y1] = this.bounds();
      const pad = 20;
      const s = Math.min((r.width - 2 * pad) / Math.max(x1 - x0, 1), (r.height - 2 * pad) / Math.max(y1 - y0, 1));
      this.scale = Math.min(Math.max(s, 0.02), 40);
      this.tx = pad - x0 * this.scale + Math.max(0, (r.width - 2 * pad - (x1 - x0) * this.scale) / 2);
      this.ty = pad - y0 * this.scale;
      this.redraw();
    }
    set(scene, fit = true) {
      this.scene = scene;
      if (fit) this.fit();
      else this.redraw();
    }
    hit(px, py) {
      const x = (px - this.tx) / this.scale, y = (py - this.ty) / this.scale;
      const bs = this.scene.boxes;
      for (let i = bs.length - 1; i >= 0; i--) {
        const b = bs[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      }
      return null;
    }
    redraw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.paint();
      });
    }
    paint() {
      const c = this.canvas, ctx = this.ctx;
      const r = c.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
        c.style.width = r.width + "px";
        c.style.height = r.height + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#171c24";
      ctx.fillRect(0, 0, r.width, r.height);
      const s = this.scale;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.tx, dpr * this.ty);
      const vx0 = -this.tx / s, vy0 = -this.ty / s, vx1 = vx0 + r.width / s, vy1 = vy0 + r.height / s;
      for (const b of this.scene.bg ?? []) {
        ctx.fillStyle = b.fill;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      const lines = (ls) => {
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
          ctx.strokeStyle = b.hl ? "#ffd479" : b.stroke;
          ctx.lineWidth = (b.hl ? 2.5 : 1) / s;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
      }
      lines(this.scene.lines);
      ctx.textBaseline = "middle";
      for (const b of this.scene.boxes) {
        if (!b.label || b.h * s < 9 || b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) continue;
        const fs = Math.min(b.h * 0.62, 11 / s * 1 + b.h * 0.2);
        ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = "#0f1318";
        ctx.textAlign = "center";
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2, b.w - 2 / s);
      }
      for (const t of this.scene.texts) {
        const fs = (t.size ?? 11) / s;
        if (fs * s < 6) continue;
        ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = t.color;
        ctx.textAlign = t.align ?? "left";
        ctx.fillText(t.s, t.x, t.y);
      }
    }
  };

  // src/synth/asic.ts
  var S = 4;
  function stdColor(t) {
    if (t === "SRAM") return "#7d6b9e";
    if (t === "CLKBUF") return "#57c27a";
    if (t.startsWith("DFF")) return "#d08770";
    if (t === "MUX2") return "#ebcb8b";
    if (t === "BUF") return "#8fbcbb";
    if (t === "INV") return "#a3be8c";
    if (t.startsWith("TIE")) return "#7f8c9a";
    if (t.startsWith("X")) return "#c39bd3";
    if (t.endsWith("AND2")) return "#6aa1d4";
    if (t.endsWith("OR2")) return "#7ec3ff";
    return "#b48ead";
  }
  function dieScene(r, pos, colorOf) {
    const d = r.die;
    const H = d.h * S;
    const bg = [{ x: -2, y: -2, w: d.w * S + 4, h: H + 4, fill: "#2a3441" }];
    for (let row = 0; row < d.rows; row++) bg.push({ x: 0, y: H - (row + 1) * d.row_h * S, w: d.w * S, h: d.row_h * S, fill: row % 2 ? "#1f2833" : "#222c38" });
    const boxes = r.cells.map(([row, site, w, , , hh], i) => {
      const [rr, ss] = pos ? [pos[2 * i], pos[2 * i + 1]] : [row, site];
      const macro = r.map.cells[i].t === "SRAM";
      return {
        id: i,
        x: ss * d.site_w * S + 0.25,
        y: H - (rr + hh) * d.row_h * S + 0.6,
        w: w * d.site_w * S - 0.5,
        h: hh * d.row_h * S - 1.2,
        fill: colorOf && !macro ? colorOf(i) : stdColor(r.map.cells[i].t),
        label: macro ? "SRAM" : void 0,
        stroke: macro ? "#c3b2e0" : void 0
      };
    });
    const texts = [];
    const n = r.cells.length;
    r.pins.forEach((p, k) => {
      const x = p.x * S, y = H - p.y * S;
      boxes.push({ id: n + k, x: x - 2.5, y: y - 2.5, w: 5, h: 5, fill: p.dir === "in" ? "#57c27a" : "#e06c75", stroke: "#0f1318" });
      if (r.pins.length <= 120) {
        const left = p.x <= 0, right = p.x >= d.w, bottom = p.y <= 0;
        texts.push({
          x: left ? x - 5 : right ? x + 5 : x,
          y: left || right ? y : bottom ? y + 9 : y - 6,
          s: p.name,
          color: p.dir === "in" ? "#8fe0a8" : "#f0a0a8",
          size: 8,
          align: left ? "right" : right ? "left" : "center"
        });
      }
    });
    return { bg, boxes, lines: [], texts };
  }
  function gc(r, x, y) {
    const g = r.die.row_h * S;
    return [(x + 0.5) * g, r.die.h * S - (y + 0.5) * g];
  }
  function edgeUse(r) {
    const { gx, gy } = r.route;
    const h = new Uint16Array(gx * gy), v = new Uint16Array(gx * gy);
    for (const n of r.route.nets) {
      const s = n.segs;
      for (let i = 0; i < s.length; i += 4) {
        const [x0, y0, x1, y1] = [s[i], s[i + 1], s[i + 2], s[i + 3]];
        if (y0 === y1) h[y0 * gx + Math.min(x0, x1)]++;
        else v[Math.min(y0, y1) * gx + x0]++;
      }
    }
    return { h, v };
  }
  function congestion(r) {
    const { gx, gy, cap } = r.route;
    const u = edgeUse(r);
    const g = r.die.row_h * S;
    const out = [];
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
      const k = y * gx + x;
      const m = Math.max(u.h[k], u.v[k], x ? u.h[k - 1] : 0, y ? u.v[k - gx] : 0) / cap;
      if (m < 0.25) continue;
      const [cx, cy] = gc(r, x, y);
      out.push({ x: cx - g / 2, y: cy - g / 2, w: g, h: g, fill: `hsla(${120 - 120 * Math.min(m, 1)}, 70%, 45%, ${0.15 + 0.35 * Math.min(m, 1)})` });
    }
    return out;
  }
  function asicRouteLines(r, opts) {
    const out = [], top = [];
    r.route.nets.forEach((n, ni) => {
      const s = n.segs;
      const sel = opts.net === ni;
      for (let i = 0; i < s.length; i += 4) {
        const [ax, ay] = gc(r, s[i], s[i + 1]), [bx, by] = gc(r, s[i + 2], s[i + 3]);
        const pts = [ax, ay, bx, by];
        if (opts.dim && n.crit) top.push({ pts, color: "#ff5c5c", width: 2.4 });
        else if (sel) top.push({ pts, color: "#ffd479", width: 2.4 });
        else if (opts.dim) out.push({ pts, color: "rgba(126,150,180,0.15)", width: 0.8 });
        else out.push({ pts, color: n.clock ? "rgba(87,194,122,0.8)" : s[i + 1] === s[i + 3] ? "rgba(94,159,214,0.55)" : "rgba(180,142,173,0.6)", width: 0.9 });
      }
    });
    return out.concat(top);
  }
  var LAYER_COLOR = ["rgba(94,159,214,0.75)", "rgba(224,108,117,0.7)", "rgba(87,194,122,0.7)", "rgba(229,192,123,0.75)"];
  function detailLines(r, sel, layers) {
    const d = r.detail;
    const t = r.die.row_h / d.tracks;
    const H = r.die.h * S;
    const out = [], top = [];
    d.nets.forEach((n, ni) => {
      const s = n.segs;
      for (let i = 0; i < s.length; i += 5) {
        const l = s[i];
        if (!layers[l]) continue;
        const pts = [s[i + 1] * t * S, H - s[i + 2] * t * S, s[i + 3] * t * S, H - s[i + 4] * t * S];
        if (ni === sel) top.push({ pts, color: "#ffd479", width: 1.6 });
        else out.push({ pts, color: LAYER_COLOR[l], width: 0.5 });
      }
    });
    return out.concat(top);
  }
  function powerScene(r) {
    const d = r.die, H = d.h * S, f = r.pdn.fillers;
    const bg = [];
    for (let i = 0; i < f.length; i += 3) {
      bg.push({ x: f[i + 1] * d.site_w * S + 0.25, y: H - (f[i] + 1) * d.row_h * S + 0.6, w: f[i + 2] * d.site_w * S - 0.5, h: d.row_h * S - 1.2, fill: "#323a46" });
    }
    const lines = [];
    for (let k = 0; k < r.pdn.rails; k++) {
      const y = H - k * d.row_h * S;
      lines.push({ pts: [0, y, d.w * S, y], color: k % 2 ? "rgba(224,108,117,0.55)" : "rgba(126,195,255,0.55)", width: 0.8 });
    }
    const t = d.row_h / r.detail.tracks;
    for (const [x, vdd] of r.pdn.straps) {
      const cx = (x + r.pdn.strap_w / 2) * t * S;
      lines.push({ pts: [cx, 0, cx, H], color: vdd ? "rgba(224,108,117,0.8)" : "rgba(126,195,255,0.8)", width: r.pdn.strap_w * t * S });
    }
    return { bg, lines };
  }

  // src/synth/device.ts
  var T = 12;
  var TILE_FILL = {
    logic: "#222c38",
    io: "#25352b",
    ramb: "#33283f",
    ramt: "#33283f",
    dsp0: "#3a3026",
    dsp1: "#3a3026",
    dsp2: "#3a3026",
    dsp3: "#3a3026",
    ipcon: "#263340"
  };
  var KIND_COLOR = {
    sp4: "rgba(94,159,214,0.75)",
    sp12: "rgba(180,142,173,0.85)",
    local: "rgba(160,170,185,0.6)",
    in: "rgba(160,170,185,0.6)",
    glb: "#57c27a",
    g2l: "#57c27a",
    ctrl: "#57c27a",
    io: "#e5c07b",
    carry: "#e5c07b",
    fabout: "#57c27a",
    out: "#9fb2c8",
    other: "#9fb2c8"
  };
  function lcColor(lc) {
    if (lc.carry) return "#e5c07b";
    if (lc.ff && lc.init === "aaaa" && lc.ins.filter((x) => x).length <= 1) return "#d08770";
    if (lc.ff) return "#c27ba0";
    if (!lc.ins.some((x) => x)) return "#7f8c9a";
    return "#5e9fd6";
  }
  function tileXY(dev, x, y) {
    return [x * T, (dev.h - 1 - y) * T];
  }
  function lcRect(dev, x, y, z) {
    const [tx, ty] = tileXY(dev, x, y);
    const w = (T - 3) / 2, h = (T - 3) / 4;
    return [tx + 1 + z % 2 * (w + 0.5), ty + 1 + (3 - Math.floor(z / 2)) * (h + 0.3), w, h];
  }
  var RAM_COLOR = "#b48ead";
  function deviceScene(r, pos, colorOf, ramPos) {
    const dev = r.device;
    const bg = dev.tiles.map(([x, y, t]) => {
      const [tx, ty] = tileXY(dev, x, y);
      return { x: tx, y: ty, w: T - 1, h: T - 1, fill: TILE_FILL[t] ?? "#1d232e" };
    });
    const boxes = r.lcs.map((lc, i) => {
      const [x, y, z] = pos ? [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]] : [lc.x, lc.y, lc.z];
      const [bx, by, w, h] = lcRect(dev, x, y, z);
      return { id: i, x: bx, y: by, w, h, fill: colorOf ? colorOf(i) : lcColor(lc) };
    });
    const texts = [];
    r.ios.forEach((io, k) => {
      const [tx, ty] = tileXY(dev, io.x, io.y);
      boxes.push({ id: r.lcs.length + k, x: tx + 1 + io.z * 5.5, y: ty + 3, w: 4.5, h: 5, fill: io.dir === "in" ? "#57c27a" : "#e06c75", stroke: "#0f1318" });
      texts.push({ x: tx + 3 + io.z * 5.5, y: io.y === 0 ? ty + T + 3 : ty - 3, s: io.name, color: io.dir === "in" ? "#8fe0a8" : "#f0a0a8", size: 9, align: "center" });
    });
    r.rams.forEach((ram, k) => {
      const [x, y] = ramPos ? [ramPos[2 * k], ramPos[2 * k + 1]] : [ram.x, ram.y];
      const [tx, ty] = tileXY(dev, x, y + 1);
      boxes.push({ id: r.lcs.length + r.ios.length + k, x: tx + 1, y: ty + 1, w: T - 3, h: 2 * T - 3, fill: RAM_COLOR, stroke: "#0f1318", label: "RAM" });
    });
    for (const [x, y, t] of dev.tiles) {
      if (t !== "logic") continue;
      for (let z = 0; z < 8; z++) {
        const [bx, by, w, h] = lcRect(dev, x, y, z);
        bg.push({ x: bx, y: by, w, h, fill: "#2a3441" });
      }
    }
    return { bg, boxes, lines: [], texts };
  }
  function routeLines(r, opts) {
    const dev = r.device;
    const c = (x, y) => {
      const [tx, ty] = tileXY(dev, x, y);
      return [tx + (T - 1) / 2, ty + (T - 1) / 2];
    };
    const out = [];
    const crit = [];
    r.nets.forEach((n, ni) => {
      const sel = opts.net === ni;
      for (const [x0, y0, x1, y1, kind, isCrit] of n.segs) {
        if (x0 === x1 && y0 === y1) continue;
        const [ax, ay] = c(x0, y0), [bx, by] = c(x1, y1);
        if (isCrit) crit.push({ pts: [ax, ay, bx, by], color: "#ff5c5c", width: 2.2 });
        else if (sel) out.push({ pts: [ax, ay, bx, by], color: "#ffd479", width: 2 });
        else if (!opts.critOnly) out.push({ pts: [ax, ay, bx, by], color: opts.dim ? "rgba(126,150,180,0.18)" : KIND_COLOR[kind] ?? "#9fb2c8", width: 0.8 });
      }
    });
    return out.concat(crit);
  }
  function heat(t) {
    const h = 120 - 120 * Math.min(Math.max(t, 0), 1);
    return `hsl(${h}, 70%, 52%)`;
  }

  // src/zip.ts
  var CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 4294967295;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let off = 0;
    const d = /* @__PURE__ */ new Date();
    const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
    const date = d.getFullYear() - 1980 << 9 | d.getMonth() + 1 << 5 | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 67324752, true);
      loc.setUint16(4, 20, true);
      loc.setUint16(6, 2048, true);
      loc.setUint16(10, time, true);
      loc.setUint16(12, date, true);
      loc.setUint32(14, crc, true);
      loc.setUint32(18, data.length, true);
      loc.setUint32(22, data.length, true);
      loc.setUint16(26, name.length, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 33639248, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 2048, true);
      cen.setUint16(12, time, true);
      cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, off, true);
      parts.push(new Uint8Array(loc.buffer), name, data);
      central.push(new Uint8Array(cen.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 101010256, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const a of all) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  }
  function saveAs(name, data, type = "application/octet-stream") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1e3);
  }

  // src/synth/compare.ts
  function bbox(s) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y, w, h) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w);
      y1 = Math.max(y1, y + h);
    };
    for (const b of s.boxes) add(b.x, b.y, b.w, b.h);
    for (const b of s.bg ?? []) add(b.x, b.y, b.w, b.h);
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
  }
  function moved(s, k, dx, dy, id) {
    const pts = (p) => p.map((v, i) => i % 2 ? v * k + dy : v * k + dx);
    return {
      boxes: s.boxes.map((b) => ({ ...b, id: b.id + id, x: b.x * k + dx, y: b.y * k + dy, w: b.w * k, h: b.h * k })),
      lines: s.lines.map((l) => ({ ...l, pts: pts(l.pts) })),
      under: s.under?.map((l) => ({ ...l, pts: pts(l.pts) })),
      texts: s.texts.map((t) => ({ ...t, x: t.x * k + dx, y: t.y * k + dy, size: t.size ? t.size * k : t.size })),
      bg: s.bg?.map((b) => ({ ...b, x: b.x * k + dx, y: b.y * k + dy, w: b.w * k, h: b.h * k }))
    };
  }
  function compareScene(p, a) {
    const f = deviceScene(p), d = dieScene(a);
    const bf = bbox(f), bd = bbox(d);
    const h = bf.y1 - bf.y0;
    const k = h / Math.max(1e-9, bd.y1 - bd.y0);
    const gap = h * 0.12;
    const right = moved(d, k, bf.x1 + gap - bd.x0 * k, bf.y0 - bd.y0 * k, 1e6);
    const left = moved(f, 1, 0, 0, 0);
    const ty = bf.y0 - h * 0.035;
    const size = h * 0.025;
    return {
      boxes: [...left.boxes, ...right.boxes],
      lines: [],
      under: [...left.under ?? [], ...right.under ?? []],
      texts: [
        ...left.texts,
        ...right.texts,
        { x: bf.x0, y: ty, s: `FPGA\uFF1AiCE40UP5K\uFF08${p.lcs.length} LC / 5280\uFF09`, color: "#7ec3ff", size, align: "left" },
        { x: bf.x1 + gap, y: ty, s: `ASIC\uFF1Avlib \u6A19\u6E96\u5143\u4EF6\uFF08\u6676\u7C92 ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m\uFF0C\u653E\u5927\u5230\u540C\u9AD8\uFF09`, color: "#e0b87e", size, align: "left" }
      ],
      bg: [...left.bg ?? [], ...right.bg ?? []]
    };
  }
  var f1 = (v) => v.toFixed(1);
  var f2 = (v) => v.toFixed(2);
  function compareRows(p, a) {
    const fc = (t) => p.lcs.filter((l) => t === "ff" ? l.ff : t === "carry" ? l.carry : true).length;
    const ffA = a.map.cells.filter((c) => c.t.includes("DFF")).length;
    const srams = a.map.cells.filter((c) => c.t === "SRAM").length;
    const eF = p.timing.power.e_nets + p.timing.power.e_clock + p.timing.power.e_ram;
    const eA = a.power.e_nets + a.power.e_clock + a.power.e_internal + a.power.e_sram;
    const f = Math.min(p.timing.fmax, a.timing.fmax);
    const pF = eF * f / 1e3 + p.timing.power.static, pA = eA * f / 1e3 + a.power.leakage;
    return [
      ["\u5BE6\u4F5C", "iCE40UP5K LUT4 FPGA\uFF08\u53EF\u91CD\u65B0\u71D2\u9304\uFF09", "vlib \u6A19\u6E96\u5143\u4EF6\uFF08\u7D04 130 nm\uFF0C\u9700\u6D41\u7247\uFF09"],
      ["\u908F\u8F2F\u55AE\u5143", `${p.lcs.length} LC\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09\uFF0CDFF ${fc("ff")}\uFF0CCARRY ${fc("carry")}`, `${a.map.cells.length} \u500B\u5143\u4EF6\uFF0CDFF ${ffA}`],
      ...p.rams.length || srams ? [["\u8A18\u61B6\u9AD4", `${p.rams.length} \u500B SB_RAM40_4K`, `${srams} \u500B SRAM \u5DE8\u96C6`]] : [],
      ["\u9762\u7A4D", "\u56FA\u5B9A\u6676\u7247\uFF085280 LC\u300130 BRAM\uFF09", `\u5143\u4EF6 ${f1(a.area)} \xB5m\xB2\uFF0C\u6676\u7C92 ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m\uFF08\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(0)}%\uFF09`],
      ["\u7E5E\u7DDA", `${p.pips} \u500B pip\uFF08\u53EF\u7A0B\u5F0F\u958B\u95DC\uFF09`, `${f2(a.detail.wirelength / 1e3 || a.route.wirelength / 1e3)} mm \u91D1\u5C6C\u7DDA\uFF0C${a.detail.vias || a.route.vias} \u500B via`],
      ["\u95DC\u9375\u8DEF\u5F91", `${f2(p.timing.period)} ns`, `${f2(a.timing.period)} ns`],
      ["F<sub>max</sub>", `${f1(p.timing.fmax)} MHz`, `${f1(a.timing.fmax)} MHz\uFF08\xD7${(a.timing.fmax / p.timing.fmax).toFixed(1)}\uFF09`],
      ["\u6BCF\u9031\u671F\u80FD\u91CF", `${f1(eF)} pJ`, `${f2(eA)} pJ\uFF08\xF7${(eF / Math.max(1e-9, eA)).toFixed(0)}\uFF09`],
      [`\u529F\u8017 @ ${f1(f)} MHz`, `${pF.toFixed(3)} mW\uFF08\u975C\u614B ${p.timing.power.static.toFixed(3)}\uFF09`, `${pA.toFixed(4)} mW\uFF08\u6F0F\u96FB ${a.power.leakage.toFixed(4)}\uFF09`]
    ];
  }

  // src/synth/model.ts
  var OUTS = /* @__PURE__ */ new Set(["Y", "Q", "O", "CO"]);
  var isOut = (pin) => OUTS.has(pin) || pin.startsWith("RDATA");
  var isFF = (t) => t.includes("DFF") || t === "SB_RAM40_4K";
  function netNames(nl) {
    const m = /* @__PURE__ */ new Map();
    const add = (name, bits) => bits.forEach((b, i) => {
      if (typeof b === "number" && !m.has(b)) m.set(b, bits.length > 1 ? `${name}[${i}]` : name);
    });
    nl.ports.forEach((p) => add(p.name, p.bits));
    nl.nets.forEach((n) => add(n.name, n.bits));
    return m;
  }
  function bitName(names, b) {
    if (b === "0" || b === "1") return `1'b${b}`;
    return names.get(b) ?? `n${b}`;
  }
  function levelize(nl) {
    const driver = /* @__PURE__ */ new Map();
    const users = /* @__PURE__ */ new Map();
    nl.cells.forEach((c, i) => {
      for (const [p, b] of c.c) {
        if (typeof b !== "number") continue;
        if (isOut(p)) driver.set(b, i);
        else {
          const u = users.get(b);
          if (u) u.push(i);
          else users.set(b, [i]);
        }
      }
    });
    const level = new Array(nl.cells.length).fill(-1);
    let depth = 0;
    for (let s = 0; s < nl.cells.length; s++) {
      if (level[s] >= 0) continue;
      const stack = [[s, false]];
      while (stack.length) {
        const [i, done] = stack.pop();
        if (level[i] >= 0) continue;
        const c = nl.cells[i];
        if (isFF(c.t)) {
          level[i] = 0;
          continue;
        }
        const ins = [];
        for (const [p, b] of c.c) {
          if (isOut(p) || typeof b !== "number") continue;
          const d = driver.get(b);
          if (d !== void 0) ins.push(d);
        }
        if (done) {
          let l = 0;
          for (const d of ins) l = Math.max(l, (level[d] < 0 ? 0 : level[d]) + 1);
          level[i] = Math.max(l, 1);
          depth = Math.max(depth, level[i]);
          continue;
        }
        stack.push([i, true]);
        for (const d of ins) if (level[d] === -1) stack.push([d, false]);
      }
    }
    return { level, depth, driver, users };
  }
  function countTypes(nl) {
    const m = /* @__PURE__ */ new Map();
    for (const c of nl.cells) m.set(c.t, (m.get(c.t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  function lutBits(init) {
    const out = [];
    for (let i = 0; i < 16; i++) out.push(init[15 - i] === "1" ? 1 : 0);
    return out;
  }
  function lutInputs(c) {
    return ["I0", "I1", "I2", "I3"].filter((p) => {
      const b = c.c.find((x) => x[0] === p)?.[1];
      return b !== void 0 && b !== "0" && b !== "1";
    }).length;
  }

  // src/synth/layouts.ts
  var TYPE_COLOR = {
    $_AND_: "#6aa1d4",
    $_OR_: "#7ec3ff",
    $_XOR_: "#c39bd3",
    $_NOT_: "#a3be8c",
    $_MUX_: "#ebcb8b",
    SB_CARRY: "#e5c07b",
    SB_RAM40_4K: "#b48ead",
    PI: "#57c27a",
    PO: "#e06c75"
  };
  var LUT_COLOR = ["#5a6b80", "#8fbcbb", "#88c0d0", "#81a1c1", "#5e81ac"];
  function cellColor(t, inputs = 4) {
    if (t.includes("DFF")) return "#d08770";
    if (t === "SB_LUT4") return LUT_COLOR[inputs];
    if (/^[A-Z]/.test(t) && !t.startsWith("SB_") && t !== "PI" && t !== "PO") return stdColor(t);
    return TYPE_COLOR[t] ?? "#9fb2c8";
  }
  function shortType(t) {
    if (t === "SB_LUT4") return "LUT4";
    if (t === "SB_CARRY") return "CARRY";
    if (t === "SB_RAM40_4K") return "BRAM";
    if (t.startsWith("SB_DFF")) return t.slice(3);
    return t.replace(/^\$_/, "").replace(/_$/, "").replace(/^DFF_.*/, "DFF").replace(/^SDFF_.*/, "SDFF");
  }
  var BW = 34;
  var BH = 11;
  var CG = 26;
  var RG = 3;
  function netScene(nl, lev) {
    const boxes = [];
    const texts = [];
    const cols = [];
    const put = (col, id) => {
      (cols[col] ?? (cols[col] = [])).push(id);
    };
    const n = nl.cells.length;
    const items = [];
    nl.cells.forEach((c, i) => {
      items.push({ fill: cellColor(c.t, c.t === "SB_LUT4" ? lutInputs(c) : 4), label: shortType(c.t) });
      put(isFF(c.t) ? 1 : 1 + Math.max(lev.level[i], 1), i);
    });
    const portBox = /* @__PURE__ */ new Map();
    const pinPorts = /* @__PURE__ */ new Map();
    const outPorts = /* @__PURE__ */ new Map();
    const last = Math.max(cols.length, 2);
    let pid = n;
    for (const p of nl.ports) {
      p.bits.forEach((b, i) => {
        const id = pid++;
        items.push({ fill: p.dir === "in" ? TYPE_COLOR.PI : TYPE_COLOR.PO, label: p.bits.length > 1 ? `${p.name}[${i}]` : p.name });
        portBox.set(`${p.name}:${i}`, id);
        put(p.dir === "in" ? 0 : last, id);
        if (typeof b === "number") {
          const m = p.dir === "in" ? pinPorts : outPorts;
          (m.get(b) ?? m.set(b, []).get(b)).push(id);
        }
      });
    }
    const total = items.length;
    const maxRows = Math.max(40, Math.ceil(Math.sqrt(total * 3)));
    const pos = new Array(items.length);
    let x = 0;
    cols.forEach((ids, ci) => {
      if (!ids || !ids.length) {
        x += BW * 0.5;
        return;
      }
      const sub = Math.ceil(ids.length / maxRows);
      const rows = Math.ceil(ids.length / sub);
      const w = ci === 0 || ci === last ? BW * 2.2 : BW;
      ids.forEach((id, k) => {
        const sx = Math.floor(k / rows), sy = k % rows;
        pos[id] = [x + sx * (w + 4), sy * (BH + RG)];
      });
      const label = ci === 0 ? "\u8F38\u5165" : ci === 1 ? "DFF" : ci === last ? "\u8F38\u51FA" : `L${ci - 1}`;
      texts.push({ x, y: -12, s: label, color: "#9fb2c8", size: 11 });
      x += sub * (w + 4) + CG;
    });
    const cellBox = [];
    items.forEach((it, id) => {
      const [bx, by] = pos[id];
      const port = id >= n;
      const w = port ? BW * 2.2 : BW;
      boxes.push({ id, x: bx, y: by, w, h: BH, fill: it.fill, label: it.label });
      if (!port) cellBox[id] = id;
    });
    return { scene: { boxes, lines: [], texts }, cellBox, portBox, pinPorts, outPorts };
  }
  function netLines(nl, lev, lay, all, sel) {
    const bx = lay.scene.boxes;
    const right = (id) => [bx[id].x + bx[id].w, bx[id].y + bx[id].h / 2];
    const left = (id) => [bx[id].x, bx[id].y + bx[id].h / 2];
    const out = [];
    const edge = (from, to, color, width = 1) => {
      const [x0, y0] = right(from), [x1, y1] = left(to);
      const mx = (x0 + x1) / 2;
      out.push({ pts: [x0, y0, mx, y0, mx, y1, x1, y1], color, width });
    };
    const sources = (w) => {
      const d = lev.driver.get(w);
      if (d !== void 0) return [d];
      return lay.pinPorts.get(w) ?? [];
    };
    const each = (fn, only) => {
      nl.cells.forEach((c, i) => {
        for (const [p, b] of c.c) {
          if (isOut(p) || typeof b !== "number") continue;
          for (const s of sources(b)) if (only === void 0 || only === i || only === s) fn(s, i);
        }
      });
      for (const [w, ids] of lay.outPorts) for (const id of ids) for (const s of sources(w)) if (only === void 0 || only === id || only === s) fn(s, id);
    };
    if (all) each((a, b) => edge(a, b, "rgba(126,195,255,0.18)"));
    if (sel !== null) {
      each((a, b) => edge(a, b, b === sel ? "#ff9b8a" : "#7ec3ff", 1.6), sel);
    }
    return out;
  }
  function edgeCount(nl) {
    let n = 0;
    for (const c of nl.cells) for (const [p, b] of c.c) if (!isOut(p) && typeof b === "number") n++;
    return n;
  }
  function hierScene(hier, counts) {
    const boxes = [];
    const lines = [];
    const texts = [];
    const W = 260, H = 26, IND = 40, GAP = 10;
    const ypos = /* @__PURE__ */ new Map();
    hier.forEach((h, i) => {
      const depth = h.path === "" ? 0 : h.path.split(".").length;
      const x = depth * IND, y = i * (H + GAP);
      const parent = h.path.includes(".") ? h.path.slice(0, h.path.lastIndexOf(".")) : h.path === "" ? null : "";
      const name = h.path === "" ? h.module : h.path.split(".").pop();
      const n = counts.get(h.path) ?? 0;
      boxes.push({ id: i, x, y, w: W, h: H, fill: depth === 0 ? "#3d6ea0" : "#2c3e55", stroke: "#6aa1d4", label: `${name} : ${h.module}` });
      texts.push({ x: x + W + 10, y: y + H / 2, s: `${n} \u500B\u8A0A\u865F`, color: "#9fb2c8", size: 11 });
      if (parent !== null && ypos.has(parent)) {
        const [px, py] = ypos.get(parent);
        lines.push({ pts: [px + 14, py + H, px + 14, y + H / 2, x, y + H / 2], color: "#6aa1d4", width: 1.5 });
      }
      ypos.set(h.path, [x, y]);
    });
    return { boxes, lines, texts };
  }

  // src/synth/overlay.ts
  var $ = (id) => document.getElementById(id);
  var FPGA_STAGES = [
    { key: "rtl", tag: "common", label: "\u5171 \u2460 RTL\u2192Logic" },
    { key: "raw", tag: "common", label: "\u5171 \u2461 Logic Netlist" },
    { key: "opt", tag: "common", label: "\u5171 \u2462 Tech-indep Syn" },
    { key: "map", tag: "fpga", label: "F \u2463 LUT4 Techmap" },
    { key: "place", tag: "fpga", label: "F \u2464 Placement \u9000\u706B" },
    { key: "route", tag: "fpga", label: "F \u2465 Global+Detail Routing" },
    { key: "sta", tag: "fpga", label: "F \u2466 Timing (STA)" }
  ];
  var ASIC_STAGES = [
    ...FPGA_STAGES.slice(0, 3),
    { key: "amap", tag: "asic", label: "A \u2463 Standard Cell Map" },
    { key: "aplace", tag: "asic", label: "A \u2464 Row Placement \u9000\u706B" },
    { key: "aroute", tag: "asic", label: "A \u2465 CTS + Global Routing" },
    { key: "adetail", tag: "asic", label: "A \u2466 Detail Routing" },
    { key: "asta", tag: "asic", label: "A \u2467 Timing (STA)" },
    { key: "apower", tag: "asic", label: "A \u2468 Power + IR Drop" }
  ];
  var PNR = /* @__PURE__ */ new Set(["place", "route", "sta"]);
  var ASIC = /* @__PURE__ */ new Set(["amap", "aplace", "aroute", "adetail", "asta", "apower"]);
  var APHYS = /* @__PURE__ */ new Set(["aplace", "aroute", "adetail", "asta", "apower"]);
  var OTHER = { map: "amap", place: "aplace", route: "aroute", sta: "asta", amap: "map", aplace: "place", aroute: "route", asta: "sta" };
  var isNet = (k) => k === "raw" || k === "opt" || k === "map" || k === "amap";
  var SynthOverlay = class {
    /** `embedded`: the views live in a page pane (the IDE), not an overlay to close */
    constructor(core2, opts = {}) {
      __publicField(this, "core", core2);
      __publicField(this, "opts", opts);
      __publicField(this, "view");
      __publicField(this, "res", null);
      __publicField(this, "pnr", null);
      __publicField(this, "pnrErr", null);
      __publicField(this, "pnrBusy", false);
      __publicField(this, "stage", "rtl");
      __publicField(this, "nets", /* @__PURE__ */ new Map());
      __publicField(this, "sel", null);
      __publicField(this, "edges", true);
      __publicField(this, "files", []);
      __publicField(this, "pcf");
      __publicField(this, "anim", 0);
      __publicField(this, "gen", 0);
      __publicField(this, "target", "fpga");
      __publicField(this, "asic", null);
      __publicField(this, "asicErr", null);
      __publicField(this, "asicBusy", false);
      __publicField(this, "asicMs", 0);
      __publicField(this, "pnrMs", 0);
      __publicField(this, "synMs", 0);
      __publicField(this, "selNet", null);
      __publicField(this, "selNetA", null);
      __publicField(this, "selNetD", null);
      __publicField(this, "layers", [true, true, true, true]);
      __publicField(this, "power", true);
      __publicField(this, "showIr", false);
      this.view = new CanvasView($("synCanvas"));
      this.view.onPick = (b) => this.pick(b);
      if (!opts.embedded) $("synClose").onclick = () => this.close();
      $("synZin").onclick = () => this.view.zoom(1.4);
      $("synZout").onclick = () => this.view.zoom(1 / 1.4);
      $("synZfit").onclick = () => this.view.fit();
      $("synEdges").onclick = () => {
        this.edges = !this.edges;
        this.redrawLines();
      };
      $("synAnim").onclick = () => this.animate();
      $("synAsc").onclick = () => this.pnr && download(`${this.pnr.top}.asc`, this.pnr.asc);
      $("synPcf").onclick = () => this.pnr && download(`${this.pnr.top}.pcf`, this.pnr.pcf);
      $("synBin").onclick = () => this.pnr && download(`${this.pnr.top}.bin`, fromBase64(this.pnr.bin));
      $("synV").onclick = () => this.asic && download(`${this.asic.top}_vlib.v`, this.asic.verilog);
      $("synDef").onclick = () => this.asic && download(`${this.asic.top}.def`, this.asic.def);
      $("synTarget").onchange = () => this.setTarget($("synTarget").value);
      $("synTop").onchange = () => this.run($("synTop").value);
      if (!opts.embedded) document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("synOverlay").classList.contains("hidden")) this.close();
      });
      this.chips();
    }
    open(files, top, pcf, target, stage) {
      this.files = files;
      this.pcf = pcf;
      if (target) this.setTarget(target, false);
      if (stage) this.stage = stage;
      $("synOverlay").classList.remove("hidden");
      this.run(top);
    }
    /** the stage shown */
    get current() {
      return this.stage;
    }
    /** show a stage (the synthesis must have been started with `open`) */
    showStage(key) {
      if (ASIC.has(key) && this.target !== "asic") this.setTarget("asic", false);
      else if ((PNR.has(key) || key === "map") && this.target !== "fpga") this.setTarget("fpga", false);
      this.stage = key;
      this.show(key);
    }
    get synthesized() {
      return this.res !== null;
    }
    close() {
      this.stopAnim();
      $("synOverlay").classList.add("hidden");
    }
    async run(top) {
      const gen = ++this.gen;
      this.stopAnim();
      this.res = null;
      this.pnr = null;
      this.pnrErr = null;
      this.asic = null;
      this.asicErr = null;
      this.nets.clear();
      $("synInfo").textContent = "\u5408\u6210\u4E2D\u2026";
      $("synSide").innerHTML = "";
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.buttons();
      const t0 = performance.now();
      let res;
      try {
        res = await this.core.call({ cmd: "synth", files: this.files, top: top || null });
      } catch (e) {
        if (gen !== this.gen) return;
        $("synInfo").textContent = "\u5408\u6210\u5931\u6557\uFF1A\n" + String(e.message ?? e);
        $("synStats").innerHTML = "";
        return;
      }
      if (gen !== this.gen) return;
      this.res = res;
      const sel = $("synTop");
      sel.innerHTML = "";
      for (const m of res.modules.filter((m2) => !m2.test)) {
        const o = document.createElement("option");
        o.value = o.textContent = m.name;
        sel.appendChild(o);
      }
      sel.value = res.top;
      this.stats(performance.now() - t0);
      this.show(this.stage);
    }
    async runPnr() {
      if (!this.res || this.pnr || this.pnrBusy) return;
      const gen = this.gen;
      this.pnrBusy = true;
      const t0 = performance.now();
      const tick = setInterval(() => {
        if (gen === this.gen && PNR.has(this.stage)) $("synInfo").textContent = `\u4F48\u5C40\u7E5E\u7DDA\u4E2D\u2026\uFF08iCE40UP5K\uFF0C${((performance.now() - t0) / 1e3).toFixed(1)} s\uFF09`;
      }, 200);
      try {
        $("synInfo").textContent = "\u8F09\u5165\u6676\u7247\u8CC7\u6599\u5EAB\uFF08IceStorm chipdb-5k\uFF0C4 MB\uFF09\u2026";
        await this.core.chipdb();
        const r = await this.core.call({ cmd: "pnr", files: this.files, top: this.res.top, pcf: this.pcf ?? null, seed: 1 });
        if (gen !== this.gen) return;
        this.pnr = r;
        this.pnrMs = performance.now() - t0;
      } catch (e) {
        if (gen !== this.gen) return;
        this.pnrErr = String(e.message ?? e);
      } finally {
        clearInterval(tick);
        this.pnrBusy = false;
      }
      this.stats(this.synMs);
      this.buttons();
      if (PNR.has(this.stage) || this.stage === "cmp") this.show(this.stage);
    }
    setTarget(t, show = true) {
      this.target = t;
      $("synTarget").value = t;
      $("synTitle").textContent = t === "fpga" ? "\u5408\u6210 \u2192 FPGA\uFF08iCE40UP5K\uFF09" : "\u5408\u6210 \u2192 ASIC\uFF08vlib \u6A19\u6E96\u5143\u4EF6\uFF09";
      this.chips();
      const cur = ASIC.has(this.stage) !== (t === "asic") && OTHER[this.stage] ? OTHER[this.stage] : this.stage;
      if (this.res) this.stats(this.synMs);
      if (show) this.show(cur);
      else this.stage = cur;
    }
    async runAsic() {
      if (!this.res || this.asic || this.asicBusy) return;
      const gen = this.gen;
      this.asicBusy = true;
      const t0 = performance.now();
      const tick = setInterval(() => {
        if (gen === this.gen && ASIC.has(this.stage)) $("synInfo").textContent = `ASIC \u6D41\u7A0B\u4E2D\uFF1A\u6A19\u6E96\u5143\u4EF6\u5C0D\u61C9 \u2192 \u5217\u5F0F\u4F48\u5C40\u9000\u706B \u2192 \u5168\u57DF\u7E5E\u7DDA \u2192 STA\u2026\uFF08${((performance.now() - t0) / 1e3).toFixed(1)} s\uFF09`;
      }, 200);
      try {
        const r = await this.core.call({ cmd: "asic", files: this.files, top: this.res.top, seed: 1 });
        if (gen !== this.gen) return;
        this.asic = r;
        this.asicMs = performance.now() - t0;
      } catch (e) {
        if (gen !== this.gen) return;
        this.asicErr = String(e.message ?? e);
      } finally {
        clearInterval(tick);
        this.asicBusy = false;
      }
      this.stats(this.synMs);
      this.buttons();
      if (ASIC.has(this.stage) || this.stage === "cmp") this.show(this.stage);
    }
    chips() {
      const box = $("synChips");
      box.innerHTML = "";
      (this.target === "fpga" ? FPGA_STAGES : ASIC_STAGES).forEach((s, i) => {
        if (i) {
          const a = document.createElement("span");
          a.className = "arrow";
          a.textContent = "\u2192";
          box.appendChild(a);
        }
        const b = document.createElement("button");
        b.textContent = s.label;
        b.dataset.key = s.key;
        b.className = s.tag === "fpga" ? "tagf" : s.tag === "asic" ? "taga" : "";
        b.onclick = () => this.show(s.key);
        box.appendChild(b);
      });
      const sep = document.createElement("span");
      sep.className = "arrow";
      sep.textContent = "\u2502";
      const c = document.createElement("button");
      c.textContent = "\u21C4 FPGA vs ASIC";
      c.dataset.key = "cmp";
      c.title = "\u540C\u4E00\u500B\u8A2D\u8A08\u7684\u5169\u7A2E\u5BE6\u4F5C\u4E26\u6392\u6BD4\u8F03";
      c.onclick = () => this.show("cmp");
      box.append(sep, c);
    }
    /** stage-dependent buttons */
    buttons() {
      const p = PNR.has(this.stage), a = ASIC.has(this.stage);
      $("synAnim").classList.toggle("hidden", this.stage !== "place" && this.stage !== "aplace");
      $("synAnim").disabled = a ? !this.asic : !this.pnr;
      for (const id of ["synAsc", "synPcf", "synBin"]) {
        $(id).classList.toggle("hidden", !p);
        $(id).disabled = !this.pnr;
      }
      for (const id of ["synV", "synDef"]) {
        $(id).classList.toggle("hidden", !a);
        $(id).disabled = !this.asic;
      }
      $("synEdges").classList.toggle("hidden", this.stage === "place" || this.stage === "aplace" || this.stage === "cmp");
    }
    netView(key) {
      let v = this.nets.get(key);
      if (!v) {
        const nl = key === "amap" ? this.asic.map : this.res[key];
        const lev = levelize(nl);
        v = { nl, lev, lay: netScene(nl, lev), names: netNames(nl) };
        this.nets.set(key, v);
      }
      return v;
    }
    stats(ms) {
      this.synMs = ms;
      const r = this.res;
      if (this.target === "asic") {
        this.asicStats(ms);
        return;
      }
      const m = r.map.cells;
      const luts = m.filter((c) => c.t === "SB_LUT4").length;
      const ffs = m.filter((c) => c.t.includes("DFF")).length;
      const carry = m.filter((c) => c.t === "SB_CARRY").length;
      const brams = m.filter((c) => c.t === "SB_RAM40_4K").length;
      const lev = this.netView("map").lev;
      const items = [
        `\u9802\u5C64 <b>${r.top}</b>`,
        `\u9598 <b>${r.raw.cells.length}</b> \u2192 <b>${r.opt.cells.length}</b>`,
        `LUT4 <b>${luts}</b>`,
        `CARRY <b>${carry}</b>`,
        `DFF <b>${ffs}</b>`,
        ...brams ? [`BRAM <b>${brams}</b>`] : [],
        `LUT \u5C64\u6578 <b>${lev.depth}</b>`
      ];
      if (this.pnr) {
        const p = this.pnr;
        items.push(
          `LC <b>${p.lcs.length}</b>/5280\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09`,
          ...p.rams.length ? [`BRAM <b>${p.rams.length}</b>/30`] : [],
          `pip <b>${p.pips}</b>`,
          `F<sub>max</sub> <b>${p.timing.fmax.toFixed(1)}</b> MHz`,
          `\u95DC\u9375\u8DEF\u5F91 <b>${p.timing.period.toFixed(2)}</b> ns`
        );
      }
      items.push(`\u5408\u6210 <b>${ms.toFixed(0)}</b> ms` + (this.pnr ? `\uFF0C\u4F48\u5C40\u7E5E\u7DDA <b>${(this.pnrMs / 1e3).toFixed(1)}</b> s` : ""));
      $("synStats").innerHTML = items.join('<span class="sep">\u2502</span>');
    }
    asicStats(ms) {
      const r = this.res;
      const items = [`\u9802\u5C64 <b>${r.top}</b>`, `\u9598 <b>${r.raw.cells.length}</b> \u2192 <b>${r.opt.cells.length}</b>`];
      const a = this.asic;
      if (a) {
        const ffs = a.map.cells.filter((c) => c.t.includes("DFF")).length;
        items.push(
          `\u6A19\u6E96\u5143\u4EF6 <b>${a.map.cells.length}</b>\uFF08DFF ${ffs}\uFF09`,
          `\u9762\u7A4D <b>${fmtArea(a.area)}</b>`,
          `\u6676\u7C92 <b>${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)}</b> \xB5m\uFF08${a.die.rows} \u5217\uFF0C\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(0)}%\uFF09`,
          `\u7DDA\u9577 <b>${(a.route.wirelength / 1e3).toFixed(2)}</b> mm`,
          `F<sub>max</sub> <b>${a.timing.fmax.toFixed(1)}</b> MHz`
        );
      }
      items.push(`\u5408\u6210 <b>${ms.toFixed(0)}</b> ms` + (a ? `\uFF0CASIC \u6D41\u7A0B <b>${(this.asicMs / 1e3).toFixed(1)}</b> s` : ""));
      $("synStats").innerHTML = items.join('<span class="sep">\u2502</span>');
    }
    show(key) {
      if (!this.res) return;
      this.stopAnim();
      this.stage = key;
      this.sel = null;
      for (const b of $("synChips").querySelectorAll("button")) b.classList.toggle("cur", b.dataset.key === key);
      this.buttons();
      this.opts.onStage?.(key);
      const r = this.res;
      if (key === "cmp") {
        this.showCompare();
        return;
      }
      if (key === "rtl") {
        const counts = /* @__PURE__ */ new Map();
        for (const s of r.signals) {
          const p = s.name.includes(".") ? s.name.slice(0, s.name.lastIndexOf(".")) : "";
          counts.set(p, (counts.get(p) ?? 0) + 1);
        }
        this.view.set(hierScene(r.hier, counts));
        const bits = r.signals.reduce((a, s) => a + s.width, 0);
        this.info([
          "\u2460 RTL\u2192Logic",
          "\u89E3\u6790 Veryl\uFF08veryl-parser\uFF09\u2192 \u5C55\u958B package / enum / struct / \u53C3\u6578 \u2192 \u7531\u9802\u5C64\u5F80\u4E0B\u5BE6\u4F8B\u5316\u5B50\u6A21\u7D44\u4E26\u6524\u5E73\uFF08flatten\uFF09\uFF0C\u6BCF\u500B\u8A0A\u865F\u914D\u7F6E\u300C\u4F54\u4F4D\u300D\u7DDA\u3002",
          "",
          `\u9802\u5C64\uFF1A${r.top}\u3000\u5BE6\u4F8B ${r.hier.length - 1} \u500B\u3000\u6A21\u7D44\u7A2E\u985E ${new Set(r.hier.map((h) => h.module)).size}`,
          `\u57E0\uFF1A${r.ports.map((p) => `${p.dir === "in" ? "\u2192" : "\u2190"}${p.name}${p.width > 1 ? `[${p.width}]` : ""}`).join("  ")}`,
          `\u8A0A\u865F ${r.signals.length} \u500B\uFF0C\u5171 ${bits} bit`,
          ...r.warnings.length ? ["", "\u8B66\u544A\uFF1A", ...r.warnings] : []
        ]);
        this.side(this.rtlSide());
        return;
      }
      if (ASIC.has(key) && !this.asic) {
        this.view.set({ boxes: [], lines: [], texts: [] });
        this.side(document.createElement("div"));
        if (this.asicErr) {
          this.info(["ASIC \u6D41\u7A0B\u5931\u6557\uFF1A", this.asicErr]);
          return;
        }
        this.info(["ASIC \u6D41\u7A0B\u4E2D\u2026"]);
        this.runAsic();
        return;
      }
      if (APHYS.has(key)) {
        this.drawAsic(true);
        this.info(this.asicReport(key));
        this.side(this.asicSide(key));
        return;
      }
      if (isNet(key)) {
        const v = this.netView(key);
        this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, this.edges && edgeCount(v.nl) <= 6e3, null) });
        this.info(this.netReport(key, v));
        this.side(this.netSide(v));
        return;
      }
      if (!this.pnr) {
        this.view.set({ boxes: [], lines: [], texts: [] });
        this.side(document.createElement("div"));
        if (this.pnrErr) {
          const fit = /does not fit/.test(this.pnrErr);
          this.info(["\u4F48\u5C40\u7E5E\u7DDA\u5931\u6557\uFF1A", this.pnrErr, ...fit ? ["", "iCE40UP5K-SG48 \u53EA\u6709 5280 \u500B LC\u300139 \u500B IO \u8173\uFF1A\u6574\u9846 RV32I \u6838\u5FC3\uFF08\u66AB\u5B58\u5668\u6A94\u7528\u6B63\u53CD\u5668\uFF09\u653E\u4E0D\u4E0B\u3002\u8ACB\u6539\u7528\u300CRISC-V SoC\uFF08FPGA\uFF09\u300D\u7BC4\u4F8B\uFF0C\u6216\u6539\u770B ASIC \u6D41\u7A0B\u3002"] : []]);
          return;
        }
        this.info(["\u4F48\u5C40\u7E5E\u7DDA\u4E2D\u2026"]);
        this.runPnr();
        return;
      }
      this.drawPnr(true);
      this.info(this.pnrReport(key));
      this.side(this.pnrSide(key));
    }
    showCompare() {
      const p = this.pnr, a = this.asic;
      if (!p || !a) {
        this.view.set({ boxes: [], lines: [], texts: [] });
        this.side(document.createElement("div"));
        const lines = ["\u21C4 FPGA vs ASIC\uFF1A\u5169\u500B\u5F8C\u7AEF\u90FD\u8981\u8DD1\u5B8C\u624D\u80FD\u6BD4\u8F03"];
        lines.push(p ? "\u2713 FPGA \u4F48\u5C40\u7E5E\u7DDA\u5B8C\u6210" : this.pnrErr ? `\u2717 FPGA\uFF1A${this.pnrErr}` : "\u2026 FPGA \u4F48\u5C40\u7E5E\u7DDA\u4E2D");
        lines.push(a ? "\u2713 ASIC \u6D41\u7A0B\u5B8C\u6210" : this.asicErr ? `\u2717 ASIC\uFF1A${this.asicErr}` : "\u2026 ASIC \u6D41\u7A0B\u4E2D");
        this.info(lines);
        if (!p && !this.pnrErr) this.runPnr();
        if (!a && !this.asicErr) this.runAsic();
        return;
      }
      this.view.set(compareScene(p, a), true);
      const rows = compareRows(p, a);
      this.info([
        "\u21C4 FPGA vs ASIC\uFF1A\u540C\u4E00\u500B\u7DB2\u8868\uFF08\u5171 \u2460\u2013\u2462\uFF09\u5206\u5225\u8D70 iCE40 \u8207\u6A19\u6E96\u5143\u4EF6\u6D41\u7A0B",
        "FPGA \u7528\u73FE\u6210\u7684 LUT / \u53EF\u7A0B\u5F0F\u7E5E\u7DDA\u958B\u95DC\uFF0C\u5F48\u6027\u5927\u4F46\u6BCF\u500B\u908F\u8F2F\u548C\u6BCF\u6BB5\u7E5E\u7DDA\u90FD\u6162\u3001\u90FD\u8017\u96FB\uFF1BASIC \u628A\u908F\u8F2F\u76F4\u63A5\u505A\u6210\u96FB\u6676\u9AD4\u8207\u91D1\u5C6C\u7DDA\uFF0C\u9762\u7A4D\u5C0F\u3001\u5FEB\u3001\u7701\u96FB\uFF0C\u4F46\u8981\u6D41\u7247\u3002",
        "",
        `F_max\uFF1AFPGA ${p.timing.fmax.toFixed(1)} MHz vs ASIC ${a.timing.fmax.toFixed(1)} MHz\u3000\u5DE6\uFF1AiCE40 \u4F48\u5C40\uFF0C\u53F3\uFF1A\u6A19\u6E96\u5143\u4EF6\u6676\u7C92\uFF08\u653E\u5927\u5230\u540C\u9AD8\uFF09`
      ]);
      const d = document.createElement("div");
      d.innerHTML = '<h3>\u6BD4\u8F03</h3><div class="cmpw">' + table(["\u9805\u76EE", "FPGA", "ASIC"], rows.map((r) => [r[0], r[1], r[2]])) + '</div><p class="hint">\u529F\u8017\u4EE5\u5169\u8005 F<sub>max</sub> \u8F03\u4F4E\u8005\u70BA\u5171\u540C\u983B\u7387\uFF0C\u7FFB\u8F49\u7387\u4F86\u81EA\u540C\u4E00\u7D44\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u3002</p>';
      this.side(d);
    }
    drawPnr(fit) {
      const p = this.pnr;
      const k = this.stage;
      let color;
      if (k === "sta") {
        const max = Math.max(...p.lcs.map((l) => l.arr), 1e-9);
        color = (i) => heat(p.lcs[i].arr / max);
      }
      const scene = deviceScene(p, void 0, color);
      const crit = new Set(p.timing.crit_lcs);
      for (const b of scene.boxes) b.hl = b.id === this.sel || k === "sta" && crit.has(b.id);
      if (k === "route") scene.lines = this.edges ? routeLines(p, { net: this.selNet }) : [];
      if (k === "sta") scene.lines = routeLines(p, { dim: true, net: this.selNet });
      this.view.set(scene, fit);
    }
    pnrReport(key) {
      const p = this.pnr;
      if (key === "place") {
        const h = p.history;
        const chains = p.chains.map((c) => c.length);
        return [
          "\u2464 Placement \u9000\u706B\uFF08iCE40UP5K\uFF1A26\xD732 tile\uFF0C\u908F\u8F2F tile \u6BCF\u500B 8 \u500B LC\uFF09",
          "\u5148\u6253\u5305\uFF08LUT+FF+CARRY \u2192 LC\uFF09\uFF0C\u9032\u4F4D\u93C8\u653E\u5728\u6574\u6B04\u908F\u8F2F tile \u4E26\u5F9E LC 0 \u958B\u59CB\uFF1B\u5176\u9918\u4EE5\u6A21\u64EC\u9000\u706B\u6700\u5C0F\u5316\u7DDA\u9577\uFF08HPWL\uFF09\uFF0C\u540C\u4E00 tile \u7684 DFF \u5FC5\u9808\u540C clock / reset / \u908A\u7DE3\u3002",
          "",
          `LC ${p.lcs.length} \u500B\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09\uFF0C\u9032\u4F4D\u93C8 ${chains.length} \u689D${chains.length ? `\uFF08${chains.join(", ")} LC\uFF09` : ""}\uFF0CIO ${p.ios.length} \u500B${p.rams.length ? `\uFF0Cblock RAM ${p.rams.length} \u500B\uFF08RAM \u6B04 x = 6 / 19\uFF0C\u6BCF\u500B\u4F54\u4E0A\u4E0B\u5169\u500B tile\uFF09` : ""}`,
          `HPWL\uFF1A\u521D\u59CB ${h[0].cost.toFixed(0)} \u2192 \u9000\u706B\u5F8C ${h[h.length - 1].cost.toFixed(0)}\uFF08${h.length - 1} \u500B\u6EAB\u5EA6\u5FEB\u7167\uFF09\u3000\u6309\u300C\u25B6 \u9000\u706B\u52D5\u756B\u300D\u91CD\u64AD`
        ];
      }
      if (key === "route") {
        const glb = p.globals.map((g) => `${g.net} \u2192 glb_netwk_${g.glb}`).join("\uFF0C") || "\u7121";
        return [
          "\u2465 Global + Detail Routing",
          "clock / reset \u8D70\u5168\u57DF\u7DB2\u8DEF\uFF08\u4F86\u6E90 \u2192 fabout \u2192 glb_netwk \u2192 \u5404 tile \u7684 clk / s_r mux\uFF09\uFF1B\u5176\u9918\u4EE5 PathFinder \u5354\u5546\u64C1\u585E + A* \u5728 IceStorm \u7E5E\u7DDA\u5716\u4E0A\u627E\u8DEF\uFF08\u6BCF\u689D\u7DDA\u53EA\u80FD\u7D66\u4E00\u500B\u8A0A\u865F\uFF09\u3002",
          "",
          `\u5168\u57DF\uFF1A${glb}`,
          `${p.nets.length} \u689D net\uFF0C\u4F7F\u7528 ${p.pips} \u500B pip\uFF1B\u6BCF\u8F2A\u904E\u5EA6\u4F7F\u7528\u7684\u7DDA\uFF1A${p.route_iters.join(" \u2192 ")}`,
          "\u984F\u8272\uFF1A\u85CD\uFF1Dspan4\u3001\u7D2B\uFF1Dspan12\u3001\u7070\uFF1Dlocal / \u8F38\u5165\u3001\u7DA0\uFF1D\u5168\u57DF\u3001\u9EC3\uFF1DIO\uFF08\u9EDE LC \u770B\u7D30\u7BC0\uFF09"
        ];
      }
      const t = p.timing;
      return [
        "\u2466 Timing (STA)",
        "\u5EF6\u9072\u53D6\u81EA IceStorm timings_up5k\uFF08\u6162\u901F\u89D2\uFF09\uFF1ALC in\u2192out\u3001carry\u3001clk\u2192Q\u3001setup\uFF0C\u6BCF\u6BB5\u7E5E\u7DDA\u4F9D\u6240\u9A45\u52D5\u7684\u7DDA\u7A2E\u985E\u8A08 mux \u5EF6\u9072\uFF1Bclock \u8996\u70BA\u7406\u60F3\uFF08\u5168\u57DF\u7DB2\u8DEF\uFF09\u3002",
        "",
        `\u95DC\u9375\u8DEF\u5F91 ${t.period.toFixed(2)} ns \u2192 Fmax ${t.fmax.toFixed(2)} MHz\uFF08${t.endpoints} \u500B\u7AEF\u9EDE\uFF09\uFF1B\u7D05\u7DDA\uFF1D\u95DC\u9375\u8DEF\u5F91\uFF0CLC \u984F\u8272\uFF1D\u5230\u9054\u6642\u9593\uFF08\u7DA0\u65E9\u7D05\u665A\uFF09`,
        `\u529F\u8017\u4F30\u8A08\uFF08\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u7684\u7FFB\u8F49\u7387\uFF1Bnet \u96FB\u5BB9 \u2248 5 fF \xD7 \u8CA0\u8F09 + 8 fF \xD7 \u7E5E\u7DDA\u6BB5\uFF0C\u5168\u57DF\u6642\u8108\u7DB2\u8DEF\u6BCF\u62CD\uFF0Cblock RAM \u6BCF\u6B21\u5B58\u53D6 \u2248 24 pJ\uFF0C\u975C\u614B \u2248 75 \xB5A\uFF09\uFF1A\u5728 ${t.fmax.toFixed(1)} MHz \u7D04 ${t.power.total.toFixed(3)} mW\uFF08\u52D5\u614B ${t.power.dynamic.toFixed(3)} + \u975C\u614B ${t.power.static.toFixed(3)}\uFF1B\u6BCF\u9031\u671F ${(t.power.e_nets + t.power.e_clock + t.power.e_ram).toFixed(1)} pJ\uFF09`,
        ...t.fmax_wl ? [`\u6642\u5E8F\u5C0E\u5411\uFF1A\u7B2C\u4E00\u8F2A\u53EA\u770B\u7DDA\u9577 ${t.fmax_wl.toFixed(2)} MHz\uFF1B\u518D\u4EE5\u6BCF\u689D net \u7684\u95DC\u9375\u5EA6\uFF08\u7D93\u904E\u5B83\u7684\u6700\u9577\u8DEF\u5F91 / \u95DC\u9375\u8DEF\u5F91\uFF09\u52A0\u6B0A\u91CD\u65B0\u4F48\u5C40\uFF0C\u7E5E\u7DDA\u6642\u95DC\u9375 net \u512A\u5148\u8D70\u5FEB\u7684\u7DDA \u2192 ${t.fmax.toFixed(2)} MHz\uFF08\u53D6\u8F03\u5FEB\u7684\u4E00\u8F2A\uFF09`] : []
      ];
    }
    pnrSide(key) {
      const p = this.pnr;
      const d = document.createElement("div");
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = '<p class="hint">\u9EDE LC \u770B\u7D30\u7BC0\uFF08LUT \u771F\u503C\u8868\u3001DFF\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002</p>';
      d.appendChild(det);
      let h = "";
      if (key === "sta") {
        h += `<h3>\u95DC\u9375\u8DEF\u5F91\uFF08${p.timing.period.toFixed(2)} ns\uFF09</h3>` + table(["\u7D2F\u8A08 ns", "\u5EF6\u9072", "\u7D93\u904E"], p.timing.path.map((s) => [s.at.toFixed(2), s.delay.toFixed(3), esc(s.what)]));
      }
      if (key === "route") {
        h += `<h3>Net\uFF08${p.nets.length}\uFF0C\u4F9D pip \u6578\uFF09</h3>`;
      }
      h += `<h3>IO</h3>` + table(["\u8A0A\u865F", "\u65B9\u5411", "\u8173\u4F4D", "tile"], p.ios.map((io) => [esc(io.name), io.dir === "in" ? "in" : "out", io.pin, `${io.x},${io.y}/${io.z}`]));
      const div = document.createElement("div");
      div.innerHTML = h;
      d.appendChild(div);
      if (key === "route") {
        const list = document.createElement("div");
        list.className = "clist";
        const order = p.nets.map((n, i) => i).sort((a, b) => p.nets[b].pips - p.nets[a].pips);
        for (const i of order.slice(0, 400)) {
          const n = p.nets[i];
          const row = document.createElement("div");
          row.textContent = `${n.name}  ${n.pips} pip  ${n.sinks} \u8CA0\u8F09${n.global ? "  [\u5168\u57DF]" : ""}`;
          row.onclick = () => {
            this.selNet = i;
            this.drawPnr(false);
          };
          list.appendChild(row);
        }
        div.insertBefore(list, div.querySelector("h3:nth-of-type(2)"));
      }
      return d;
    }
    animate() {
      if (this.stage === "aplace") {
        this.animateAsic();
        return;
      }
      if (!this.pnr || this.stage !== "place") return;
      this.stopAnim();
      const p = this.pnr;
      let f = 0;
      const step = () => {
        const fr = p.history[f];
        const scene = deviceScene(p, fr.pos, void 0, fr.ram);
        this.view.set(scene, false);
        $("synInfo").textContent = `\u2464 \u9000\u706B\u52D5\u756B\uFF1A\u7B2C ${f + 1}/${p.history.length} \u500B\u5FEB\u7167\u3000\u6EAB\u5EA6 ${fr.temp.toFixed(2)}\u3000HPWL ${fr.cost.toFixed(0)}\u3000\u63A5\u53D7\u7387 ${(fr.accept * 100).toFixed(0)}%`;
        f++;
        if (f < p.history.length) this.anim = window.setTimeout(step, 90);
        else this.anim = window.setTimeout(() => {
          this.anim = 0;
          this.info(this.pnrReport("place"));
        }, 1200);
      };
      step();
    }
    animateAsic() {
      const a = this.asic;
      if (!a) return;
      this.stopAnim();
      let f = 0;
      const step = () => {
        const fr = a.history[f];
        this.view.set(dieScene(a, fr.pos), false);
        $("synInfo").textContent = `A \u2464 \u9000\u706B\u52D5\u756B\uFF1A\u7B2C ${f + 1}/${a.history.length} \u500B\u5FEB\u7167\u3000\u6EAB\u5EA6 ${fr.temp.toFixed(2)}\u3000HPWL ${(fr.cost / 1e3).toFixed(2)} mm\u3000\u63A5\u53D7\u7387 ${(fr.accept * 100).toFixed(0)}%`;
        f++;
        if (f < a.history.length) this.anim = window.setTimeout(step, 110);
        else this.anim = window.setTimeout(() => {
          this.anim = 0;
          this.info(this.asicReport("aplace"));
        }, 1200);
      };
      step();
    }
    drawAsic(fit) {
      const a = this.asic;
      const k = this.stage;
      let color;
      if (k === "asta") {
        const max = Math.max(...a.cells.map((c) => c[3]), 1e-9);
        color = (i) => heat(a.cells[i][3] / max);
      }
      if (k === "apower") {
        const v = this.showIr ? a.power.ir : a.power.cell;
        const max = Math.max(...v, 1e-12);
        color = (i) => heat(v[i] / max);
      }
      const scene = dieScene(a, void 0, color);
      for (const b of scene.boxes) b.hl = b.id === this.sel || k === "asta" && b.id < a.cells.length && a.cells[b.id][4] === 1;
      if (k === "aroute") {
        scene.bg = [...scene.bg ?? [], ...congestion(a)];
        scene.lines = this.edges ? asicRouteLines(a, { net: this.selNetA }) : [];
      }
      if (k === "adetail") {
        const pw = powerScene(a);
        scene.bg = [...scene.bg ?? [], ...pw.bg];
        scene.lines = [...this.power ? pw.lines : [], ...this.edges ? detailLines(a, this.selNetD, this.layers) : []];
      }
      if (k === "asta") scene.lines = asicRouteLines(a, { dim: true });
      this.view.set(scene, fit);
    }
    asicReport(key) {
      const a = this.asic;
      if (key === "aplace") {
        const h = a.history;
        return [
          `A \u2464 Row Placement \u9000\u706B\uFF08\u6676\u7C92 ${a.die.w.toFixed(1)} \xD7 ${a.die.h.toFixed(1)} \xB5m\uFF0C${a.die.rows} \u5217 \xD7 ${a.die.sites} site\uFF09`,
          `\u4F9D\u76EE\u6A19\u5229\u7528\u7387\u6C7A\u5B9A\u6676\u7C92\u5927\u5C0F\uFF08${(a.die.util * 100).toFixed(0)}%\uFF1B\u592A\u64E0\u7E5E\u4E0D\u901A\u5C31\u81EA\u52D5\u653E\u5927\uFF09\uFF0CIO \u8173\u5E73\u5747\u653E\u5728\u56DB\u5468\uFF08\u8F38\u5165\uFF1A\u5DE6\u3001\u4E0A\uFF1B\u8F38\u51FA\uFF1A\u53F3\u3001\u4E0B\uFF09\u3002\u521D\u59CB\u4F9D\u7DB2\u8868\u9806\u5E8F\u86C7\u5F62\u586B\u5217\uFF0C\u518D\u4EE5\u6A21\u64EC\u9000\u706B\u6700\u5C0F\u5316 HPWL + \u5BC6\u5EA6\u61F2\u7F70\uFF1A\u6BCF\u4E00\u6B65\u628A\u5143\u4EF6\u79FB\u5230\u7A7A\u4F4D\u6216\u8207\u53E6\u4E00\u500B\u5143\u4EF6\u4EA4\u63DB\uFF0C\u6C38\u9060\u4FDD\u6301\u5408\u6CD5\uFF08\u4E0D\u91CD\u758A\u3001\u5C0D\u9F4A site\uFF09\uFF1B16 \xD7 16 \xB5m \u7684\u683C\u5B50\u8D85\u904E\u76EE\u6A19\u5BC6\u5EA6 ${(a.die.target_density * 100).toFixed(0)}% \u7684\u90E8\u5206\u8981\u4ED8\u4EE3\u50F9\uFF0C\u5143\u4EF6\u624D\u4E0D\u6703\u5168\u64E0\u5230 IO \u8173\u65C1\u908A\u3001\u7559\u4E0B\u5C40\u90E8\u7E5E\u4E0D\u901A\u7684\u71B1\u9EDE\u3002`,
          `\u6700\u6EFF\u7684\u683C\u5B50 ${(a.die.max_density * 100).toFixed(0)}%`,
          "",
          `${a.cells.length} \u500B\u5143\u4EF6\uFF0C\u5217\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(1)}%\uFF1BHPWL\uFF1A\u521D\u59CB ${(h[0].cost / 1e3).toFixed(2)} mm \u2192 \u9000\u706B\u5F8C ${(h[h.length - 1].cost / 1e3).toFixed(2)} mm\u3000\u6309\u300C\u25B6 \u9000\u706B\u52D5\u756B\u300D\u91CD\u64AD`,
          "\u984F\u8272\uFF1A\u6A58\uFF1DDFF\u3001\u9EC3\uFF1DMUX2\u3001\u85CD\uFF1DAND/OR \u985E\u3001\u7D2B\uFF1DXOR/AOI/OAI\u3001\u7DA0\uFF1DINV\u3001\u9752\uFF1DBUF\uFF1B\u7DA0/\u7D05\u5C0F\u65B9\u584A\uFF1D\u8F38\u5165/\u8F38\u51FA\u8173"
        ];
      }
      if (key === "aroute") {
        const r = a.route;
        const c = a.cts;
        return [
          `A \u2465 CTS + Global Routing\uFF08${r.gx} \xD7 ${r.gy} \u500B gcell\uFF0C\u6BCF\u683C 4 \xB5m\uFF1B\u6C34\u5E73\u7DDA\u8D70 M2/M4\u3001\u5782\u76F4\u7DDA\u8D70 M3/M5\uFF0C\u6BCF\u908A ${r.cap} \u8ECC\uFF09`,
          `\u6642\u8108\u6A39\u5408\u6210\uFF08CTS\uFF09\uFF1A\u4F48\u5C40\u5B8C\u6210\u5F8C\uFF0C\u628A clock\uFF08\u8207\u975E\u540C\u6B65 reset\uFF09\u7684\u8CA0\u8F09\u4F9D\u4F4D\u7F6E\u905E\u8FF4\u5C0D\u534A\u5207\uFF08\u6CBF\u8F03\u9577\u7684\u65B9\u5411\u53D6\u4E2D\u4F4D\u6578\uFF0C\u50CF H-tree\uFF09\uFF0C\u6BCF\u7FA4 \u2264 16 \u500B\u8CA0\u8F09\u7531\u4E00\u500B CLKBUF \u9A45\u52D5\uFF0C\u7DE9\u885D\u5668\u653E\u5728\u6240\u9A45\u52D5\u8005\u7684\u91CD\u5FC3\uFF1B\u5E73\u8861\u7684\u5207\u6CD5\u8B93\u6BCF\u500B\u6B63\u53CD\u5668\u7D93\u904E\u4E00\u6A23\u591A\u7D1A\u3001\u5DEE\u4E0D\u591A\u9577\u7684\u7DDA \u2192 skew \u5C0F\u3002`,
          c.buffers ? `\u2192 ${c.trees.map((t2) => `${t2.net}\uFF1A${t2.sinks} \u500B\u8CA0\u8F09\uFF0C${t2.buffers} \u500B CLKBUF\uFF0C${t2.levels} \u7D1A`).join("\uFF1B")}\uFF1B\u63D2\u5165\u5EF6\u9072 ${a.timing.insertion.toFixed(3)} ns\uFF0Cskew ${(a.timing.skew * 1e3).toFixed(0)} ps` : "\u2192 \u8CA0\u8F09\u4E0D\u591A\uFF08\u2264 16\uFF09\uFF0C\u4E0D\u9700\u8981\u6642\u8108\u6A39",
          "\u6BCF\u689D net \u7684\u7AEF\u9EDE\u4F9D Prim \u6700\u5C0F\u751F\u6210\u6A39\u9806\u5E8F\uFF0C\u7528 A* \u5F9E\u7AEF\u9EDE\u9023\u5230\u5DF2\u5EFA\u597D\u7684\u6A39\uFF1B\u8D85\u904E\u5BB9\u91CF\u7684\u908A\u4EE5 PathFinder\uFF08\u73FE\u6CC1 + \u6B77\u53F2\u6210\u672C\uFF09\u5354\u5546\u91CD\u7E5E\uFF0C\u76F4\u5230\u6C92\u6709\u6EA2\u51FA\u3002",
          "",
          `${r.nets.length} \u689D net\uFF0C\u7E3D\u7DDA\u9577 ${(r.wirelength / 1e3).toFixed(2)} mm\uFF0Cvia ${r.vias} \u500B\uFF1B\u6BCF\u8F2A\u6EA2\u51FA\uFF1A${r.iters.join(" \u2192 ")}`,
          "\u984F\u8272\uFF1A\u85CD\uFF1D\u6C34\u5E73\u3001\u7D2B\uFF1D\u5782\u76F4\u3001\u7DA0\uFF1Dclock / reset\uFF1B\u5E95\u8272\uFF1D\u64C1\u585E\uFF08\u7DA0\u9B06 \u2192 \u7D05\u6EFF\uFF09\u3002\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\u3001\u9EDE\u53F3\u5074 net \u9AD8\u4EAE\u3002"
        ];
      }
      if (key === "apower") {
        const p = a.power;
        const e = p.e_nets + p.e_clock + p.e_internal + p.e_sram;
        return [
          "A \u2468 Power + IR Drop",
          `\u4EE5\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u6700\u5F8C\u7684\u7DB2\u8868 ${p.cycles} \u500B\u9031\u671F\uFF08\u6709 reset \u5C31\u5148\u62C9\u5169\u62CD\uFF09\uFF0C\u7D71\u8A08\u6BCF\u689D net \u7684\u7FFB\u8F49\u7387 \u03B1\uFF1B\u5207\u63DB\u529F\u8017 = \xBD\xB7\u03B1\xB7C\xB7V\xB2\xB7f\uFF08C = \u8CA0\u8F09\u8173\u4F4D + 0.2 fF/\xB5m \u7684\u5BE6\u969B\u7DDA\u9577\uFF0CV = 1.2 V\uFF09\uFF0C\u6642\u8108\u6A39\u6BCF\u62CD\u5145\u653E\u96FB\uFF1B\u5143\u4EF6\u5167\u90E8\u80FD\u91CF\u4F9D\u5927\u5C0F\u8A08\u3001\u6B63\u53CD\u5668\u6BCF\u62CD\u6709\u6642\u8108\u80FD\u91CF\u3001SRAM \u6BCF\u6B21\u5B58\u53D6\uFF1B\u6F0F\u96FB\u4F9D\u9762\u7A4D\u3002`,
          `IR drop\uFF1A\u6BCF\u500B\u5143\u4EF6\u7684\u5E73\u5747\u96FB\u6D41\u6D41\u904E\u6240\u5728\u5217\u7684 VDD \u8ECC\u8207 VSS \u8ECC\uFF1B\u5169\u689D\u96FB\u6E90\u5E36\u4E4B\u9593\u7684\u8ECC\u662F\u5169\u7AEF\u4F9B\u96FB\u7684\u96FB\u963B\u7DDA\uFF08M1 0.2 \u03A9/\xB5m\uFF09\uFF0C\u7B97\u51FA\u6BCF\u500B\u5143\u4EF6\u770B\u5230\u7684\u58D3\u964D\u3002`,
          "",
          `\u6BCF\u9031\u671F\u80FD\u91CF ${e.toFixed(2)} pJ\uFF08\u8A0A\u865F ${p.e_nets.toFixed(2)}\u3001\u6642\u8108\u6A39 ${p.e_clock.toFixed(2)}\u3001\u5143\u4EF6\u5167\u90E8 ${p.e_internal.toFixed(2)}\u3001SRAM ${p.e_sram.toFixed(2)}\uFF09\u2192 \u5728 Fmax ${p.freq.toFixed(1)} MHz\uFF1A${p.total.toFixed(3)} mW\uFF08\u52D5\u614B ${p.dynamic.toFixed(3)}\u3001\u6F0F\u96FB ${p.leakage.toFixed(4)}\uFF09`,
          `\u6700\u5927 IR drop ${p.ir_worst.toFixed(2)} mV\uFF08${(p.ir_worst / 12).toFixed(2)}% of VDD\uFF09\uFF1B\u984F\u8272\uFF1D${this.showIr ? "IR drop" : "\u6BCF\u500B\u5143\u4EF6\u7684\u529F\u8017"}\uFF08\u7DA0\u4F4E\u7D05\u9AD8\uFF09\uFF0C\u5074\u6B04\u53EF\u5207\u63DB`
        ];
      }
      if (key === "adetail") {
        const d = a.detail;
        const um = (x) => (x / 1e3).toFixed(2) + " mm";
        return [
          `A \u2466 Detail Routing\uFF08\u8ECC\u9053\u683C\u9EDE\uFF1A\u6BCF ${(a.die.row_h / d.tracks).toFixed(1)} \xB5m \u4E00\u689D\uFF0C${d.nx} \xD7 ${d.ny} \xD7 4 \u5C64\uFF1BM2/M4 \u6C34\u5E73\u3001M3/M5 \u5782\u76F4\uFF09`,
          "\u6BCF\u689D net \u53EA\u5728\u5168\u57DF\u7E5E\u7DDA\u9078\u7684 gcell \u8D70\u5ECA\u5167\uFF08\u5916\u52A0\u4E00\u5708\uFF09\u4EE5 A* \u627E\u8DEF\uFF1A\u7AEF\u9EDE\u4F9D Prim \u9806\u5E8F\u9023\u5230\u5DF2\u5EFA\u597D\u7684\u6A39\uFF0C\u63DB\u5C64\u4E00\u500B via \u6210\u672C\u8F03\u9AD8\uFF1B\u6BCF\u500B\u683C\u9EDE\u53EA\u80FD\u5C6C\u65BC\u4E00\u689D net\uFF08\u6240\u4EE5\u6C92\u6709\u77ED\u8DEF\uFF09\uFF0C\u91CD\u758A\u4EE5 PathFinder \u5354\u5546\u91CD\u7E5E\uFF0C\u5361\u4F4F\u7684 net \u8D70\u5ECA\u6703\u52A0\u5BEC\u3002\u5143\u4EF6\u8173\u4F4D\u5F9E M1 \u7D93 via \u4E0A\u4F86\uFF0CSRAM \u5DE8\u96C6\u4E0A\u65B9\u64CB\u4F4F M2/M3\uFF0CIO \u8173\u5728 M5\u3002",
          "",
          `\u96FB\u6E90\u7DB2\u8DEF\uFF1A\u6BCF\u689D\u5217\u908A\u754C\u4E00\u689D M1 \u96FB\u6E90\u8ECC\uFF08VSS / VDD \u4EA4\u66FF\uFF0C\u5171 ${a.pdn.rails} \u689D\uFF09\uFF0CM5 \u5782\u76F4\u96FB\u6E90\u5E36 ${a.pdn.straps.length} \u689D\uFF08VDD / VSS \u6210\u5C0D\uFF0C\u6BCF 40 \xB5m \u4E00\u5C0D\uFF09\uFF0C${a.pdn.vias} \u500B via \u758A\u628A\u5E36\u5B50\u63A5\u5230\u540C\u540D\u7684\u8ECC\uFF1B\u7E5E\u7DDA\u5668\u907F\u958B\u5E36\u5B50\u8207 via \u758A\u3002\u7A7A\u4F4D\u88DC\u4E0A ${a.pdn.fillers.length / 3} \u500B\u586B\u5145\u5143\u4EF6\uFF08FILL8/4/2/1\uFF0C\u6DF1\u7070\uFF09\uFF0C\u8B93\u4E95\u8207\u96FB\u6E90\u8ECC\u9023\u7E8C\u3002`,
          `\u7DDA\u9577 ${um(d.wirelength)}\uFF08M2 ${um(d.per_layer[0])}\u3001M3 ${um(d.per_layer[1])}\u3001M4 ${um(d.per_layer[2])}\u3001M5 ${um(d.per_layer[3])}\uFF09\uFF0Cvia ${d.vias} \u500B\uFF1B\u885D\u7A81 ${d.conflicts}\u3001\u672A\u63A5\u901A ${d.opens}\uFF1B\u6BCF\u8F2A\u885D\u7A81\uFF1A${d.iters.join(" \u2192 ")}`,
          d.nets.length ? "\u984F\u8272\uFF1A\u85CD M2\u3001\u7D05 M3\u3001\u7DA0 M4\u3001\u9EC3 M5\uFF1B\u5074\u6B04\u53EF\u5207\u63DB\u5C64\u3001\u9EDE net \u9AD8\u4EAE\u3002\u9019\u4E00\u6B65\u7684\u7DDA\u9577\u4E5F\u56DE\u994B\u7D66 STA\u3002" : `\uFF08\u5171 ${d.segments} \u6BB5\u7DDA\uFF0C\u592A\u591A\u4E0D\u756B\uFF0C\u53EA\u5217\u7D71\u8A08\uFF09`
        ];
      }
      const t = a.timing;
      return [
        "A \u2467 Timing (STA)",
        "\u5143\u4EF6\u5EF6\u9072 = \u672C\u5FB5\u5EF6\u9072 + \u6BCF\u6247\u51FA\u8CA0\u8F09 \xD7 \u6247\u51FA\uFF1B\u7DDA\u5EF6\u9072 = \u9A45\u52D5\u6574\u689D\u7E5E\u7DDA\u7684\u96FB\u5BB9 + \u5230\u8A72\u8CA0\u8F09\u7684\u5206\u4F48 RC\uFF08\u4F9D\u66FC\u54C8\u9813\u8DDD\u96E2\uFF09\u3002\u8DEF\u5F91\u8D77\u9EDE\u70BA\u8F38\u5165\u8173\u8207 DFF\uFF08clk\u2192Q\uFF09\uFF0C\u7D42\u9EDE\u70BA DFF D\uFF08\u52A0 setup\uFF09\u8207\u8F38\u51FA\u8173\uFF1Bclock \u8996\u70BA\u7406\u60F3\u3002",
        "",
        `\u95DC\u9375\u8DEF\u5F91 ${t.period.toFixed(3)} ns \u2192 Fmax ${t.fmax.toFixed(1)} MHz\uFF08${t.endpoints} \u500B\u7AEF\u9EDE\uFF09\uFF1B\u7D05\u7DDA\uFF1D\u95DC\u9375\u8DEF\u5F91\uFF0C\u5143\u4EF6\u984F\u8272\uFF1D\u5230\u9054\u6642\u9593\uFF08\u7DA0\u65E9\u7D05\u665A\uFF09`,
        `\u6642\u5E8F\u5C0E\u5411\uFF1A\u53EA\u770B\u7DDA\u9577\u7684\u4F48\u5C40 ${t.fmax_wl.toFixed(1)} MHz\uFF1B\u4EE5 net \u95DC\u9375\u5EA6\u52A0\u6B0A\u5F8C\u518D\u9000\u706B\uFF08\u5FAE\u8ABF + \u5C0F\u8A2D\u8A08\u91CD\u65B0\u9000\u706B\uFF0C\u53EA\u53D6\u7E5E\u5F97\u901A\u7684\uFF09\u2192 ${t.fmax_ideal.toFixed(1)} MHz\uFF08\u7406\u60F3\u6642\u8108\uFF09`,
        `\u6642\u8108\u6A39\u4E4B\u5F8C\uFF08propagated clock\uFF09\uFF1A\u8DEF\u5F91\u5F9E\u767C\u9001\u7AEF\u6B63\u53CD\u5668\u7684\u6642\u8108\u5230\u9054\u6642\u9593\u51FA\u767C\u3001\u5C0D\u63A5\u6536\u7AEF\u7684\u6642\u8108\u6AA2\u67E5 setup \u2192 ${t.fmax.toFixed(1)} MHz\uFF1Bskew ${(t.skew * 1e3).toFixed(0)} ps\u3002`,
        `Hold \u6AA2\u67E5\uFF08\u6700\u77ED\u8DEF\u5F91\uFF1A\u6700\u65E9\u5230\u9054 \u2265 \u63A5\u6536\u6642\u8108 + hold\uFF09\uFF1A\u6700\u5DEE\u9918\u88D5 ${t.hold_slack.toFixed(3)} ns${a.cts.hold_bufs ? `\uFF0C\u63D2\u5165 ${a.cts.hold_bufs} \u500B\u5EF6\u9072 BUF \u4FEE\u6B63` : "\uFF0C\u6C92\u6709\u9055\u898F"}\u3002`
      ];
    }
    asicSide(key) {
      const a = this.asic;
      const d = document.createElement("div");
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = '<p class="hint">\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\uFF08\u7A2E\u985E\u3001\u4F4D\u7F6E\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002</p>';
      d.appendChild(det);
      const div = document.createElement("div");
      if (key === "apower") {
        const p = a.power;
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = this.showIr;
        cb.onchange = () => {
          this.showIr = cb.checked;
          this.drawAsic(false);
          this.info(this.asicReport("apower"));
        };
        lab.append(cb, " \u986F\u793A IR drop\uFF08\u5426\u5247\u986F\u793A\u529F\u8017\uFF09");
        div.appendChild(lab);
        const byType = /* @__PURE__ */ new Map();
        a.map.cells.forEach((c, i) => byType.set(c.t, (byType.get(c.t) ?? 0) + p.cell[i]));
        div.insertAdjacentHTML("beforeend", `<h3>\u6BCF\u9031\u671F\u80FD\u91CF\uFF08pJ\uFF09</h3>` + table(["\u4F86\u6E90", "pJ"], [["\u8A0A\u865F net", p.e_nets.toFixed(3)], ["\u6642\u8108\u6A39", p.e_clock.toFixed(3)], ["\u5143\u4EF6\u5167\u90E8", p.e_internal.toFixed(3)], ["SRAM", p.e_sram.toFixed(3)]]) + `<h3>\u529F\u8017\uFF08\u4F9D\u5143\u4EF6\u7A2E\u985E\uFF0C\xB5W\uFF09</h3>` + table(["\u5143\u4EF6", "\xB5W"], [...byType.entries()].sort((x, y) => y[1] - x[1]).map(([t, v]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, v.toFixed(2)])));
      } else if (key === "adetail") {
        const d2 = a.detail;
        div.innerHTML = `<h3>\u5C64</h3>`;
        const pw = document.createElement("label");
        pw.style.display = "block";
        const pcb = document.createElement("input");
        pcb.type = "checkbox";
        pcb.checked = this.power;
        pcb.onchange = () => {
          this.power = pcb.checked;
          this.drawAsic(false);
        };
        pw.append(pcb, ` \u96FB\u6E90\u7DB2\u8DEF\uFF08\u7D05 VDD\u3001\u85CD VSS\uFF09`);
        div.appendChild(pw);
        ["M2 \u6C34\u5E73", "M3 \u5782\u76F4", "M4 \u6C34\u5E73", "M5 \u5782\u76F4"].forEach((name, l) => {
          const lab = document.createElement("label");
          lab.style.display = "block";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = this.layers[l];
          cb.onchange = () => {
            this.layers[l] = cb.checked;
            this.drawAsic(false);
          };
          lab.append(cb, ` `, Object.assign(document.createElement("span"), { className: "sw", style: `background:${LAYER_COLOR[l]}` }), `${name}\u3000${(d2.per_layer[l] / 1e3).toFixed(2)} mm`);
          div.appendChild(lab);
        });
        if (d2.nets.length) {
          const h = document.createElement("h3");
          h.textContent = `Net\uFF08${d2.nets.length}\uFF0C\u4F9D\u7DDA\u9577\uFF09`;
          div.appendChild(h);
          const list = document.createElement("div");
          list.className = "clist";
          const order = d2.nets.map((_, i) => i).sort((x, y) => d2.nets[y].len - d2.nets[x].len);
          for (const i of order.slice(0, 400)) {
            const n = d2.nets[i];
            const row = document.createElement("div");
            row.textContent = `${n.name}  ${n.len.toFixed(1)} \xB5m  ${n.vias.length / 3} via`;
            row.onclick = () => {
              this.selNetD = i;
              this.drawAsic(false);
            };
            list.appendChild(row);
          }
          div.appendChild(list);
        }
      } else if (key === "asta") {
        div.innerHTML = `<h3>\u95DC\u9375\u8DEF\u5F91\uFF08${a.timing.period.toFixed(3)} ns\uFF09</h3>` + table(["\u7D2F\u8A08 ns", "\u5EF6\u9072", "\u7D93\u904E"], a.timing.path.map((s) => [s.at.toFixed(3), s.delay.toFixed(3), esc(s.what)]));
      } else if (key === "aroute") {
        div.innerHTML = `<h3>Net\uFF08${a.route.nets.length}\uFF0C\u4F9D\u7DDA\u9577\uFF09</h3>`;
        const list = document.createElement("div");
        list.className = "clist";
        const order = a.route.nets.map((_, i) => i).sort((x, y) => a.route.nets[y].len - a.route.nets[x].len);
        for (const i of order.slice(0, 400)) {
          const n = a.route.nets[i];
          const row = document.createElement("div");
          row.textContent = `${n.name}  ${n.len.toFixed(0)} \xB5m  ${n.vias} via${n.clock ? "  [clock/reset]" : ""}`;
          row.onclick = () => {
            this.selNetA = i;
            this.drawAsic(false);
          };
          list.appendChild(row);
        }
        div.appendChild(list);
      } else {
        const areaOf = /* @__PURE__ */ new Map();
        a.cells.forEach(([, , w, , , h], i) => {
          const t = a.map.cells[i].t;
          areaOf.set(t, (areaOf.get(t) ?? 0) + w * a.die.site_w * h * a.die.row_h);
        });
        div.innerHTML = `<h3>\u5143\u4EF6\u6578\u91CF</h3>` + table(["\u5143\u4EF6", "\u6578\u91CF", "\u9762\u7A4D \xB5m\xB2"], a.counts.map(([t, n]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, String(n), (areaOf.get(t) ?? 0).toFixed(0)]));
      }
      div.insertAdjacentHTML("beforeend", `<h3>IO \u8173</h3>` + table(["\u8A0A\u865F", "\u65B9\u5411", "x \xB5m", "y \xB5m"], a.pins.map((p) => [esc(p.name), p.dir, p.x.toFixed(1), p.y.toFixed(1)])));
      d.appendChild(div);
      return d;
    }
    stdDetail() {
      const det = document.getElementById("synDetail");
      if (!det || !this.asic) return;
      if (this.sel === null) {
        det.innerHTML = '<p class="hint">\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\uFF08\u7A2E\u985E\u3001\u4F4D\u7F6E\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002</p>';
        return;
      }
      const a = this.asic;
      const v = this.netView("amap");
      const c = a.map.cells[this.sel];
      const [row, site, w, arr, crit] = a.cells[this.sel];
      const lib = a.lib.find((l) => l.name === c.t);
      let h = `<h3><span class="sw" style="background:${stdColor(c.t)}"></span>#${this.sel} ${c.t}${crit ? "\uFF08\u95DC\u9375\u8DEF\u5F91\uFF09" : ""}</h3>`;
      h += `<p>\u7B2C ${row} \u5217\uFF0Csite ${site}\u2013${site + w - 1}\uFF08x = ${(site * a.die.site_w).toFixed(1)} \xB5m\uFF09<br>\u8F38\u51FA\u5230\u9054\u6642\u9593 ${arr.toFixed(3)} ns</p>`;
      if (lib) h += `<p><code>${esc(lib.verilog)}</code></p>`;
      if (c.t === "SRAM") {
        const n = (k) => parseInt(c.p?.[k] ?? "0", 2);
        h += `<p>SRAM \u5DE8\u96C6\uFF08\u8A18\u61B6\u9AD4\u7DE8\u8B6F\u5668\u7522\u751F\u7684\u786C\u5DE8\u96C6\uFF09\uFF1A${n("DEPTH")} \u5B57 \xD7 ${n("WIDTH")} bit\uFF0C\u4E00\u500B\u5BEB\u5165\u57E0\u3001\u4E00\u500B\u540C\u6B65\u8B80\u53D6\u57E0\uFF08RA \u5728 CK \u6B63\u7DE3\u53D6\u6A23\uFF0CRDATA \u4E0B\u4E00\u62CD\u6709\u6548\uFF09\uFF1B\u4F54 ${w} site \xD7 ${a.cells[this.sel][5]} \u5217\u3002</p>`;
      }
      h += table(["\u63A5\u8173", "\u8A0A\u865F"], c.c.map(([p, b]) => [p, esc(bitName(v.names, b))]));
      det.innerHTML = h;
    }
    stopAnim() {
      if (this.anim) {
        clearTimeout(this.anim);
        this.anim = 0;
      }
    }
    redrawLines() {
      $("synEdges").textContent = `\u2301 \u9023\u7DDA\uFF1A${this.edges ? "\u958B" : "\u95DC"}`;
      const k = this.stage;
      if (PNR.has(k)) {
        if (this.pnr) this.drawPnr(false);
        return;
      }
      if (APHYS.has(k)) {
        if (this.asic) this.drawAsic(false);
        return;
      }
      if (!isNet(k)) return;
      const v = this.netView(k);
      const all = this.edges && edgeCount(v.nl) <= 6e3;
      for (const b of v.lay.scene.boxes) b.hl = b.id === this.sel;
      this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, all, this.sel) }, false);
    }
    netReport(key, v) {
      const r = this.res;
      const types = countTypes(v.nl).map(([t, n]) => `${shortType(t)} ${n}`).join("  ");
      const ffs = v.nl.cells.filter((c) => c.t.includes("DFF")).length;
      const big = edgeCount(v.nl) > 6e3 ? "\uFF08\u9023\u7DDA\u592A\u591A\uFF1A\u53EA\u756B\u9078\u53D6\u5143\u4EF6\u7684\u6247\u5165/\u6247\u51FA\uFF09" : "";
      if (key === "raw") return [
        "\u2461 Logic Netlist",
        "\u6BCF\u500B assign / always_comb / always_ff \u7D93\u300C\u7B26\u865F\u57F7\u884C\u300D\u8B8A\u6210 2 \u8F38\u5165\u9598\u3001MUX \u8207 DFF\uFF1Aif/case \u2192 MUX\uFF08\u5E38\u6578\u6A19\u7C64\u7684 case \u2192 \u5E73\u884C one-hot\uFF09\uFF0Cfor \u5C55\u958B\uFF0Cfunction \u5167\u5D4C\uFF0Calways_ff \u2192 $_DFF_* / $_SDFF_*\u3002",
        "\u5EFA\u9598\u6642\u5C31\u505A\u5C40\u90E8\u5E38\u6578\u647A\u758A\u8207 structural hashing\uFF1B\u9019\u88E1\u5DF2\u89E3\u6790\u4F54\u4F4D\u5225\u540D\uFF0C\u4F46\u9084\u6C92\u505A\u6574\u9AD4\u6700\u4F73\u5316\u3002",
        "",
        `${v.nl.cells.length} \u500B\u5143\u4EF6\uFF1A${types}`,
        `\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64\uFF0CDFF ${ffs} \u500B ${big}`
      ];
      if (key === "opt") {
        const d = r.raw.cells.length - r.opt.cells.length;
        const rf = r.raw.cells.filter((c) => c.t.includes("DFF")).length;
        return [
          "\u2462 Tech-indep Syn\uFF08\u8207\u6280\u8853\u7121\u95DC\u7684\u6700\u4F73\u5316\uFF09",
          "\u4F9D\u62D3\u64B2\u9806\u5E8F\u91CD\u5EFA\u6574\u500B\u7DB2\u8868\uFF1A\u5E38\u6578\u50B3\u64AD\u3001structural hashing\u3001x&!x \u7B49\u5316\u7C21\u3001\u7D44\u5408\u8FF4\u8DEF\u6AA2\u67E5\u3001\u79FB\u9664\u4E0D\u5F71\u97FF\u8F38\u51FA\u7684\u908F\u8F2F\uFF1B",
          "\u53CD\u8986\u300C\u8B49\u660E\u5E38\u6578\u7BC0\u9EDE\u300D\uFF08\u96A8\u6A5F\u6A21\u64EC\u627E\u5019\u9078\u3001\u5C0D \u226416 \u500B\u8F38\u5165\u7AAE\u8209\u8B49\u660E\uFF09\u4E26\u79FB\u9664\u5361\u5728 0 \u7684\u66AB\u5B58\u5668\u3002",
          "",
          `${r.raw.cells.length} \u2192 ${v.nl.cells.length} \u500B\u5143\u4EF6\uFF08\u5C11\u4E86 ${d}\uFF0C${(100 * d / Math.max(1, r.raw.cells.length)).toFixed(1)}%\uFF09\uFF1BDFF ${rf} \u2192 ${ffs}`,
          `${types}`,
          `\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64 ${big}`
        ];
      }
      if (key === "amap") {
        const a = this.asic;
        const bufs = v.nl.cells.filter((c) => c.t === "BUF").length;
        return [
          "A \u2463 Standard Cell Map\uFF08vlib\uFF1A\u5217\u9AD8 4.0 \xB5m\u3001site 0.5 \xB5m\uFF0C\u7D04 130 nm \u6162\u901F\u89D2\uFF09",
          "\u628A\u7DB2\u8868\u5728\u591A\u6247\u51FA\u9EDE\u5207\u6210\u6A39\uFF0C\u5C0D\u6BCF\u68F5\u6A39\u505A\u52D5\u614B\u898F\u5283\u7684 tree covering\uFF08\u6700\u5C0F\u9762\u7A4D\uFF09\uFF1A\u53CD\u76F8\u5668\u4F75\u5165 NAND2 / NOR2 / XNOR2 / AOI21 / OAI21\uFF1B\u540C\u6B65 set/reset \u8B8A\u6210 D \u524D\u7684\u908F\u8F2F\uFF0C\u975E\u540C\u6B65\u7684\u7528 DFFR / DFFS\uFF08\u4F4E\u614B\u6709\u6548\uFF0C\u5FC5\u8981\u6642\u52A0 INV\uFF09\uFF1B\u6247\u51FA > 12 \u7684\u8A0A\u865F\u63D2\u5165 BUF \u6A39\uFF1B\u540C\u6B65\u8B80\u53D6\u7684\u8A18\u61B6\u9AD4\u8B8A\u6210 SRAM \u5DE8\u96C6\uFF08\u6BCF\u500B\u8B80\u53D6\u57E0\u4E00\u500B\uFF09\u3002",
          "",
          `${types}`,
          `\u5143\u4EF6\u9762\u7A4D ${fmtArea(a.area)}\uFF0CBUF ${bufs} \u500B\uFF0C\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64 ${big}`
        ];
      }
      const luts = v.nl.cells.filter((c) => c.t === "SB_LUT4");
      const hist = [0, 0, 0, 0, 0];
      luts.forEach((c) => hist[lutInputs(c)]++);
      return [
        "\u2463 LUT4 Techmap\uFF08iCE40\uFF09",
        "\u5168\u52A0\u5668\u9032\u4F4D (a&b)|((a^b)&c) \u5C0D\u5230\u786C\u9AD4\u9032\u4F4D\u93C8 SB_CARRY\uFF1B\u5176\u9918\u4EE5 cut-based \u65B9\u5F0F\u8986\u84CB\u6210 4 \u8F38\u5165 LUT\uFF08\u5148\u6C42\u6700\u6DFA\u3001\u518D\u770B area flow\uFF09\uFF1BDFF \u2192 SB_DFF[N][S]{R,S}\u3002",
        "",
        `${types}`,
        `LUT \u8F38\u5165\u6578\u5206\u5E03\uFF1A${hist.map((n, i) => `${i} \u5165 ${n}`).filter((_, i) => i > 0).join("  ")}`,
        `LUT \u5C64\u6578 ${v.lev.depth} ${big}`
      ];
    }
    info(lines) {
      $("synInfo").textContent = lines.join("\n");
    }
    side(html) {
      const s = $("synSide");
      s.innerHTML = "";
      s.appendChild(html);
    }
    rtlSide() {
      const r = this.res;
      const d = document.createElement("div");
      d.innerHTML = `<h3>\u57E0</h3>` + table(["\u540D\u7A31", "\u65B9\u5411", "\u5BEC\u5EA6"], r.ports.map((p) => [esc(p.name), p.dir === "in" ? "input" : "output", String(p.width)])) + `<h3>\u5BE6\u4F8B</h3>` + table(["\u8DEF\u5F91", "\u6A21\u7D44"], r.hier.map((h) => [esc(h.path || "(top)"), esc(h.module)])) + `<h3>\u8A0A\u865F\uFF08${r.signals.length}\uFF09</h3>` + table(["\u540D\u7A31", "\u5BEC\u5EA6"], r.signals.slice(0, 400).map((s) => [esc(s.name), String(s.width)]));
      return d;
    }
    netSide(v) {
      const d = document.createElement("div");
      const types = countTypes(v.nl);
      d.innerHTML = `<h3>\u5143\u4EF6\u7A2E\u985E</h3>` + table(["\u7A2E\u985E", "\u6578\u91CF"], types.map(([t, n2]) => [`<span class="sw" style="background:${cellColor(t, 4)}"></span>${shortType(t)}`, String(n2)])) + `<h3>\u5143\u4EF6\u6E05\u55AE\uFF08\u9EDE\u9078\uFF09</h3>`;
      const list = document.createElement("div");
      list.className = "clist";
      const n = Math.min(v.nl.cells.length, 500);
      for (let i = 0; i < n; i++) {
        const c = v.nl.cells[i];
        const row = document.createElement("div");
        row.textContent = `#${i} ${shortType(c.t)}  L${v.lev.level[i]}  \u2192 ${bitName(v.names, c.c.find((x) => isOut(x[0]))?.[1] ?? "0")}`;
        row.onclick = () => this.select(i);
        list.appendChild(row);
      }
      if (v.nl.cells.length > n) {
        const m = document.createElement("div");
        m.className = "more";
        m.textContent = `\u2026 \u5171 ${v.nl.cells.length} \u500B\uFF08\u9EDE\u5716\u4E0A\u7684\u65B9\u584A\u770B\u5176\u4ED6\u5143\u4EF6\uFF09`;
        list.appendChild(m);
      }
      d.appendChild(list);
      if (v.nl === this.asic?.map) {
        const lib = document.createElement("div");
        lib.innerHTML = `<h3>vlib \u5143\u4EF6\u5EAB</h3>` + table(
          ["\u5143\u4EF6", "\u5BEC", "\u9762\u7A4D \xB5m\xB2", "\u5EF6\u9072 ns", "+\u6BCF\u6247\u51FA", "\u529F\u80FD"],
          this.asic.lib.map((c) => [`<span class="sw" style="background:${stdColor(c.name)}"></span>${c.name}`, String(c.width), c.area.toFixed(0), c.delay.toFixed(3), c.load.toFixed(3), esc(c.verilog.replace(/^assign Y = |;$/g, ""))])
        );
        d.appendChild(lib);
      }
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = '<p class="hint">\u9EDE\u5716\u4E0A\u7684\u5143\u4EF6\u770B\u7D30\u7BC0\uFF1A\u63A5\u8173\u3001\u6240\u9023\u8A0A\u865F\u3001LUT \u771F\u503C\u8868\u3002</p>';
      d.prepend(det);
      return d;
    }
    pick(b) {
      const k = this.stage;
      if (k === "cmp") return;
      if (PNR.has(k)) {
        if (!this.pnr || this.anim) return;
        const n = this.pnr.lcs.length + this.pnr.ios.length;
        this.sel = b && (b.id < this.pnr.lcs.length || b.id >= n) ? b.id : null;
        this.drawPnr(false);
        if (this.sel !== null && this.sel >= n) this.ramDetail(this.sel - n);
        else this.lcDetail();
        return;
      }
      if (APHYS.has(k)) {
        if (!this.asic || this.anim) return;
        this.sel = b && b.id < this.asic.cells.length ? b.id : null;
        this.drawAsic(false);
        this.stdDetail();
        return;
      }
      if (!b) {
        this.select(null);
        return;
      }
      if (isNet(k)) {
        const v = this.netView(k);
        if (b.id < v.nl.cells.length) this.select(b.id);
      }
    }
    ramDetail(k) {
      const det = document.getElementById("synDetail");
      if (!det || !this.pnr) return;
      const r = this.pnr.rams[k];
      let h = `<h3><span class="sw" style="background:${RAM_COLOR}"></span>block RAM #${k}\u3000tile (${r.x},${r.y})\u2013(${r.x},${r.y + 1})</h3>`;
      h += `<p>SB_RAM40_4K\uFF084 Kbit\uFF09\uFF0C\u8B80 ${r.read}\u3001\u5BEB ${r.write}\uFF1B\u540C\u6B65\u8B80\u53D6\uFF1ARADDR \u5728 RCLK \u6B63\u7DE3\u53D6\u6A23\uFF0CRDATA \u4E0B\u4E00\u62CD\u6709\u6548\u3002</p>`;
      h += table(["\u63A5\u8173", "\u8A0A\u865F"], [...r.ins.map(([p, n]) => [p, esc(n)]), ...r.outs.map(([p, n]) => [p + " \u2192", esc(n)])]);
      det.innerHTML = h;
    }
    lcDetail() {
      const det = document.getElementById("synDetail");
      if (!det || !this.pnr) return;
      if (this.sel === null) {
        det.innerHTML = '<p class="hint">\u9EDE LC \u770B\u7D30\u7BC0\uFF08LUT \u771F\u503C\u8868\u3001DFF\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002</p>';
        return;
      }
      const lc = this.pnr.lcs[this.sel];
      const init = parseInt(lc.init, 16).toString(2).padStart(16, "0");
      let h = `<h3>LC #${this.sel}\u3000tile (${lc.x},${lc.y}) LC ${lc.z}</h3>`;
      h += `<p><span class="sw" style="background:${lcColor(lc)}"></span>${lc.carry ? "CARRY " : ""}${lc.ff ? `DFF${lc.ff.neg ? "\uFF08\u8CA0\u7DE3\uFF09" : ""}${lc.ff.sr ? (lc.ff.async ? "\uFF08\u975E\u540C\u6B65" : "\uFF08\u540C\u6B65") + (lc.ff.set ? " set\uFF09" : " reset\uFF09") : ""} ` : ""}LUT 16'h${lc.init}${lc.in3c ? "\uFF08in3 = \u9032\u4F4D\u93C8\uFF09" : ""}</p>`;
      h += `<p>\u8F38\u51FA\u5230\u9054\u6642\u9593 ${lc.arr.toFixed(2)} ns</p>`;
      h += table(["\u63A5\u8173", "\u8A0A\u865F"], [...lc.ins.map((n, k) => [`in${k}`, esc(k === 3 && lc.in3c ? "(carry in)" : n || "\u2014")]), ["out", esc(lc.out || "\u2014")]]);
      h += `<h3>LUT \u771F\u503C\u8868</h3>` + table(["I3 I2 I1 I0", "O"], lutBits(init).map((o, k) => [`${k >> 3 & 1}  ${k >> 2 & 1}  ${k >> 1 & 1}  ${k & 1}`, String(o)]));
      det.innerHTML = h;
    }
    select(i) {
      this.sel = i;
      this.redrawLines();
      const det = document.getElementById("synDetail");
      const k = this.stage;
      if (!det || !isNet(k)) return;
      if (i === null) {
        det.innerHTML = '<p class="hint">\u9EDE\u5716\u4E0A\u7684\u5143\u4EF6\u770B\u7D30\u7BC0\uFF1A\u63A5\u8173\u3001\u6240\u9023\u8A0A\u865F\u3001LUT \u771F\u503C\u8868\u3002</p>';
        return;
      }
      const v = this.netView(k);
      const c = v.nl.cells[i];
      let h = `<h3>#${i} ${c.t}</h3><p>\u5C64\u7D1A L${v.lev.level[i]}</p>`;
      h += table(["\u63A5\u8173", "\u8A0A\u865F", "\u4F86\u6E90"], c.c.map(([p, b]) => {
        const src = typeof b === "number" && !isOut(p) ? v.lev.driver.has(b) ? `#${v.lev.driver.get(b)} ${shortType(v.nl.cells[v.lev.driver.get(b)].t)}` : "\u8F38\u5165\u57E0" : isOut(p) ? `\u2192 ${typeof b === "number" ? v.lev.users.get(b)?.length ?? 0 : 0} \u500B\u8CA0\u8F09` : "\u5E38\u6578";
        return [p, esc(bitName(v.names, b)), src];
      }));
      if (c.t === "SB_LUT4" && c.p?.LUT_INIT) {
        const bits = lutBits(c.p.LUT_INIT);
        h += `<h3>LUT_INIT = 16'b${c.p.LUT_INIT}</h3>`;
        h += table(["I3 I2 I1 I0", "O"], bits.map((o, k2) => [`${k2 >> 3 & 1}  ${k2 >> 2 & 1}  ${k2 >> 1 & 1}  ${k2 & 1}`, String(o)]));
      }
      det.innerHTML = h;
      det.scrollIntoView({ block: "nearest" });
    }
  };
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
  function table(head, rows) {
    return `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
  }
  function download(name, data) {
    saveAs(name, data, typeof data === "string" ? "text/plain" : "application/octet-stream");
  }
  function fmtArea(um2) {
    return um2 >= 1e5 ? `${(um2 / 1e6).toFixed(3)} mm\xB2` : `${um2.toFixed(0)} \xB5m\xB2`;
  }

  // src/templates.ts
  function newModule(m) {
    return `module ${m} (
    i_clk: input  clock   ,
    i_rst: input  reset   ,
    i_en : input  logic   ,
    o_cnt: output logic<8>,
) {
    var cnt: logic<8>;

    always_ff {
        if_reset {
            cnt = 0;
        } else if i_en {
            cnt = cnt + 1;
        }
    }

    assign o_cnt = cnt;
}

#[test(test_${m.toLowerCase()})]
module Test${m} {
    inst clk: $tb::clock_gen;
    inst rst: $tb::reset_gen(clk);

    var en : logic   ;
    var cnt: logic<8>;

    inst dut: ${m} (
        i_clk: clk,
        i_rst: rst,
        i_en : en ,
        o_cnt: cnt,
    );

    initial {
        en = 0;
        rst.assert();
        en = 1;
        clk.next(5);
        $assert(cnt == 8'd5, "counts to 5");
        $finish();
    }
}
`;
  }
  function projectZip(name, files, extra) {
    const dir = name.replace(/[^\w.-]+/g, "_") || "project";
    const out = files.map((f) => ({ name: f.name.endsWith(".veryl") ? `${dir}/src/${f.name}` : `${dir}/${f.name}`, data: f.src }));
    out.push({ name: `${dir}/Veryl.toml`, data: `[project]
name = "${dir.replace(/[^\w]/g, "_")}"
version = "0.1.0"

[build]
sources = ["src"]
target = { type = "directory", path = "target" }
` });
    if (extra) out.push({ name: `${dir}/${extra.name}`, data: extra.src });
    return zip(out);
  }

  // src/wave.ts
  function parseVcd(text) {
    const byId = /* @__PURE__ */ new Map();
    const signals = [];
    let t = 0;
    let end = 0;
    const lines = text.split("\n");
    let i = 0;
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("$var")) {
        const p = l.split(/\s+/);
        const s = { id: p[3], name: p[4], width: +p[2], changes: [] };
        signals.push(s);
        byId.set(s.id, [...byId.get(s.id) ?? [], s]);
      } else if (l.startsWith("$enddefinitions")) {
        i++;
        break;
      }
    }
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l[0] === "#") {
        t = +l.slice(1);
        end = Math.max(end, t);
        continue;
      }
      let v, id;
      if (l[0] === "b" || l[0] === "B") {
        const sp = l.indexOf(" ");
        v = l.slice(1, sp);
        id = l.slice(sp + 1);
      } else {
        v = l[0];
        id = l.slice(1);
      }
      for (const s of byId.get(id) ?? []) s.changes.push([t, v]);
    }
    return { signals, end };
  }
  function fmt(v, width) {
    if (width === 1) return v;
    if (/[xz]/i.test(v)) return v.length > 8 ? "x" : v;
    const n = BigInt("0b" + v);
    return n.toString(16);
  }
  function valueAt(s, t) {
    let lo = 0, hi = s.changes.length - 1, r = -1;
    while (lo <= hi) {
      const m = lo + hi >> 1;
      if (s.changes[m][0] <= t) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r < 0 ? void 0 : s.changes[r][1];
  }
  var NAME_W = 170;
  var ROW = 22;
  var TOP = 22;
  var WaveView = class {
    constructor(canvas, picker, filter) {
      __publicField(this, "canvas", canvas);
      __publicField(this, "picker", picker);
      __publicField(this, "filter", filter);
      __publicField(this, "vcd", null);
      __publicField(this, "shown", []);
      __publicField(this, "t0", 0);
      __publicField(this, "scale", 1);
      // px per time unit
      __publicField(this, "cursor", null);
      __publicField(this, "drag", null);
      new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (!this.vcd) return;
        const x = e.offsetX - NAME_W;
        const tAt = this.t0 + x / this.scale;
        this.scale = Math.min(Math.max(this.scale * Math.exp(-e.deltaY * 2e-3), 1e-4), 200);
        this.t0 = Math.max(0, tAt - x / this.scale);
        this.draw();
      }, { passive: false });
      canvas.addEventListener("pointerdown", (e) => {
        this.drag = { x: e.clientX, t0: this.t0 };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (this.drag) {
          this.t0 = Math.max(0, this.drag.t0 - (e.clientX - this.drag.x) / this.scale);
        }
        this.cursor = e.offsetX > NAME_W ? this.t0 + (e.offsetX - NAME_W) / this.scale : null;
        this.draw();
      });
      canvas.addEventListener("pointerup", () => {
        this.drag = null;
      });
      canvas.addEventListener("dblclick", () => this.fit());
      filter.addEventListener("input", () => this.fillPicker());
    }
    set(text) {
      this.vcd = text ? parseVcd(text) : null;
      this.shown = this.vcd ? this.vcd.signals.filter((s) => !s.name.includes(".")).slice(0, 16) : [];
      this.fillPicker();
      this.fit();
    }
    fit() {
      if (!this.vcd) {
        this.draw();
        return;
      }
      const w = Math.max(this.canvas.parentElement.clientWidth - NAME_W - 10, 200);
      this.t0 = 0;
      this.scale = w / Math.max(this.vcd.end, 1);
      this.draw();
    }
    fillPicker() {
      this.picker.innerHTML = "";
      if (!this.vcd) return;
      const q = this.filter.value.toLowerCase();
      for (const s of this.vcd.signals) {
        if (q && !s.name.toLowerCase().includes(q)) continue;
        const l = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = this.shown.includes(s);
        cb.onchange = () => {
          this.shown = cb.checked ? [...this.shown, s] : this.shown.filter((x) => x !== s);
          this.draw();
        };
        l.append(cb, ` ${s.name}${s.width > 1 ? `[${s.width}]` : ""}`);
        this.picker.appendChild(l);
      }
    }
    draw() {
      const c = this.canvas, r = c.parentElement.getBoundingClientRect();
      if (r.width < NAME_W + 20 || !(this.scale > 0)) return;
      const h = Math.max(r.height, TOP + ROW * this.shown.length + 10);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = r.width + "px";
      c.style.height = h + "px";
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#171c24";
      g.fillRect(0, 0, r.width, h);
      g.font = "11px ui-monospace, Menlo, monospace";
      g.textBaseline = "middle";
      if (!this.vcd) {
        g.fillStyle = "#9fb2c8";
        g.fillText("\u6309\u300C\u25B6 \u6A21\u64EC\u300D\u5F8C\u986F\u793A\u6CE2\u5F62", 12, 20);
        return;
      }
      const W = r.width - NAME_W;
      const X = (t) => NAME_W + (t - this.t0) * this.scale;
      const t1 = this.t0 + W / this.scale;
      const step = Math.max(niceStep(80 / this.scale), (t1 - this.t0) / 200, 1e-9);
      g.strokeStyle = "#2a3441";
      g.fillStyle = "#9fb2c8";
      for (let t = Math.ceil(this.t0 / step) * step; t <= t1; t += step) {
        const x = X(t);
        g.beginPath();
        g.moveTo(x, TOP - 4);
        g.lineTo(x, h);
        g.stroke();
        g.fillText(String(t), x + 2, 9);
      }
      this.shown.forEach((s, k) => {
        const y = TOP + k * ROW, mid = y + ROW / 2, hi = y + 4, lo = y + ROW - 4;
        const cv = this.cursor !== null ? valueAt(s, this.cursor) : void 0;
        g.fillStyle = "#c9d4e2";
        g.fillText(s.name + (cv !== void 0 ? ` = ${fmt(cv, s.width)}` : ""), 6, mid, NAME_W - 10);
        g.strokeStyle = s.width === 1 ? "#57c27a" : "#7ec3ff";
        g.lineWidth = 1.2;
        const ch = s.changes;
        for (let i = 0; i < ch.length; i++) {
          const [ta, v] = ch[i];
          const tb = i + 1 < ch.length ? ch[i + 1][0] : this.vcd.end;
          if (tb < this.t0 || ta > t1) continue;
          const xa = Math.max(X(ta), NAME_W), xb = Math.min(X(tb), r.width);
          if (s.width === 1) {
            const yv = v === "1" ? hi : v === "0" ? lo : mid;
            g.strokeStyle = v === "1" || v === "0" ? "#57c27a" : "#e06c75";
            g.beginPath();
            g.moveTo(xa, yv);
            g.lineTo(xb, yv);
            if (i + 1 < ch.length && X(tb) <= r.width) {
              const nv = ch[i + 1][1];
              g.lineTo(xb, nv === "1" ? hi : nv === "0" ? lo : mid);
            }
            g.stroke();
          } else {
            g.strokeStyle = /[xz]/i.test(v) ? "#e06c75" : "#7ec3ff";
            g.beginPath();
            g.moveTo(xa, hi);
            g.lineTo(xb - 2, hi);
            g.lineTo(xb, mid);
            g.lineTo(xb - 2, lo);
            g.lineTo(xa, lo);
            if (X(ta) >= NAME_W) {
              g.lineTo(xa - 2 < NAME_W ? xa : xa - 0, mid);
            }
            g.stroke();
            const label = fmt(v, s.width);
            if (xb - xa > label.length * 7 + 6) {
              g.fillStyle = "#dce1e8";
              g.fillText(label, xa + 4, mid);
            }
          }
        }
        g.strokeStyle = "#232b36";
        g.beginPath();
        g.moveTo(0, y + ROW);
        g.lineTo(r.width, y + ROW);
        g.stroke();
      });
      g.strokeStyle = "#3a4a5e";
      g.beginPath();
      g.moveTo(NAME_W - 2, 0);
      g.lineTo(NAME_W - 2, h);
      g.stroke();
      if (this.cursor !== null) {
        const x = X(this.cursor);
        g.strokeStyle = "#ffd479";
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
        g.fillStyle = "#ffd479";
        g.fillText(`t=${Math.round(this.cursor)}`, x + 3, TOP - 9);
      }
    }
  };
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  // src/ide/highlight.ts
  var KEYWORDS = new Set("module interface package function import export inst param const var let assign always_ff always_comb initial final if else if_reset case switch default for in rev step return break input output inout modport struct enum union typedef embed include generate pub proto bind connect type as repeat inside outside unsafe alias true false".split(" "));
  var TYPES = new Set("logic bit clock clock_posedge clock_negedge reset reset_async_high reset_async_low reset_sync_high reset_sync_low u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 signed tri string".split(" "));
  var TOKEN = /(\/\/.*)|(\/\*)|("(?:\\.|[^"\\])*")|(\d+'s?[bodhBODH][0-9a-fA-FxXzZ_]+|\d+'[01xXzZ]|'[01xXzZ]|\d[\d_]*(?:\.\d+)?)|(\$[A-Za-z_]\w*)|(#\[[^\]]*\])|([A-Za-z_]\w*)|('[a-z_]\w*)/g;
  function esc2(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function highlight(src) {
    const out = [];
    let inBlock = false;
    for (const line of src.split("\n")) {
      let h = "";
      let i = 0;
      if (inBlock) {
        const e = line.indexOf("*/");
        if (e < 0) {
          out.push(`<span class="t-com">${esc2(line)}</span>`);
          continue;
        }
        h += `<span class="t-com">${esc2(line.slice(0, e + 2))}</span>`;
        i = e + 2;
        inBlock = false;
      }
      TOKEN.lastIndex = i;
      let m;
      while (m = TOKEN.exec(line)) {
        h += esc2(line.slice(i, m.index));
        const t = m[0];
        if (m[1]) h += `<span class="t-com">${esc2(t)}</span>`;
        else if (m[2]) {
          const e = line.indexOf("*/", m.index + 2);
          const end = e < 0 ? line.length : e + 2;
          h += `<span class="t-com">${esc2(line.slice(m.index, end))}</span>`;
          if (e < 0) inBlock = true;
          TOKEN.lastIndex = end;
          i = end;
          if (inBlock) break;
          continue;
        } else if (m[3]) h += `<span class="t-str">${esc2(t)}</span>`;
        else if (m[4]) h += `<span class="t-num">${esc2(t)}</span>`;
        else if (m[5]) h += `<span class="t-sys">${esc2(t)}</span>`;
        else if (m[6]) h += `<span class="t-attr">${esc2(t)}</span>`;
        else if (m[7]) {
          if (KEYWORDS.has(t)) h += `<span class="t-kw">${t}</span>`;
          else if (TYPES.has(t)) h += `<span class="t-type">${t}</span>`;
          else if (/^[A-Z]/.test(t)) h += `<span class="t-name">${t}</span>`;
          else h += t;
        } else h += `<span class="t-dom">${esc2(t)}</span>`;
        i = TOKEN.lastIndex;
      }
      if (i < line.length) h += esc2(line.slice(i));
      out.push(h);
    }
    return out;
  }

  // src/ide/editor.ts
  var CodeEditor = class {
    constructor(host) {
      __publicField(this, "scroller");
      __publicField(this, "gutter");
      __publicField(this, "code");
      __publicField(this, "pre");
      __publicField(this, "ta");
      __publicField(this, "curLine");
      __publicField(this, "markers", []);
      __publicField(this, "raf", 0);
      __publicField(this, "lines", 0);
      __publicField(this, "onChange", () => {
      });
      __publicField(this, "onCursor", () => {
      });
      /** keyboard shortcuts the page handles (return true when handled) */
      __publicField(this, "onKey", () => false);
      __publicField(this, "lineHeight", 19);
      host.classList.add("ed");
      this.scroller = el("div", "ed-scroll");
      this.gutter = el("div", "ed-gutter");
      this.code = el("div", "ed-code");
      this.curLine = el("div", "ed-cur");
      this.pre = el("pre", "ed-hl");
      this.ta = el("textarea", "ed-ta");
      this.ta.spellcheck = false;
      this.ta.wrap = "off";
      this.ta.setAttribute("autocapitalize", "off");
      this.ta.setAttribute("autocomplete", "off");
      this.code.append(this.curLine, this.pre, this.ta);
      this.scroller.append(this.gutter, this.code);
      host.appendChild(this.scroller);
      this.ta.addEventListener("input", () => {
        this.render();
        this.onChange(this.ta.value);
      });
      for (const ev of ["keyup", "click", "select", "focus"]) this.ta.addEventListener(ev, () => this.cursor());
      this.ta.addEventListener("keydown", (e) => this.key(e));
    }
    get value() {
      return this.ta.value;
    }
    set value(s) {
      this.ta.value = s;
      this.ta.setSelectionRange(0, 0);
      this.scroller.scrollTop = 0;
      this.scroller.scrollLeft = 0;
      this.render();
      this.cursor();
    }
    get readOnly() {
      return this.ta.readOnly;
    }
    set readOnly(v) {
      this.ta.readOnly = v;
    }
    focus() {
      this.ta.focus({ preventScroll: true });
    }
    setMarkers(m) {
      this.markers = m;
      this.render();
    }
    /** put the cursor at line:col (1-based) and select to the end of the line */
    goto(line, col = 1, selectLine = false) {
      const ls = this.ta.value.split("\n");
      line = Math.max(1, Math.min(line, ls.length));
      let off = 0;
      for (let k = 0; k < line - 1; k++) off += ls[k].length + 1;
      const start = off + Math.max(0, Math.min(col - 1, ls[line - 1].length));
      this.ta.focus({ preventScroll: true });
      this.ta.setSelectionRange(start, selectLine ? off + ls[line - 1].length : start);
      const y = (line - 1) * this.lineHeight;
      const h = this.scroller.clientHeight;
      if (y < this.scroller.scrollTop || y > this.scroller.scrollTop + h - 3 * this.lineHeight) this.scroller.scrollTop = Math.max(0, y - h / 3);
      this.cursor();
    }
    render() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.paint());
    }
    paint() {
      const text = this.ta.value;
      const hl = highlight(text);
      const bad = /* @__PURE__ */ new Map();
      for (const m of this.markers) if (!bad.has(m.line) || m.severity === "error") bad.set(m.line, m);
      this.pre.innerHTML = hl.map((h, i) => {
        const m = bad.get(i + 1);
        return m ? `<span class="ed-${m.severity}" title="${m.msg.replace(/"/g, "&quot;").replace(/</g, "&lt;")}">${h || " "}</span>` : h;
      }).join("\n") + "\n ";
      if (hl.length !== this.lines || this.markers.length || this.gutter.dataset.marked) {
        this.lines = hl.length;
        let g = "";
        for (let i = 1; i <= hl.length; i++) {
          const m = bad.get(i);
          g += m ? `<div class="g-${m.severity}" title="${m.msg.replace(/"/g, "&quot;").replace(/</g, "&lt;")}">${i}</div>` : `<div>${i}</div>`;
        }
        this.gutter.innerHTML = g;
        this.gutter.dataset.marked = this.markers.length ? "1" : "";
      }
      this.ta.style.height = this.pre.offsetHeight + "px";
      this.ta.style.width = Math.max(this.pre.scrollWidth, this.code.clientWidth) + "px";
    }
    cursor() {
      const s = this.ta.selectionStart;
      const before = this.ta.value.slice(0, s);
      const line = before.split("\n").length;
      const col = s - before.lastIndexOf("\n");
      this.curLine.style.top = (line - 1) * this.lineHeight + 4 + "px";
      this.onCursor(line, col);
    }
    key(e) {
      if (this.onKey(e)) {
        e.preventDefault();
        return;
      }
      const ta = this.ta;
      if (ta.readOnly) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const [s, t] = [ta.selectionStart, ta.selectionEnd];
        const v = ta.value;
        if (s === t && !e.shiftKey) {
          this.edit(s, t, "    ");
          return;
        }
        const a = v.lastIndexOf("\n", s - 1) + 1;
        const b = t > s && v[t - 1] === "\n" ? t - 1 : v.indexOf("\n", t) < 0 ? v.length : v.indexOf("\n", t);
        const block = v.slice(a, b).split("\n").map((l) => e.shiftKey ? l.replace(/^ {1,4}/, "") : "    " + l).join("\n");
        this.edit(a, b, block);
        ta.setSelectionRange(a, a + block.length);
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const s = ta.selectionStart;
        const v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const ind = /^ */.exec(v.slice(ls, s))[0];
        const more = /[{(\[]\s*$/.test(v.slice(ls, s)) ? "    " : "";
        const close = more && /^\s*[})\]]/.test(v.slice(ta.selectionEnd));
        this.edit(s, ta.selectionEnd, "\n" + ind + more + (close ? "\n" + ind : ""));
        if (close) ta.setSelectionRange(s + 1 + ind.length + 4, s + 1 + ind.length + 4);
      } else if (e.key === "}" && ta.selectionStart === ta.selectionEnd) {
        const s = ta.selectionStart;
        const v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        if (/^ {4,}$/.test(v.slice(ls, s))) {
          e.preventDefault();
          this.edit(s - 4, s, "}");
        }
      } else if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const [s, t] = [ta.selectionStart, ta.selectionEnd];
        const v = ta.value;
        const a = v.lastIndexOf("\n", s - 1) + 1;
        const b = v.indexOf("\n", t) < 0 ? v.length : v.indexOf("\n", t);
        const ls = v.slice(a, b).split("\n");
        const all = ls.every((l) => /^\s*\/\//.test(l) || !l.trim());
        const block = ls.map((l) => all ? l.replace(/^(\s*)\/\/ ?/, "$1") : l.trim() ? l.replace(/^(\s*)/, "$1// ") : l).join("\n");
        this.edit(a, b, block);
        ta.setSelectionRange(a, a + block.length);
      }
    }
    /** replace [a, b) with `s` as one undoable edit */
    edit(a, b, s) {
      const ta = this.ta;
      ta.setSelectionRange(a, b);
      if (!document.execCommand || !document.execCommand("insertText", false, s)) {
        ta.setRangeText(s, a, b, "end");
        ta.dispatchEvent(new Event("input"));
      }
    }
  };
  function el(tag, cls) {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  // src/ide/main.ts
  var $2 = (id) => document.getElementById(id);
  var mod = (e) => e.ctrlKey || e.metaKey;
  var esc3 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var KEY = "veryl2chip-ide:";
  function store() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  function load(k, d) {
    try {
      const s = store()?.getItem(KEY + k);
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  }
  function save(k, v) {
    try {
      store()?.setItem(KEY + k, JSON.stringify(v));
    } catch {
    }
  }
  var projects = load("projects", []).filter((p) => p && Array.isArray(p.files));
  var proj;
  var saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      save("projects", projects);
      save("cur", proj.id);
    }, 300);
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function fromExample(ex) {
    return { id: uid(), name: ex.title, files: ex.files.map((f) => ({ ...f })), synth: ex.synth, pcf: ex.pcf, from: ex.id, open: [ex.files[0].name], active: ex.files[0].name };
  }
  function blankProject(name) {
    const m = name.replace(/[^A-Za-z0-9_]/g, "").replace(/^[^A-Za-z]+/, "") || "Top";
    const top = m[0].toUpperCase() + m.slice(1);
    const f = `${top.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}.veryl`;
    return { id: uid(), name, files: [{ name: f, src: newModule(top) }], synth: top, open: [f], active: f };
  }
  var core = null;
  var synth = null;
  var wave = null;
  var ed;
  var vcds = [];
  var mods = [];
  var problems = [];
  var testState = /* @__PURE__ */ new Map();
  var synthKey = "";
  var busy = 0;
  var FPGA_FLOW = [
    ["rtl", "\u5171 \u2460 RTL\u2192Logic"],
    ["raw", "\u5171 \u2461 Logic Netlist"],
    ["opt", "\u5171 \u2462 Tech-indep Syn"],
    ["map", "F \u2463 LUT4 Techmap"],
    ["place", "F \u2464 Placement \u9000\u706B"],
    ["route", "F \u2465 Global+Detail Routing"],
    ["sta", "F \u2466 Timing (STA)"]
  ];
  var ASIC_FLOW = [
    ...FPGA_FLOW.slice(0, 3),
    ["amap", "A \u2463 Standard Cell Map"],
    ["aplace", "A \u2464 Row Placement \u9000\u706B"],
    ["aroute", "A \u2465 CTS + Global Routing"],
    ["adetail", "A \u2466 Detail Routing"],
    ["asta", "A \u2467 Timing (STA)"],
    ["apower", "A \u2468 Power + IR Drop"]
  ];
  var FLOW_TAB = "\u2699 \u5408\u6210\u6D41\u7A0B";
  var WELCOME = "\u6B61\u8FCE";
  function file(name) {
    return proj.files.find((f) => f.name === name);
  }
  function original(name) {
    return proj.from ? examples().find((e) => e.id === proj.from)?.files.find((f) => f.name === name)?.src : void 0;
  }
  function openTabs() {
    return proj.open ?? (proj.open = []);
  }
  function openFile(name, line, col) {
    if (name !== FLOW_TAB && name !== WELCOME && !file(name)) return;
    if (!openTabs().includes(name)) openTabs().push(name);
    proj.active = name;
    persist();
    showActive();
    if (line && name !== FLOW_TAB) ed.goto(line, col ?? 1, true);
  }
  function closeTab(name) {
    const t = openTabs();
    const i = t.indexOf(name);
    if (i < 0) return;
    t.splice(i, 1);
    if (proj.active === name) proj.active = t[Math.min(i, t.length - 1)];
    persist();
    showActive();
  }
  function showActive() {
    let a = proj.active;
    if (a && a !== FLOW_TAB && a !== WELCOME && !file(a)) a = void 0;
    if (!a) a = openTabs().find((n) => n === FLOW_TAB || file(n)) ?? WELCOME;
    proj.active = a;
    if (!openTabs().includes(a)) openTabs().push(a);
    const isFile = !!file(a);
    $2("editorHost").classList.toggle("hidden", !isFile);
    $2("synOverlay").classList.toggle("hidden", a !== FLOW_TAB);
    $2("welcome").classList.toggle("hidden", a !== WELCOME);
    if (isFile) {
      if (ed.value !== file(a).src || $2("editorHost").dataset.file !== a) {
        ed.value = file(a).src;
        $2("editorHost").dataset.file = a;
      }
      markers();
      ed.focus();
    } else {
      $2("editorHost").dataset.file = "";
      $2("sbPos").textContent = "";
    }
    if (a === WELCOME) welcome();
    renderTabs();
    renderFiles();
  }
  function renderTabs() {
    const box = $2("edTabs");
    box.innerHTML = "";
    for (const n of openTabs()) {
      const t = document.createElement("div");
      const f = file(n);
      const errs = problems.some((p) => p.file === n && p.severity === "error");
      t.className = "tab" + (n === proj.active ? " cur" : "") + (f && original(n) !== void 0 && original(n) !== f.src ? " dirty" : "") + (errs ? " err" : "");
      t.innerHTML = `<span class="ic">${n === FLOW_TAB ? "" : n === WELCOME ? "\u2605" : f?.name.endsWith(".veryl") ? "\u25C6" : "\u25A4"}</span><span class="nm">${esc3(n)}</span><span class="x" title="\u95DC\u9589"></span>`;
      t.onclick = () => {
        proj.active = n;
        persist();
        showActive();
      };
      t.onauxclick = (e) => {
        if (e.button === 1) closeTab(n);
      };
      t.querySelector(".x").addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(n);
      });
      box.appendChild(t);
      if (n === proj.active) setTimeout(() => t.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
  }
  function renderProjects() {
    const sel = $2("projSel");
    sel.innerHTML = "";
    for (const p of projects) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.value = proj.id;
  }
  function renderFiles() {
    const box = $2("fileList");
    box.innerHTML = "";
    for (const f of proj.files) {
      const d = document.createElement("div");
      const n = problems.filter((p) => p.file === f.name && p.severity === "error").length;
      const changed2 = original(f.name) !== void 0 && original(f.name) !== f.src;
      d.className = "item" + (f.name === proj.active ? " cur" : "");
      d.innerHTML = `<span class="ic">${f.name.endsWith(".veryl") ? "\u25C6" : "\u25A4"}</span><span class="nm">${esc3(f.name)}</span><span class="acts"><button class="icon" data-a="ren" title="\u91CD\u65B0\u547D\u540D">\u270E</button><button class="icon" data-a="del" title="\u522A\u9664">\u{1F5D1}</button></span>` + (n ? `<span class="tag" style="color:var(--err)">${n}</span>` : changed2 ? '<span class="tag dirty-dot" title="\u8207\u7BC4\u4F8B\u539F\u59CB\u78BC\u4E0D\u540C">M</span>' : "");
      d.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === "ren") renameFile(f.name);
        else if (a === "del") deleteFile(f.name);
        else openFile(f.name);
      };
      box.appendChild(d);
    }
    renderOutline();
  }
  function declarations() {
    const out = [];
    for (const f of proj.files) {
      const ls = f.src.split("\n");
      ls.forEach((l, i) => {
        const m = /^\s*(?:pub\s+)?(module|interface|package)\s+([A-Za-z_]\w*)/.exec(l);
        if (m) out.push({ kind: m[1], name: m[2], file: f.name, line: i + 1, test: i > 0 && /#\[test/.test(ls[i - 1] + (ls[i - 2] ?? "")) });
      });
    }
    return out;
  }
  function renderOutline() {
    const box = $2("outline");
    box.innerHTML = "";
    for (const d of declarations()) {
      const el2 = document.createElement("div");
      const top = d.kind === "module" && d.name === synthTop();
      el2.className = "item";
      el2.innerHTML = `<span class="ic">${d.kind === "module" ? d.test ? "\u2714" : "\u25A3" : d.kind === "interface" ? "\u21C4" : "{}"}</span><span class="nm">${esc3(d.name)}</span><span class="tag">${top ? "\u5408\u6210\u9802\u5C64" : d.test ? "test" : d.kind === "module" ? "" : d.kind}</span>`;
      el2.title = `${d.file}:${d.line}`;
      el2.onclick = () => openFile(d.file, d.line);
      box.appendChild(el2);
    }
  }
  function validName(name) {
    if (!/^[\w.-]+$/.test(name)) return "\u6A94\u540D\u53EA\u80FD\u7528\u82F1\u6578\u5B57\u3001\u5E95\u7DDA\u3001\u9EDE\u548C\u6E1B\u865F";
    if (file(name)) return `\u5DF2\u7D93\u6709 ${name}`;
    return null;
  }
  function newFile() {
    let name = prompt("\u65B0\u6A94\u540D\uFF08.veryl\uFF09", `module${proj.files.length}.veryl`)?.trim();
    if (!name) return;
    if (!/\.\w+$/.test(name)) name += ".veryl";
    const bad = validName(name);
    if (bad) {
      alert(bad);
      return;
    }
    const base = name.replace(/\.\w+$/, "").replace(/(^|[_-])(\w)/g, (_, _a, c) => c.toUpperCase()).replace(/\W/g, "");
    const m = /^[A-Za-z]/.test(base) ? base : "M" + base;
    proj.files.push({ name, src: name.endsWith(".veryl") ? newModule(m) : "" });
    openFile(name);
    changed();
  }
  function renameFile(old) {
    let name = prompt("\u65B0\u6A94\u540D", old)?.trim();
    if (!name || name === old) return;
    if (!/\.\w+$/.test(name)) name += ".veryl";
    const bad = validName(name);
    if (bad) {
      alert(bad);
      return;
    }
    file(old).name = name;
    proj.open = openTabs().map((n) => n === old ? name : n);
    if (proj.active === old) proj.active = name;
    showActive();
    changed();
  }
  function deleteFile(name) {
    if (proj.files.length < 2) {
      alert("\u5C08\u6848\u81F3\u5C11\u8981\u6709\u4E00\u500B\u6A94\u6848");
      return;
    }
    if (!confirm(`\u522A\u9664 ${name}\uFF1F`)) return;
    proj.files = proj.files.filter((f) => f.name !== name);
    proj.open = openTabs().filter((n) => n !== name);
    if (proj.active === name) proj.active = void 0;
    showActive();
    changed();
  }
  async function importFiles(list) {
    if (!list) return;
    let last = "";
    for (const f of Array.from(list)) {
      const src = await f.text();
      if (f.name.endsWith(".pcf")) {
        proj.pcf = src;
        continue;
      }
      const cur = file(f.name);
      if (cur) cur.src = src;
      else proj.files.push({ name: f.name, src });
      last = f.name;
    }
    if (last) openFile(last);
    changed();
  }
  function switchProject(id) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    proj = p;
    synthKey = "";
    testState = /* @__PURE__ */ new Map();
    problems = [];
    vcds = [];
    wave?.set(null);
    $2("p-output").textContent = "";
    $2("p-results").innerHTML = "";
    if (proj.active === FLOW_TAB) proj.active = void 0;
    proj.open = openTabs().filter((n) => n !== FLOW_TAB);
    renderProjects();
    showActive();
    changed();
    persist();
    demoLink();
  }
  function demoLink() {
    $2("demoLink").href = "index.html" + (proj.from ? "#ex=" + proj.from : "");
  }
  function openExample(ex) {
    const have = projects.find((p2) => p2.from === ex.id);
    if (have) {
      switchProject(have.id);
      return;
    }
    const p = fromExample(ex);
    projects.push(p);
    switchProject(p.id);
  }
  function newProject() {
    const name = prompt("\u5C08\u6848\u540D\u7A31", "MyDesign")?.trim();
    if (!name) return;
    const p = blankProject(name);
    projects.push(p);
    switchProject(p.id);
  }
  function renameProject() {
    const name = prompt("\u5C08\u6848\u540D\u7A31", proj.name)?.trim();
    if (!name) return;
    proj.name = name;
    renderProjects();
    persist();
  }
  function deleteProject() {
    if (!confirm(`\u522A\u9664\u5C08\u6848\u300C${proj.name}\u300D\uFF1F\uFF08\u5B58\u5728\u700F\u89BD\u5668\u88E1\u7684\u6A94\u6848\u6703\u4E00\u8D77\u522A\u6389\uFF09`)) return;
    projects = projects.filter((p) => p !== proj);
    if (!projects.length) projects.push(fromExample(examples().find((e) => e.id === "seq101") ?? examples()[0]));
    switchProject(projects[0].id);
  }
  function revertProject() {
    const ex = examples().find((e) => e.id === proj.from);
    if (!ex) {
      alert("\u9019\u500B\u5C08\u6848\u4E0D\u662F\u5F9E\u7BC4\u4F8B\u958B\u7684");
      return;
    }
    if (!confirm("\u6368\u68C4\u6240\u6709\u4FEE\u6539\uFF0C\u56DE\u5230\u7BC4\u4F8B\u539F\u59CB\u78BC\uFF1F")) return;
    proj.files = ex.files.map((f) => ({ ...f }));
    proj.synth = ex.synth;
    proj.pcf = ex.pcf;
    showActive();
    changed();
  }
  function exportZip() {
    saveAs(
      `${proj.name.replace(/[^\w.-]+/g, "_") || "project"}.zip`,
      projectZip(proj.name, proj.files, proj.pcf ? { name: `${proj.synth ?? "top"}.pcf`, src: proj.pcf } : void 0),
      "application/zip"
    );
  }
  function renderExamples() {
    const box = $2("exList");
    box.innerHTML = "";
    let g = "";
    for (const ex of examples()) {
      if (ex.group !== g) {
        g = ex.group;
        const h = document.createElement("div");
        h.className = "group";
        h.textContent = g;
        box.appendChild(h);
      }
      const d = document.createElement("div");
      const opened = projects.some((p) => p.from === ex.id);
      d.className = "item";
      d.title = (ex.note ? ex.note + "\n" : "") + ex.files.map((f) => f.name).join(", ");
      d.innerHTML = `<span class="ic">${opened ? "\u25CF" : "\u25CB"}</span><span class="nm">${esc3(ex.title)}</span>`;
      d.onclick = () => {
        openExample(ex);
        renderExamples();
      };
      box.appendChild(d);
    }
  }
  function welcome() {
    const recent = projects.slice(-8).reverse();
    $2("welcome").innerHTML = `<h2>veryl2chip IDE</h2><p>Veryl \u2192 \u6A21\u64EC \u2192 \u5408\u6210 \u2192 FPGA / ASIC\uFF0C\u5168\u90E8\u5728\u700F\u89BD\u5668\u88E1\u3002</p>
    <div class="cols">
      <div><h3>\u958B\u59CB</h3><a data-a="newfile">\uFF0B \u65B0\u589E .veryl \u6A94</a><a data-a="newproj">\uFF0B \u65B0\u5C08\u6848</a><a data-a="examples">\u{1F4DA} \u958B\u555F\u7BC4\u4F8B\u2026</a><a data-a="import">\u21EA \u532F\u5165 .veryl \u6A94\u2026</a></div>
      <div><h3>\u6700\u8FD1\u7684\u5C08\u6848</h3>${recent.map((p) => `<a data-p="${p.id}">${esc3(p.name)}</a>`).join("")}</div>
      <div><h3>\u9019\u500B\u5C08\u6848</h3>${proj.files.map((f) => `<a data-f="${esc3(f.name)}">\u25C6 ${esc3(f.name)}</a>`).join("")}<a data-a="flow">\u2699 \u5408\u6210\u6D41\u7A0B</a></div>
    </div>`;
    $2("welcome").onclick = (e) => {
      const t = e.target;
      const a = t.dataset.a;
      if (a === "newfile") newFile();
      else if (a === "newproj") newProject();
      else if (a === "examples") sideView("examples");
      else if (a === "import") $2("importIn").click();
      else if (a === "flow") runSynth();
      else if (t.dataset.p) switchProject(t.dataset.p);
      else if (t.dataset.f) openFile(t.dataset.f);
    };
  }
  var checkTimer = 0;
  var checkGen = 0;
  function changed() {
    persist();
    renderFiles();
    renderTabs();
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(check, 350);
  }
  async function check() {
    if (!core) return;
    const gen = ++checkGen;
    const files = proj.files.filter((f) => f.name.endsWith(".veryl"));
    let errs = [];
    try {
      mods = (await core.call({ cmd: "list", files })).modules;
    } catch (e) {
      errs = parseErrors(String(e.message ?? e), "check");
    }
    if (gen !== checkGen) return;
    problems = [...errs, ...problems.filter((p) => p.from === "run")];
    if (errs.length) problems = problems.filter((p) => p.from === "check" || !p.file);
    refreshTops();
    renderProblems();
  }
  function parseErrors(text, from) {
    const out = [];
    for (const ln of text.split("\n")) {
      const m = /^([\w./-]+\.veryl):(\d+):(\d+):\s*(.*)$/.exec(ln);
      if (m) out.push({ file: m[1], line: +m[2], col: +m[3], msg: m[4], severity: "error", from });
      else if (ln.trim() && out.length) out[out.length - 1].msg += "\n" + ln.trim();
      else if (ln.trim()) out.push({ msg: ln.trim(), severity: "error", from, ...locate(ln) });
    }
    return out;
  }
  function locate(msg) {
    const m = /'([A-Za-z_][\w.]*)'/.exec(msg);
    if (!m) return {};
    const id = m[1].split(".").pop();
    const re = new RegExp(`(^|[^\\w$])${id.replace(/[$]/g, "\\$")}(?!\\w)`);
    for (const f of proj.files) {
      const ls = f.src.split("\n");
      for (let i = 0; i < ls.length; i++) {
        const code = ls[i].replace(/\/\/.*$/, "");
        const k = re.exec(code);
        if (k) return { file: f.name, line: i + 1, col: k.index + k[1].length + 1 };
      }
    }
    return {};
  }
  function markers() {
    const a = proj.active;
    const ms = problems.filter((p) => p.file === a && p.line).map((p) => ({ line: p.line, col: p.col ?? 1, msg: p.msg, severity: p.severity }));
    ed.setMarkers(ms);
  }
  function renderProblems() {
    const box = $2("p-problems");
    box.innerHTML = "";
    const ne = problems.filter((p) => p.severity === "error").length, nw = problems.length - ne;
    $2("sbProblems").textContent = `\u2297 ${ne}  \u26A0 ${nw}`;
    const badge = $2("probCount");
    badge.textContent = String(problems.length);
    badge.classList.toggle("hidden", !problems.length);
    badge.classList.toggle("err", ne > 0);
    if (!problems.length) {
      box.innerHTML = '<div class="none">\u6C92\u6709\u554F\u984C\u3002</div>';
    }
    for (const p of problems) {
      const d = document.createElement("div");
      d.className = "prob " + p.severity;
      d.innerHTML = `<span class="sev">${p.severity === "error" ? "\u2297" : "\u26A0"}</span><span class="m">${esc3(p.msg)}</span>${p.file ? `<span class="loc">${esc3(p.file)} [${p.line}, ${p.col}]</span>` : ""}`;
      if (p.file) d.onclick = () => openFile(p.file, p.line, p.col);
      box.appendChild(d);
    }
    markers();
    renderTabs();
    renderFiles();
  }
  function synthTop() {
    const v = $2("synthTop").value;
    return v || proj.synth || "";
  }
  function refreshTops() {
    const st = $2("simTop");
    const keep = st.value;
    st.innerHTML = '<option value="">\u5168\u90E8 #[test]</option>' + mods.map((m) => `<option value="${esc3(m.name)}">${esc3(m.name)}${m.test ? "  (test)" : ""}</option>`).join("");
    if (mods.some((m) => m.name === keep)) st.value = keep;
    const sy = $2("synthTop");
    const designs = mods.filter((m) => !m.test);
    const want = sy.value && designs.some((m) => m.name === sy.value) ? sy.value : designs.some((m) => m.name === proj.synth) ? proj.synth : designs[designs.length - 1]?.name ?? "";
    sy.innerHTML = designs.map((m) => `<option value="${esc3(m.name)}">${esc3(m.name)}</option>`).join("");
    sy.value = want;
    renderTests();
    renderOutline();
  }
  function renderTests() {
    const box = $2("testList");
    box.innerHTML = "";
    const tests = mods.filter((m) => m.test);
    if (!tests.length) {
      box.innerHTML = '<p class="side-hint">\u6C92\u6709 #[test] \u6A21\u7D44\u3002\u5728\u6A21\u7D44\u524D\u52A0\u4E0A <code>#[test(name)]</code>\uFF0C\u7528 <code>$tb::clock_gen</code>\u3001<code>$assert</code> \u5BEB testbench\u3002</p>';
      return;
    }
    for (const t of tests) {
      const s = testState.get(t.name);
      const d = document.createElement("div");
      d.className = "item " + (s ?? "");
      d.innerHTML = `<span class="ic">${s === "pass" ? "\u2713" : s === "fail" ? "\u2717" : s === "run" ? "\u2026" : "\u25CB"}</span><span class="nm">${esc3(t.name)}</span><span class="acts"><button class="icon" title="\u57F7\u884C">\u25B6</button></span>`;
      d.onclick = () => runTests(t.name);
      d.ondblclick = () => {
        const dcl = declarations().find((x) => x.name === t.name);
        if (dcl) openFile(dcl.file, dcl.line);
      };
      box.appendChild(d);
    }
  }
  function setBusy(on, what = "") {
    busy += on ? 1 : -1;
    $2("statusbar").classList.toggle("busy", busy > 0);
    if (on) $2("sbTest").textContent = what;
  }
  var KIND = { rtl: "RTL", opt: "\u901A\u7528\u9598", ice40: "iCE40", asic: "\u6A19\u6E96\u5143\u4EF6" };
  async function simulate(top, mode, vcd) {
    const files = proj.files.filter((f) => f.name.endsWith(".veryl"));
    const gate = mode === "rtl" ? {} : { gate: mode, synth: synthTop() };
    if (mode !== "rtl" && !synthTop()) throw new Error("\u6C92\u6709\u53EF\u5408\u6210\u7684\u6A21\u7D44\uFF08\u9598\u7D1A\u6A21\u64EC\u9700\u8981\u5408\u6210\u9802\u5C64\uFF09");
    return core.call({ cmd: "simulate", files, top, max_time: 1e6, vcd, ...gate });
  }
  async function runTests(only) {
    if (!core) return;
    const top = only ?? ($2("simTop").value || null);
    const mode = $2("simMode").value;
    const names = top ? [top] : mods.filter((m) => m.test).map((m) => m.name);
    for (const n of names) testState.set(n, "run");
    renderTests();
    setBusy(true, `\u25B6 \u6E2C\u8A66\u4E2D\uFF08${KIND[mode]}\uFF09\u2026`);
    const t0 = performance.now();
    problems = problems.filter((p) => p.from !== "run");
    try {
      const r = await simulate(top, mode, true);
      vcds = r.vcd;
      fillWaveTops();
      wave?.set(vcds[0]?.text ?? null);
      $2("p-output").textContent = r.log;
      for (const t of r.tops) testState.set(t.name, t.fails ? "fail" : "pass");
      const fails = r.tops.filter((t) => t.fails);
      const where = r.gate ? `\u3000\u9598\u7D1A\uFF1A${r.gate.top} \u2192 ${r.gate.cells} \u500B${KIND[mode]}\u5143\u4EF6` : "";
      const msg = fails.length ? `\u2717 ${fails.reduce((a, t) => a + t.fails, 0)} \u500B\u65B7\u8A00\u5931\u6557\uFF08${fails.map((t) => t.name).join(", ")}\uFF09` : `\u2713 ${r.tops.length} \u500B\u6E2C\u8A66\u901A\u904E`;
      $2("p-results").innerHTML = `<div class="banner ${fails.length ? "fail" : "pass"}">${esc3(msg + where)}</div><table><tr><th>testbench</th><th>${KIND[mode]}</th><th>\u7D50\u675F</th></tr>${r.tops.map((t) => `<tr><td>${esc3(t.name)}</td><td class="${t.fails ? "fail" : "pass"}">${t.fails ? `\u2717 ${t.fails} \u500B\u5931\u6557` : "\u2713 PASS"}</td><td>${t.finished ? "$finish" : "\u6642\u9593\u5230"}</td></tr>`).join("")}</table>`;
      $2("sbTest").textContent = `${fails.length ? "\u2717" : "\u2713"} ${msg.slice(2)}\uFF08${((performance.now() - t0) / 1e3).toFixed(2)} s\uFF09`;
      for (const ln of r.log.split("\n")) if (/ASSERTION FAILED/.test(ln)) problems.push({ msg: ln.trim(), severity: "error", from: "run" });
      panel(fails.length ? "output" : "results");
    } catch (e) {
      for (const n of names) testState.delete(n);
      const errs = parseErrors(String(e.message ?? e), "run");
      problems.push(...errs);
      $2("p-output").textContent = String(e.message ?? e);
      $2("sbTest").textContent = "\u2717 \u932F\u8AA4";
      panel("problems");
      const first = errs.find((p) => p.file);
      if (first) openFile(first.file, first.line, first.col);
    }
    setBusy(false);
    renderTests();
    renderProblems();
  }
  async function verifyAll() {
    if (!core) return;
    const tests = mods.filter((m) => m.test).map((m) => m.name);
    if (!tests.length) {
      alert("\u6C92\u6709 #[test] \u6A21\u7D44\u53EF\u4EE5\u8DD1");
      return;
    }
    panel("results");
    const modes = synthTop() ? ["rtl", "opt", "ice40", "asic"] : ["rtl"];
    const res = /* @__PURE__ */ new Map();
    const cells = /* @__PURE__ */ new Map();
    const draw = (done) => {
      const rtl = res.get("rtl");
      let same = true;
      const rows = tests.map((t) => `<tr><td>${esc3(t)}</td>${modes.map((m) => {
        const v = res.get(m)?.get(t);
        if (v === void 0) return `<td class="na">${done ? "\u2014" : "\u2026"}</td>`;
        if (m !== "rtl" && rtl && v !== rtl.get(t)) same = false;
        return `<td class="${v === "0" ? "pass" : v === "err" ? "fail" : "fail"}">${v === "0" ? "\u2713" : v === "err" ? "\u932F\u8AA4" : `\u2717 ${v}`}</td>`;
      }).join("")}</tr>`).join("");
      const allPass = [...res.values()].every((m) => [...m.values()].every((v) => v === "0"));
      $2("p-results").innerHTML = (done ? `<div class="banner ${allPass && same ? "pass" : "fail"}">${allPass && same ? `\u2713 \u5168\u9762\u9A57\u8B49\u901A\u904E\uFF1A${tests.length} \u500B testbench \xD7 ${modes.length} \u7A2E\u5BE6\u4F5C\u7D50\u679C\u4E00\u81F4` : same ? "\u2717 \u6709\u6E2C\u8A66\u5931\u6557\uFF08\u5404\u5BE6\u4F5C\u7D50\u679C\u4E00\u81F4\uFF09" : "\u2717 \u5408\u6210\u524D\u5F8C\u7D50\u679C\u4E0D\u4E00\u81F4\uFF01"}</div>` : '<div class="banner">\u9A57\u8B49\u4E2D\u2026</div>') + `<table><tr><th>testbench</th>${modes.map((m) => `<th>${KIND[m]}${cells.has(m) ? `<br><small>${cells.get(m)} \u5143\u4EF6</small>` : ""}</th>`).join("")}</tr>${rows}</table>` + (synthTop() ? `<p class="side-hint">\u9598\u7D1A\uFF1A\u628A ${esc3(synthTop())} \u63DB\u6210\u5408\u6210\u5F8C\u7684\u7DB2\u8868\uFF0C\u8DD1\u540C\u4E00\u7D44 testbench\u3002</p>` : "");
    };
    setBusy(true, "\u2714 \u5168\u9762\u9A57\u8B49\u4E2D\u2026");
    const t0 = performance.now();
    for (const m of modes) {
      draw(false);
      const col = /* @__PURE__ */ new Map();
      try {
        const r = await simulate(null, m, false);
        for (const t of r.tops) col.set(t.name, String(t.fails));
        if (r.gate) cells.set(m, r.gate.cells);
      } catch (e) {
        for (const t of tests) col.set(t, "err");
        problems = problems.filter((p) => p.from !== "run");
        problems.push(...parseErrors(`[${KIND[m]}] ` + String(e.message ?? e), "run"));
        renderProblems();
      }
      res.set(m, col);
    }
    draw(true);
    for (const t of tests) testState.set(t, res.get("rtl")?.get(t) === "0" ? "pass" : "fail");
    renderTests();
    $2("sbTest").textContent = `\u2714 \u5168\u9762\u9A57\u8B49 ${((performance.now() - t0) / 1e3).toFixed(1)} s`;
    setBusy(false);
  }
  function fillWaveTops() {
    const sel = $2("waveTop");
    sel.innerHTML = vcds.map((v) => `<option>${esc3(v.top)}</option>`).join("");
    sel.classList.toggle("hidden", vcds.length < 2 || curPanel !== "wave");
  }
  function runSynth(stage) {
    if (!synth) return;
    const top = synthTop();
    if (!top) {
      alert("\u6C92\u6709\u53EF\u5408\u6210\u7684\u6A21\u7D44\uFF08#[test] \u6A21\u7D44\u4E0D\u80FD\u5408\u6210\uFF09");
      return;
    }
    const files = proj.files.filter((f) => f.name.endsWith(".veryl"));
    const key = JSON.stringify([files, top, proj.pcf]);
    openFile(FLOW_TAB);
    if (window.innerHeight < 900) $2("panel").classList.add("collapsed");
    if (key !== synthKey || !synth.synthesized) {
      synthKey = key;
      const target = stage && ASIC_FLOW.some((s) => s[0] === stage && s[0].startsWith("a")) ? "asic" : stage && ["map", "place", "route", "sta"].includes(stage) ? "fpga" : void 0;
      synth.open(files, top, proj.pcf, target ?? $2("flowTarget").value, stage);
    } else if (stage) synth.showStage(stage);
    sideView("flow");
  }
  function renderFlow(cur) {
    const asic = $2("flowTarget").value === "asic";
    const box = $2("flowList");
    box.innerHTML = "";
    for (const [k, label] of [...asic ? ASIC_FLOW : FPGA_FLOW, ["cmp", "\u21C4 FPGA vs ASIC \u6BD4\u8F03"]]) {
      const d = document.createElement("div");
      const tag = label.slice(0, 1);
      d.className = "item" + (k === cur ? " cur" : "") + (tag === "F" ? " stage-fpga" : tag === "A" ? " stage-asic" : "");
      d.innerHTML = `<span class="ic">${k === "cmp" ? "\u21C4" : tag === "\u5171" ? "\u25C7" : "\u25C6"}</span><span class="nm">${esc3(label.replace(/^(共|F|A) /, ""))}</span><span class="tag">${tag === "\u5171" ? "\u5171\u7528" : tag === "F" ? "FPGA" : tag === "A" ? "ASIC" : ""}</span>`;
      d.onclick = () => runSynth(k);
      box.appendChild(d);
    }
  }
  var curPanel = "problems";
  function panel(p) {
    curPanel = p;
    $2("panel").classList.remove("collapsed");
    for (const b of $2("panelTabs").querySelectorAll("button[data-panel]")) b.classList.toggle("cur", b.dataset.panel === p);
    for (const v of ["problems", "output", "results", "wave"]) $2("p-" + v).classList.toggle("hidden", v !== p);
    $2("waveTop").classList.toggle("hidden", p !== "wave" || vcds.length < 2);
    if (p === "wave") wave?.fit();
  }
  function sideView(v) {
    const cur = $2("activity").querySelector(`button[data-view="${v}"]`);
    const already = cur?.classList.contains("cur") && !$2("sidebar").classList.contains("hidden");
    for (const b of $2("activity").querySelectorAll("button")) b.classList.toggle("cur", b.dataset.view === v);
    for (const s of document.querySelectorAll(".sideview")) s.classList.toggle("hidden", s.id !== "view-" + v);
    $2("sidebar").classList.remove("hidden");
    $2("sideResize").classList.remove("hidden");
    if (v === "examples") renderExamples();
    void already;
  }
  function resizer(id, prop, axis, min, max, invert = false) {
    const r = $2(id);
    const saved = load(prop, 0);
    if (saved) document.body.style.setProperty(prop, saved + "px");
    r.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      r.classList.add("drag");
      r.setPointerCapture(e.pointerId);
      const start = axis === "x" ? e.clientX : e.clientY;
      const target = id === "sideResize" ? $2("sidebar") : $2("panel");
      const s0 = axis === "x" ? target.getBoundingClientRect().width : target.getBoundingClientRect().height;
      const move = (ev) => {
        const d = (axis === "x" ? ev.clientX : ev.clientY) - start;
        const v = Math.max(min, Math.min(max(), s0 + (invert ? -d : d)));
        document.body.style.setProperty(prop, v + "px");
        save(prop, v);
      };
      const up = () => {
        r.classList.remove("drag");
        r.removeEventListener("pointermove", move);
        r.removeEventListener("pointerup", up);
      };
      r.addEventListener("pointermove", move);
      r.addEventListener("pointerup", up);
    });
  }
  function commands() {
    const c = [
      { label: "\u57F7\u884C\u6E2C\u8A66", key: "Ctrl+Enter", run: () => runTests() },
      { label: "\u5168\u9762\u9A57\u8B49\uFF08RTL + \u4E09\u7A2E\u9598\u7D1A\u7DB2\u8868\uFF09", run: verifyAll },
      { label: "\u5408\u6210\u4E26\u6AA2\u8996\u6D41\u7A0B", key: "Ctrl+Shift+B", run: () => runSynth() },
      ...FPGA_FLOW.slice(3).map(([k, l]) => ({ label: `\u6D41\u7A0B\uFF1A${l}`, run: () => runSynth(k) })),
      ...ASIC_FLOW.slice(3).map(([k, l]) => ({ label: `\u6D41\u7A0B\uFF1A${l}`, run: () => runSynth(k) })),
      ...FPGA_FLOW.slice(0, 3).map(([k, l]) => ({ label: `\u6D41\u7A0B\uFF1A${l}`, run: () => runSynth(k) })),
      { label: "\u6D41\u7A0B\uFF1A\u21C4 FPGA vs ASIC \u6BD4\u8F03", run: () => runSynth("cmp") },
      { label: "\u65B0\u589E\u6A94\u6848", run: newFile },
      { label: "\u65B0\u5C08\u6848", run: newProject },
      { label: "\u532F\u5165 .veryl \u6A94", run: () => $2("importIn").click() },
      { label: "\u4E0B\u8F09\u5C08\u6848 .zip", run: exportZip },
      { label: "\u91CD\u65B0\u547D\u540D\u5C08\u6848", run: renameProject },
      { label: "\u9084\u539F\u6210\u7BC4\u4F8B\u539F\u59CB\u78BC", run: revertProject },
      { label: "\u522A\u9664\u5C08\u6848", run: deleteProject },
      { label: "\u5207\u63DB\u9762\u677F", key: "Ctrl+J", run: () => $2("panel").classList.toggle("collapsed") },
      { label: "\u986F\u793A\uFF1A\u554F\u984C", run: () => panel("problems") },
      { label: "\u986F\u793A\uFF1A\u8F38\u51FA", run: () => panel("output") },
      { label: "\u986F\u793A\uFF1A\u6CE2\u5F62", run: () => panel("wave") },
      { label: "\u6B61\u8FCE\u9801", run: () => openFile(WELCOME) },
      ...projects.filter((p) => p !== proj).map((p) => ({ label: `\u5207\u63DB\u5C08\u6848\uFF1A${p.name}`, run: () => switchProject(p.id) })),
      ...examples().map((e) => ({ label: `\u958B\u555F\u7BC4\u4F8B\uFF1A${e.title}`, run: () => openExample(e) }))
    ];
    return c;
  }
  var palItems = [];
  var palSel = 0;
  function palette(files) {
    $2("palette").classList.remove("hidden");
    const inp = $2("palIn");
    inp.value = files ? "" : ">";
    inp.focus();
    palFilter();
  }
  function palFilter() {
    const q = $2("palIn").value;
    const isCmd = q.startsWith(">");
    const words = q.replace(/^>/, "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = isCmd ? commands() : [
      ...proj.files.map((f) => ({ label: f.name, key: "\u6A94\u6848", run: () => openFile(f.name) })),
      ...declarations().map((d) => ({ label: `${d.name}`, key: `${d.kind} \xB7 ${d.file}:${d.line}`, run: () => openFile(d.file, d.line) }))
    ];
    palItems = all.filter((c) => words.every((w) => (c.label + " " + (c.key ?? "")).toLowerCase().includes(w))).slice(0, 60);
    palSel = 0;
    drawPal();
  }
  function drawPal() {
    const box = $2("palList");
    box.innerHTML = "";
    palItems.forEach((c, i) => {
      const d = document.createElement("div");
      d.className = i === palSel ? "cur" : "";
      d.innerHTML = `<span>${esc3(c.label)}</span>${c.key ? `<span class="k">${esc3(c.key)}</span>` : ""}`;
      d.onmousedown = (e) => {
        e.preventDefault();
        closePal();
        c.run();
      };
      box.appendChild(d);
      if (i === palSel) d.scrollIntoView({ block: "nearest" });
    });
  }
  function closePal() {
    $2("palette").classList.add("hidden");
  }
  function globalKey(e) {
    if (mod(e) && e.key === "Enter") {
      runTests();
      return true;
    }
    if (mod(e) && e.shiftKey && (e.key === "B" || e.key === "b")) {
      runSynth();
      return true;
    }
    if (mod(e) && e.shiftKey && (e.key === "P" || e.key === "p")) {
      palette(false);
      return true;
    }
    if (mod(e) && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      palette(true);
      return true;
    }
    if (mod(e) && (e.key === "s" || e.key === "S")) {
      persist();
      $2("sbTest").textContent = "\u5DF2\u5132\u5B58\uFF08\u5728\u700F\u89BD\u5668\uFF09";
      return true;
    }
    if (mod(e) && (e.key === "j" || e.key === "J")) {
      $2("panel").classList.toggle("collapsed");
      return true;
    }
    return false;
  }
  function wire() {
    ed = new CodeEditor($2("editorHost"));
    ed.onChange = (text) => {
      const f = file(proj.active ?? "");
      if (!f) return;
      f.src = text;
      problems = problems.filter((p) => p.file !== f.name);
      changed();
    };
    ed.onCursor = (l, c) => {
      $2("sbPos").textContent = `\u884C ${l}\uFF0C\u6B04 ${c}`;
    };
    ed.onKey = globalKey;
    document.addEventListener("keydown", (e) => {
      if (!$2("palette").classList.contains("hidden")) {
        if (e.key === "Escape") {
          closePal();
          e.preventDefault();
        } else if (e.key === "ArrowDown") {
          palSel = Math.min(palItems.length - 1, palSel + 1);
          drawPal();
          e.preventDefault();
        } else if (e.key === "ArrowUp") {
          palSel = Math.max(0, palSel - 1);
          drawPal();
          e.preventDefault();
        } else if (e.key === "Enter") {
          const c = palItems[palSel];
          closePal();
          c?.run();
          e.preventDefault();
        }
        return;
      }
      if (e.target.classList?.contains("ed-ta")) return;
      if (globalKey(e)) e.preventDefault();
    });
    $2("palIn").addEventListener("input", palFilter);
    $2("palIn").addEventListener("blur", () => setTimeout(closePal, 100));
    $2("cmdPalette").onclick = () => palette(false);
    $2("cmdRun").onclick = () => runTests();
    $2("cmdVerify").onclick = verifyAll;
    $2("cmdSynth").onclick = () => runSynth();
    $2("testsRun").onclick = () => runTests();
    $2("testsVerify").onclick = verifyAll;
    $2("synthTop").onchange = () => {
      renderOutline();
    };
    $2("flowTarget").onchange = () => {
      renderFlow();
      if (proj.active === FLOW_TAB && synth?.synthesized) {
        const asic = $2("flowTarget").value === "asic";
        const map = asic ? { map: "amap", place: "aplace", route: "aroute", sta: "asta" } : { amap: "map", aplace: "place", aroute: "route", adetail: "route", asta: "sta", apower: "sta" };
        const k = map[synth.current] ?? synth.current;
        synth.showStage(k);
      }
    };
    for (const b of $2("activity").querySelectorAll("button")) b.onclick = () => sideView(b.dataset.view);
    for (const b of $2("panelTabs").querySelectorAll("button[data-panel]")) b.onclick = () => panel(b.dataset.panel);
    $2("panelToggle").onclick = () => $2("panel").classList.toggle("collapsed");
    $2("sbProblems").onclick = () => panel("problems");
    $2("projSel").onchange = () => switchProject($2("projSel").value);
    $2("projNew").onclick = newProject;
    $2("projRename").onclick = renameProject;
    $2("projDel").onclick = deleteProject;
    $2("fileNew").onclick = newFile;
    $2("fileImport").onclick = () => $2("importIn").click();
    $2("importIn").onchange = () => {
      importFiles($2("importIn").files);
      $2("importIn").value = "";
    };
    $2("projZip").onclick = exportZip;
    wave = new WaveView($2("waveCanvas"), $2("wavePick"), $2("waveFilter"));
    $2("waveTop").onchange = () => wave?.set(vcds.find((v) => v.top === $2("waveTop").value)?.text ?? null);
    resizer("sideResize", "--sidew", "x", 150, () => window.innerWidth * 0.5);
    resizer("panelResize", "--panelh", "y", 60, () => window.innerHeight * 0.75, true);
    new MutationObserver(() => {
      const t = $2("synStats").innerHTML.split(/<span class="sep">[^<]*<\/span>/).map((x) => x.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()).filter(Boolean).join("\n");
      $2("flowSum").innerText = t;
      const f = /Fmax\s*([\d.]+)\s*MHz/.exec(t);
      $2("sbSynth").textContent = f ? `\u2699 ${synthTop()} \xB7 Fmax ${f[1]} MHz` : $2("synStats").innerText ? `\u2699 ${synthTop()}` : "";
    }).observe($2("synStats"), { childList: true, subtree: true, characterData: true });
  }
  async function boot() {
    wire();
    const hash = location.hash;
    const exId = /ex=([\w-]+)/.exec(hash)?.[1];
    if (!projects.length) projects.push(fromExample(examples().find((e) => e.id === (exId ?? "seq101")) ?? examples()[0]));
    proj = projects.find((p) => p.id === load("cur", "")) ?? projects[0];
    const ex = exId ? examples().find((e) => e.id === exId) : void 0;
    if (ex) {
      const have = projects.find((p) => p.from === ex.id);
      if (have) proj = have;
      else {
        proj = fromExample(ex);
        projects.push(proj);
      }
    }
    if (proj.active === FLOW_TAB) proj.active = void 0;
    proj.open = openTabs().filter((n) => n !== FLOW_TAB);
    renderProjects();
    renderFlow();
    showActive();
    renderProblems();
    demoLink();
    try {
      const t0 = performance.now();
      core = await startCore(fromBase64(VERYL_WASM_B64));
      $2("sbCore").textContent = `\u2713 WebAssembly ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? "\uFF08\u80CC\u666F\u57F7\u884C\u7DD2\uFF09" : ""}`;
      for (const id of ["cmdRun", "cmdVerify", "cmdSynth"]) $2(id).disabled = false;
      synth = new SynthOverlay(core, {
        embedded: true,
        onStage: (k) => {
          if (ASIC_FLOW.slice(3).some((s) => s[0] === k)) $2("flowTarget").value = "asic";
          else if (FPGA_FLOW.slice(3).some((s) => s[0] === k)) $2("flowTarget").value = "fpga";
          renderFlow(k);
        }
      });
      await check();
      const st = /stage=(\w+)/.exec(hash)?.[1];
      if (st) runSynth(st);
      if (/[#&]run=1/.test(hash)) runTests();
      if (/[#&]verify=1/.test(hash)) verifyAll();
    } catch (e) {
      $2("sbCore").textContent = "\u2717 WebAssembly \u8F09\u5165\u5931\u6557";
      $2("statusbar").classList.add("bad");
      problems.push({ msg: String(e), severity: "error", from: "run" });
      renderProblems();
    }
  }
  boot();
})();
