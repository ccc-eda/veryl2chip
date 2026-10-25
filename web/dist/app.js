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

  // src/main.ts
  var $ = (id) => document.getElementById(id);
  var core = null;
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
    $("status").textContent = s;
  }
  function renderTabs() {
    const tabs = $("tabs");
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
    const ed = $("editor");
    const n = ed.value.split("\n").length;
    let s = "";
    for (let i = 1; i <= n; i++) s += i + "\n";
    $("gutter").textContent = s;
    $("gutter").scrollTop = ed.scrollTop;
  }
  function showFile() {
    const ed = $("editor");
    ed.value = st.files[st.cur].src;
    ed.scrollTop = 0;
    renderTabs();
    gutter();
  }
  function refreshTops() {
    const sel = $("top");
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
    $("example").value = ex.id;
    $("exnote").textContent = ex.note ?? "";
    try {
      history.replaceState(null, "", "#ex=" + ex.id);
    } catch {
    }
    showFile();
    refreshTops();
    $("log").textContent = "";
    $("msg").textContent = "";
    $("banner").className = "hidden";
  }
  function jumpTo(name, line, col) {
    if (!st) return;
    const i = st.files.findIndex((f) => f.name === name);
    if (i < 0) return;
    st.cur = i;
    showFile();
    const ed = $("editor");
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
    const msg = $("msg");
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
    const top = $("top").value || void 0;
    status("\u6A21\u64EC\u4E2D\u2026");
    $("msg").textContent = "";
    setTimeout(() => {
      const t0 = performance.now();
      const banner = $("banner");
      try {
        const r = core.simulate(st.files, top);
        $("log").textContent = r.log;
        const fails = r.tops.reduce((a, t) => a + t.fails, 0);
        banner.className = fails ? "fail" : "pass";
        banner.textContent = fails ? `\u2717 ${fails} \u500B\u65B7\u8A00\u5931\u6557\uFF08${r.tops.filter((t) => t.fails).map((t) => t.name).join(", ")}\uFF09` : `\u2713 PASS\uFF1A${r.tops.map((t) => t.name).join(", ")}`;
        status(`\u6A21\u64EC\u5B8C\u6210 ${(performance.now() - t0).toFixed(0)} ms`);
      } catch (e) {
        banner.className = "fail";
        banner.textContent = "\u2717 \u932F\u8AA4";
        $("log").textContent = "";
        showError(String(e.message ?? e));
        const m = /^([\w./-]+\.veryl):(\d+):(\d+):/.exec(String(e.message));
        if (m) jumpTo(m[1], +m[2], +m[3]);
        status("\u5931\u6557");
      }
    }, 10);
  }
  function fillExamples() {
    const sel = $("example");
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
    const ed = $("editor");
    ed.addEventListener("input", () => {
      st.files[st.cur].src = ed.value;
      persist();
      gutter();
      renderTabs();
    });
    ed.addEventListener("scroll", () => {
      $("gutter").scrollTop = ed.scrollTop;
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
    $("run").onclick = runSim;
    $("revert").onclick = () => {
      if (!st) return;
      st.files = st.ex.files.map((f) => ({ ...f }));
      persist();
      showFile();
      refreshTops();
    };
  }
  async function boot() {
    fillExamples();
    wire();
    const id = /ex=([\w-]+)/.exec(location.hash)?.[1] ?? "seq101";
    selectExample(id);
    window.addEventListener("hashchange", () => {
      const h = /ex=([\w-]+)/.exec(location.hash)?.[1];
      if (h && h !== st?.ex.id) selectExample(h);
    });
    try {
      const t0 = performance.now();
      core = await Veryl.load(fromBase64(VERYL_WASM_B64));
      status(`\u5C31\u7DD2\uFF08WebAssembly \u8F09\u5165 ${(performance.now() - t0).toFixed(0)} ms\uFF09`);
      $("run").disabled = false;
      refreshTops();
    } catch (e) {
      status("WebAssembly \u8F09\u5165\u5931\u6557");
      $("msg").textContent = String(e);
    }
  }
  boot();
})();
