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
    constructor(mod) {
      __publicField(this, "mod", mod);
      __publicField(this, "x");
      __publicField(this, "chipdb", null);
      this.reset();
    }
    static async load(bytes) {
      return new _Veryl(await WebAssembly.compile(bytes));
    }
    static fromModule(mod) {
      return new _Veryl(mod);
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
    const mod = await WebAssembly.compile(wasm);
    try {
      return await workerCore(mod);
    } catch {
      return directCore(mod);
    }
  }
  function chipdbGz() {
    if (typeof VERYL_CHIPDB_GZ_B64 === "undefined") throw new Error("chipdb.js (\u6676\u7247\u8CC7\u6599\u5EAB) \u6C92\u6709\u8F09\u5165");
    return fromBase64(VERYL_CHIPDB_GZ_B64);
  }
  async function workerCore(mod) {
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
    await Promise.race([send({ type: "init", module: mod }), new Promise((_, f) => setTimeout(() => f(new Error("worker timeout")), 5e3))]);
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
  function directCore(mod) {
    const v = Veryl.fromModule(mod);
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
    { key: "asta", tag: "asic", label: "A \u2466 Timing (STA)" }
  ];
  var PNR = /* @__PURE__ */ new Set(["place", "route", "sta"]);
  var ASIC = /* @__PURE__ */ new Set(["amap", "aplace", "aroute", "asta"]);
  var APHYS = /* @__PURE__ */ new Set(["aplace", "aroute", "asta"]);
  var OTHER = { map: "amap", place: "aplace", route: "aroute", sta: "asta", amap: "map", aplace: "place", aroute: "route", asta: "sta" };
  var isNet = (k) => k === "raw" || k === "opt" || k === "map" || k === "amap";
  var SynthOverlay = class {
    constructor(core2) {
      __publicField(this, "core", core2);
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
      this.view = new CanvasView($("synCanvas"));
      this.view.onPick = (b) => this.pick(b);
      $("synClose").onclick = () => this.close();
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
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("synOverlay").classList.contains("hidden")) this.close();
      });
      this.chips();
    }
    open(files, top, pcf, target) {
      this.files = files;
      this.pcf = pcf;
      if (target) this.setTarget(target, false);
      $("synOverlay").classList.remove("hidden");
      this.run(top);
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
      if (PNR.has(this.stage)) this.show(this.stage);
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
      if (ASIC.has(this.stage)) this.show(this.stage);
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
      $("synEdges").classList.toggle("hidden", this.stage === "place" || this.stage === "aplace");
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
      const r = this.res;
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
      const scene = dieScene(a, void 0, color);
      for (const b of scene.boxes) b.hl = b.id === this.sel || k === "asta" && b.id < a.cells.length && a.cells[b.id][4] === 1;
      if (k === "aroute") {
        scene.bg = [...scene.bg ?? [], ...congestion(a)];
        scene.lines = this.edges ? asicRouteLines(a, { net: this.selNetA }) : [];
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
          "\u4F9D\u76EE\u6A19\u5229\u7528\u7387 65% \u6C7A\u5B9A\u6676\u7C92\u5927\u5C0F\uFF0CIO \u8173\u5E73\u5747\u653E\u5728\u56DB\u5468\uFF08\u8F38\u5165\uFF1A\u5DE6\u3001\u4E0A\uFF1B\u8F38\u51FA\uFF1A\u53F3\u3001\u4E0B\uFF09\u3002\u521D\u59CB\u4F9D\u7DB2\u8868\u9806\u5E8F\u86C7\u5F62\u586B\u5217\uFF0C\u518D\u4EE5\u6A21\u64EC\u9000\u706B\u6700\u5C0F\u5316 HPWL\uFF1A\u6BCF\u4E00\u6B65\u628A\u5143\u4EF6\u79FB\u5230\u7A7A\u4F4D\u6216\u8207\u53E6\u4E00\u500B\u5143\u4EF6\u4EA4\u63DB\uFF0C\u6C38\u9060\u4FDD\u6301\u5408\u6CD5\uFF08\u4E0D\u91CD\u758A\u3001\u5C0D\u9F4A site\uFF09\u3002",
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
      const t = a.timing;
      return [
        "A \u2466 Timing (STA)",
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
      if (key === "asta") {
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
      div.innerHTML += `<h3>IO \u8173</h3>` + table(["\u8A0A\u865F", "\u65B9\u5411", "x \xB5m", "y \xB5m"], a.pins.map((p) => [esc(p.name), p.dir, p.x.toFixed(1), p.y.toFixed(1)]));
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: typeof data === "string" ? "text/plain" : "application/octet-stream" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1e3);
  }
  function fmtArea(um2) {
    return um2 >= 1e5 ? `${(um2 / 1e6).toFixed(3)} mm\xB2` : `${um2.toFixed(0)} \xB5m\xB2`;
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

  // src/main.ts
  var $2 = (id) => document.getElementById(id);
  var core = null;
  var synth = null;
  var wave = null;
  var vcds = [];
  function showTab(t) {
    $2("tabLog").classList.toggle("cur", t === "log");
    $2("tabWave").classList.toggle("cur", t === "wave");
    $2("log").classList.toggle("hidden", t !== "log");
    $2("wavePane").classList.toggle("hidden", t !== "wave");
    $2("waveTop").classList.toggle("hidden", t !== "wave" || vcds.length < 2);
    $2("waveHint").textContent = t === "wave" ? "\u6EFE\u8F2A\u7E2E\u653E\u3001\u62D6\u66F3\u5E73\u79FB\u3001\u96D9\u64CA\u5168\u89BD" : "";
    if (t === "wave") wave?.fit();
  }
  function showVcds(list) {
    vcds = list;
    const sel = $2("waveTop");
    sel.innerHTML = "";
    for (const v of list) {
      const o = document.createElement("option");
      o.value = o.textContent = v.top;
      sel.appendChild(o);
    }
    wave?.set(list[0]?.text ?? null);
    showTab($2("tabWave").classList.contains("cur") ? "wave" : "log");
  }
  var st = null;
  function store() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  function savedFiles(ex) {
    try {
      const s = store()?.getItem("veryl2chip:" + ex.id);
      if (s) {
        const v = JSON.parse(s);
        if (Array.isArray(v) && v.length === ex.files.length) return v;
      }
    } catch {
    }
    return ex.files.map((f) => ({ ...f }));
  }
  function persist() {
    if (!st) return;
    try {
      const same = st.files.every((f, i) => f.src === st.ex.files[i].src);
      if (same) store()?.removeItem("veryl2chip:" + st.ex.id);
      else store()?.setItem("veryl2chip:" + st.ex.id, JSON.stringify(st.files));
    } catch {
    }
  }
  function status(s) {
    $2("status").textContent = s;
  }
  function renderTabs() {
    const tabs = $2("tabs");
    tabs.innerHTML = "";
    st.files.forEach((f, i) => {
      const b = document.createElement("button");
      b.textContent = f.name;
      if (i === st.cur) b.classList.add("cur");
      if (f.src !== st.ex.files[i].src) b.classList.add("dirty");
      b.onclick = () => {
        st.cur = i;
        showFile();
      };
      tabs.appendChild(b);
    });
  }
  function gutter() {
    const ed = $2("editor");
    const n = ed.value.split("\n").length;
    let s = "";
    for (let i = 1; i <= n; i++) s += i + "\n";
    $2("gutter").textContent = s;
    $2("gutter").scrollTop = ed.scrollTop;
  }
  function showFile() {
    const ed = $2("editor");
    ed.value = st.files[st.cur].src;
    ed.scrollTop = 0;
    renderTabs();
    gutter();
  }
  async function refreshTops() {
    const sel = $2("top");
    const keep = sel.value;
    if (!core || !st) return;
    let mods = [];
    try {
      mods = (await core.call({ cmd: "list", files: st.files })).modules;
    } catch {
    }
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "\u5168\u90E8 #[test]";
    sel.appendChild(all);
    for (const m of mods) {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.name + (m.test ? "  (#[test])" : "");
      sel.appendChild(o);
    }
    if (mods.some((m) => m.name === keep)) sel.value = keep;
  }
  function selectExample(id) {
    const ex = examples().find((e) => e.id === id) ?? examples()[0];
    if (!ex) return;
    st = { ex, files: savedFiles(ex), cur: 0 };
    $2("example").value = ex.id;
    $2("exnote").textContent = ex.note ?? "";
    try {
      history.replaceState(null, "", "#ex=" + ex.id);
    } catch {
    }
    showFile();
    refreshTops();
    $2("log").textContent = "";
    $2("msg").textContent = "";
    $2("banner").className = "hidden";
    showVcds([]);
  }
  function jumpTo(name, line, col) {
    if (!st) return;
    const i = st.files.findIndex((f) => f.name === name);
    if (i < 0) return;
    st.cur = i;
    showFile();
    const ed = $2("editor");
    const lines = ed.value.split("\n");
    let off = 0;
    for (let k = 0; k < line - 1 && k < lines.length; k++) off += lines[k].length + 1;
    const end = off + (lines[line - 1]?.length ?? 0);
    ed.focus();
    ed.setSelectionRange(off + Math.max(0, col - 1), end);
    ed.scrollTop = Math.max(0, (line - 6) * 17.4);
    gutter();
  }
  function showError(text) {
    const msg = $2("msg");
    msg.innerHTML = "";
    for (const ln of text.split("\n")) {
      const m = /^([\w./-]+\.veryl):(\d+):(\d+):/.exec(ln);
      const div = document.createElement("div");
      if (m) {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = m[0];
        a.onclick = (e) => {
          e.preventDefault();
          jumpTo(m[1], +m[2], +m[3]);
        };
        div.append(a, ln.slice(m[0].length));
      } else div.textContent = ln;
      msg.appendChild(div);
    }
  }
  async function runSim() {
    if (!core || !st) return;
    const top = $2("top").value || null;
    status("\u6A21\u64EC\u4E2D\u2026");
    $2("msg").textContent = "";
    $2("run").disabled = true;
    {
      const t0 = performance.now();
      const banner = $2("banner");
      try {
        const r = await core.call({ cmd: "simulate", files: st.files, top, max_time: 1e6, vcd: true });
        showVcds(r.vcd);
        $2("log").textContent = r.log;
        const fails = r.tops.reduce((a, t) => a + t.fails, 0);
        banner.className = fails ? "fail" : "pass";
        banner.textContent = fails ? `\u2717 ${fails} \u500B\u65B7\u8A00\u5931\u6557\uFF08${r.tops.filter((t) => t.fails).map((t) => t.name).join(", ")}\uFF09` : `\u2713 PASS\uFF1A${r.tops.map((t) => t.name).join(", ")}`;
        status(`\u6A21\u64EC\u5B8C\u6210 ${(performance.now() - t0).toFixed(0)} ms`);
      } catch (e) {
        banner.className = "fail";
        banner.textContent = "\u2717 \u932F\u8AA4";
        $2("log").textContent = "";
        showError(String(e.message ?? e));
        const m = /^([\w./-]+\.veryl):(\d+):(\d+):/.exec(String(e.message));
        if (m) jumpTo(m[1], +m[2], +m[3]);
        status("\u5931\u6557");
      }
      $2("run").disabled = false;
    }
  }
  function fillExamples() {
    const sel = $2("example");
    const groups = /* @__PURE__ */ new Map();
    for (const ex of examples()) {
      let g = groups.get(ex.group);
      if (!g) {
        g = document.createElement("optgroup");
        g.label = ex.group;
        groups.set(ex.group, g);
        sel.appendChild(g);
      }
      const o = document.createElement("option");
      o.value = ex.id;
      o.textContent = ex.title;
      g.appendChild(o);
    }
    sel.onchange = () => selectExample(sel.value);
  }
  function wire() {
    const ed = $2("editor");
    ed.addEventListener("input", () => {
      st.files[st.cur].src = ed.value;
      persist();
      gutter();
      renderTabs();
    });
    ed.addEventListener("scroll", () => {
      $2("gutter").scrollTop = ed.scrollTop;
    });
    ed.addEventListener("change", refreshTops);
    ed.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ed.selectionStart;
        ed.setRangeText("    ", s, ed.selectionEnd, "end");
        ed.dispatchEvent(new Event("input"));
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runSim();
      }
    });
    $2("run").onclick = runSim;
    wave = new WaveView($2("waveCanvas"), $2("wavePick"), $2("waveFilter"));
    $2("tabLog").onclick = () => showTab("log");
    $2("tabWave").onclick = () => showTab("wave");
    $2("waveTop").onchange = () => wave?.set(vcds.find((v) => v.top === $2("waveTop").value)?.text ?? null);
    $2("synth").onclick = () => {
      if (synth && st) synth.open(st.files, st.ex.synth, st.ex.pcf);
    };
    $2("revert").onclick = () => {
      if (!st) return;
      st.files = st.ex.files.map((f) => ({ ...f }));
      persist();
      showFile();
      refreshTops();
    };
  }
  async function boot() {
    const hash = location.hash;
    fillExamples();
    wire();
    const id = /ex=([\w-]+)/.exec(hash)?.[1] ?? "seq101";
    selectExample(id);
    window.addEventListener("hashchange", () => {
      const h = /ex=([\w-]+)/.exec(location.hash)?.[1];
      if (h && h !== st?.ex.id) selectExample(h);
    });
    try {
      const t0 = performance.now();
      core = await startCore(fromBase64(VERYL_WASM_B64));
      status(`\u5C31\u7DD2\uFF08WebAssembly \u8F09\u5165 ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? "\uFF0C\u80CC\u666F\u57F7\u884C\u7DD2" : ""}\uFF09`);
      $2("run").disabled = false;
      $2("synth").disabled = false;
      synth = new SynthOverlay(core);
      if (/[#&]synth=1/.test(hash)) synth.open(st.files, st.ex.synth, st.ex.pcf, /[#&]target=asic/.test(hash) ? "asic" : void 0);
      refreshTops();
    } catch (e) {
      status("WebAssembly \u8F09\u5165\u5931\u6557");
      $2("msg").textContent = String(e);
    }
  }
  boot();
})();
