"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/api.ts
var api_exports = {};
__export(api_exports, {
  Veryl: () => Veryl,
  fromBase64: () => fromBase64
});
module.exports = __toCommonJS(api_exports);
function fromBase64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
var Veryl = class _Veryl {
  constructor(mod) {
    this.mod = mod;
    this.reset();
  }
  mod;
  x;
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Veryl,
  fromBase64
});
