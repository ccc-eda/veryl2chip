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
      this.reset();
    }
    static async load(bytes) {
      return new _Veryl(await WebAssembly.compile(bytes));
    }
    /** a trap (Rust panic) leaves the instance unusable: start a fresh one */
    reset() {
      this.x = new WebAssembly.Instance(this.mod, {}).exports;
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
      this.ctx = canvas.getContext("2d");
      new ResizeObserver(() => this.redraw()).observe(canvas.parentElement);
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const f = Math.exp(-e.deltaY * 15e-4);
        this.zoomAt(mx, my, f);
      }, { passive: false });
      canvas.addEventListener("pointerdown", (e) => {
        this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
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
      const r = this.canvas.getBoundingClientRect();
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

  // src/synth/model.ts
  var OUTS = /* @__PURE__ */ new Set(["Y", "Q", "O", "CO"]);
  var isOut = (pin) => OUTS.has(pin);
  var isFF = (t) => t.includes("DFF");
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
    PI: "#57c27a",
    PO: "#e06c75"
  };
  var LUT_COLOR = ["#5a6b80", "#8fbcbb", "#88c0d0", "#81a1c1", "#5e81ac"];
  function cellColor(t, inputs = 4) {
    if (t.includes("DFF")) return "#d08770";
    if (t === "SB_LUT4") return LUT_COLOR[inputs];
    return TYPE_COLOR[t] ?? "#9fb2c8";
  }
  function shortType(t) {
    if (t === "SB_LUT4") return "LUT4";
    if (t === "SB_CARRY") return "CARRY";
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
      put(c.t.includes("DFF") ? 1 : 1 + Math.max(lev.level[i], 1), i);
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
    { key: "rtl", tag: "common", label: "\u5171 \u2460 RTL\u2192Logic", ready: true },
    { key: "raw", tag: "common", label: "\u5171 \u2461 Logic Netlist", ready: true },
    { key: "opt", tag: "common", label: "\u5171 \u2462 Tech-indep Syn", ready: true },
    { key: "map", tag: "fpga", label: "F \u2463 LUT4 Techmap", ready: true },
    { key: "place", tag: "fpga", label: "F \u2464 Placement \u9000\u706B", ready: false },
    { key: "route", tag: "fpga", label: "F \u2465 Global+Detail Routing", ready: false },
    { key: "sta", tag: "fpga", label: "F \u2466 Timing (STA)", ready: false }
  ];
  var SynthOverlay = class {
    constructor(core2) {
      __publicField(this, "core", core2);
      __publicField(this, "view");
      __publicField(this, "res", null);
      __publicField(this, "stage", "rtl");
      __publicField(this, "nets", /* @__PURE__ */ new Map());
      __publicField(this, "sel", null);
      __publicField(this, "edges", true);
      __publicField(this, "files", []);
      this.view = new CanvasView($("synCanvas"));
      this.view.onPick = (b) => this.pick(b);
      $("synClose").onclick = () => this.close();
      $("synZin").onclick = () => this.view.zoom(1.4);
      $("synZout").onclick = () => this.view.zoom(1 / 1.4);
      $("synZfit").onclick = () => this.view.fit();
      $("synEdges").onclick = () => {
        this.edges = !this.edges;
        this.updateLines();
      };
      $("synTop").onchange = () => this.run($("synTop").value);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("synOverlay").classList.contains("hidden")) this.close();
      });
      this.chips();
    }
    open(files, top) {
      this.files = files;
      $("synOverlay").classList.remove("hidden");
      this.run(top);
    }
    close() {
      $("synOverlay").classList.add("hidden");
    }
    run(top) {
      $("synInfo").textContent = "\u5408\u6210\u4E2D\u2026";
      $("synSide").innerHTML = "";
      setTimeout(() => {
        const t0 = performance.now();
        try {
          this.res = this.core.call({ cmd: "synth", files: this.files, top: top || null });
        } catch (e) {
          this.res = null;
          $("synInfo").textContent = "\u5408\u6210\u5931\u6557\uFF1A\n" + String(e.message ?? e);
          this.view.set({ boxes: [], lines: [], texts: [] });
          $("synStats").innerHTML = "";
          return;
        }
        const ms = performance.now() - t0;
        this.nets.clear();
        const sel = $("synTop");
        sel.innerHTML = "";
        for (const m of this.res.modules.filter((m2) => !m2.test)) {
          const o = document.createElement("option");
          o.value = o.textContent = m.name;
          sel.appendChild(o);
        }
        sel.value = this.res.top;
        this.stats(ms);
        this.show(this.stage);
      }, 10);
    }
    chips() {
      const box = $("synChips");
      box.innerHTML = "";
      FPGA_STAGES.forEach((s, i) => {
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
        b.disabled = !s.ready;
        if (!s.ready) b.title = "\u4E0B\u4E00\u500B\u91CC\u7A0B\u7891";
        b.onclick = () => this.show(s.key);
        box.appendChild(b);
      });
    }
    netView(key) {
      let v = this.nets.get(key);
      if (!v) {
        const nl = this.res[key];
        const lev = levelize(nl);
        v = { nl, lev, lay: netScene(nl, lev), names: netNames(nl) };
        this.nets.set(key, v);
      }
      return v;
    }
    stats(ms) {
      const r = this.res;
      const m = r.map.cells;
      const luts = m.filter((c) => c.t === "SB_LUT4").length;
      const ffs = m.filter((c) => isFF(c.t)).length;
      const carry = m.filter((c) => c.t === "SB_CARRY").length;
      const lev = this.netView("map").lev;
      $("synStats").innerHTML = [
        `\u9802\u5C64 <b>${r.top}</b>`,
        `\u9598 <b>${r.raw.cells.length}</b> \u2192 <b>${r.opt.cells.length}</b>`,
        `LUT4 <b>${luts}</b>`,
        `CARRY <b>${carry}</b>`,
        `DFF <b>${ffs}</b>`,
        `LUT \u5C64\u6578 <b>${lev.depth}</b>`,
        `\u5408\u6210 <b>${ms.toFixed(0)}</b> ms`
      ].join('<span class="sep">\u2502</span>');
    }
    show(key) {
      if (!this.res) return;
      this.stage = key;
      this.sel = null;
      for (const b of $("synChips").querySelectorAll("button")) b.classList.toggle("cur", b.dataset.key === key);
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
      if (key === "raw" || key === "opt" || key === "map") {
        const v = this.netView(key);
        this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, this.edges && edgeCount(v.nl) <= 6e3, null) });
        this.info(this.netReport(key, v));
        this.side(this.netSide(key, v));
      }
    }
    updateLines() {
      const k = this.stage;
      $("synEdges").textContent = `\u2301 \u9023\u7DDA\uFF1A${this.edges ? "\u958B" : "\u95DC"}`;
      if (k !== "raw" && k !== "opt" && k !== "map") return;
      const v = this.netView(k);
      const all = this.edges && edgeCount(v.nl) <= 6e3;
      for (const b of v.lay.scene.boxes) b.hl = b.id === this.sel;
      this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, all, this.sel) }, false);
    }
    netReport(key, v) {
      const r = this.res;
      const types = countTypes(v.nl).map(([t, n]) => `${shortType(t)} ${n}`).join("  ");
      const ffs = v.nl.cells.filter((c) => isFF(c.t)).length;
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
        const rf = r.raw.cells.filter((c) => isFF(c.t)).length;
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
      d.innerHTML = `<h3>\u57E0</h3>` + table(["\u540D\u7A31", "\u65B9\u5411", "\u5BEC\u5EA6"], r.ports.map((p) => [p.name, p.dir === "in" ? "input" : "output", String(p.width)])) + `<h3>\u5BE6\u4F8B</h3>` + table(["\u8DEF\u5F91", "\u6A21\u7D44"], r.hier.map((h) => [h.path || "(top)", h.module])) + `<h3>\u8A0A\u865F\uFF08${r.signals.length}\uFF09</h3>` + table(["\u540D\u7A31", "\u5BEC\u5EA6"], r.signals.slice(0, 400).map((s) => [s.name, String(s.width)]));
      return d;
    }
    netSide(_key, v) {
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
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = '<p class="hint">\u9EDE\u5716\u4E0A\u7684\u5143\u4EF6\u770B\u7D30\u7BC0\uFF1A\u63A5\u8173\u3001\u6240\u9023\u8A0A\u865F\u3001LUT \u771F\u503C\u8868\u3002</p>';
      d.prepend(det);
      return d;
    }
    pick(b) {
      if (!b) {
        this.select(null);
        return;
      }
      const k = this.stage;
      if (k === "raw" || k === "opt" || k === "map") {
        const v = this.netView(k);
        if (b.id < v.nl.cells.length) this.select(b.id);
      }
    }
    select(i) {
      this.sel = i;
      this.updateLines();
      const det = document.getElementById("synDetail");
      const k = this.stage;
      if (!det || k !== "raw" && k !== "opt" && k !== "map") return;
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

  // src/main.ts
  var $2 = (id) => document.getElementById(id);
  var core = null;
  var synth = null;
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
  function refreshTops() {
    const sel = $2("top");
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "\u5168\u90E8 #[test]";
    sel.appendChild(all);
    if (!core || !st) return;
    try {
      for (const m of core.list(st.files)) {
        const o = document.createElement("option");
        o.value = m.name;
        o.textContent = m.name + (m.test ? "  (#[test])" : "");
        sel.appendChild(o);
      }
    } catch {
    }
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
  function runSim() {
    if (!core || !st) return;
    const top = $2("top").value || void 0;
    status("\u6A21\u64EC\u4E2D\u2026");
    $2("msg").textContent = "";
    setTimeout(() => {
      const t0 = performance.now();
      const banner = $2("banner");
      try {
        const r = core.simulate(st.files, top);
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
    }, 10);
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
    $2("synth").onclick = () => {
      if (synth && st) synth.open(st.files, st.ex.synth);
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
      core = await Veryl.load(fromBase64(VERYL_WASM_B64));
      status(`\u5C31\u7DD2\uFF08WebAssembly \u8F09\u5165 ${(performance.now() - t0).toFixed(0)} ms\uFF09`);
      $2("run").disabled = false;
      $2("synth").disabled = false;
      synth = new SynthOverlay(core);
      if (/[#&]synth=1/.test(hash)) synth.open(st.files, st.ex.synth);
      refreshTops();
    } catch (e) {
      status("WebAssembly \u8F09\u5165\u5931\u6557");
      $2("msg").textContent = String(e);
    }
  }
  boot();
})();
