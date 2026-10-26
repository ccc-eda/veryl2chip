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
  async function gunzip(gz2) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([gz2]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // src/i18n_hans.ts
  var HANS_PHRASES = {
    "\u6A21\u7D44": "\u6A21\u5757",
    "\u6A94\u6848\u7E3D\u7BA1": "\u8D44\u6E90\u7BA1\u7406\u5668",
    "\u6A94\u6848": "\u6587\u4EF6",
    "\u6A94\u540D": "\u6587\u4EF6\u540D",
    "\u5FEB\u901F\u958B\u6A94": "\u5FEB\u901F\u6253\u5F00\u6587\u4EF6",
    "\u66AB\u5B58\u5668\u6A94": "\u5BC4\u5B58\u5668\u5806",
    "\u6A94": "\u6587\u4EF6",
    "\u53EF\u7A0B\u5F0F": "\u53EF\u7F16\u7A0B",
    "\u7A0B\u5F0F\u78BC": "\u4EE3\u7801",
    "\u539F\u59CB\u78BC": "\u6E90\u4EE3\u7801",
    "\u7A0B\u5F0F": "\u7A0B\u5E8F",
    "\u4ECB\u9762": "\u754C\u9762",
    "\u6A21\u64EC\u9000\u706B": "\u6A21\u62DF\u9000\u706B",
    "\u6A21\u64EC": "\u4EFF\u771F",
    "\u4F4D\u5143\u6D41": "\u6BD4\u7279\u6D41",
    "\u4F4D\u5143": "\u4F4D",
    "\u9810\u8A2D": "\u9ED8\u8BA4",
    "\u8A18\u61B6\u9AD4\u7DE8\u8B6F\u5668": "\u5B58\u50A8\u5668\u7F16\u8BD1\u5668",
    "\u8A18\u61B6\u9AD4": "\u5B58\u50A8\u5668",
    "\u8CC7\u6599\u5EAB": "\u6570\u636E\u5E93",
    "\u8CC7\u6599": "\u6570\u636E",
    "\u8A0A\u865F": "\u4FE1\u53F7",
    "\u8A2D\u5B9A": "\u8BBE\u7F6E",
    "\u80CC\u666F\u57F7\u884C\u7DD2": "\u540E\u53F0\u7EBF\u7A0B",
    "\u57F7\u884C\u7DD2": "\u7EBF\u7A0B",
    "\u57F7\u884C": "\u8FD0\u884C",
    "\u8F09\u5165": "\u52A0\u8F7D",
    "\u5132\u5B58": "\u4FDD\u5B58",
    "\u532F\u5165": "\u5BFC\u5165",
    "\u532F\u51FA": "\u5BFC\u51FA",
    "\u5C08\u6848": "\u9879\u76EE",
    "\u7BC4\u4F8B": "\u793A\u4F8B",
    "\u547D\u4EE4\u9078\u55AE": "\u547D\u4EE4\u9762\u677F",
    "\u9078\u55AE": "\u83DC\u5355",
    "\u7DB2\u8DEF": "\u7F51\u7EDC",
    "\u7E5E\u7DDA": "\u5E03\u7EBF",
    "\u91CD\u7E5E": "\u91CD\u65B0\u5E03\u7EBF",
    "\u7E5E\u4E0D\u901A": "\u5E03\u4E0D\u901A",
    "\u7E5E\u5F97\u901A": "\u5E03\u5F97\u901A",
    "\u4F48\u5C40": "\u5E03\u5C40",
    "\u6A19\u6E96\u5143\u4EF6": "\u6807\u51C6\u5355\u5143",
    "\u586B\u5145\u5143\u4EF6": "\u586B\u5145\u5355\u5143",
    "\u5143\u4EF6\u5EAB": "\u5355\u5143\u5E93",
    "\u5143\u4EF6": "\u5355\u5143",
    "\u6676\u7247": "\u82AF\u7247",
    "\u6676\u7C92": "\u88F8\u7247",
    "\u786C\u9AD4": "\u786C\u4EF6",
    "\u6B63\u53CD\u5668": "\u89E6\u53D1\u5668",
    "\u66AB\u5B58\u5668": "\u5BC4\u5B58\u5668",
    "\u6642\u8108": "\u65F6\u949F",
    "\u786C\u5DE8\u96C6": "\u786C\u5B8F",
    "\u5DE8\u96C6": "\u5B8F",
    "\u5BEB\u5165\u57E0": "\u5199\u5165\u7AEF\u53E3",
    "\u8B80\u53D6\u57E0": "\u8BFB\u53D6\u7AEF\u53E3",
    "\u8F38\u5165\u57E0": "\u8F93\u5165\u7AEF\u53E3",
    "\u57E0": "\u7AEF\u53E3",
    "\u5BE6\u4F5C": "\u5B9E\u73B0",
    "\u51FD\u5F0F": "\u51FD\u6570",
    "\u7D44\u5408\u8FF4\u8DEF": "\u7EC4\u5408\u73AF\u8DEF",
    "\u8FF4\u8DEF\u6E2C\u8A66": "\u73AF\u56DE\u6D4B\u8BD5",
    "\u8FF4\u8DEF": "\u73AF\u56DE",
    "\u905E\u8FF4": "\u9012\u5F52",
    "\u53EA\u5217\u7D71\u8A08": "\u53EA\u5217\u7EDF\u8BA1",
    "\u5074\u6B04": "\u4FA7\u680F",
    "\u6B04": "\u5217",
    "\u5217": "\u884C",
    "\u9078\u53D6": "\u9009\u4E2D",
    "\u652F\u63F4": "\u652F\u6301",
    "\u6700\u4F73\u5316": "\u4F18\u5316",
    "\u96FB\u6676\u9AD4": "\u6676\u4F53\u7BA1",
    "\u5E73\u884C": "\u5E76\u884C",
    "\u4E95\u8207": "\u9631\u4E0E",
    "\u63A5\u8173": "\u5F15\u811A",
    "\u8173\u4F4D": "\u5F15\u811A",
    "\u8173": "\u5F15\u811A",
    "\u8A3B\u89E3": "\u6CE8\u91CA",
    "\u53CD\u7E2E\u6392": "\u53CD\u7F29\u8FDB",
    "\u7E2E\u6392": "\u7F29\u8FDB",
    "\u65B0\u589E": "\u65B0\u5EFA",
    "\u91CD\u65B0\u547D\u540D": "\u91CD\u547D\u540D",
    "\u6536\u5408": "\u6298\u53E0",
    "\u4F3A\u670D\u5668": "\u670D\u52A1\u5668",
    "\u8CA0\u7DE3": "\u4E0B\u964D\u6CBF",
    "\u6B63\u7DE3": "\u4E0A\u5347\u6CBF",
    "\u908A\u7DE3": "\u8FB9\u6CBF",
    "\u975E\u540C\u6B65": "\u5F02\u6B65",
    "\u4F4E\u614B\u6709\u6548": "\u4F4E\u7535\u5E73\u6709\u6548",
    "\u5206\u4F48": "\u5206\u5E03",
    "\u9918\u88D5": "\u88D5\u91CF",
    "\u9598\u7D1A": "\u95E8\u7EA7",
    "\u6524\u5E73": "\u5C55\u5E73",
    "\u5373\u6642": "\u5B9E\u65F6",
    "\u5C55\u793A\u7248": "\u6F14\u793A\u7248",
    "\u5408\u6210": "\u7EFC\u5408",
    "\u526A\u8CBC\u7C3F": "\u526A\u8D34\u677F",
    "\u87A2\u5E55": "\u663E\u793A\u5668",
    "\u9B91\u7387": "\u6CE2\u7279\u7387",
    "\u9B91": "\u6CE2\u7279",
    "\u532F": "\u6C47",
    "\u54C1\u8CEA": "\u8D28\u91CF",
    "\u7269\u4EF6": "\u5BF9\u8C61",
    "\u5F71\u7247": "\u89C6\u9891",
    "\u9810\u89BD": "\u9884\u89C8",
    "\u5217\u5F0F": "\u884C\u5F0F"
  };
  var HANS_CHARS = {
    "\u71C8": "\u706F",
    "\u6975": "\u6781",
    "\u88FD": "\u5236",
    "\u8907": "\u590D",
    "\u8CBC": "\u8D34",
    "\u9EB5": "\u9762",
    "\u55CE": "\u5417",
    "\u8072": "\u58F0",
    "\u87A2": "\u8424",
    "\u898B": "\u89C1",
    "\u9B91": "\u9C8D",
    "\u9CF4": "\u9E23",
    "\u9EBC": "\u4E48",
    "\u5B78": "\u5B66",
    "\u64CA": "\u51FB",
    "\u7E7C": "\u7EE7",
    "\u865B": "\u865A",
    "\u9215": "\u94AE",
    "\u9396": "\u9501",
    "\u4E26": "\u5E76",
    "\u4F48": "\u5E03",
    "\u4F54": "\u5360",
    "\u4F75": "\u5E76",
    "\u4F86": "\u6765",
    "\u500B": "\u4E2A",
    "\u5074": "\u4FA7",
    "\u50B3": "\u4F20",
    "\u50F9": "\u4EF7",
    "\u5100": "\u4EEA",
    "\u5104": "\u4EBF",
    "\u512A": "\u4F18",
    "\u5132": "\u50A8",
    "\u5167": "\u5185",
    "\u5169": "\u4E24",
    "\u5225": "\u522B",
    "\u522A": "\u5220",
    "\u5247": "\u5219",
    "\u5275": "\u521B",
    "\u5283": "\u5212",
    "\u52D5": "\u52A8",
    "\u532F": "\u6C47",
    "\u5354": "\u534F",
    "\u53C3": "\u53C2",
    "\u54E1": "\u5458",
    "\u554F": "\u95EE",
    "\u555F": "\u542F",
    "\u55AE": "\u5355",
    "\u56B4": "\u4E25",
    "\u570D": "\u56F4",
    "\u5716": "\u56FE",
    "\u57F7": "\u6267",
    "\u584A": "\u5757",
    "\u58D3": "\u538B",
    "\u5BE6": "\u5B9E",
    "\u5BEB": "\u5199",
    "\u5BEC": "\u5BBD",
    "\u5C08": "\u4E13",
    "\u5C0D": "\u5BF9",
    "\u5C0E": "\u5BFC",
    "\u5C64": "\u5C42",
    "\u5C6C": "\u5C5E",
    "\u5E2B": "\u5E08",
    "\u5E36": "\u5E26",
    "\u5EAB": "\u5E93",
    "\u5EE3": "\u5E7F",
    "\u5F48": "\u5F39",
    "\u5F8C": "\u540E",
    "\u5F91": "\u5F84",
    "\u5F9E": "\u4ECE",
    "\u5FB5": "\u5F81",
    "\u614B": "\u6001",
    "\u61B6": "\u5FC6",
    "\u61C9": "\u5E94",
    "\u61F2": "\u60E9",
    "\u6368": "\u820D",
    "\u63DB": "\u6362",
    "\u647A": "\u6298",
    "\u64B2": "\u6251",
    "\u64C1": "\u62E5",
    "\u64C7": "\u62E9",
    "\u64CB": "\u6321",
    "\u64E0": "\u6324",
    "\u64EC": "\u62DF",
    "\u6524": "\u644A",
    "\u6557": "\u8D25",
    "\u6578": "\u6570",
    "\u65B7": "\u65AD",
    "\u65BC": "\u4E8E",
    "\u6642": "\u65F6",
    "\u66AB": "\u6682",
    "\u66F8": "\u4E66",
    "\u6703": "\u4F1A",
    "\u689D": "\u6761",
    "\u68C4": "\u5F03",
    "\u6A02": "\u4E50",
    "\u6A19": "\u6807",
    "\u6A23": "\u6837",
    "\u6A39": "\u6811",
    "\u6A5F": "\u673A",
    "\u6A94": "\u6863",
    "\u6AA2": "\u68C0",
    "\u6B0A": "\u6743",
    "\u6B61": "\u6B22",
    "\u6B77": "\u5386",
    "\u6B78": "\u5F52",
    "\u6C7A": "\u51B3",
    "\u6C92": "\u6CA1",
    "\u6CC1": "\u51B5",
    "\u6DFA": "\u6D45",
    "\u6E1B": "\u51CF",
    "\u6E2C": "\u6D4B",
    "\u6E96": "\u51C6",
    "\u6EAB": "\u6E29",
    "\u6EFE": "\u6EDA",
    "\u6EFF": "\u6EE1",
    "\u6F22": "\u6C49",
    "\u700F": "\u6D4F",
    "\u70BA": "\u4E3A",
    "\u7121": "\u65E0",
    "\u71B1": "\u70ED",
    "\u71D2": "\u70E7",
    "\u72C0": "\u72B6",
    "\u73FE": "\u73B0",
    "\u74B0": "\u73AF",
    "\u7522": "\u4EA7",
    "\u756B": "\u753B",
    "\u758A": "\u53E0",
    "\u767C": "\u53D1",
    "\u76E4": "\u76D8",
    "\u78BC": "\u7801",
    "\u790E": "\u7840",
    "\u7A2E": "\u79CD",
    "\u7A31": "\u79F0",
    "\u7A4D": "\u79EF",
    "\u7AAE": "\u7A77",
    "\u7BC0": "\u8282",
    "\u7BC4": "\u8303",
    "\u7BE9": "\u7B5B",
    "\u7C21": "\u7B80",
    "\u7C3D": "\u7B7E",
    "\u7C64": "\u7B7E",
    "\u7D04": "\u7EA6",
    "\u7D05": "\u7EA2",
    "\u7D1A": "\u7EA7",
    "\u7D30": "\u7EC6",
    "\u7D42": "\u7EC8",
    "\u7D44": "\u7EC4",
    "\u7D50": "\u7ED3",
    "\u7D66": "\u7ED9",
    "\u7D71": "\u7EDF",
    "\u7D93": "\u7ECF",
    "\u7D9C": "\u7EFC",
    "\u7DA0": "\u7EFF",
    "\u7DB2": "\u7F51",
    "\u7DD2": "\u7EEA",
    "\u7DDA": "\u7EBF",
    "\u7DE3": "\u7F18",
    "\u7DE8": "\u7F16",
    "\u7DE9": "\u7F13",
    "\u7E2E": "\u7F29",
    "\u7E3D": "\u603B",
    "\u7E5E": "\u7ED5",
    "\u7E8C": "\u7EED",
    "\u7F70": "\u7F5A",
    "\u806F": "\u8054",
    "\u8108": "\u8109",
    "\u8166": "\u8111",
    "\u8173": "\u811A",
    "\u81E8": "\u4E34",
    "\u8207": "\u4E0E",
    "\u8209": "\u4E3E",
    "\u84CB": "\u76D6",
    "\u85CD": "\u84DD",
    "\u862D": "\u5170",
    "\u8655": "\u5904",
    "\u865F": "\u53F7",
    "\u8853": "\u672F",
    "\u885D": "\u51B2",
    "\u88DC": "\u8865",
    "\u88E1": "\u91CC",
    "\u898F": "\u89C4",
    "\u8996": "\u89C6",
    "\u89BD": "\u89C8",
    "\u8A08": "\u8BA1",
    "\u8A0A": "\u8BAF",
    "\u8A18": "\u8BB0",
    "\u8A2D": "\u8BBE",
    "\u8A3B": "\u6CE8",
    "\u8A66": "\u8BD5",
    "\u8A72": "\u8BE5",
    "\u8A9E": "\u8BED",
    "\u8AA4": "\u8BEF",
    "\u8AAA": "\u8BF4",
    "\u8ABF": "\u8C03",
    "\u8ACB": "\u8BF7",
    "\u8B49": "\u8BC1",
    "\u8B6F": "\u8BD1",
    "\u8B80": "\u8BFB",
    "\u8B8A": "\u53D8",
    "\u8B93": "\u8BA9",
    "\u8CA0": "\u8D1F",
    "\u8CC7": "\u8D44",
    "\u8ECC": "\u8F68",
    "\u8F03": "\u8F83",
    "\u8F09": "\u8F7D",
    "\u8F2A": "\u8F6E",
    "\u8F2F": "\u8F91",
    "\u8F38": "\u8F93",
    "\u8F49": "\u8F6C",
    "\u8FF4": "\u56DE",
    "\u9019": "\u8FD9",
    "\u9023": "\u8FDE",
    "\u9031": "\u5468",
    "\u9032": "\u8FDB",
    "\u904E": "\u8FC7",
    "\u9054": "\u8FBE",
    "\u9055": "\u8FDD",
    "\u905E": "\u9012",
    "\u9060": "\u8FDC",
    "\u9072": "\u8FDF",
    "\u9078": "\u9009",
    "\u9084": "\u8FD8",
    "\u908A": "\u8FB9",
    "\u908F": "\u903B",
    "\u9304": "\u5F55",
    "\u932F": "\u9519",
    "\u9375": "\u952E",
    "\u93C8": "\u94FE",
    "\u9418": "\u949F",
    "\u9577": "\u957F",
    "\u9589": "\u95ED",
    "\u958B": "\u5F00",
    "\u9593": "\u95F4",
    "\u9598": "\u95E8",
    "\u95DC": "\u5173",
    "\u9663": "\u9635",
    "\u968E": "\u9636",
    "\u969B": "\u9645",
    "\u96A8": "\u968F",
    "\u96D6": "\u867D",
    "\u96D9": "\u53CC",
    "\u96DC": "\u6742",
    "\u96E2": "\u79BB",
    "\u96FB": "\u7535",
    "\u975C": "\u9759",
    "\u97FF": "\u54CD",
    "\u9801": "\u9875",
    "\u9802": "\u9876",
    "\u9805": "\u9879",
    "\u9806": "\u987A",
    "\u9808": "\u987B",
    "\u9810": "\u9884",
    "\u9813": "\u987F",
    "\u982D": "\u5934",
    "\u9838": "\u9888",
    "\u983B": "\u9891",
    "\u9846": "\u9897",
    "\u984C": "\u9898",
    "\u984F": "\u989C",
    "\u985E": "\u7C7B",
    "\u986F": "\u663E",
    "\u9918": "\u4F59",
    "\u994B": "\u9988",
    "\u9A45": "\u9A71",
    "\u9A57": "\u9A8C",
    "\u9AD4": "\u4F53",
    "\u9B06": "\u677E",
    "\u9EC3": "\u9EC4",
    "\u9EDE": "\u70B9",
    "\u9F4A": "\u9F50"
  };

  // src/i18n.ts
  var LANGS = [["zh-Hant", "\u7E41\u9AD4\u4E2D\u6587"], ["zh-Hans", "\u7B80\u4F53\u4E2D\u6587"], ["en", "English"]];
  var cur = "zh-Hant";
  function setLang(l) {
    cur = l;
  }
  function fromLocale(loc) {
    const l = (loc ?? "").toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(l)) return "zh-Hant";
    if (l.startsWith("zh")) return "zh-Hans";
    return l ? "en" : "zh-Hant";
  }
  function tr(hant, en) {
    return cur === "en" ? en : cur === "zh-Hans" ? hans(hant) : hant;
  }
  var cache = /* @__PURE__ */ new Map();
  var phraseRe = null;
  function hans(s) {
    let r = cache.get(s);
    if (r !== void 0) return r;
    phraseRe ?? (phraseRe = new RegExp(Object.keys(HANS_PHRASES).sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"));
    r = s.replace(phraseRe, (m) => HANS_PHRASES[m]);
    let out = "";
    for (const ch of r) out += HANS_CHARS[ch] ?? ch;
    cache.set(s, out);
    return out;
  }
  function translateDom(root) {
    document.documentElement.lang = cur;
    if (cur === "zh-Hant") return;
    if (cur === "en") {
      for (const el2 of root.querySelectorAll("[data-en]")) el2.textContent = el2.dataset.en;
      for (const el2 of root.querySelectorAll("[data-en-html]")) el2.innerHTML = el2.dataset.enHtml;
      for (const el2 of root.querySelectorAll("[data-en-title]")) el2.title = el2.dataset.enTitle;
      for (const el2 of root.querySelectorAll("[data-en-ph]")) el2.placeholder = el2.dataset.enPh;
      return;
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[㐀-鿿]/.test(n.nodeValue)) n.nodeValue = hans(n.nodeValue);
    for (const el2 of root.querySelectorAll("[title]")) el2.title = hans(el2.title);
    for (const el2 of root.querySelectorAll("[placeholder]")) el2.placeholder = hans(el2.placeholder);
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
    if (typeof VERYL_CHIPDB_GZ_B64 === "undefined") throw new Error(tr("chipdb.js\uFF08\u6676\u7247\u8CC7\u6599\u5EAB\uFF09\u6C92\u6709\u8F09\u5165", "chipdb.js (chip database) is not loaded"));
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
      for (const p of pending.values()) p.fail(new Error(tr("worker \u932F\u8AA4", "worker error")));
      pending.clear();
    };
    await Promise.race([send({ type: "init", module: mod2 }), new Promise((_, f) => setTimeout(() => f(new Error("worker timeout")), 5e3))]);
    let db = null;
    return {
      inWorker: true,
      call: (req) => send({ type: "call", req }),
      chipdb: () => {
        if (!db) {
          const gz2 = chipdbGz();
          db = send({ type: "chipdb", gz: gz2 }, [gz2.buffer]).then(() => {
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
  function exTitle(e) {
    return tr(e.title, e.title_en ?? e.title);
  }
  function exNote(e) {
    return e.note ? tr(e.note, e.note_en ?? e.note) : "";
  }
  function exGroup(e) {
    return tr(e.group, e.group_en ?? e.group);
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
        { x: bf.x1 + gap, y: ty, s: tr(`ASIC\uFF1Avlib \u6A19\u6E96\u5143\u4EF6\uFF08\u6676\u7C92 ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m\uFF0C\u653E\u5927\u5230\u540C\u9AD8\uFF09`, `ASIC: vlib standard cells (die ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m, scaled to the same height)`), color: "#e0b87e", size, align: "left" }
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
      [tr("\u5BE6\u4F5C", "Implementation"), tr("iCE40UP5K LUT4 FPGA\uFF08\u53EF\u91CD\u65B0\u71D2\u9304\uFF09", "iCE40UP5K LUT4 FPGA (reprogrammable)"), tr("vlib \u6A19\u6E96\u5143\u4EF6\uFF08\u7D04 130 nm\uFF0C\u9700\u6D41\u7247\uFF09", "vlib standard cells (about 130 nm, needs a tape-out)")],
      [tr("\u908F\u8F2F\u55AE\u5143", "Logic"), tr(`${p.lcs.length} LC\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09\uFF0CDFF ${fc("ff")}\uFF0CCARRY ${fc("carry")}`, `${p.lcs.length} LCs (${(100 * p.lcs.length / 5280).toFixed(1)}%), DFF ${fc("ff")}, CARRY ${fc("carry")}`), tr(`${a.map.cells.length} \u500B\u5143\u4EF6\uFF0CDFF ${ffA}`, `${a.map.cells.length} cells, DFF ${ffA}`)],
      ...p.rams.length || srams ? [[tr("\u8A18\u61B6\u9AD4", "Memory"), tr(`${p.rams.length} \u500B SB_RAM40_4K`, `${p.rams.length} SB_RAM40_4K`), tr(`${srams} \u500B SRAM \u5DE8\u96C6`, `${srams} SRAM macros`)]] : [],
      [tr("\u9762\u7A4D", "Area"), tr("\u56FA\u5B9A\u6676\u7247\uFF085280 LC\u300130 BRAM\uFF09", "a fixed chip (5280 LCs, 30 BRAMs)"), tr(`\u5143\u4EF6 ${f1(a.area)} \xB5m\xB2\uFF0C\u6676\u7C92 ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m\uFF08\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(0)}%\uFF09`, `cells ${f1(a.area)} \xB5m\xB2, die ${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)} \xB5m (${(a.die.util * 100).toFixed(0)}% utilization)`)],
      [tr("\u7E5E\u7DDA", "Wiring"), tr(`${p.pips} \u500B pip\uFF08\u53EF\u7A0B\u5F0F\u958B\u95DC\uFF09`, `${p.pips} pips (programmable switches)`), tr(`${f2(a.detail.wirelength / 1e3 || a.route.wirelength / 1e3)} mm \u91D1\u5C6C\u7DDA\uFF0C${a.detail.vias || a.route.vias} \u500B via`, `${f2(a.detail.wirelength / 1e3 || a.route.wirelength / 1e3)} mm of metal, ${a.detail.vias || a.route.vias} vias`)],
      [tr("\u95DC\u9375\u8DEF\u5F91", "Critical path"), `${f2(p.timing.period)} ns`, `${f2(a.timing.period)} ns`],
      ["F<sub>max</sub>", `${f1(p.timing.fmax)} MHz`, `${f1(a.timing.fmax)} MHz\uFF08\xD7${(a.timing.fmax / p.timing.fmax).toFixed(1)}\uFF09`],
      [tr("\u6BCF\u9031\u671F\u80FD\u91CF", "Energy per cycle"), `${f1(eF)} pJ`, `${f2(eA)} pJ\uFF08\xF7${(eF / Math.max(1e-9, eA)).toFixed(0)}\uFF09`],
      [tr(`\u529F\u8017 @ ${f1(f)} MHz`, `Power @ ${f1(f)} MHz`), tr(`${pF.toFixed(3)} mW\uFF08\u975C\u614B ${p.timing.power.static.toFixed(3)}\uFF09`, `${pF.toFixed(3)} mW (static ${p.timing.power.static.toFixed(3)})`), tr(`${pA.toFixed(4)} mW\uFF08\u6F0F\u96FB ${a.power.leakage.toFixed(4)}\uFF09`, `${pA.toFixed(4)} mW (leakage ${a.power.leakage.toFixed(4)})`)]
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
      const label = ci === 0 ? tr("\u8F38\u5165", "inputs") : ci === 1 ? "DFF" : ci === last ? tr("\u8F38\u51FA", "outputs") : `L${ci - 1}`;
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
      texts.push({ x: x + W + 10, y: y + H / 2, s: tr(`${n} \u500B\u8A0A\u865F`, `${n} signals`), color: "#9fb2c8", size: 11 });
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
  function stageLabel(s) {
    return tr(s.label, s.en);
  }
  var FPGA_STAGES = [
    { key: "rtl", tag: "common", label: "\u5171 \u2460 RTL\u2192Logic", en: "C \u2460 RTL\u2192Logic" },
    { key: "raw", tag: "common", label: "\u5171 \u2461 Logic Netlist", en: "C \u2461 Logic Netlist" },
    { key: "opt", tag: "common", label: "\u5171 \u2462 Tech-indep Syn", en: "C \u2462 Tech-indep Syn" },
    { key: "map", tag: "fpga", label: "F \u2463 LUT4 Techmap", en: "F \u2463 LUT4 Techmap" },
    { key: "place", tag: "fpga", label: "F \u2464 Placement \u9000\u706B", en: "F \u2464 Placement (annealing)" },
    { key: "route", tag: "fpga", label: "F \u2465 Global+Detail Routing", en: "F \u2465 Global+Detail Routing" },
    { key: "sta", tag: "fpga", label: "F \u2466 Timing (STA)", en: "F \u2466 Timing (STA)" }
  ];
  var ASIC_STAGES = [
    ...FPGA_STAGES.slice(0, 3),
    { key: "amap", tag: "asic", label: "A \u2463 Standard Cell Map", en: "A \u2463 Standard Cell Map" },
    { key: "aplace", tag: "asic", label: "A \u2464 Row Placement \u9000\u706B", en: "A \u2464 Row Placement (annealing)" },
    { key: "aroute", tag: "asic", label: "A \u2465 CTS + Global Routing", en: "A \u2465 CTS + Global Routing" },
    { key: "adetail", tag: "asic", label: "A \u2466 Detail Routing", en: "A \u2466 Detail Routing" },
    { key: "asta", tag: "asic", label: "A \u2467 Timing (STA)", en: "A \u2467 Timing (STA)" },
    { key: "apower", tag: "asic", label: "A \u2468 Power + IR Drop", en: "A \u2468 Power + IR Drop" }
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
      $("synInfo").textContent = tr("\u5408\u6210\u4E2D\u2026", "Synthesizing\u2026");
      $("synSide").innerHTML = "";
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.buttons();
      const t0 = performance.now();
      let res;
      try {
        res = await this.core.call({ cmd: "synth", files: this.files, top: top || null });
      } catch (e) {
        if (gen !== this.gen) return;
        $("synInfo").textContent = tr("\u5408\u6210\u5931\u6557\uFF1A\n", "Synthesis failed:\n") + String(e.message ?? e);
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
        if (gen === this.gen && PNR.has(this.stage)) $("synInfo").textContent = tr(`\u4F48\u5C40\u7E5E\u7DDA\u4E2D\u2026\uFF08iCE40UP5K\uFF0C${((performance.now() - t0) / 1e3).toFixed(1)} s\uFF09`, `Placing and routing\u2026 (iCE40UP5K, ${((performance.now() - t0) / 1e3).toFixed(1)} s)`);
      }, 200);
      try {
        $("synInfo").textContent = tr("\u8F09\u5165\u6676\u7247\u8CC7\u6599\u5EAB\uFF08IceStorm chipdb-5k\uFF0C4 MB\uFF09\u2026", "Loading the chip database (IceStorm chipdb-5k, 4 MB)\u2026");
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
      $("synTitle").textContent = t === "fpga" ? tr("\u5408\u6210 \u2192 FPGA\uFF08iCE40UP5K\uFF09", "Synthesis \u2192 FPGA (iCE40UP5K)") : tr("\u5408\u6210 \u2192 ASIC\uFF08vlib \u6A19\u6E96\u5143\u4EF6\uFF09", "Synthesis \u2192 ASIC (vlib standard cells)");
      this.chips();
      const cur2 = ASIC.has(this.stage) !== (t === "asic") && OTHER[this.stage] ? OTHER[this.stage] : this.stage;
      if (this.res) this.stats(this.synMs);
      if (show) this.show(cur2);
      else this.stage = cur2;
    }
    async runAsic() {
      if (!this.res || this.asic || this.asicBusy) return;
      const gen = this.gen;
      this.asicBusy = true;
      const t0 = performance.now();
      const tick = setInterval(() => {
        if (gen === this.gen && ASIC.has(this.stage)) $("synInfo").textContent = tr(`ASIC \u6D41\u7A0B\u4E2D\uFF1A\u6A19\u6E96\u5143\u4EF6\u5C0D\u61C9 \u2192 \u5217\u5F0F\u4F48\u5C40\u9000\u706B \u2192 \u5168\u57DF\u7E5E\u7DDA \u2192 STA\u2026\uFF08${((performance.now() - t0) / 1e3).toFixed(1)} s\uFF09`, `ASIC flow: standard-cell mapping \u2192 row placement \u2192 global routing \u2192 STA\u2026 (${((performance.now() - t0) / 1e3).toFixed(1)} s)`);
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
        b.textContent = stageLabel(s);
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
      c.title = tr("\u540C\u4E00\u500B\u8A2D\u8A08\u7684\u5169\u7A2E\u5BE6\u4F5C\u4E26\u6392\u6BD4\u8F03", "The two implementations of the same design side by side");
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
        `${tr("\u9802\u5C64", "Top")} <b>${r.top}</b>`,
        `${tr("\u9598", "Gates")} <b>${r.raw.cells.length}</b> \u2192 <b>${r.opt.cells.length}</b>`,
        `LUT4 <b>${luts}</b>`,
        `CARRY <b>${carry}</b>`,
        `DFF <b>${ffs}</b>`,
        ...brams ? [`BRAM <b>${brams}</b>`] : [],
        `${tr("LUT \u5C64\u6578", "LUT levels")} <b>${lev.depth}</b>`
      ];
      if (this.pnr) {
        const p = this.pnr;
        items.push(
          `LC <b>${p.lcs.length}</b>/5280\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09`,
          ...p.rams.length ? [`BRAM <b>${p.rams.length}</b>/30`] : [],
          `pip <b>${p.pips}</b>`,
          `F<sub>max</sub> <b>${p.timing.fmax.toFixed(1)}</b> MHz`,
          `${tr("\u95DC\u9375\u8DEF\u5F91", "Critical path")} <b>${p.timing.period.toFixed(2)}</b> ns`
        );
      }
      items.push(`${tr("\u5408\u6210", "Synthesis")} <b>${ms.toFixed(0)}</b> ms` + (this.pnr ? `${tr("\uFF0C\u4F48\u5C40\u7E5E\u7DDA", ", place & route")} <b>${(this.pnrMs / 1e3).toFixed(1)}</b> s` : ""));
      $("synStats").innerHTML = items.join('<span class="sep">\u2502</span>');
    }
    asicStats(ms) {
      const r = this.res;
      const items = [`${tr("\u9802\u5C64", "Top")} <b>${r.top}</b>`, `${tr("\u9598", "Gates")} <b>${r.raw.cells.length}</b> \u2192 <b>${r.opt.cells.length}</b>`];
      const a = this.asic;
      if (a) {
        const ffs = a.map.cells.filter((c) => c.t.includes("DFF")).length;
        items.push(
          tr(`\u6A19\u6E96\u5143\u4EF6 <b>${a.map.cells.length}</b>\uFF08DFF ${ffs}\uFF09`, `Cells <b>${a.map.cells.length}</b> (DFF ${ffs})`),
          `${tr("\u9762\u7A4D", "Area")} <b>${fmtArea(a.area)}</b>`,
          tr(`\u6676\u7C92 <b>${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)}</b> \xB5m\uFF08${a.die.rows} \u5217\uFF0C\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(0)}%\uFF09`, `Die <b>${a.die.w.toFixed(0)}\xD7${a.die.h.toFixed(0)}</b> \xB5m (${a.die.rows} rows, ${(a.die.util * 100).toFixed(0)}% utilization)`),
          `${tr("\u7DDA\u9577", "Wirelength")} <b>${(a.route.wirelength / 1e3).toFixed(2)}</b> mm`,
          `F<sub>max</sub> <b>${a.timing.fmax.toFixed(1)}</b> MHz`
        );
      }
      items.push(`${tr("\u5408\u6210", "Synthesis")} <b>${ms.toFixed(0)}</b> ms` + (a ? `${tr("\uFF0CASIC \u6D41\u7A0B", ", ASIC flow")} <b>${(this.asicMs / 1e3).toFixed(1)}</b> s` : ""));
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
          tr(
            "\u89E3\u6790 Veryl\uFF08veryl-parser\uFF09\u2192 \u5C55\u958B package / enum / struct / \u53C3\u6578 \u2192 \u7531\u9802\u5C64\u5F80\u4E0B\u5BE6\u4F8B\u5316\u5B50\u6A21\u7D44\u4E26\u6524\u5E73\uFF08flatten\uFF09\uFF0C\u6BCF\u500B\u8A0A\u865F\u914D\u7F6E\u300C\u4F54\u4F4D\u300D\u7DDA\u3002",
            "Parse Veryl (veryl-parser) \u2192 expand packages / enums / structs / parameters \u2192 instantiate the submodules from the top down and flatten them; every signal gets placeholder wires."
          ),
          "",
          tr(`\u9802\u5C64\uFF1A${r.top}\u3000\u5BE6\u4F8B ${r.hier.length - 1} \u500B\u3000\u6A21\u7D44\u7A2E\u985E ${new Set(r.hier.map((h) => h.module)).size}`, `Top: ${r.top}\u3000${r.hier.length - 1} instances\u3000${new Set(r.hier.map((h) => h.module)).size} module types`),
          `${tr("\u57E0\uFF1A", "Ports: ")}${r.ports.map((p) => `${p.dir === "in" ? "\u2192" : "\u2190"}${p.name}${p.width > 1 ? `[${p.width}]` : ""}`).join("  ")}`,
          tr(`\u8A0A\u865F ${r.signals.length} \u500B\uFF0C\u5171 ${bits} bit`, `${r.signals.length} signals, ${bits} bits`),
          ...r.warnings.length ? ["", tr("\u8B66\u544A\uFF1A", "Warnings:"), ...r.warnings] : []
        ]);
        this.side(this.rtlSide());
        return;
      }
      if (ASIC.has(key) && !this.asic) {
        this.view.set({ boxes: [], lines: [], texts: [] });
        this.side(document.createElement("div"));
        if (this.asicErr) {
          this.info([tr("ASIC \u6D41\u7A0B\u5931\u6557\uFF1A", "ASIC flow failed:"), this.asicErr]);
          return;
        }
        this.info([tr("ASIC \u6D41\u7A0B\u4E2D\u2026", "Running the ASIC flow\u2026")]);
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
          this.info([tr("\u4F48\u5C40\u7E5E\u7DDA\u5931\u6557\uFF1A", "Place and route failed:"), this.pnrErr, ...fit ? ["", tr("iCE40UP5K-SG48 \u53EA\u6709 5280 \u500B LC\u300139 \u500B IO \u8173\uFF1A\u6574\u9846 RV32I \u6838\u5FC3\uFF08\u66AB\u5B58\u5668\u6A94\u7528\u6B63\u53CD\u5668\uFF09\u653E\u4E0D\u4E0B\u3002\u8ACB\u6539\u7528\u300CRISC-V SoC\uFF08FPGA\uFF09\u300D\u7BC4\u4F8B\uFF0C\u6216\u6539\u770B ASIC \u6D41\u7A0B\u3002", 'The iCE40UP5K-SG48 has only 5280 LCs and 39 IO pins: the whole RV32I core (register file in flip-flops) does not fit. Use the "RISC-V SoC (FPGA)" example, or look at the ASIC flow.')] : []]);
          return;
        }
        this.info([tr("\u4F48\u5C40\u7E5E\u7DDA\u4E2D\u2026", "Placing and routing\u2026")]);
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
        const lines = [tr("\u21C4 FPGA vs ASIC\uFF1A\u5169\u500B\u5F8C\u7AEF\u90FD\u8981\u8DD1\u5B8C\u624D\u80FD\u6BD4\u8F03", "\u21C4 FPGA vs ASIC: both back ends must finish first")];
        lines.push(p ? tr("\u2713 FPGA \u4F48\u5C40\u7E5E\u7DDA\u5B8C\u6210", "\u2713 FPGA place and route done") : this.pnrErr ? `\u2717 FPGA: ${this.pnrErr}` : tr("\u2026 FPGA \u4F48\u5C40\u7E5E\u7DDA\u4E2D", "\u2026 FPGA place and route running"));
        lines.push(a ? tr("\u2713 ASIC \u6D41\u7A0B\u5B8C\u6210", "\u2713 ASIC flow done") : this.asicErr ? `\u2717 ASIC: ${this.asicErr}` : tr("\u2026 ASIC \u6D41\u7A0B\u4E2D", "\u2026 ASIC flow running"));
        this.info(lines);
        if (!p && !this.pnrErr) this.runPnr();
        if (!a && !this.asicErr) this.runAsic();
        return;
      }
      this.view.set(compareScene(p, a), true);
      const rows = compareRows(p, a);
      this.info([
        tr("\u21C4 FPGA vs ASIC\uFF1A\u540C\u4E00\u500B\u7DB2\u8868\uFF08\u5171 \u2460\u2013\u2462\uFF09\u5206\u5225\u8D70 iCE40 \u8207\u6A19\u6E96\u5143\u4EF6\u6D41\u7A0B", "\u21C4 FPGA vs ASIC: the same netlist (common \u2460\u2013\u2462) through the iCE40 and the standard-cell flows"),
        tr(
          "FPGA \u7528\u73FE\u6210\u7684 LUT / \u53EF\u7A0B\u5F0F\u7E5E\u7DDA\u958B\u95DC\uFF0C\u5F48\u6027\u5927\u4F46\u6BCF\u500B\u908F\u8F2F\u548C\u6BCF\u6BB5\u7E5E\u7DDA\u90FD\u6162\u3001\u90FD\u8017\u96FB\uFF1BASIC \u628A\u908F\u8F2F\u76F4\u63A5\u505A\u6210\u96FB\u6676\u9AD4\u8207\u91D1\u5C6C\u7DDA\uFF0C\u9762\u7A4D\u5C0F\u3001\u5FEB\u3001\u7701\u96FB\uFF0C\u4F46\u8981\u6D41\u7247\u3002",
          "An FPGA uses ready-made LUTs and programmable routing switches: flexible, but every logic level and every wire segment is slow and power hungry. An ASIC builds the logic directly from transistors and metal: small, fast and frugal, but it needs a tape-out."
        ),
        "",
        tr(`F_max\uFF1AFPGA ${p.timing.fmax.toFixed(1)} MHz vs ASIC ${a.timing.fmax.toFixed(1)} MHz\u3000\u5DE6\uFF1AiCE40 \u4F48\u5C40\uFF0C\u53F3\uFF1A\u6A19\u6E96\u5143\u4EF6\u6676\u7C92\uFF08\u653E\u5927\u5230\u540C\u9AD8\uFF09`, `F_max: FPGA ${p.timing.fmax.toFixed(1)} MHz vs ASIC ${a.timing.fmax.toFixed(1)} MHz\u3000left: iCE40 placement, right: standard-cell die (scaled to the same height)`)
      ]);
      const d = document.createElement("div");
      d.innerHTML = `<h3>${tr("\u6BD4\u8F03", "Comparison")}</h3><div class="cmpw">` + table([tr("\u9805\u76EE", "Item"), "FPGA", "ASIC"], rows.map((r) => [r[0], r[1], r[2]])) + `</div><p class="hint">${tr("\u529F\u8017\u4EE5\u5169\u8005 F<sub>max</sub> \u8F03\u4F4E\u8005\u70BA\u5171\u540C\u983B\u7387\uFF0C\u7FFB\u8F49\u7387\u4F86\u81EA\u540C\u4E00\u7D44\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u3002", "Power at the lower of the two F<sub>max</sub> as a common frequency; toggle rates from the same random-input simulation.")}</p>`;
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
          tr("\u2464 Placement \u9000\u706B\uFF08iCE40UP5K\uFF1A26\xD732 tile\uFF0C\u908F\u8F2F tile \u6BCF\u500B 8 \u500B LC\uFF09", "\u2464 Placement, simulated annealing (iCE40UP5K: 26\xD732 tiles, 8 LCs per logic tile)"),
          tr(
            "\u5148\u6253\u5305\uFF08LUT+FF+CARRY \u2192 LC\uFF09\uFF0C\u9032\u4F4D\u93C8\u653E\u5728\u6574\u6B04\u908F\u8F2F tile \u4E26\u5F9E LC 0 \u958B\u59CB\uFF1B\u5176\u9918\u4EE5\u6A21\u64EC\u9000\u706B\u6700\u5C0F\u5316\u7DDA\u9577\uFF08HPWL\uFF09\uFF0C\u540C\u4E00 tile \u7684 DFF \u5FC5\u9808\u540C clock / reset / \u908A\u7DE3\u3002",
            "Packing first (LUT+FF+CARRY \u2192 LC); carry chains go into a column of logic tiles starting at LC 0; the rest is placed by simulated annealing minimizing wirelength (HPWL); the DFFs of one tile must share clock / reset / edge."
          ),
          "",
          tr(
            `LC ${p.lcs.length} \u500B\uFF08${(100 * p.lcs.length / 5280).toFixed(1)}%\uFF09\uFF0C\u9032\u4F4D\u93C8 ${chains.length} \u689D${chains.length ? `\uFF08${chains.join(", ")} LC\uFF09` : ""}\uFF0CIO ${p.ios.length} \u500B${p.rams.length ? `\uFF0Cblock RAM ${p.rams.length} \u500B\uFF08RAM \u6B04 x = 6 / 19\uFF0C\u6BCF\u500B\u4F54\u4E0A\u4E0B\u5169\u500B tile\uFF09` : ""}`,
            `${p.lcs.length} LCs (${(100 * p.lcs.length / 5280).toFixed(1)}%), ${chains.length} carry chains${chains.length ? ` (${chains.join(", ")} LCs)` : ""}, ${p.ios.length} IOs${p.rams.length ? `, ${p.rams.length} block RAMs (RAM columns x = 6 / 19, two tiles each)` : ""}`
          ),
          tr(
            `HPWL\uFF1A\u521D\u59CB ${h[0].cost.toFixed(0)} \u2192 \u9000\u706B\u5F8C ${h[h.length - 1].cost.toFixed(0)}\uFF08${h.length - 1} \u500B\u6EAB\u5EA6\u5FEB\u7167\uFF09\u3000\u6309\u300C\u25B6 \u9000\u706B\u52D5\u756B\u300D\u91CD\u64AD`,
            `HPWL: initial ${h[0].cost.toFixed(0)} \u2192 annealed ${h[h.length - 1].cost.toFixed(0)} (${h.length - 1} temperature snapshots)\u3000press "\u25B6 Annealing" to replay`
          )
        ];
      }
      if (key === "route") {
        const glb = p.globals.map((g) => `${g.net} \u2192 glb_netwk_${g.glb}`).join(", ") || tr("\u7121", "none");
        return [
          "\u2465 Global + Detail Routing",
          tr(
            "clock / reset \u8D70\u5168\u57DF\u7DB2\u8DEF\uFF08\u4F86\u6E90 \u2192 fabout \u2192 glb_netwk \u2192 \u5404 tile \u7684 clk / s_r mux\uFF09\uFF1B\u5176\u9918\u4EE5 PathFinder \u5354\u5546\u64C1\u585E + A* \u5728 IceStorm \u7E5E\u7DDA\u5716\u4E0A\u627E\u8DEF\uFF08\u6BCF\u689D\u7DDA\u53EA\u80FD\u7D66\u4E00\u500B\u8A0A\u865F\uFF09\u3002",
            "Clock / reset use the global networks (source \u2192 fabout \u2192 glb_netwk \u2192 each tile's clk / s_r mux); everything else is routed with PathFinder congestion negotiation + A* on the IceStorm routing graph (each wire carries one signal)."
          ),
          "",
          `${tr("\u5168\u57DF\uFF1A", "Globals: ")}${glb}`,
          tr(`${p.nets.length} \u689D net\uFF0C\u4F7F\u7528 ${p.pips} \u500B pip\uFF1B\u6BCF\u8F2A\u904E\u5EA6\u4F7F\u7528\u7684\u7DDA\uFF1A${p.route_iters.join(" \u2192 ")}`, `${p.nets.length} nets, ${p.pips} pips; overused wires per iteration: ${p.route_iters.join(" \u2192 ")}`),
          tr("\u984F\u8272\uFF1A\u85CD\uFF1Dspan4\u3001\u7D2B\uFF1Dspan12\u3001\u7070\uFF1Dlocal / \u8F38\u5165\u3001\u7DA0\uFF1D\u5168\u57DF\u3001\u9EC3\uFF1DIO\uFF08\u9EDE LC \u770B\u7D30\u7BC0\uFF09", "Colors: blue = span4, purple = span12, gray = local / inputs, green = global, yellow = IO (click an LC for details)")
        ];
      }
      const t = p.timing;
      return [
        "\u2466 Timing (STA)",
        tr(
          "\u5EF6\u9072\u53D6\u81EA IceStorm timings_up5k\uFF08\u6162\u901F\u89D2\uFF09\uFF1ALC in\u2192out\u3001carry\u3001clk\u2192Q\u3001setup\uFF0C\u6BCF\u6BB5\u7E5E\u7DDA\u4F9D\u6240\u9A45\u52D5\u7684\u7DDA\u7A2E\u985E\u8A08 mux \u5EF6\u9072\uFF1Bclock \u8996\u70BA\u7406\u60F3\uFF08\u5168\u57DF\u7DB2\u8DEF\uFF09\u3002",
          "Delays from IceStorm timings_up5k (slow corner): LC in\u2192out, carry, clk\u2192Q, setup; each routing segment adds the mux delay of the wire type it drives; the clock is ideal (global network)."
        ),
        "",
        tr(
          `\u95DC\u9375\u8DEF\u5F91 ${t.period.toFixed(2)} ns \u2192 Fmax ${t.fmax.toFixed(2)} MHz\uFF08${t.endpoints} \u500B\u7AEF\u9EDE\uFF09\uFF1B\u7D05\u7DDA\uFF1D\u95DC\u9375\u8DEF\u5F91\uFF0CLC \u984F\u8272\uFF1D\u5230\u9054\u6642\u9593\uFF08\u7DA0\u65E9\u7D05\u665A\uFF09`,
          `Critical path ${t.period.toFixed(2)} ns \u2192 Fmax ${t.fmax.toFixed(2)} MHz (${t.endpoints} endpoints); red = critical path, LC color = arrival time (green early, red late)`
        ),
        tr(
          `\u529F\u8017\u4F30\u8A08\uFF08\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u7684\u7FFB\u8F49\u7387\uFF1Bnet \u96FB\u5BB9 \u2248 5 fF \xD7 \u8CA0\u8F09 + 8 fF \xD7 \u7E5E\u7DDA\u6BB5\uFF0C\u5168\u57DF\u6642\u8108\u7DB2\u8DEF\u6BCF\u62CD\uFF0Cblock RAM \u6BCF\u6B21\u5B58\u53D6 \u2248 24 pJ\uFF0C\u975C\u614B \u2248 75 \xB5A\uFF09\uFF1A\u5728 ${t.fmax.toFixed(1)} MHz \u7D04 ${t.power.total.toFixed(3)} mW\uFF08\u52D5\u614B ${t.power.dynamic.toFixed(3)} + \u975C\u614B ${t.power.static.toFixed(3)}\uFF1B\u6BCF\u9031\u671F ${(t.power.e_nets + t.power.e_clock + t.power.e_ram).toFixed(1)} pJ\uFF09`,
          `Power estimate (toggle rates from a random-input simulation; net capacitance \u2248 5 fF \xD7 loads + 8 fF \xD7 routing segments, the global clock network every cycle, \u2248 24 pJ per block RAM access, static \u2248 75 \xB5A): about ${t.power.total.toFixed(3)} mW at ${t.fmax.toFixed(1)} MHz (dynamic ${t.power.dynamic.toFixed(3)} + static ${t.power.static.toFixed(3)}; ${(t.power.e_nets + t.power.e_clock + t.power.e_ram).toFixed(1)} pJ per cycle)`
        ),
        ...t.fmax_wl ? [tr(
          `\u6642\u5E8F\u5C0E\u5411\uFF1A\u7B2C\u4E00\u8F2A\u53EA\u770B\u7DDA\u9577 ${t.fmax_wl.toFixed(2)} MHz\uFF1B\u518D\u4EE5\u6BCF\u689D net \u7684\u95DC\u9375\u5EA6\uFF08\u7D93\u904E\u5B83\u7684\u6700\u9577\u8DEF\u5F91 / \u95DC\u9375\u8DEF\u5F91\uFF09\u52A0\u6B0A\u91CD\u65B0\u4F48\u5C40\uFF0C\u7E5E\u7DDA\u6642\u95DC\u9375 net \u512A\u5148\u8D70\u5FEB\u7684\u7DDA \u2192 ${t.fmax.toFixed(2)} MHz\uFF08\u53D6\u8F03\u5FEB\u7684\u4E00\u8F2A\uFF09`,
          `Timing driven: the wirelength-only pass gives ${t.fmax_wl.toFixed(2)} MHz; placing again with nets weighted by criticality (longest path through the net / critical path), and routing critical nets on fast wires first \u2192 ${t.fmax.toFixed(2)} MHz (the faster pass is kept)`
        )] : []
      ];
    }
    pnrSide(key) {
      const p = this.pnr;
      const d = document.createElement("div");
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = `<p class="hint">${tr("\u9EDE LC \u770B\u7D30\u7BC0\uFF08LUT \u771F\u503C\u8868\u3001DFF\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002", "Click an LC for details (LUT truth table, DFF, pin signals, arrival time).")}</p>`;
      d.appendChild(det);
      let h = "";
      if (key === "sta") {
        h += `<h3>${tr("\u95DC\u9375\u8DEF\u5F91", "Critical path")}\uFF08${p.timing.period.toFixed(2)} ns\uFF09</h3>` + table([tr("\u7D2F\u8A08 ns", "At ns"), tr("\u5EF6\u9072", "Delay"), tr("\u7D93\u904E", "Through")], p.timing.path.map((s) => [s.at.toFixed(2), s.delay.toFixed(3), esc(stepText(s.what))]));
      }
      if (key === "route") {
        h += `<h3>${tr(`Net\uFF08${p.nets.length}\uFF0C\u4F9D pip \u6578\uFF09`, `Nets (${p.nets.length}, by pips)`)}</h3>`;
      }
      h += `<h3>IO</h3>` + table([tr("\u8A0A\u865F", "Signal"), tr("\u65B9\u5411", "Dir"), tr("\u8173\u4F4D", "Pin"), "tile"], p.ios.map((io) => [esc(io.name), io.dir === "in" ? "in" : "out", io.pin, `${io.x},${io.y}/${io.z}`]));
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
          row.textContent = `${n.name}  ${n.pips} pip  ${n.sinks} ${tr("\u8CA0\u8F09", "loads")}${n.global ? tr("  [\u5168\u57DF]", "  [global]") : ""}`;
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
        $("synInfo").textContent = tr(`\u2464 \u9000\u706B\u52D5\u756B\uFF1A\u7B2C ${f + 1}/${p.history.length} \u500B\u5FEB\u7167\u3000\u6EAB\u5EA6 ${fr.temp.toFixed(2)}\u3000HPWL ${fr.cost.toFixed(0)}\u3000\u63A5\u53D7\u7387 ${(fr.accept * 100).toFixed(0)}%`, `\u2464 Annealing: snapshot ${f + 1}/${p.history.length}\u3000temperature ${fr.temp.toFixed(2)}\u3000HPWL ${fr.cost.toFixed(0)}\u3000acceptance ${(fr.accept * 100).toFixed(0)}%`);
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
        $("synInfo").textContent = tr(`A \u2464 \u9000\u706B\u52D5\u756B\uFF1A\u7B2C ${f + 1}/${a.history.length} \u500B\u5FEB\u7167\u3000\u6EAB\u5EA6 ${fr.temp.toFixed(2)}\u3000HPWL ${(fr.cost / 1e3).toFixed(2)} mm\u3000\u63A5\u53D7\u7387 ${(fr.accept * 100).toFixed(0)}%`, `A \u2464 Annealing: snapshot ${f + 1}/${a.history.length}\u3000temperature ${fr.temp.toFixed(2)}\u3000HPWL ${(fr.cost / 1e3).toFixed(2)} mm\u3000acceptance ${(fr.accept * 100).toFixed(0)}%`);
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
          tr(`A \u2464 Row Placement \u9000\u706B\uFF08\u6676\u7C92 ${a.die.w.toFixed(1)} \xD7 ${a.die.h.toFixed(1)} \xB5m\uFF0C${a.die.rows} \u5217 \xD7 ${a.die.sites} site\uFF09`, `A \u2464 Row Placement, simulated annealing (die ${a.die.w.toFixed(1)} \xD7 ${a.die.h.toFixed(1)} \xB5m, ${a.die.rows} rows \xD7 ${a.die.sites} sites)`),
          tr(
            `\u4F9D\u76EE\u6A19\u5229\u7528\u7387\u6C7A\u5B9A\u6676\u7C92\u5927\u5C0F\uFF08${(a.die.util * 100).toFixed(0)}%\uFF1B\u592A\u64E0\u7E5E\u4E0D\u901A\u5C31\u81EA\u52D5\u653E\u5927\uFF09\uFF0CIO \u8173\u5E73\u5747\u653E\u5728\u56DB\u5468\uFF08\u8F38\u5165\uFF1A\u5DE6\u3001\u4E0A\uFF1B\u8F38\u51FA\uFF1A\u53F3\u3001\u4E0B\uFF09\u3002\u521D\u59CB\u4F9D\u7DB2\u8868\u9806\u5E8F\u86C7\u5F62\u586B\u5217\uFF0C\u518D\u4EE5\u6A21\u64EC\u9000\u706B\u6700\u5C0F\u5316 HPWL + \u5BC6\u5EA6\u61F2\u7F70\uFF1A\u6BCF\u4E00\u6B65\u628A\u5143\u4EF6\u79FB\u5230\u7A7A\u4F4D\u6216\u8207\u53E6\u4E00\u500B\u5143\u4EF6\u4EA4\u63DB\uFF0C\u6C38\u9060\u4FDD\u6301\u5408\u6CD5\uFF08\u4E0D\u91CD\u758A\u3001\u5C0D\u9F4A site\uFF09\uFF1B16 \xD7 16 \xB5m \u7684\u683C\u5B50\u8D85\u904E\u76EE\u6A19\u5BC6\u5EA6 ${(a.die.target_density * 100).toFixed(0)}% \u7684\u90E8\u5206\u8981\u4ED8\u4EE3\u50F9\uFF0C\u5143\u4EF6\u624D\u4E0D\u6703\u5168\u64E0\u5230 IO \u8173\u65C1\u908A\u3001\u7559\u4E0B\u5C40\u90E8\u7E5E\u4E0D\u901A\u7684\u71B1\u9EDE\u3002`,
            `The die size follows the target utilization (${(a.die.util * 100).toFixed(0)}%; enlarged automatically when too crowded to route); IO pins are spread around the edge (inputs: left, top; outputs: right, bottom). Rows are first filled in netlist order like a snake, then simulated annealing minimizes HPWL + a density penalty: each move takes a cell to a free spot or swaps it with another, always legal (no overlap, on sites); 16 \xD7 16 \xB5m bins above the target density of ${(a.die.target_density * 100).toFixed(0)}% pay a cost, so cells do not pile up next to the IO pins and leave unroutable hot spots.`
          ),
          tr(`\u6700\u6EFF\u7684\u683C\u5B50 ${(a.die.max_density * 100).toFixed(0)}%`, `Fullest bin ${(a.die.max_density * 100).toFixed(0)}%`),
          "",
          tr(
            `${a.cells.length} \u500B\u5143\u4EF6\uFF0C\u5217\u5229\u7528\u7387 ${(a.die.util * 100).toFixed(1)}%\uFF1BHPWL\uFF1A\u521D\u59CB ${(h[0].cost / 1e3).toFixed(2)} mm \u2192 \u9000\u706B\u5F8C ${(h[h.length - 1].cost / 1e3).toFixed(2)} mm\u3000\u6309\u300C\u25B6 \u9000\u706B\u52D5\u756B\u300D\u91CD\u64AD`,
            `${a.cells.length} cells, row utilization ${(a.die.util * 100).toFixed(1)}%; HPWL: initial ${(h[0].cost / 1e3).toFixed(2)} mm \u2192 annealed ${(h[h.length - 1].cost / 1e3).toFixed(2)} mm\u3000press "\u25B6 Annealing" to replay`
          ),
          tr("\u984F\u8272\uFF1A\u6A58\uFF1DDFF\u3001\u9EC3\uFF1DMUX2\u3001\u85CD\uFF1DAND/OR \u985E\u3001\u7D2B\uFF1DXOR/AOI/OAI\u3001\u7DA0\uFF1DINV\u3001\u9752\uFF1DBUF\uFF1B\u7DA0/\u7D05\u5C0F\u65B9\u584A\uFF1D\u8F38\u5165/\u8F38\u51FA\u8173", "Colors: orange = DFF, yellow = MUX2, blue = AND/OR family, purple = XOR/AOI/OAI, green = INV, cyan = BUF; small green / red squares = input / output pins")
        ];
      }
      if (key === "aroute") {
        const r = a.route;
        const c = a.cts;
        return [
          tr(`A \u2465 CTS + Global Routing\uFF08${r.gx} \xD7 ${r.gy} \u500B gcell\uFF0C\u6BCF\u683C 4 \xB5m\uFF1B\u6C34\u5E73\u7DDA\u8D70 M2/M4\u3001\u5782\u76F4\u7DDA\u8D70 M3/M5\uFF0C\u6BCF\u908A ${r.cap} \u8ECC\uFF09`, `A \u2465 CTS + Global Routing (${r.gx} \xD7 ${r.gy} gcells of 4 \xB5m; horizontal on M2/M4, vertical on M3/M5, ${r.cap} tracks per edge)`),
          tr(
            `\u6642\u8108\u6A39\u5408\u6210\uFF08CTS\uFF09\uFF1A\u4F48\u5C40\u5B8C\u6210\u5F8C\uFF0C\u628A clock\uFF08\u8207\u975E\u540C\u6B65 reset\uFF09\u7684\u8CA0\u8F09\u4F9D\u4F4D\u7F6E\u905E\u8FF4\u5C0D\u534A\u5207\uFF08\u6CBF\u8F03\u9577\u7684\u65B9\u5411\u53D6\u4E2D\u4F4D\u6578\uFF0C\u50CF H-tree\uFF09\uFF0C\u6BCF\u7FA4 \u2264 16 \u500B\u8CA0\u8F09\u7531\u4E00\u500B CLKBUF \u9A45\u52D5\uFF0C\u7DE9\u885D\u5668\u653E\u5728\u6240\u9A45\u52D5\u8005\u7684\u91CD\u5FC3\uFF1B\u5E73\u8861\u7684\u5207\u6CD5\u8B93\u6BCF\u500B\u6B63\u53CD\u5668\u7D93\u904E\u4E00\u6A23\u591A\u7D1A\u3001\u5DEE\u4E0D\u591A\u9577\u7684\u7DDA \u2192 skew \u5C0F\u3002`,
            `Clock tree synthesis (CTS): after placement the loads of the clock (and asynchronous reset) are split in halves by position, recursively (median along the longer side, like an H-tree); each group of \u2264 16 loads is driven by one CLKBUF placed at their centroid; balanced splits give every flip-flop the same number of levels and similar wire lengths \u2192 small skew.`
          ),
          c.buffers ? tr(
            `\u2192 ${c.trees.map((t2) => `${t2.net}\uFF1A${t2.sinks} \u500B\u8CA0\u8F09\uFF0C${t2.buffers} \u500B CLKBUF\uFF0C${t2.levels} \u7D1A`).join("\uFF1B")}\uFF1B\u63D2\u5165\u5EF6\u9072 ${a.timing.insertion.toFixed(3)} ns\uFF0Cskew ${(a.timing.skew * 1e3).toFixed(0)} ps`,
            `\u2192 ${c.trees.map((t2) => `${t2.net}: ${t2.sinks} loads, ${t2.buffers} CLKBUFs, ${t2.levels} levels`).join("; ")}; insertion delay ${a.timing.insertion.toFixed(3)} ns, skew ${(a.timing.skew * 1e3).toFixed(0)} ps`
          ) : tr("\u2192 \u8CA0\u8F09\u4E0D\u591A\uFF08\u2264 16\uFF09\uFF0C\u4E0D\u9700\u8981\u6642\u8108\u6A39", "\u2192 few loads (\u2264 16), no clock tree needed"),
          tr(
            "\u6BCF\u689D net \u7684\u7AEF\u9EDE\u4F9D Prim \u6700\u5C0F\u751F\u6210\u6A39\u9806\u5E8F\uFF0C\u7528 A* \u5F9E\u7AEF\u9EDE\u9023\u5230\u5DF2\u5EFA\u597D\u7684\u6A39\uFF1B\u8D85\u904E\u5BB9\u91CF\u7684\u908A\u4EE5 PathFinder\uFF08\u73FE\u6CC1 + \u6B77\u53F2\u6210\u672C\uFF09\u5354\u5546\u91CD\u7E5E\uFF0C\u76F4\u5230\u6C92\u6709\u6EA2\u51FA\u3002",
            "The pins of each net are connected in Prim minimum-spanning-tree order, A* from a pin to the tree built so far; edges over capacity are renegotiated with PathFinder (present + history cost) until nothing overflows."
          ),
          "",
          tr(`${r.nets.length} \u689D net\uFF0C\u7E3D\u7DDA\u9577 ${(r.wirelength / 1e3).toFixed(2)} mm\uFF0Cvia ${r.vias} \u500B\uFF1B\u6BCF\u8F2A\u6EA2\u51FA\uFF1A${r.iters.join(" \u2192 ")}`, `${r.nets.length} nets, wirelength ${(r.wirelength / 1e3).toFixed(2)} mm, ${r.vias} vias; overflow per iteration: ${r.iters.join(" \u2192 ")}`),
          tr("\u984F\u8272\uFF1A\u85CD\uFF1D\u6C34\u5E73\u3001\u7D2B\uFF1D\u5782\u76F4\u3001\u7DA0\uFF1Dclock / reset\uFF1B\u5E95\u8272\uFF1D\u64C1\u585E\uFF08\u7DA0\u9B06 \u2192 \u7D05\u6EFF\uFF09\u3002\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\u3001\u9EDE\u53F3\u5074 net \u9AD8\u4EAE\u3002", "Colors: blue = horizontal, purple = vertical, green = clock / reset; background = congestion (green free \u2192 red full). Click a cell for details, a net on the right to highlight it.")
        ];
      }
      if (key === "apower") {
        const p = a.power;
        const e = p.e_nets + p.e_clock + p.e_internal + p.e_sram;
        return [
          "A \u2468 Power + IR Drop",
          tr(
            `\u4EE5\u96A8\u6A5F\u8F38\u5165\u6A21\u64EC\u6700\u5F8C\u7684\u7DB2\u8868 ${p.cycles} \u500B\u9031\u671F\uFF08\u6709 reset \u5C31\u5148\u62C9\u5169\u62CD\uFF09\uFF0C\u7D71\u8A08\u6BCF\u689D net \u7684\u7FFB\u8F49\u7387 \u03B1\uFF1B\u5207\u63DB\u529F\u8017 = \xBD\xB7\u03B1\xB7C\xB7V\xB2\xB7f\uFF08C = \u8CA0\u8F09\u8173\u4F4D + 0.2 fF/\xB5m \u7684\u5BE6\u969B\u7DDA\u9577\uFF0CV = 1.2 V\uFF09\uFF0C\u6642\u8108\u6A39\u6BCF\u62CD\u5145\u653E\u96FB\uFF1B\u5143\u4EF6\u5167\u90E8\u80FD\u91CF\u4F9D\u5927\u5C0F\u8A08\u3001\u6B63\u53CD\u5668\u6BCF\u62CD\u6709\u6642\u8108\u80FD\u91CF\u3001SRAM \u6BCF\u6B21\u5B58\u53D6\uFF1B\u6F0F\u96FB\u4F9D\u9762\u7A4D\u3002`,
            `The final netlist is simulated for ${p.cycles} cycles with random inputs (reset held for two cycles first, if any) to get each net's toggle rate \u03B1; switching power = \xBD\xB7\u03B1\xB7C\xB7V\xB2\xB7f (C = load pins + 0.2 fF/\xB5m of actual wire, V = 1.2 V); the clock tree charges every cycle; internal energy by cell size, clock energy per flip-flop per cycle, SRAM per access; leakage by area.`
          ),
          tr(
            `IR drop\uFF1A\u6BCF\u500B\u5143\u4EF6\u7684\u5E73\u5747\u96FB\u6D41\u6D41\u904E\u6240\u5728\u5217\u7684 VDD \u8ECC\u8207 VSS \u8ECC\uFF1B\u5169\u689D\u96FB\u6E90\u5E36\u4E4B\u9593\u7684\u8ECC\u662F\u5169\u7AEF\u4F9B\u96FB\u7684\u96FB\u963B\u7DDA\uFF08M1 0.2 \u03A9/\xB5m\uFF09\uFF0C\u7B97\u51FA\u6BCF\u500B\u5143\u4EF6\u770B\u5230\u7684\u58D3\u964D\u3002`,
            `IR drop: each cell's average current flows through the VDD and VSS rails of its row; a rail between two straps is a resistive line fed from both ends (M1 0.2 \u03A9/\xB5m), giving the drop each cell sees.`
          ),
          "",
          tr(
            `\u6BCF\u9031\u671F\u80FD\u91CF ${e.toFixed(2)} pJ\uFF08\u8A0A\u865F ${p.e_nets.toFixed(2)}\u3001\u6642\u8108\u6A39 ${p.e_clock.toFixed(2)}\u3001\u5143\u4EF6\u5167\u90E8 ${p.e_internal.toFixed(2)}\u3001SRAM ${p.e_sram.toFixed(2)}\uFF09\u2192 \u5728 Fmax ${p.freq.toFixed(1)} MHz\uFF1A${p.total.toFixed(3)} mW\uFF08\u52D5\u614B ${p.dynamic.toFixed(3)}\u3001\u6F0F\u96FB ${p.leakage.toFixed(4)}\uFF09`,
            `Energy per cycle ${e.toFixed(2)} pJ (signals ${p.e_nets.toFixed(2)}, clock tree ${p.e_clock.toFixed(2)}, cell internal ${p.e_internal.toFixed(2)}, SRAM ${p.e_sram.toFixed(2)}) \u2192 at Fmax ${p.freq.toFixed(1)} MHz: ${p.total.toFixed(3)} mW (dynamic ${p.dynamic.toFixed(3)}, leakage ${p.leakage.toFixed(4)})`
          ),
          tr(
            `\u6700\u5927 IR drop ${p.ir_worst.toFixed(2)} mV\uFF08${(p.ir_worst / 12).toFixed(2)}% of VDD\uFF09\uFF1B\u984F\u8272\uFF1D${this.showIr ? "IR drop" : "\u6BCF\u500B\u5143\u4EF6\u7684\u529F\u8017"}\uFF08\u7DA0\u4F4E\u7D05\u9AD8\uFF09\uFF0C\u5074\u6B04\u53EF\u5207\u63DB`,
            `Worst IR drop ${p.ir_worst.toFixed(2)} mV (${(p.ir_worst / 12).toFixed(2)}% of VDD); color = ${this.showIr ? "IR drop" : "power per cell"} (green low, red high), switch in the side panel`
          )
        ];
      }
      if (key === "adetail") {
        const d = a.detail;
        const um = (x) => (x / 1e3).toFixed(2) + " mm";
        return [
          tr(`A \u2466 Detail Routing\uFF08\u8ECC\u9053\u683C\u9EDE\uFF1A\u6BCF ${(a.die.row_h / d.tracks).toFixed(1)} \xB5m \u4E00\u689D\uFF0C${d.nx} \xD7 ${d.ny} \xD7 4 \u5C64\uFF1BM2/M4 \u6C34\u5E73\u3001M3/M5 \u5782\u76F4\uFF09`, `A \u2466 Detail Routing (track grid: one every ${(a.die.row_h / d.tracks).toFixed(1)} \xB5m, ${d.nx} \xD7 ${d.ny} \xD7 4 layers; M2/M4 horizontal, M3/M5 vertical)`),
          tr(
            "\u6BCF\u689D net \u53EA\u5728\u5168\u57DF\u7E5E\u7DDA\u9078\u7684 gcell \u8D70\u5ECA\u5167\uFF08\u5916\u52A0\u4E00\u5708\uFF09\u4EE5 A* \u627E\u8DEF\uFF1A\u7AEF\u9EDE\u4F9D Prim \u9806\u5E8F\u9023\u5230\u5DF2\u5EFA\u597D\u7684\u6A39\uFF0C\u63DB\u5C64\u4E00\u500B via \u6210\u672C\u8F03\u9AD8\uFF1B\u6BCF\u500B\u683C\u9EDE\u53EA\u80FD\u5C6C\u65BC\u4E00\u689D net\uFF08\u6240\u4EE5\u6C92\u6709\u77ED\u8DEF\uFF09\uFF0C\u91CD\u758A\u4EE5 PathFinder \u5354\u5546\u91CD\u7E5E\uFF0C\u5361\u4F4F\u7684 net \u8D70\u5ECA\u6703\u52A0\u5BEC\u3002\u5143\u4EF6\u8173\u4F4D\u5F9E M1 \u7D93 via \u4E0A\u4F86\uFF0CSRAM \u5DE8\u96C6\u4E0A\u65B9\u64CB\u4F4F M2/M3\uFF0CIO \u8173\u5728 M5\u3002",
            "Each net is routed with A* only inside the gcell corridor chosen by global routing (plus one ring): pins join the tree in Prim order, a layer change (via) costs more; every grid point belongs to one net at most (so no shorts), overlaps are renegotiated with PathFinder and a stuck net's corridor widens. Cell pins come up from M1 through vias, SRAM macros block M2/M3 above them, IO pins are on M5."
          ),
          "",
          tr(
            `\u96FB\u6E90\u7DB2\u8DEF\uFF1A\u6BCF\u689D\u5217\u908A\u754C\u4E00\u689D M1 \u96FB\u6E90\u8ECC\uFF08VSS / VDD \u4EA4\u66FF\uFF0C\u5171 ${a.pdn.rails} \u689D\uFF09\uFF0CM5 \u5782\u76F4\u96FB\u6E90\u5E36 ${a.pdn.straps.length} \u689D\uFF08VDD / VSS \u6210\u5C0D\uFF0C\u6BCF 40 \xB5m \u4E00\u5C0D\uFF09\uFF0C${a.pdn.vias} \u500B via \u758A\u628A\u5E36\u5B50\u63A5\u5230\u540C\u540D\u7684\u8ECC\uFF1B\u7E5E\u7DDA\u5668\u907F\u958B\u5E36\u5B50\u8207 via \u758A\u3002\u7A7A\u4F4D\u88DC\u4E0A ${a.pdn.fillers.length / 3} \u500B\u586B\u5145\u5143\u4EF6\uFF08FILL8/4/2/1\uFF0C\u6DF1\u7070\uFF09\uFF0C\u8B93\u4E95\u8207\u96FB\u6E90\u8ECC\u9023\u7E8C\u3002`,
            `Power grid: an M1 rail on every row boundary (VSS / VDD alternating, ${a.pdn.rails} rails), ${a.pdn.straps.length} vertical M5 straps (VDD / VSS pairs, one pair every 40 \xB5m), ${a.pdn.vias} via stacks tie the straps to the rails of the same net; the router avoids straps and via stacks. ${a.pdn.fillers.length / 3} filler cells (FILL8/4/2/1, dark gray) fill the gaps so wells and rails are continuous.`
          ),
          tr(
            `\u7DDA\u9577 ${um(d.wirelength)}\uFF08M2 ${um(d.per_layer[0])}\u3001M3 ${um(d.per_layer[1])}\u3001M4 ${um(d.per_layer[2])}\u3001M5 ${um(d.per_layer[3])}\uFF09\uFF0Cvia ${d.vias} \u500B\uFF1B\u885D\u7A81 ${d.conflicts}\u3001\u672A\u63A5\u901A ${d.opens}\uFF1B\u6BCF\u8F2A\u885D\u7A81\uFF1A${d.iters.join(" \u2192 ")}`,
            `Wirelength ${um(d.wirelength)} (M2 ${um(d.per_layer[0])}, M3 ${um(d.per_layer[1])}, M4 ${um(d.per_layer[2])}, M5 ${um(d.per_layer[3])}), ${d.vias} vias; ${d.conflicts} conflicts, ${d.opens} opens; conflicts per iteration: ${d.iters.join(" \u2192 ")}`
          ),
          d.nets.length ? tr("\u984F\u8272\uFF1A\u85CD M2\u3001\u7D05 M3\u3001\u7DA0 M4\u3001\u9EC3 M5\uFF1B\u5074\u6B04\u53EF\u5207\u63DB\u5C64\u3001\u9EDE net \u9AD8\u4EAE\u3002\u9019\u4E00\u6B65\u7684\u7DDA\u9577\u4E5F\u56DE\u994B\u7D66 STA\u3002", "Colors: blue M2, red M3, green M4, yellow M5; switch layers in the side panel, click a net to highlight it. These wire lengths also feed the STA.") : tr(`\uFF08\u5171 ${d.segments} \u6BB5\u7DDA\uFF0C\u592A\u591A\u4E0D\u756B\uFF0C\u53EA\u5217\u7D71\u8A08\uFF09`, `(${d.segments} segments: too many to draw, statistics only)`)
        ];
      }
      const t = a.timing;
      return [
        "A \u2467 Timing (STA)",
        tr(
          "\u5143\u4EF6\u5EF6\u9072 = \u672C\u5FB5\u5EF6\u9072 + \u6BCF\u6247\u51FA\u8CA0\u8F09 \xD7 \u6247\u51FA\uFF1B\u7DDA\u5EF6\u9072 = \u9A45\u52D5\u6574\u689D\u7E5E\u7DDA\u7684\u96FB\u5BB9 + \u5230\u8A72\u8CA0\u8F09\u7684\u5206\u4F48 RC\uFF08\u4F9D\u66FC\u54C8\u9813\u8DDD\u96E2\uFF09\u3002\u8DEF\u5F91\u8D77\u9EDE\u70BA\u8F38\u5165\u8173\u8207 DFF\uFF08clk\u2192Q\uFF09\uFF0C\u7D42\u9EDE\u70BA DFF D\uFF08\u52A0 setup\uFF09\u8207\u8F38\u51FA\u8173\uFF1Bclock \u8996\u70BA\u7406\u60F3\u3002",
          "Cell delay = intrinsic delay + load per fanout \xD7 fanout; wire delay = driving the whole routed net's capacitance + the distributed RC to that load (by Manhattan distance). Paths start at input pins and DFFs (clk\u2192Q) and end at DFF D (plus setup) and output pins; the clock is ideal here."
        ),
        "",
        tr(
          `\u95DC\u9375\u8DEF\u5F91 ${t.period.toFixed(3)} ns \u2192 Fmax ${t.fmax.toFixed(1)} MHz\uFF08${t.endpoints} \u500B\u7AEF\u9EDE\uFF09\uFF1B\u7D05\u7DDA\uFF1D\u95DC\u9375\u8DEF\u5F91\uFF0C\u5143\u4EF6\u984F\u8272\uFF1D\u5230\u9054\u6642\u9593\uFF08\u7DA0\u65E9\u7D05\u665A\uFF09`,
          `Critical path ${t.period.toFixed(3)} ns \u2192 Fmax ${t.fmax.toFixed(1)} MHz (${t.endpoints} endpoints); red = critical path, cell color = arrival time (green early, red late)`
        ),
        tr(
          `\u6642\u5E8F\u5C0E\u5411\uFF1A\u53EA\u770B\u7DDA\u9577\u7684\u4F48\u5C40 ${t.fmax_wl.toFixed(1)} MHz\uFF1B\u4EE5 net \u95DC\u9375\u5EA6\u52A0\u6B0A\u5F8C\u518D\u9000\u706B\uFF08\u5FAE\u8ABF + \u5C0F\u8A2D\u8A08\u91CD\u65B0\u9000\u706B\uFF0C\u53EA\u53D6\u7E5E\u5F97\u901A\u7684\uFF09\u2192 ${t.fmax_ideal.toFixed(1)} MHz\uFF08\u7406\u60F3\u6642\u8108\uFF09`,
          `Timing driven: wirelength-only placement ${t.fmax_wl.toFixed(1)} MHz; annealing again with nets weighted by criticality (refinement, plus a fresh anneal for small designs, routable results only) \u2192 ${t.fmax_ideal.toFixed(1)} MHz (ideal clock)`
        ),
        tr(
          `\u6642\u8108\u6A39\u4E4B\u5F8C\uFF08propagated clock\uFF09\uFF1A\u8DEF\u5F91\u5F9E\u767C\u9001\u7AEF\u6B63\u53CD\u5668\u7684\u6642\u8108\u5230\u9054\u6642\u9593\u51FA\u767C\u3001\u5C0D\u63A5\u6536\u7AEF\u7684\u6642\u8108\u6AA2\u67E5 setup \u2192 ${t.fmax.toFixed(1)} MHz\uFF1Bskew ${(t.skew * 1e3).toFixed(0)} ps\u3002`,
          `With the clock tree (propagated clock): paths start at the launching flip-flop's clock arrival and check setup against the capturing clock \u2192 ${t.fmax.toFixed(1)} MHz; skew ${(t.skew * 1e3).toFixed(0)} ps.`
        ),
        tr(
          `Hold \u6AA2\u67E5\uFF08\u6700\u77ED\u8DEF\u5F91\uFF1A\u6700\u65E9\u5230\u9054 \u2265 \u63A5\u6536\u6642\u8108 + hold\uFF09\uFF1A\u6700\u5DEE\u9918\u88D5 ${t.hold_slack.toFixed(3)} ns${a.cts.hold_bufs ? `\uFF0C\u63D2\u5165 ${a.cts.hold_bufs} \u500B\u5EF6\u9072 BUF \u4FEE\u6B63` : "\uFF0C\u6C92\u6709\u9055\u898F"}\u3002`,
          `Hold check (shortest paths: earliest arrival \u2265 capture clock + hold): worst slack ${t.hold_slack.toFixed(3)} ns${a.cts.hold_bufs ? `, fixed by inserting ${a.cts.hold_bufs} delay BUFs` : ", no violations"}.`
        )
      ];
    }
    asicSide(key) {
      const a = this.asic;
      const d = document.createElement("div");
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = `<p class="hint">${tr("\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\uFF08\u7A2E\u985E\u3001\u4F4D\u7F6E\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002", "Click a cell for details (type, position, pin signals, arrival time).")}</p>`;
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
        lab.append(cb, tr(" \u986F\u793A IR drop\uFF08\u5426\u5247\u986F\u793A\u529F\u8017\uFF09", " show IR drop (otherwise power)"));
        div.appendChild(lab);
        const byType = /* @__PURE__ */ new Map();
        a.map.cells.forEach((c, i) => byType.set(c.t, (byType.get(c.t) ?? 0) + p.cell[i]));
        div.insertAdjacentHTML("beforeend", `<h3>${tr("\u6BCF\u9031\u671F\u80FD\u91CF\uFF08pJ\uFF09", "Energy per cycle (pJ)")}</h3>` + table([tr("\u4F86\u6E90", "Source"), "pJ"], [[tr("\u8A0A\u865F net", "signal nets"), p.e_nets.toFixed(3)], [tr("\u6642\u8108\u6A39", "clock tree"), p.e_clock.toFixed(3)], [tr("\u5143\u4EF6\u5167\u90E8", "cell internal"), p.e_internal.toFixed(3)], ["SRAM", p.e_sram.toFixed(3)]]) + `<h3>${tr("\u529F\u8017\uFF08\u4F9D\u5143\u4EF6\u7A2E\u985E\uFF0C\xB5W\uFF09", "Power by cell type (\xB5W)")}</h3>` + table([tr("\u5143\u4EF6", "Cell"), "\xB5W"], [...byType.entries()].sort((x, y) => y[1] - x[1]).map(([t, v]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, v.toFixed(2)])));
      } else if (key === "adetail") {
        const d2 = a.detail;
        div.innerHTML = `<h3>${tr("\u5C64", "Layers")}</h3>`;
        const pw = document.createElement("label");
        pw.style.display = "block";
        const pcb = document.createElement("input");
        pcb.type = "checkbox";
        pcb.checked = this.power;
        pcb.onchange = () => {
          this.power = pcb.checked;
          this.drawAsic(false);
        };
        pw.append(pcb, tr(" \u96FB\u6E90\u7DB2\u8DEF\uFF08\u7D05 VDD\u3001\u85CD VSS\uFF09", " power grid (red VDD, blue VSS)"));
        div.appendChild(pw);
        [tr("M2 \u6C34\u5E73", "M2 horizontal"), tr("M3 \u5782\u76F4", "M3 vertical"), tr("M4 \u6C34\u5E73", "M4 horizontal"), tr("M5 \u5782\u76F4", "M5 vertical")].forEach((name, l) => {
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
          h.textContent = tr(`Net\uFF08${d2.nets.length}\uFF0C\u4F9D\u7DDA\u9577\uFF09`, `Nets (${d2.nets.length}, by length)`);
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
        div.innerHTML = `<h3>${tr("\u95DC\u9375\u8DEF\u5F91", "Critical path")}\uFF08${a.timing.period.toFixed(3)} ns\uFF09</h3>` + table([tr("\u7D2F\u8A08 ns", "At ns"), tr("\u5EF6\u9072", "Delay"), tr("\u7D93\u904E", "Through")], a.timing.path.map((s) => [s.at.toFixed(3), s.delay.toFixed(3), esc(s.what)]));
      } else if (key === "aroute") {
        div.innerHTML = `<h3>${tr(`Net\uFF08${a.route.nets.length}\uFF0C\u4F9D\u7DDA\u9577\uFF09`, `Nets (${a.route.nets.length}, by length)`)}</h3>`;
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
        div.innerHTML = `<h3>${tr("\u5143\u4EF6\u6578\u91CF", "Cell counts")}</h3>` + table([tr("\u5143\u4EF6", "Cell"), tr("\u6578\u91CF", "Count"), tr("\u9762\u7A4D \xB5m\xB2", "Area \xB5m\xB2")], a.counts.map(([t, n]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, String(n), (areaOf.get(t) ?? 0).toFixed(0)]));
      }
      div.insertAdjacentHTML("beforeend", `<h3>${tr("IO \u8173", "IO pins")}</h3>` + table([tr("\u8A0A\u865F", "Signal"), tr("\u65B9\u5411", "Dir"), "x \xB5m", "y \xB5m"], a.pins.map((p) => [esc(p.name), p.dir, p.x.toFixed(1), p.y.toFixed(1)])));
      d.appendChild(div);
      return d;
    }
    stdDetail() {
      const det = document.getElementById("synDetail");
      if (!det || !this.asic) return;
      if (this.sel === null) {
        det.innerHTML = `<p class="hint">${tr("\u9EDE\u5143\u4EF6\u770B\u7D30\u7BC0\uFF08\u7A2E\u985E\u3001\u4F4D\u7F6E\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002", "Click a cell for details (type, position, pin signals, arrival time).")}</p>`;
        return;
      }
      const a = this.asic;
      const v = this.netView("amap");
      const c = a.map.cells[this.sel];
      const [row, site, w, arr, crit] = a.cells[this.sel];
      const lib = a.lib.find((l) => l.name === c.t);
      let h = `<h3><span class="sw" style="background:${stdColor(c.t)}"></span>#${this.sel} ${c.t}${crit ? tr("\uFF08\u95DC\u9375\u8DEF\u5F91\uFF09", " (critical path)") : ""}</h3>`;
      h += `<p>${tr(`\u7B2C ${row} \u5217\uFF0Csite ${site}\u2013${site + w - 1}\uFF08x = ${(site * a.die.site_w).toFixed(1)} \xB5m\uFF09<br>\u8F38\u51FA\u5230\u9054\u6642\u9593 ${arr.toFixed(3)} ns`, `Row ${row}, sites ${site}\u2013${site + w - 1} (x = ${(site * a.die.site_w).toFixed(1)} \xB5m)<br>output arrival ${arr.toFixed(3)} ns`)}</p>`;
      if (lib) h += `<p><code>${esc(lib.verilog)}</code></p>`;
      if (c.t === "SRAM") {
        const n = (k) => parseInt(c.p?.[k] ?? "0", 2);
        h += `<p>${tr(`SRAM \u5DE8\u96C6\uFF08\u8A18\u61B6\u9AD4\u7DE8\u8B6F\u5668\u7522\u751F\u7684\u786C\u5DE8\u96C6\uFF09\uFF1A${n("DEPTH")} \u5B57 \xD7 ${n("WIDTH")} bit\uFF0C\u4E00\u500B\u5BEB\u5165\u57E0\u3001\u4E00\u500B\u540C\u6B65\u8B80\u53D6\u57E0\uFF08RA \u5728 CK \u6B63\u7DE3\u53D6\u6A23\uFF0CRDATA \u4E0B\u4E00\u62CD\u6709\u6548\uFF09\uFF1B\u4F54 ${w} site \xD7 ${a.cells[this.sel][5]} \u5217\u3002`, `SRAM macro (a hard macro from a memory compiler): ${n("DEPTH")} words \xD7 ${n("WIDTH")} bits, one write port and one synchronous read port (RA sampled on the CK rising edge, RDATA valid the next cycle); ${w} sites \xD7 ${a.cells[this.sel][5]} rows.`)}</p>`;
      }
      h += table([tr("\u63A5\u8173", "Pin"), tr("\u8A0A\u865F", "Signal")], c.c.map(([p, b]) => [p, esc(bitName(v.names, b))]));
      det.innerHTML = h;
    }
    stopAnim() {
      if (this.anim) {
        clearTimeout(this.anim);
        this.anim = 0;
      }
    }
    redrawLines() {
      $("synEdges").textContent = tr(`\u2301 \u9023\u7DDA\uFF1A${this.edges ? "\u958B" : "\u95DC"}`, `\u2301 Wires: ${this.edges ? "on" : "off"}`);
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
      const big = edgeCount(v.nl) > 6e3 ? tr("\uFF08\u9023\u7DDA\u592A\u591A\uFF1A\u53EA\u756B\u9078\u53D6\u5143\u4EF6\u7684\u6247\u5165/\u6247\u51FA\uFF09", "(too many wires: only the selected cell's fan-in / fan-out is drawn)") : "";
      if (key === "raw") return [
        "\u2461 Logic Netlist",
        tr("\u6BCF\u500B assign / always_comb / always_ff \u7D93\u300C\u7B26\u865F\u57F7\u884C\u300D\u8B8A\u6210 2 \u8F38\u5165\u9598\u3001MUX \u8207 DFF\uFF1Aif/case \u2192 MUX\uFF08\u5E38\u6578\u6A19\u7C64\u7684 case \u2192 \u5E73\u884C one-hot\uFF09\uFF0Cfor \u5C55\u958B\uFF0Cfunction \u5167\u5D4C\uFF0Calways_ff \u2192 $_DFF_* / $_SDFF_*\u3002", "Every assign / always_comb / always_ff is symbolically executed into 2-input gates, MUXes and DFFs: if/case \u2192 MUX (case with constant labels \u2192 parallel one-hot), for loops unrolled, functions inlined, always_ff \u2192 $_DFF_* / $_SDFF_*."),
        tr("\u5EFA\u9598\u6642\u5C31\u505A\u5C40\u90E8\u5E38\u6578\u647A\u758A\u8207 structural hashing\uFF1B\u9019\u88E1\u5DF2\u89E3\u6790\u4F54\u4F4D\u5225\u540D\uFF0C\u4F46\u9084\u6C92\u505A\u6574\u9AD4\u6700\u4F73\u5316\u3002", "Local constant folding and structural hashing happen while the gates are built; placeholder aliases are resolved here, but nothing is optimized globally yet."),
        "",
        tr(`${v.nl.cells.length} \u500B\u5143\u4EF6\uFF1A${types}`, `${v.nl.cells.length} cells: ${types}`),
        tr(`\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64\uFF0CDFF ${ffs} \u500B ${big}`, `combinational depth ${v.lev.depth}, ${ffs} DFFs ${big}`)
      ];
      if (key === "opt") {
        const d = r.raw.cells.length - r.opt.cells.length;
        const rf = r.raw.cells.filter((c) => c.t.includes("DFF")).length;
        return [
          tr("\u2462 Tech-indep Syn\uFF08\u8207\u6280\u8853\u7121\u95DC\u7684\u6700\u4F73\u5316\uFF09", "\u2462 Tech-indep Syn (technology-independent optimization)"),
          tr("\u4F9D\u62D3\u64B2\u9806\u5E8F\u91CD\u5EFA\u6574\u500B\u7DB2\u8868\uFF1A\u5E38\u6578\u50B3\u64AD\u3001structural hashing\u3001x&!x \u7B49\u5316\u7C21\u3001\u7D44\u5408\u8FF4\u8DEF\u6AA2\u67E5\u3001\u79FB\u9664\u4E0D\u5F71\u97FF\u8F38\u51FA\u7684\u908F\u8F2F\uFF1B", "The whole netlist is rebuilt in topological order: constant propagation, structural hashing, simplifications such as x&!x, combinational loop check, removal of logic that does not reach an output;"),
          tr("\u53CD\u8986\u300C\u8B49\u660E\u5E38\u6578\u7BC0\u9EDE\u300D\uFF08\u96A8\u6A5F\u6A21\u64EC\u627E\u5019\u9078\u3001\u5C0D \u226416 \u500B\u8F38\u5165\u7AAE\u8209\u8B49\u660E\uFF09\u4E26\u79FB\u9664\u5361\u5728 0 \u7684\u66AB\u5B58\u5668\u3002", "repeatedly proving constant nodes (candidates from random simulation, exhaustive proof over \u226416 inputs) and removing registers stuck at 0."),
          "",
          tr(`${r.raw.cells.length} \u2192 ${v.nl.cells.length} \u500B\u5143\u4EF6\uFF08\u5C11\u4E86 ${d}\uFF0C${(100 * d / Math.max(1, r.raw.cells.length)).toFixed(1)}%\uFF09\uFF1BDFF ${rf} \u2192 ${ffs}`, `${r.raw.cells.length} \u2192 ${v.nl.cells.length} cells (${d} fewer, ${(100 * d / Math.max(1, r.raw.cells.length)).toFixed(1)}%); DFF ${rf} \u2192 ${ffs}`),
          `${types}`,
          tr(`\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64 ${big}`, `combinational depth ${v.lev.depth} ${big}`)
        ];
      }
      if (key === "amap") {
        const a = this.asic;
        const bufs = v.nl.cells.filter((c) => c.t === "BUF").length;
        return [
          tr("A \u2463 Standard Cell Map\uFF08vlib\uFF1A\u5217\u9AD8 4.0 \xB5m\u3001site 0.5 \xB5m\uFF0C\u7D04 130 nm \u6162\u901F\u89D2\uFF09", "A \u2463 Standard Cell Map (vlib: row height 4.0 \xB5m, site 0.5 \xB5m, about a 130 nm slow corner)"),
          tr("\u628A\u7DB2\u8868\u5728\u591A\u6247\u51FA\u9EDE\u5207\u6210\u6A39\uFF0C\u5C0D\u6BCF\u68F5\u6A39\u505A\u52D5\u614B\u898F\u5283\u7684 tree covering\uFF08\u6700\u5C0F\u9762\u7A4D\uFF09\uFF1A\u53CD\u76F8\u5668\u4F75\u5165 NAND2 / NOR2 / XNOR2 / AOI21 / OAI21\uFF1B\u540C\u6B65 set/reset \u8B8A\u6210 D \u524D\u7684\u908F\u8F2F\uFF0C\u975E\u540C\u6B65\u7684\u7528 DFFR / DFFS\uFF08\u4F4E\u614B\u6709\u6548\uFF0C\u5FC5\u8981\u6642\u52A0 INV\uFF09\uFF1B\u6247\u51FA > 12 \u7684\u8A0A\u865F\u63D2\u5165 BUF \u6A39\uFF1B\u540C\u6B65\u8B80\u53D6\u7684\u8A18\u61B6\u9AD4\u8B8A\u6210 SRAM \u5DE8\u96C6\uFF08\u6BCF\u500B\u8B80\u53D6\u57E0\u4E00\u500B\uFF09\u3002", "The netlist is cut into trees at multi-fanout points and each tree is covered by dynamic programming (minimum area): inverters merge into NAND2 / NOR2 / XNOR2 / AOI21 / OAI21; synchronous set/reset becomes logic before D, asynchronous ones use DFFR / DFFS (active low, INV added when needed); signals with fanout > 12 get BUF trees; memories with synchronous reads become SRAM macros (one per read port)."),
          "",
          `${types}`,
          tr(`\u5143\u4EF6\u9762\u7A4D ${fmtArea(a.area)}\uFF0CBUF ${bufs} \u500B\uFF0C\u7D44\u5408\u908F\u8F2F\u6DF1\u5EA6 ${v.lev.depth} \u5C64 ${big}`, `cell area ${fmtArea(a.area)}, ${bufs} BUFs, combinational depth ${v.lev.depth} ${big}`)
        ];
      }
      const luts = v.nl.cells.filter((c) => c.t === "SB_LUT4");
      const hist = [0, 0, 0, 0, 0];
      luts.forEach((c) => hist[lutInputs(c)]++);
      return [
        "\u2463 LUT4 Techmap\uFF08iCE40\uFF09",
        tr("\u5168\u52A0\u5668\u9032\u4F4D (a&b)|((a^b)&c) \u5C0D\u5230\u786C\u9AD4\u9032\u4F4D\u93C8 SB_CARRY\uFF1B\u5176\u9918\u4EE5 cut-based \u65B9\u5F0F\u8986\u84CB\u6210 4 \u8F38\u5165 LUT\uFF08\u5148\u6C42\u6700\u6DFA\u3001\u518D\u770B area flow\uFF09\uFF1BDFF \u2192 SB_DFF[N][S]{R,S}\u3002", "Full-adder carries (a&b)|((a^b)&c) map to the hardware carry chain SB_CARRY; the rest is covered by 4-input LUTs, cut-based (depth first, then area flow); DFF \u2192 SB_DFF[N][S]{R,S}."),
        "",
        `${types}`,
        `${tr("LUT \u8F38\u5165\u6578\u5206\u5E03\uFF1A", "LUT inputs: ")}${hist.map((n, i) => tr(`${i} \u5165 ${n}`, `${i}-in ${n}`)).filter((_, i) => i > 0).join("  ")}`,
        `${tr("LUT \u5C64\u6578", "LUT levels")} ${v.lev.depth} ${big}`
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
      d.innerHTML = `<h3>${tr("\u57E0", "Ports")}</h3>` + table([tr("\u540D\u7A31", "Name"), tr("\u65B9\u5411", "Dir"), tr("\u5BEC\u5EA6", "Width")], r.ports.map((p) => [esc(p.name), p.dir === "in" ? "input" : "output", String(p.width)])) + `<h3>${tr("\u5BE6\u4F8B", "Instances")}</h3>` + table([tr("\u8DEF\u5F91", "Path"), tr("\u6A21\u7D44", "Module")], r.hier.map((h) => [esc(h.path || "(top)"), esc(h.module)])) + `<h3>${tr("\u8A0A\u865F", "Signals")}\uFF08${r.signals.length}\uFF09</h3>` + table([tr("\u540D\u7A31", "Name"), tr("\u5BEC\u5EA6", "Width")], r.signals.slice(0, 400).map((s) => [esc(s.name), String(s.width)]));
      return d;
    }
    netSide(v) {
      const d = document.createElement("div");
      const types = countTypes(v.nl);
      d.innerHTML = `<h3>${tr("\u5143\u4EF6\u7A2E\u985E", "Cell types")}</h3>` + table([tr("\u7A2E\u985E", "Type"), tr("\u6578\u91CF", "Count")], types.map(([t, n2]) => [`<span class="sw" style="background:${cellColor(t, 4)}"></span>${shortType(t)}`, String(n2)])) + `<h3>${tr("\u5143\u4EF6\u6E05\u55AE\uFF08\u9EDE\u9078\uFF09", "Cells (click one)")}</h3>`;
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
        m.textContent = tr(`\u2026 \u5171 ${v.nl.cells.length} \u500B\uFF08\u9EDE\u5716\u4E0A\u7684\u65B9\u584A\u770B\u5176\u4ED6\u5143\u4EF6\uFF09`, `\u2026 ${v.nl.cells.length} in all (click a box in the drawing for the others)`);
        list.appendChild(m);
      }
      d.appendChild(list);
      if (v.nl === this.asic?.map) {
        const lib = document.createElement("div");
        lib.innerHTML = `<h3>${tr("vlib \u5143\u4EF6\u5EAB", "vlib cell library")}</h3>` + table(
          [tr("\u5143\u4EF6", "Cell"), tr("\u5BEC", "Width"), tr("\u9762\u7A4D \xB5m\xB2", "Area \xB5m\xB2"), tr("\u5EF6\u9072 ns", "Delay ns"), tr("+\u6BCF\u6247\u51FA", "+per fanout"), tr("\u529F\u80FD", "Function")],
          this.asic.lib.map((c) => [`<span class="sw" style="background:${stdColor(c.name)}"></span>${c.name}`, String(c.width), c.area.toFixed(0), c.delay.toFixed(3), c.load.toFixed(3), esc(c.verilog.replace(/^assign Y = |;$/g, ""))])
        );
        d.appendChild(lib);
      }
      const det = document.createElement("div");
      det.id = "synDetail";
      det.innerHTML = `<p class="hint">${tr("\u9EDE\u5716\u4E0A\u7684\u5143\u4EF6\u770B\u7D30\u7BC0\uFF1A\u63A5\u8173\u3001\u6240\u9023\u8A0A\u865F\u3001LUT \u771F\u503C\u8868\u3002", "Click a cell in the drawing for details: pins, connected signals, LUT truth table.")}</p>`;
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
      h += `<p>${tr(`SB_RAM40_4K\uFF084 Kbit\uFF09\uFF0C\u8B80 ${r.read}\u3001\u5BEB ${r.write}\uFF1B\u540C\u6B65\u8B80\u53D6\uFF1ARADDR \u5728 RCLK \u6B63\u7DE3\u53D6\u6A23\uFF0CRDATA \u4E0B\u4E00\u62CD\u6709\u6548\u3002`, `SB_RAM40_4K (4 Kbit), read ${r.read}, write ${r.write}; synchronous read: RADDR sampled on the RCLK rising edge, RDATA valid the next cycle.`)}</p>`;
      h += table([tr("\u63A5\u8173", "Pin"), tr("\u8A0A\u865F", "Signal")], [...r.ins.map(([p, n]) => [p, esc(n)]), ...r.outs.map(([p, n]) => [p + " \u2192", esc(n)])]);
      det.innerHTML = h;
    }
    lcDetail() {
      const det = document.getElementById("synDetail");
      if (!det || !this.pnr) return;
      if (this.sel === null) {
        det.innerHTML = `<p class="hint">${tr("\u9EDE LC \u770B\u7D30\u7BC0\uFF08LUT \u771F\u503C\u8868\u3001DFF\u3001\u63A5\u8173\u8A0A\u865F\u3001\u5230\u9054\u6642\u9593\uFF09\u3002", "Click an LC for details (LUT truth table, DFF, pin signals, arrival time).")}</p>`;
        return;
      }
      const lc = this.pnr.lcs[this.sel];
      const init = parseInt(lc.init, 16).toString(2).padStart(16, "0");
      let h = `<h3>LC #${this.sel}\u3000tile (${lc.x},${lc.y}) LC ${lc.z}</h3>`;
      h += `<p><span class="sw" style="background:${lcColor(lc)}"></span>${lc.carry ? "CARRY " : ""}${lc.ff ? `DFF${lc.ff.neg ? tr("\uFF08\u8CA0\u7DE3\uFF09", " (falling edge)") : ""}${lc.ff.sr ? (lc.ff.async ? tr("\uFF08\u975E\u540C\u6B65", " (async") : tr("\uFF08\u540C\u6B65", " (sync")) + (lc.ff.set ? tr(" set\uFF09", " set)") : tr(" reset\uFF09", " reset)")) : ""} ` : ""}LUT 16'h${lc.init}${lc.in3c ? tr("\uFF08in3 = \u9032\u4F4D\u93C8\uFF09", " (in3 = carry chain)") : ""}</p>`;
      h += `<p>${tr("\u8F38\u51FA\u5230\u9054\u6642\u9593", "Output arrival")} ${lc.arr.toFixed(2)} ns</p>`;
      h += table([tr("\u63A5\u8173", "Pin"), tr("\u8A0A\u865F", "Signal")], [...lc.ins.map((n, k) => [`in${k}`, esc(k === 3 && lc.in3c ? "(carry in)" : n || "\u2014")]), ["out", esc(lc.out || "\u2014")]]);
      h += `<h3>${tr("LUT \u771F\u503C\u8868", "LUT truth table")}</h3>` + table(["I3 I2 I1 I0", "O"], lutBits(init).map((o, k) => [`${k >> 3 & 1}  ${k >> 2 & 1}  ${k >> 1 & 1}  ${k & 1}`, String(o)]));
      det.innerHTML = h;
    }
    select(i) {
      this.sel = i;
      this.redrawLines();
      const det = document.getElementById("synDetail");
      const k = this.stage;
      if (!det || !isNet(k)) return;
      if (i === null) {
        det.innerHTML = `<p class="hint">${tr("\u9EDE\u5716\u4E0A\u7684\u5143\u4EF6\u770B\u7D30\u7BC0\uFF1A\u63A5\u8173\u3001\u6240\u9023\u8A0A\u865F\u3001LUT \u771F\u503C\u8868\u3002", "Click a cell in the drawing for details: pins, connected signals, LUT truth table.")}</p>`;
        return;
      }
      const v = this.netView(k);
      const c = v.nl.cells[i];
      let h = `<h3>#${i} ${c.t}</h3><p>${tr("\u5C64\u7D1A", "Level")} L${v.lev.level[i]}</p>`;
      h += table([tr("\u63A5\u8173", "Pin"), tr("\u8A0A\u865F", "Signal"), tr("\u4F86\u6E90", "Source")], c.c.map(([p, b]) => {
        const src = typeof b === "number" && !isOut(p) ? v.lev.driver.has(b) ? `#${v.lev.driver.get(b)} ${shortType(v.nl.cells[v.lev.driver.get(b)].t)}` : tr("\u8F38\u5165\u57E0", "input port") : isOut(p) ? tr(`\u2192 ${typeof b === "number" ? v.lev.users.get(b)?.length ?? 0 : 0} \u500B\u8CA0\u8F09`, `\u2192 ${typeof b === "number" ? v.lev.users.get(b)?.length ?? 0 : 0} loads`) : tr("\u5E38\u6578", "constant");
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
  function stepText(w) {
    let m = /^繞線 (.*)（(\d+) 段）$/.exec(w);
    if (m) return tr(w, `route ${m[1]} (${m[2]} segments)`);
    m = /^(輸出|輸入)腳 (.*)$/.exec(w);
    if (m) return tr(w, `${m[1] === "\u8F38\u51FA" ? "output" : "input"} pin ${m[2]}`);
    return w;
  }
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
        g.fillText(tr("\u6309\u300C\u25B6 \u6A21\u64EC\u300D\u5F8C\u986F\u793A\u6CE2\u5F62", "Run a simulation (\u25B6) to see the waveform"), 12, 20);
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

  // src/ide/bbmodel.ts
  function node(p) {
    const m = /^h:(\d+):([a-j])$/.exec(p);
    if (m) return `s:${m[1]}:${"abcde".includes(m[2]) ? "top" : "bot"}`;
    const r = /^r:([a-z]+[+-]):\d+$/.exec(p);
    if (r) return `rail:${r[1]}`;
    return p;
  }
  var Uf = class {
    constructor() {
      __publicField(this, "p", /* @__PURE__ */ new Map());
    }
    find(a) {
      let r = a;
      while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r);
      this.p.set(a, r);
      return r;
    }
    union(a, b) {
      const x = this.find(a), y = this.find(b);
      if (x !== y) this.p.set(x, y);
    }
  };
  function solve(parts, outputs, inputs, pressed, tr2 = (h) => h) {
    const uf = new Uf();
    const nodes = /* @__PURE__ */ new Set(["vcc", "gnd"]);
    for (const p of parts) {
      nodes.add(node(p.a));
      nodes.add(node(p.b));
    }
    for (const pin of [...outputs.keys(), ...inputs]) nodes.add(`p:${pin}`);
    for (const n of nodes) uf.find(n);
    for (const p of parts) {
      const closed = p.kind === "wire" || p.kind === "sw" && p.on || p.kind === "btn" && pressed.has(p.id);
      if (closed) uf.union(node(p.a), node(p.b));
    }
    const drivers = /* @__PURE__ */ new Map();
    const add = (n, what, v) => {
      const r = uf.find(n);
      if (!drivers.has(r)) drivers.set(r, []);
      drivers.get(r).push({ what, v });
    };
    add("vcc", "3V3", 1);
    add("gnd", "GND", 0);
    for (const [pin, d] of outputs) add(`p:${pin}`, tr2(`\u8173 ${pin}`, `pin ${pin}`), d);
    const warnings = [];
    const level = /* @__PURE__ */ new Map();
    const nets = new Set([...nodes].map((n) => uf.find(n)));
    for (const r of nets) {
      const ds = drivers.get(r) ?? [];
      if (ds.length > 1) {
        warnings.push(tr2(`\u77ED\u8DEF\uFF1A${ds.map((d) => d.what).join(" \u548C ")} \u63A5\u5728\u4E00\u8D77`, `Short circuit: ${ds.map((d) => d.what).join(" and ")} are connected`));
      }
      level.set(r, ds.length ? ds[0].v : null);
    }
    const strong = new Set([...nets].filter((r) => level.get(r) !== null));
    for (let changed2 = true, k = 0; changed2 && k < 50; k++) {
      changed2 = false;
      for (const p of parts.filter((q) => q.kind === "res")) {
        const [x, y] = [uf.find(node(p.a)), uf.find(node(p.b))];
        for (const [from, to] of [[x, y], [y, x]]) {
          if (!strong.has(to) && level.get(to) == null && level.get(from) != null) {
            level.set(to, level.get(from));
            changed2 = true;
          }
        }
      }
    }
    const lv = (n) => level.get(uf.find(n)) ?? null;
    const led = /* @__PURE__ */ new Map();
    for (const p of parts.filter((q) => q.kind === "led")) {
      const [a, c] = [lv(node(p.a)), lv(node(p.b))];
      led.set(p.id, a === null || c === null ? 0 : Math.max(0, a * (1 - c)));
      const [ra, rc] = [uf.find(node(p.a)), uf.find(node(p.b))];
      if (strong.has(ra) && strong.has(rc) && (level.get(ra) ?? 0) > 0 && (level.get(rc) ?? 1) < 1) {
        warnings.push(tr2("LED \u6C92\u6709\u4E32\u806F\u9650\u6D41\u96FB\u963B\uFF08\u771F\u5BE6\u96FB\u8DEF\u4E2D\u6703\u71D2\u6389 LED \u6216 FPGA \u8173\u4F4D\uFF09", "An LED has no series resistor (on real hardware it would burn the LED or the FPGA pin)"));
      }
    }
    const ins = /* @__PURE__ */ new Map();
    for (const pin of inputs) {
      const n = `p:${pin}`;
      if (!parts.some((p) => node(p.a) === n || node(p.b) === n)) continue;
      const v = lv(n);
      if (v === null) warnings.push(tr2(`\u8173 ${pin} \u6D6E\u63A5\uFF08\u6C92\u6709\u63A5\u5230\u4EFB\u4F55\u96FB\u4F4D\uFF09\uFF1A\u52A0\u4E00\u500B\u4E0A\u62C9\u6216\u4E0B\u62C9\u96FB\u963B`, `Pin ${pin} floats (nothing drives it): add a pull-up or pull-down resistor`));
      ins.set(pin, v !== null && v > 0.5 ? 1 : 0);
    }
    return { level, led, inputs: ins, warnings: [...new Set(warnings)] };
  }

  // src/ide/breadboard.ts
  var PMOD1A = [4, 2, 47, 45, 3, 48, 46, 44];
  var PMOD1B = [43, 38, 34, 31, 42, 36, 32, 28];
  var NAMES = ["1", "2", "3", "4", "7", "8", "9", "10"];
  var COLS = 30;
  var SVGNS = "http://www.w3.org/2000/svg";
  var TOOLS = [
    ["select", "\u2196 \u9078\u53D6", "\u2196 Select"],
    ["wire", "\u3030 \u5C0E\u7DDA", "\u3030 Wire"],
    ["led", "\u25C9 LED", "\u25C9 LED"],
    ["res", "\u25AD \u96FB\u963B", "\u25AD Resistor"],
    ["btn", "\u23FA \u6309\u9215", "\u23FA Button"],
    ["sw", "\u21CB \u958B\u95DC", "\u21CB Switch"]
  ];
  var LED_COLORS = ["#ff3b30", "#34c759", "#ffcc00", "#0a84ff"];
  var WIRE_COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#e5e5e5"];
  function points() {
    const m = /* @__PURE__ */ new Map();
    [...PMOD1A, ...PMOD1B].forEach((pin, i) => m.set(`p:${pin}`, { x: 34 + i * 26 + (i >= 8 ? 14 : 0), y: 30 }));
    m.set("vcc", { x: 34 + 16 * 26 + 30, y: 30 });
    m.set("gnd", { x: 34 + 17 * 26 + 30, y: 30 });
    for (let c = 1; c <= COLS; c++) {
      const x = 40 + (c - 1) * 16;
      m.set(`r:top+:${c}`, { x, y: 64 });
      m.set(`r:top-:${c}`, { x, y: 78 });
      "abcde".split("").forEach((r, i) => m.set(`h:${c}:${r}`, { x, y: 104 + i * 14 }));
      "fghij".split("").forEach((r, i) => m.set(`h:${c}:${r}`, { x, y: 186 + i * 14 }));
      m.set(`r:bot+:${c}`, { x, y: 264 });
      m.set(`r:bot-:${c}`, { x, y: 278 });
    }
    return m;
  }
  var Breadboard = class {
    constructor(host) {
      __publicField(this, "host", host);
      __publicField(this, "parts", []);
      __publicField(this, "pressed", /* @__PURE__ */ new Set());
      __publicField(this, "blocked", /* @__PURE__ */ new Set());
      __publicField(this, "tool", "select");
      __publicField(this, "first", null);
      __publicField(this, "sel", null);
      __publicField(this, "pts", points());
      __publicField(this, "svg");
      __publicField(this, "ledColor", 0);
      __publicField(this, "wireColor", 0);
      /** layout changed (save it) / a button or switch changed (solve again) */
      __publicField(this, "onChange", () => {
      });
      host.innerHTML = `<div class="bb-tools">${TOOLS.map(([t, h, e]) => `<button class="tb-btn bb-tool" data-tool="${t}">${tr(h, e)}</button>`).join("")}
      <span class="bb-hint">${tr("\u9078\u5DE5\u5177\uFF0C\u9EDE\u5169\u500B\u5B54\u653E\u96F6\u4EF6\uFF08LED\uFF1A\u5148\u9EDE\u6B63\u6975\uFF09\uFF1B\u9078\u53D6\u5F8C\u6309 Delete \u522A\u9664\uFF0C\u53F3\u9375\u4E5F\u53EF\u522A\u9664\uFF1B\u6309\u4F4F\u6309\u9215\u3001\u9EDE\u4E00\u4E0B\u958B\u95DC", "Pick a tool and click two holes (LED: anode first); select + Delete, or right-click, removes; hold buttons, click switches")}</span>
      <button class="tb-btn ghost bb-clear" title="${tr("\u6E05\u7A7A\u9EB5\u5305\u677F", "Clear the breadboard")}">\u{1F5D1}</button></div>
      <svg class="bb-svg" viewBox="0 0 560 296" xmlns="${SVGNS}"></svg>
      <div class="bb-warn"></div>`;
      this.svg = host.querySelector(".bb-svg");
      for (const b of host.querySelectorAll(".bb-tool")) b.onclick = () => this.setTool(b.dataset.tool);
      host.querySelector(".bb-clear").onclick = () => {
        if (!this.parts.length || confirm(tr("\u6E05\u7A7A\u9EB5\u5305\u677F\uFF1F", "Clear the breadboard?"))) {
          this.parts = [];
          this.render();
          this.onChange(true);
        }
      };
      this.svg.addEventListener("pointerdown", (e) => this.down(e));
      this.svg.addEventListener("pointerup", () => this.release());
      this.svg.addEventListener("pointerleave", () => this.release());
      this.svg.addEventListener("pointermove", (e) => this.hover(e));
      this.svg.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const id = this.partAt(e);
        if (id !== null) this.remove(id);
      });
      host.tabIndex = 0;
      host.addEventListener("keydown", (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && this.sel !== null) {
          this.remove(this.sel);
          e.preventDefault();
        }
        if (e.key === "Escape") {
          this.first = null;
          this.setTool("select");
        }
      });
      this.setTool("select");
    }
    setParts(parts) {
      this.parts = parts.map((p) => ({ ...p }));
      this.pressed.clear();
      this.render();
    }
    setTool(t) {
      this.tool = t;
      this.first = null;
      for (const b of this.host.querySelectorAll(".bb-tool")) b.classList.toggle("cur", b.dataset.tool === t);
      this.render();
    }
    local(e) {
      const p = this.svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const m = this.svg.getScreenCTM();
      return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }
    pointAt(e) {
      const { x, y } = this.local(e);
      let best = null, bd = 64;
      for (const [id, q] of this.pts) {
        if (id.startsWith("p:") && this.blocked.has(+id.slice(2))) continue;
        const d = (q.x - x) ** 2 + (q.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      return best;
    }
    partAt(e) {
      const el2 = e.target.closest("[data-part]");
      return el2 ? +el2.dataset.part : null;
    }
    down(e) {
      this.host.focus();
      if (e.button !== 0) return;
      const id = this.partAt(e);
      if (this.tool === "select") {
        if (id === null) {
          this.sel = null;
          this.render();
          return;
        }
        const p = this.parts.find((q) => q.id === id);
        this.sel = id;
        if (p.kind === "btn") {
          this.pressed.add(id);
          this.onChange(false);
        }
        if (p.kind === "sw") {
          p.on = !p.on;
          this.onChange(true);
        }
        this.render();
        return;
      }
      const pt = this.pointAt(e);
      if (!pt) return;
      if (!this.first) {
        this.first = pt;
        this.render();
        return;
      }
      if (pt === this.first) return;
      const id2 = this.parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      const part = { id: id2, kind: this.tool, a: this.first, b: pt };
      if (this.tool === "led") part.color = LED_COLORS[this.ledColor++ % LED_COLORS.length];
      if (this.tool === "wire") part.color = WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
      if (this.tool === "sw") part.on = false;
      this.parts.push(part);
      this.first = null;
      this.render();
      this.onChange(true);
    }
    release() {
      if (this.pressed.size) {
        this.pressed.clear();
        this.render();
        this.onChange(false);
      }
    }
    hover(e) {
      const h = this.svg.querySelector(".bb-hover");
      const pt = this.tool === "select" ? null : this.pointAt(e);
      if (!h) return;
      if (!pt) {
        h.setAttribute("r", "0");
        return;
      }
      const q = this.pts.get(pt);
      h.setAttribute("cx", String(q.x));
      h.setAttribute("cy", String(q.y));
      h.setAttribute("r", "6");
    }
    remove(id) {
      this.parts = this.parts.filter((p) => p.id !== id);
      if (this.sel === id) this.sel = null;
      this.render();
      this.onChange(true);
    }
    /** LED brightness by part id */
    setLeds(led) {
      for (const el2 of this.svg.querySelectorAll("[data-glow]")) {
        const v = led.get(+el2.dataset.glow) ?? 0;
        el2.style.opacity = (v < 4e-3 ? 0 : 0.25 + 0.75 * Math.sqrt(v)).toFixed(3);
      }
    }
    setWarnings(w) {
      this.host.querySelector(".bb-warn").innerHTML = w.map((x) => `\u26A0 ${x.replace(/</g, "&lt;")}`).join("<br>");
    }
    render() {
      const P = this.pts;
      let s = "";
      s += `<rect x="14" y="8" width="532" height="38" rx="5" class="bb-header"/>`;
      s += `<text x="${34 + 3.5 * 26}" y="18" class="bb-t" text-anchor="middle">PMOD1A</text><text x="${34 + 11.5 * 26 + 14}" y="18" class="bb-t" text-anchor="middle">PMOD1B</text>`;
      [...PMOD1A, ...PMOD1B].forEach((pin, i) => {
        const q = P.get(`p:${pin}`);
        const off = this.blocked.has(pin);
        s += `<g class="bb-pin${off ? " off" : ""}"><title>${i < 8 ? "PMOD1A" : "PMOD1B"} ${NAMES[i % 8]}\uFF08${tr("\u8173", "pin")} ${pin}\uFF09${off ? tr("\uFF1A\u5DF2\u63A5\u6A21\u7D44", ": a module is plugged in") : ""}</title><rect x="${q.x - 6}" y="${q.y - 6}" width="12" height="12" rx="2"/><text x="${q.x}" y="${q.y + 15}" class="bb-t" text-anchor="middle">${NAMES[i % 8]}</text></g>`;
      });
      for (const [id, label, cls] of [["vcc", "3V3", "bb-vcc"], ["gnd", "GND", "bb-gnd"]]) {
        const q = P.get(id);
        s += `<g class="bb-pin ${cls}"><rect x="${q.x - 6}" y="${q.y - 6}" width="12" height="12" rx="2"/><text x="${q.x}" y="${q.y + 15}" class="bb-t" text-anchor="middle">${label}</text></g>`;
      }
      s += `<rect x="22" y="54" width="516" height="236" rx="6" class="bb-board"/>`;
      s += `<line x1="30" y1="64" x2="530" y2="64" class="bb-rail-p"/><line x1="30" y1="78" x2="530" y2="78" class="bb-rail-n"/>`;
      s += `<line x1="30" y1="264" x2="530" y2="264" class="bb-rail-p"/><line x1="30" y1="278" x2="530" y2="278" class="bb-rail-n"/>`;
      s += `<rect x="30" y="168" width="500" height="6" class="bb-gap"/>`;
      for (let c = 1; c <= COLS; c += 1) if (c % 5 === 0 || c === 1) s += `<text x="${40 + (c - 1) * 16}" y="96" class="bb-t" text-anchor="middle">${c}</text>`;
      "abcdefghij".split("").forEach((r, i) => s += `<text x="30" y="${(i < 5 ? 104 + i * 14 : 186 + (i - 5) * 14) + 3}" class="bb-t" text-anchor="middle">${r}</text>`);
      for (const [id, q] of P) {
        if (id.startsWith("p:") || id === "vcc" || id === "gnd") continue;
        s += `<rect x="${q.x - 3}" y="${q.y - 3}" width="6" height="6" rx="1" class="bb-hole"/>`;
      }
      for (const p of this.parts) {
        const [a, b] = [P.get(p.a), P.get(p.b)];
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const sel = p.id === this.sel ? " sel" : "";
        let g = `<g data-part="${p.id}" class="bb-part${sel}">`;
        if (p.kind === "wire") {
          g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${p.color}" class="bb-wire"/>`;
        } else {
          g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="bb-leg"/>`;
          const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
          if (p.kind === "led") {
            g += `<circle cx="${mx}" cy="${my}" r="15" fill="${p.color}" filter="url(#bbGlow)" data-glow="${p.id}" style="opacity:0"/>`;
            g += `<g transform="translate(${mx} ${my}) rotate(${ang})"><circle r="8" class="bb-led" stroke="${p.color}"/><circle r="8" fill="${p.color}" data-glow="${p.id}" style="opacity:0"/><path d="M-3 -4 L3 0 L-3 4 Z M3 -4 V4" class="bb-sym"/></g>`;
          } else if (p.kind === "res") {
            g += `<g transform="translate(${mx} ${my}) rotate(${ang})"><rect x="-11" y="-4" width="22" height="8" rx="3" class="bb-res"/><path d="M-6 -4 v8 M-2 -4 v8 M4 -4 v8" class="bb-band"/></g>`;
          } else if (p.kind === "btn") {
            g += `<g transform="translate(${mx} ${my})"><rect x="-9" y="-9" width="18" height="18" rx="2" class="bb-btn-base"/><circle r="6" class="bb-btn${this.pressed.has(p.id) ? " down" : ""}"/></g>`;
          } else if (p.kind === "sw") {
            g += `<g transform="translate(${mx} ${my})"><rect x="-11" y="-7" width="22" height="14" rx="3" class="bb-sw-base"/><rect x="${p.on ? 0 : -9}" y="-5" width="9" height="10" rx="2" class="bb-sw${p.on ? " on" : ""}"/></g>`;
          }
        }
        g += `<title>${this.title(p)}</title></g>`;
        s += g;
      }
      if (this.first) {
        const q = P.get(this.first);
        s += `<circle cx="${q.x}" cy="${q.y}" r="6" class="bb-first"/>`;
      }
      s += `<circle class="bb-hover" r="0"/>`;
      this.svg.innerHTML = `<defs><filter id="bbGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="4"/></filter></defs>` + s;
    }
    title(p) {
      const name = (pt) => pt.startsWith("p:") ? `${tr("\u8173", "pin")} ${pt.slice(2)}` : pt === "vcc" ? "3V3" : pt === "gnd" ? "GND" : pt.startsWith("r:") ? tr(`\u96FB\u6E90\u8ECC ${pt.split(":")[1]}`, `rail ${pt.split(":")[1]}`) : pt.slice(2).replace(":", "");
      const k = { led: "LED", res: tr("\u96FB\u963B", "resistor"), btn: tr("\u6309\u9215", "button"), sw: tr("\u958B\u95DC", "switch"), wire: tr("\u5C0E\u7DDA", "wire") };
      return `${k[p.kind]}\uFF1A${name(p.a)} \u2192 ${name(p.b)}${p.kind === "led" ? tr("\uFF08\u6B63\u6975 \u2192 \u8CA0\u6975\uFF09", " (anode \u2192 cathode)") : ""}`;
    }
  };

  // src/ide/board.ts
  var DEFAULT_SETUP = { uart: false, baud: 115200, pmod1a: "", pmod1b: "" };
  var SLOT = { pmod1a: [4, 2, 47, 45, 3, 48, 46, 44], pmod1b: [43, 38, 34, 31, 42, 36, 32, 28] };
  var MODULES = [
    ["", "\u2014", "\u2014"],
    ["led8", "8 \u9846 LED", "8 LEDs"],
    ["sw8", "8 \u500B\u958B\u95DC", "8 switches"],
    ["seg7", "\u4E03\u6BB5\u986F\u793A\u5668\uFF082 \u4F4D\uFF09", "7-segment (2 digits)"],
    ["vga", "VGA \u87A2\u5E55\uFF08\u4F54 1A+1B\uFF09", "VGA monitor (1A+1B)"],
    ["buzzer", "\u8702\u9CF4\u5668\uFF08\u8173 1\uFF09", "buzzer (pin 1)"]
  ];
  var PMOD1A2 = [4, 2, 47, 45, 3, 48, 46, 44];
  var PMOD1B2 = [43, 38, 34, 31, 42, 36, 32, 28];
  var PMOD2 = [27, 25, 21, 19, 26, 23, 20, 18];
  var KEYS = { "0": 10, "1": 20, "2": 19, "3": 18 };
  var esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  var VirtualBoard = class {
    constructor(host, core2) {
      __publicField(this, "host", host);
      __publicField(this, "core", core2);
      __publicField(this, "info", null);
      __publicField(this, "running", false);
      __publicField(this, "loop", 0);
      __publicField(this, "pending", []);
      __publicField(this, "held", /* @__PURE__ */ new Map());
      __publicField(this, "latched", /* @__PURE__ */ new Set());
      __publicField(this, "cycles", 2e4);
      __publicField(this, "realtime", true);
      __publicField(this, "lastCycle", 0);
      __publicField(this, "speed", { t: 0, c: 0, rate: 0 });
      __publicField(this, "gen", 0);
      __publicField(this, "setup", { ...DEFAULT_SETUP });
      __publicField(this, "bb");
      __publicField(this, "duty", /* @__PURE__ */ new Map());
      __publicField(this, "bbIn", /* @__PURE__ */ new Map());
      __publicField(this, "vgaSeen", 0);
      __publicField(this, "term", "");
      __publicField(this, "sendQ", "");
      __publicField(this, "audio", null);
      __publicField(this, "switches", /* @__PURE__ */ new Map());
      /** called when the user changes what is plugged in (the IDE saves it with the project) */
      __publicField(this, "onSetup", () => {
      });
      /** a new pin file from the pin table (the IDE saves it as pins.pcf and flashes again) */
      __publicField(this, "onPins", () => {
      });
      /** called after an uploaded bitstream is on the board (the IDE shows its warnings) */
      __publicField(this, "onLoaded", () => {
      });
      __publicField(this, "lastFrame", 0);
      host.innerHTML = `<div class="vb-bar">
        <button class="tb-btn" data-a="flash" title="${tr("\u5408\u6210\u76EE\u524D\u7684\u8A2D\u8A08\u4E26\u71D2\u9304\u5230\u865B\u64EC\u677F", "Synthesize the current design and flash it to the virtual board")}">${tr("\u26A1 \u71D2\u9304", "\u26A1 Flash")}</button>
        <button class="tb-btn" data-a="run" disabled>\u23F8</button>
        <button class="tb-btn" data-a="power" disabled title="${tr("\u91CD\u65B0\u4E0A\u96FB\uFF08\u5F9E\u982D\u958B\u59CB\uFF09", "Power cycle (start over)")}">\u27F2</button>
        <select data-a="mode" title="${tr("\u71D2\u9304\u4EC0\u9EBC\uFF1A\u4F4D\u5143\u6D41\uFF1D\u4F48\u5C40\u7E5E\u7DDA\u5F8C\u7684\u771F\u5BE6\u4F4D\u5143\u6D41\uFF08\u89E3\u78BC\u56DE\u96FB\u8DEF\u6A21\u64EC\uFF09\uFF1B\u7DB2\u8868\uFF1D\u6620\u5C04\u5F8C\u7684\u7DB2\u8868\uFF08\u5FEB\uFF0C\u4E0D\u4F48\u5C40\u7E5E\u7DDA\uFF09", "What to flash: bitstream = the real placed-and-routed bitstream (decoded back into a circuit); netlist = the mapped netlist (fast, no place and route)")}">
          <option value="bitstream">${tr("\u4F4D\u5143\u6D41\uFF08\u771F\u5BE6\uFF09", "bitstream (real)")}</option><option value="netlist">${tr("\u7DB2\u8868\uFF08\u5FEB\u901F\uFF09", "netlist (fast)")}</option></select>
        <button class="tb-btn ghost" data-a="upload" title="${tr("\u8F09\u5165\u4EFB\u4F55 iCE40UP5K \u7684 .bin\uFF08\u4F8B\u5982 nextpnr + icepack \u505A\u7684\uFF1B\u4E5F\u53EF\u4EE5\u62D6\u653E\u5230\u677F\u5B50\u4E0A\uFF09", "Load any iCE40UP5K .bin (e.g. from nextpnr + icepack; or drop it on the board)")}">${tr("\u{1F4C2} .bin", "\u{1F4C2} .bin")}</button>
        <button class="tb-btn ghost" data-a="pins" disabled title="${tr("\u8173\u4F4D\u6307\u5B9A\uFF1A\u8A2D\u8A08\u7684\u6BCF\u500B\u57E0\u63A5\u5230\u677F\u5B50\u7684\u54EA\u652F\u8173\uFF08\u5BEB\u5165 pins.pcf\uFF09", "Pin assignment: which board pin each port uses (written to pins.pcf)")}">${tr("\u{1F4CC} \u8173\u4F4D", "\u{1F4CC} Pins")}</button>
        <button class="tb-btn ghost hidden" data-a="download" title="${tr("\u4E0B\u8F09\u9019\u500B\u4F4D\u5143\u6D41\uFF08iceprog \u53EF\u4EE5\u71D2\u9032\u771F\u5BE6\u7684 iCEBreaker\uFF09", "Download this bitstream (iceprog flashes it to a real iCEBreaker)")}">\u2B07 .bin</button>
        <input type="file" accept=".bin" class="hidden" data-a="file">
        <select data-a="pace" title="${tr("\u901F\u5EA6", "Speed")}"><option value="rt">${tr("\u4E0D\u8D85\u904E\u5373\u6642", "up to real time")}</option><option value="max">${tr("\u6700\u5FEB", "fastest")}</option></select>
        <span class="vb-stat"></span>
      </div>
      <div class="vb-bar vb-bar2">
        <label class="vb-chk"><input type="checkbox" data-a="uart"> ${tr("\u{1F5A5} USB \u7D42\u7AEF\u6A5F", "\u{1F5A5} USB terminal")}</label>
        <select data-a="baud" title="${tr("\u9B91\u7387\uFF08\u6BCF\u4F4D\u5143\u6642\u8108\u6578 = 12 MHz \xF7 \u9B91\u7387\uFF09", "Baud rate (clocks per bit = 12 MHz / baud)")}">
          ${[115200, 57600, 19200, 9600].map((b) => `<option value="${b}">${b}</option>`).join("")}<option value="-8">${tr("\u6BCF\u4F4D\u5143 8 \u62CD\uFF08\u6E2C\u8A66\u7528\uFF09", "8 clocks per bit (tests)")}</option></select>
        <span class="vb-sep">\u2502</span>
        <label class="vb-chk">PMOD1A <select data-a="pmod1a">${MODULES.map((m) => `<option value="${m[0]}">${tr(m[1], m[2])}</option>`).join("")}</select></label>
        <label class="vb-chk">PMOD1B <select data-a="pmod1b">${MODULES.filter((m) => m[0] !== "vga").map((m) => `<option value="${m[0]}">${tr(m[1], m[2])}</option>`).join("")}</select></label>
        <span class="vb-sep">\u2502</span>
        <label class="vb-chk"><input type="checkbox" data-a="breadboard"> ${tr("\u{1F9EA} \u9EB5\u5305\u677F", "\u{1F9EA} Breadboard")}</label>
      </div>
      <div class="vb-main">
        <div class="vb-stage"><svg class="vb-svg" viewBox="0 0 920 330" xmlns="http://www.w3.org/2000/svg"></svg><div class="bb hidden"></div></div>
        <div class="vb-cards"></div>
      </div>
      <div class="vb-foot"></div>
      <div class="vb-pins hidden"></div>`;
      this.svg.innerHTML = this.drawing();
      this.q("[data-a=run]").onclick = () => this.setRunning(!this.running);
      this.q("[data-a=power]").onclick = () => this.power();
      this.q("[data-a=pace]").onchange = (e) => {
        this.realtime = e.target.value === "rt";
      };
      this.q("[data-a=upload]").onclick = () => this.q("[data-a=file]").click();
      this.q("[data-a=file]").onchange = (e) => {
        const f = e.target.files?.[0];
        if (f) this.loadBin(f);
        e.target.value = "";
      };
      this.q("[data-a=download]").onclick = () => this.download();
      this.q("[data-a=pins]").onclick = () => this.pinTable();
      for (const k of ["uart", "baud", "pmod1a", "pmod1b", "breadboard"]) this.q(`[data-a=${k}]`).addEventListener("change", () => this.setupFromUi());
      this.bb = new Breadboard(this.q(".bb"));
      this.bb.onChange = (layout) => {
        if (layout) {
          this.setup.bb = this.bb.parts.map((p) => ({ ...p }));
          this.onSetup(this.setup);
        }
        this.solveBB();
        if (!this.running) this.tick(0);
      };
      host.addEventListener("dragover", (e) => {
        e.preventDefault();
        host.classList.add("drop");
      });
      host.addEventListener("dragleave", () => host.classList.remove("drop"));
      host.addEventListener("drop", (e) => {
        e.preventDefault();
        host.classList.remove("drop");
        const f = e.dataTransfer?.files?.[0];
        if (f) this.loadBin(f);
      });
      for (const b of this.svg.querySelectorAll("[data-btn]")) {
        const pin = +b.dataset.btn;
        const down = (e) => {
          e.preventDefault();
          if (e.shiftKey) {
            this.latched.has(pin) ? this.latched.delete(pin) : this.latched.add(pin);
            this.press(pin, this.latched.has(pin));
            return;
          }
          this.press(pin, true);
        };
        const up = () => {
          if (!this.latched.has(pin)) this.press(pin, false);
        };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up);
        b.addEventListener("pointerleave", up);
      }
      host.tabIndex = 0;
      host.addEventListener("keydown", (e) => {
        const p = KEYS[e.key];
        if (p !== void 0 && !e.repeat) {
          this.press(p, true);
          e.preventDefault();
        }
      });
      host.addEventListener("keyup", (e) => {
        const p = KEYS[e.key];
        if (p !== void 0 && !this.latched.has(p)) this.press(p, false);
      });
    }
    /** plug in modules and the terminal (from the project, or an example's defaults) */
    setSetup(s) {
      this.setup = { ...DEFAULT_SETUP, ...s };
      if (this.setup.pmod1a === "vga") this.setup.pmod1b = "";
      this.q("[data-a=uart]").checked = this.setup.uart;
      this.q("[data-a=baud]").value = String(this.setup.baud);
      this.q("[data-a=pmod1a]").value = this.setup.pmod1a;
      this.q("[data-a=pmod1b]").value = this.setup.pmod1b;
      this.q("[data-a=pmod1b]").disabled = this.setup.pmod1a === "vga";
      this.q("[data-a=breadboard]").checked = !!this.setup.breadboard;
      this.q(".bb").classList.toggle("hidden", !this.setup.breadboard);
      this.bb.blocked = /* @__PURE__ */ new Set([...this.setup.pmod1a ? SLOT.pmod1a : [], ...this.setup.pmod1b || this.setup.pmod1a === "vga" ? SLOT.pmod1b : []]);
      this.bb.setParts(this.setup.bb ?? []);
      this.bbIn.clear();
      this.cards();
      if (this.info) this.attach();
    }
    setupFromUi() {
      const s = {
        uart: this.q("[data-a=uart]").checked,
        baud: +this.q("[data-a=baud]").value,
        pmod1a: this.q("[data-a=pmod1a]").value,
        pmod1b: this.q("[data-a=pmod1b]").value,
        breadboard: this.q("[data-a=breadboard]").checked,
        bb: this.bb.parts.map((p) => ({ ...p }))
      };
      this.setSetup(s);
      this.onSetup(this.setup);
    }
    /** the peripheral configuration for the core */
    periph() {
      const s = this.setup;
      const seg = (pins) => ({ segs: [...pins.slice(0, 7), null], sels: [[pins[7], 0], [pins[7], 1]], on: 1 });
      const segs = ["pmod1a", "pmod1b"].filter((k) => s[k] === "seg7").map((k) => seg(SLOT[k]));
      const a = SLOT.pmod1a, b = SLOT.pmod1b;
      return {
        uart: s.uart ? { tx: 9, rx: 6, cpb: s.baud < 0 ? -s.baud : 12e6 / s.baud } : null,
        seg: segs,
        // PmodVGA: 1A pins 1-4 R0-R3, 7-10 B0-B3; 1B pins 1-4 G0-G3, 7 HS, 8 VS (colors msb first)
        vga: s.pmod1a === "vga" ? { hs: b[4], vs: b[5], r: [a[3], a[2], a[1], a[0]], g: [b[3], b[2], b[1], b[0]], b: [a[7], a[6], a[5], a[4]] } : null
      };
    }
    async attach() {
      await (await this.core()).call({ cmd: "board_periph", ...this.periph() });
      this.vgaSeen = 0;
      for (const [pin, on] of this.switches) this.pending.push([pin, on ? 1 : 0]);
    }
    /** the cards of the plugged-in modules */
    cards() {
      const box = this.q(".vb-cards");
      let h = "";
      const s = this.setup;
      if (s.uart) h += `<div class="vb-card vb-term"><div class="vb-card-h">${tr("USB \u7D42\u7AEF\u6A5F", "USB terminal")}\u3000<span class="vb-dim">TX ${tr("\u8173", "pin")} 9 \u2192 ${tr("\u96FB\u8166", "PC")}\uFF0CRX ${tr("\u8173", "pin")} 6 \u2190 ${tr("\u96FB\u8166", "PC")}</span><span class="vb-err"></span><button class="icon" data-a="tclear" title="${tr("\u6E05\u9664", "Clear")}">\u232B</button></div><pre class="vb-tout"></pre><input class="vb-tin" placeholder="${tr("\u8F38\u5165\u6587\u5B57\uFF0CEnter \u9001\u51FA", "Type, Enter to send")}"></div>`;
      for (const k of ["pmod1a", "pmod1b"]) {
        const m = s[k], pins = SLOT[k], name = k === "pmod1a" ? "PMOD1A" : "PMOD1B";
        if (!m) continue;
        if (m === "led8") h += `<div class="vb-card"><div class="vb-card-h">${name}\uFF1A${tr("8 \u9846 LED", "8 LEDs")}</div><div class="vb-led8">${pins.map((p, i) => `<span class="vb-l8" data-l8="${p}" title="${tr("\u8173", "pin")} ${p}">${i}</span>`).join("")}</div></div>`;
        if (m === "sw8") h += `<div class="vb-card"><div class="vb-card-h">${name}\uFF1A${tr("8 \u500B\u958B\u95DC\uFF08\u9EDE\u4E00\u4E0B\u5207\u63DB\uFF09", "8 switches (click to flip)")}</div><div class="vb-sw8">${pins.map((p, i) => `<button class="vb-sw" data-sw="${p}" title="${tr("\u8173", "pin")} ${p}">${i}</button>`).join("")}</div></div>`;
        if (m === "seg7") h += `<div class="vb-card"><div class="vb-card-h">${name}\uFF1A${tr("\u4E03\u6BB5\u986F\u793A\u5668", "7-segment display")}\u3000<span class="vb-dim">${tr("\u8173 1\u20134\u30017\u20139 = a\u2013g\uFF0C\u8173 10 = \u9078\u4F4D", "pins 1\u20134, 7\u20139 = a\u2013g, pin 10 = digit")}</span></div><svg class="vb-seg" viewBox="0 0 150 110" data-seg="${k}">${[1, 0].map((d, i) => this.digit(8 + i * 70, 8, d)).join("")}</svg></div>`;
        if (m === "vga") h += `<div class="vb-card"><div class="vb-card-h">${tr("VGA \u87A2\u5E55", "VGA monitor")}\u3000<span class="vb-dim vb-vga-i"></span></div><canvas class="vb-vga" width="320" height="240"></canvas></div>`;
        if (m === "buzzer") h += `<div class="vb-card"><div class="vb-card-h">${name}\uFF1A${tr("\u8702\u9CF4\u5668\uFF08\u8173 1\uFF09", "buzzer (pin 1)")}\u3000<label class="vb-chk"><input type="checkbox" data-a="sound"> ${tr("\u{1F50A} \u8072\u97F3", "\u{1F50A} sound")}</label></div><div class="vb-buzz" data-buzz="${pins[0]}">\u2014</div></div>`;
      }
      box.innerHTML = h;
      box.classList.toggle("hidden", !h);
      const tin = box.querySelector(".vb-tin");
      if (tin) tin.onkeydown = (e) => {
        if (e.key === "Enter") {
          this.sendQ += tin.value;
          this.echoLocal(tin.value);
          tin.value = "";
          if (!this.running) this.tick(0);
        }
      };
      const tc = box.querySelector("[data-a=tclear]");
      if (tc) tc.onclick = () => {
        this.term = "";
        this.showTerm();
      };
      this.showTerm();
      for (const b of box.querySelectorAll("[data-sw]")) {
        const pin = +b.dataset.sw;
        b.classList.toggle("on", !!this.switches.get(pin));
        b.onclick = () => {
          const on = !this.switches.get(pin);
          this.switches.set(pin, on);
          b.classList.toggle("on", on);
          this.pending.push([pin, on ? 1 : 0]);
          if (!this.running) this.tick(0);
        };
      }
      const snd = box.querySelector("[data-a=sound]");
      if (snd) {
        snd.checked = !!this.audio;
        snd.onchange = () => this.sound(snd.checked);
      }
    }
    /** a seven-segment digit: segments a..g + dp as paths tagged data-s */
    digit(x, y, d) {
      const H = (sx, sy) => `M${x + sx + 6} ${y + sy} h28 l5 5 l-5 5 h-28 l-5 -5 z`;
      const V = (sx, sy) => `M${x + sx} ${y + sy + 6} l5 -5 l5 5 v30 l-5 5 l-5 -5 z`;
      const segs = [H(0, 0), V(38, 4), V(38, 46), H(0, 84), V(-6, 46), V(-6, 4), H(0, 42)];
      return segs.map((p, k) => `<path d="${p}" class="vb-s" data-d="${d}" data-s="${k}"/>`).join("") + `<circle cx="${x + 50}" cy="${y + 92}" r="4" class="vb-s" data-d="${d}" data-s="7"/>`;
    }
    echoLocal(_t) {
    }
    showTerm() {
      const o = this.host.querySelector(".vb-tout");
      if (!o) return;
      o.textContent = this.term;
      o.scrollTop = o.scrollHeight;
    }
    sound(on) {
      if (on && !this.audio) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        this.audio = { ctx, osc, gain };
      } else if (!on && this.audio) {
        this.audio.ctx.close();
        this.audio = null;
      }
    }
    /** the flash button (the IDE hooks it up) */
    get flashButton() {
      return this.q("[data-a=flash]");
    }
    get loaded() {
      return this.info;
    }
    q(sel) {
      return this.host.querySelector(sel);
    }
    get svg() {
      return this.q(".vb-svg");
    }
    /** the selected mode: the real bitstream (synthesis, place and route, decoding) or the mapped netlist */
    get mode() {
      return this.q("[data-a=mode]").value;
    }
    /** synthesize `top` and power the board up with it */
    async flash(files, top, pcf) {
      this.setRunning(false);
      const gen = ++this.gen;
      const core2 = await this.core();
      let info;
      if (this.mode === "bitstream") {
        this.stat(tr("\u8F09\u5165\u6676\u7247\u8CC7\u6599\u5EAB\u2026", "Loading the chip database\u2026"));
        await core2.chipdb();
        this.stat(tr("\u5408\u6210\u3001\u4F48\u5C40\u7E5E\u7DDA\u3001\u7522\u751F\u4F4D\u5143\u6D41\u4E26\u71D2\u9304\u2026", "Synthesis, place and route, bitstream, flashing\u2026"));
        info = await core2.call({ cmd: "board_flash", files, top, pcf: pcf ?? null });
      } else {
        this.stat(tr("\u5408\u6210\u4E26\u71D2\u9304\u7DB2\u8868\u2026", "Synthesizing and flashing the netlist\u2026"));
        info = await core2.call({ cmd: "board_load", files, top, pcf: pcf ?? null });
      }
      if (gen !== this.gen) return info;
      this.start(info);
      return info;
    }
    /** any iCE40UP5K bitstream from a file */
    async loadBin(f) {
      this.setRunning(false);
      const gen = ++this.gen;
      const bytes = new Uint8Array(await f.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
      try {
        const core2 = await this.core();
        this.stat(tr("\u8F09\u5165\u6676\u7247\u8CC7\u6599\u5EAB\u2026", "Loading the chip database\u2026"));
        await core2.chipdb();
        this.stat(tr("\u89E3\u78BC\u4F4D\u5143\u6D41\u2026", "Decoding the bitstream\u2026"));
        const info = await core2.call({ cmd: "board_load_bin", bin: btoa(s), name: f.name });
        if (gen !== this.gen) return;
        this.start(info);
        this.onLoaded(info);
      } catch (e) {
        this.stat("\u2717 " + String(e.message ?? e));
      }
    }
    /** the pin assignment table: a pin per port bit */
    pinTable() {
      const i = this.info;
      const box = this.q(".vb-pins");
      if (!i?.ports) return;
      const cur2 = /* @__PURE__ */ new Map();
      for (const p of i.pins) {
        const port = p.input ?? p.output;
        if (port) cur2.set(port, p.pin);
      }
      const kind = (k) => ({ clock: tr("\u6642\u8108", "clock"), button: tr("\u6309\u9215", "button"), led: "LED", uart_rx: "UART RX", uart_tx: "UART TX", pmod: "PMOD" })[k] ?? k;
      const opts = (port) => `<option value="">\u2014</option>` + i.pins.map((p) => `<option value="${p.pin}"${cur2.get(port) === p.pin ? " selected" : ""}>${p.name}\uFF08${p.pin}\uFF0C${kind(p.kind)}\uFF09</option>`).join("");
      box.innerHTML = `<div class="vb-pins-box"><div class="vb-card-h">${tr("\u8173\u4F4D\u6307\u5B9A", "Pin assignment")}\u3000<span class="vb-dim">${tr("\u5957\u7528\u5F8C\u5BEB\u5165 pins.pcf \u4E26\u91CD\u65B0\u71D2\u9304", "Apply writes pins.pcf and flashes again")}</span></div>
      <table>${i.ports.map((p) => `<tr><td>${esc2(p.name)}</td><td class="vb-dim">${p.dir === "in" ? tr("\u8F38\u5165", "input") : tr("\u8F38\u51FA", "output")}</td><td><select data-port="${esc2(p.name)}">${opts(p.name)}</select></td></tr>`).join("")}</table>
      <div class="vb-pins-act"><button class="tb-btn primary" data-a="pins-ok">${tr("\u5957\u7528\u4E26\u71D2\u9304", "Apply and flash")}</button><button class="tb-btn" data-a="pins-no">${tr("\u53D6\u6D88", "Cancel")}</button></div></div>`;
      box.classList.remove("hidden");
      box.querySelector("[data-a=pins-no]").onclick = () => box.classList.add("hidden");
      box.querySelector("[data-a=pins-ok]").onclick = () => {
        const lines = [...box.querySelectorAll("select[data-port]")].filter((sel) => sel.value).map((sel) => `set_io -nowarn ${sel.dataset.port} ${sel.value}`);
        box.classList.add("hidden");
        this.onPins(`# pins of ${i.top} on the iCEBreaker (written by the pin table)
${lines.join("\n")}
`);
      };
    }
    download() {
      if (!this.info?.bin) return;
      const raw = atob(this.info.bin);
      const u = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([u], { type: "application/octet-stream" }));
      a.download = `${this.info.top}.bin`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1e3);
    }
    start(info) {
      this.info = info;
      this.held.clear();
      this.latched.clear();
      this.lastCycle = 0;
      this.speed = { t: performance.now(), c: 0, rate: 0 };
      this.cycles = 2e4;
      this.wire();
      this.foot();
      this.q("[data-a=run]").disabled = false;
      this.q("[data-a=power]").disabled = false;
      this.q("[data-a=download]").classList.toggle("hidden", !info.bin);
      this.q("[data-a=pins]").disabled = !info.ports;
      this.term = "";
      this.bbIn.clear();
      this.cards();
      this.attach().then(() => this.setRunning(true));
    }
    async power() {
      if (!this.info) return;
      const was = this.running;
      this.setRunning(false);
      await (await this.core()).call({ cmd: "board_reset" });
      this.vgaSeen = 0;
      for (const [pin, on] of this.switches) this.pending.push([pin, on ? 1 : 0]);
      this.lastCycle = 0;
      this.speed = { t: performance.now(), c: 0, rate: 0 };
      for (const p of this.latched) this.press(p, true);
      if (was) this.setRunning(true);
      else this.tick(0);
    }
    stop() {
      this.setRunning(false);
    }
    resume() {
      this.setRunning(true);
    }
    get isRunning() {
      return this.running;
    }
    setRunning(on) {
      this.running = on && !!this.info;
      this.q("[data-a=run]").textContent = this.running ? "\u23F8" : "\u25B6";
      this.q("[data-a=run]").title = this.running ? tr("\u66AB\u505C", "Pause") : tr("\u7E7C\u7E8C", "Run");
      clearTimeout(this.loop);
      if (this.running) {
        this.speed = { t: performance.now(), c: this.lastCycle, rate: this.speed.rate };
        this.tick(this.cycles);
      }
    }
    press(pin, down) {
      const p = this.info?.pins.find((x) => x.pin === pin);
      if (!p || p.kind !== "button") return;
      this.held.set(pin, down);
      this.pending.push([pin, (down ? p.level : !p.level) ? 1 : 0]);
      this.svg.querySelector(`[data-btn="${pin}"]`)?.classList.toggle("down", down);
      if (!this.running) this.tick(0);
    }
    /** one call to the worker: `n` cycles, then draw and schedule the next */
    async tick(n) {
      const gen = this.gen;
      const t0 = performance.now();
      const inputs = this.pending;
      this.pending = [];
      const uart_send = this.sendQ;
      this.sendQ = "";
      const wantFrame = this.setup.pmod1a === "vga" && performance.now() - this.lastFrame > 150;
      let r;
      try {
        r = await (await this.core()).call({ cmd: "board_run", cycles: n, inputs, uart_send, ...wantFrame ? { vga_seen: this.vgaSeen } : {} });
      } catch (e) {
        this.stat("\u2717 " + String(e.message ?? e));
        this.setRunning(false);
        return;
      }
      if (gen !== this.gen) return;
      const dt = performance.now() - t0;
      this.lastCycle = r.cycle;
      this.show(r);
      if (!this.running) {
        this.stat();
        return;
      }
      if (n > 0) this.cycles = Math.max(1e3, Math.min(4e6, Math.round(n * 25 / Math.max(1, dt))));
      const now = performance.now();
      const el2 = (now - this.speed.t) / 1e3;
      if (el2 > 0.5) {
        this.speed.rate = (r.cycle - this.speed.c) / el2;
        this.speed = { t: now, c: r.cycle, rate: this.speed.rate };
      }
      this.stat();
      let next = this.cycles;
      let wait = 0;
      if (this.realtime) {
        const hz = this.info.clock_hz;
        next = Math.min(next, Math.round(hz * 0.03));
        wait = Math.max(0, next / hz * 1e3 - dt);
      }
      this.loop = window.setTimeout(() => this.tick(next), wait);
    }
    /** the breadboard against the outputs' duties: LED brightness, warnings, the FPGA's input levels */
    solveBB() {
      if (!this.setup.breadboard || !this.info) return;
      const outs = /* @__PURE__ */ new Map(), ins = /* @__PURE__ */ new Set();
      for (const p of this.info.pins) {
        if (this.bb.blocked.has(p.pin)) continue;
        if (p.output) outs.set(p.pin, this.duty.get(p.pin) ?? 0);
        if (p.input) ins.add(p.pin);
      }
      const r = solve(this.bb.parts, outs, ins, this.bb.pressed, tr);
      this.bb.setLeds(r.led);
      this.bb.setWarnings(r.warnings);
      for (const [pin, v] of r.inputs) {
        if (this.bbIn.get(pin) !== v) {
          this.bbIn.set(pin, v);
          this.pending.push([pin, v]);
        }
      }
    }
    /** LED brightness and pin levels from the duty cycles */
    show(r) {
      this.duty = new Map(r.duty);
      this.solveBB();
      this.showPeriph(r);
      for (const [pin, duty] of r.duty) {
        const p = this.info.pins.find((x) => x.pin === pin);
        if (!p) continue;
        const lit = p.kind === "led" ? p.level ? duty : 1 - duty : duty;
        for (const el2 of this.svg.querySelectorAll(`[data-led="${pin}"]`)) el2.style.opacity = (lit < 4e-3 ? 0 : 0.18 + 0.82 * Math.sqrt(lit)).toFixed(3);
        for (const el2 of this.svg.querySelectorAll(`[data-hdr="${pin}"]`)) el2.style.fill = `rgba(255, 210, 80, ${(0.15 + 0.85 * duty).toFixed(3)})`;
      }
    }
    showPeriph(r) {
      const duty = new Map(r.duty);
      for (const el2 of this.host.querySelectorAll("[data-l8]")) {
        const d = duty.get(+el2.dataset.l8);
        el2.style.setProperty("--lit", d === void 0 ? "0" : (d < 4e-3 ? 0 : 0.2 + 0.8 * Math.sqrt(d)).toFixed(3));
        el2.classList.toggle("nc", d === void 0);
      }
      let si = 0;
      for (const svg of this.host.querySelectorAll("[data-seg]")) {
        const disp = r.segs[si++];
        if (!disp) continue;
        for (const el2 of svg.querySelectorAll(".vb-s")) {
          const v = disp[+el2.dataset.d]?.[+el2.dataset.s] ?? 0;
          el2.style.opacity = (v * disp.length < 0.01 ? 0.08 : 0.25 + 0.75 * Math.min(1, Math.sqrt(v * disp.length))).toFixed(3);
        }
      }
      if (r.uart) {
        if (r.uart.rx.length) {
          for (const b of r.uart.rx) {
            if (b === 13) continue;
            this.term += b === 10 || b >= 32 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`;
          }
          if (this.term.length > 2e4) this.term = this.term.slice(-15e3);
          this.showTerm();
        }
        const e = this.host.querySelector(".vb-err");
        if (e) e.textContent = r.uart.errors ? `\u3000\u26A0 ${r.uart.errors} ${tr("\u500B\u683C\u5F0F\u932F\u8AA4\uFF08\u9B91\u7387\u5C0D\u55CE\uFF1F\uFF09", "framing errors (right baud rate?)")}` : "";
      }
      if (r.vga?.rle && r.vga.w && r.vga.h) {
        this.vgaSeen = r.vga.n;
        this.lastFrame = performance.now();
        this.drawFrame(r.vga.w, r.vga.h, r.vga.rle);
      }
      const vi = this.host.querySelector(".vb-vga-i");
      if (vi && r.vga) vi.textContent = r.vga.n ? `${tr("\u756B\u9762", "frames")} ${r.vga.n}` : tr("\u7B49\u5F85 VSYNC\u2026", "waiting for VSYNC\u2026");
      const bz = this.host.querySelector("[data-buzz]");
      if (bz && r.window > 0) {
        const edges = new Map(r.edges).get(+bz.dataset.buzz) ?? 0;
        const hz = edges / 2 / (r.window / this.info.clock_hz);
        bz.textContent = hz >= 1 ? `${hz < 1e3 ? hz.toFixed(1) : (hz / 1e3).toFixed(2) + " k"}Hz` : tr("\uFF08\u5B89\u975C\uFF09", "(silent)");
        if (this.audio) {
          const on = hz >= 20 && hz <= 2e4;
          this.audio.gain.gain.setTargetAtTime(on ? 0.05 : 0, this.audio.ctx.currentTime, 0.01);
          if (on) this.audio.osc.frequency.setTargetAtTime(hz, this.audio.ctx.currentTime, 0.01);
        }
      }
    }
    drawFrame(w, h, rle) {
      const c = this.host.querySelector(".vb-vga");
      if (!c) return;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const raw = atob(rle);
      const img = c.getContext("2d").createImageData(w, h);
      let p = 0;
      for (let i = 0; i + 3 < raw.length; i += 4) {
        const col = raw.charCodeAt(i) | raw.charCodeAt(i + 1) << 8;
        const n = raw.charCodeAt(i + 2) | raw.charCodeAt(i + 3) << 8;
        const [R, G, B] = [(col >> 8 & 15) * 17, (col >> 4 & 15) * 17, (col & 15) * 17];
        for (let k = 0; k < n && p < w * h; k++, p++) {
          img.data[p * 4] = R;
          img.data[p * 4 + 1] = G;
          img.data[p * 4 + 2] = B;
          img.data[p * 4 + 3] = 255;
        }
      }
      c.getContext("2d").putImageData(img, 0, 0);
    }
    stat(text) {
      const s = this.q(".vb-stat");
      if (text !== void 0) {
        s.textContent = text;
        return;
      }
      if (!this.info) {
        s.textContent = tr("\u9084\u6C92\u6709\u71D2\u9304\u8A2D\u8A08", "No design flashed yet");
        return;
      }
      const hz = this.info.clock_hz;
      const t = this.lastCycle / hz;
      const rate = this.speed.rate;
      s.textContent = `${this.info.top} \xB7 ${tr("\u865B\u64EC\u6642\u9593", "virtual time")} ${t < 10 ? t.toFixed(3) : t.toFixed(1)} s \xB7 ` + (this.running ? `${tr("\u901F\u5EA6", "speed")} ${(rate / 1e6).toFixed(2)} MHz\uFF08${tr("\u771F\u5BE6\u7684", "real time \xD7")} ${(rate / hz).toFixed(2)}${tr(" \u500D", "")}\uFF09` : tr("\u66AB\u505C", "paused"));
    }
    /** which pins the design uses: tooltips and dim parts it does not drive */
    wire() {
      const by = new Map(this.info.pins.map((p) => [p.pin, p]));
      for (const el2 of this.svg.querySelectorAll("[data-pin]")) {
        const p = by.get(+el2.dataset.pin);
        if (!p) continue;
        const port = p.input ?? p.output;
        el2.classList.toggle("used", !!port);
        const t = el2.querySelector("title") ?? el2.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "title"));
        t.textContent = `${p.name}\uFF08${tr("\u8173", "pin")} ${p.pin}\uFF09` + (port ? ` \u2194 ${port}` : tr("\uFF1A\u8A2D\u8A08\u6C92\u6709\u7528\u5230", ": not used by the design"));
      }
      for (const el2 of this.svg.querySelectorAll("[data-led],[data-hdr]")) {
        el2.style.opacity = el2.dataset.led ? "0" : "";
        el2.style.fill = "";
      }
    }
    foot() {
      const i = this.info;
      const used = i.pins.filter((p) => p.input || p.output).map((p) => `${p.name}\u2194${p.input ?? p.output}`);
      const what = i.mode === "netlist" ? `${tr("\u7DB2\u8868", "netlist")}\uFF1A${i.cells.lut} LUT\u3001${i.cells.carry} CARRY\u3001${i.cells.ff} DFF${i.cells.ram ? `\u3001${i.cells.ram} BRAM` : ""}\uFF08${tr("\u672A\u4F48\u5C40\u7E5E\u7DDA", "not placed and routed")}\uFF09` : `${i.mode === "bin" ? tr("\u4E0A\u50B3\u7684\u4F4D\u5143\u6D41", "uploaded bitstream") : tr("\u4F4D\u5143\u6D41", "bitstream")}\uFF1A${i.cells.lc ?? i.cells.lut} LC${i.cells.ram ? `\u3001${i.cells.ram} BRAM` : ""}` + (i.fmax ? `\uFF0CF<sub>max</sub> ${i.fmax.toFixed(1)} MHz${i.fmax < i.clock_hz / 1e6 ? " \u26A0" : ` \u2265 12 MHz \u2713`}` : "");
      this.q(".vb-foot").innerHTML = `<b>${esc2(i.top)}</b>\u3000${what}\u3000${i.default_pcf ? tr("\uFF08\u5C08\u6848\u6C92\u6709\u8173\u4F4D\u6A94\uFF1A\u4F7F\u7528\u6559\u5B78\u7684 iCEBreaker \u9810\u8A2D\u8173\u4F4D\uFF09", "(no pin file in the project: the tutorial's iCEBreaker pins)") : ""}<br>${tr("\u63A5\u7DDA", "Wiring")}\uFF1A${esc2(used.join("\u3000")) || "\u2014"}` + (i.warnings.length ? `<br><span class="vb-warn">\u26A0 ${esc2(i.warnings.slice(0, 3).join("\uFF1B"))}${i.warnings.length > 3 ? tr(`\u2026\uFF08\u5171 ${i.warnings.length} \u689D\uFF0C\u898B\u300C\u554F\u984C\u300D\u9762\u677F\uFF09`, `\u2026 (${i.warnings.length} in all, see Problems)`) : ""}</span>` : "") + `<br><span class="vb-hint">${tr("\u6309\u4F4F\u6309\u9215\uFF08\u6216\u6309\u9375 0 = BTN_N\u30011\u20133 = BTN1\u20133\uFF09\uFF1BShift+\u9EDE\u64CA\u53EF\u4EE5\u9396\u4F4F\u6309\u9215\u3002\u4F4D\u5143\u6D41\u6A21\u5F0F\u6A21\u64EC\u7684\u662F\u4F48\u5C40\u7E5E\u7DDA\u5F8C\u771F\u6B63\u6703\u71D2\u9032\u6676\u7247\u7684\u4F4D\u5143\u6D41\uFF08\u89E3\u78BC\u56DE\u96FB\u8DEF\u3001\u9010\u9031\u671F\u6A21\u64EC\uFF09\uFF0C\u901F\u5EA6\u4F9D\u8A2D\u8A08\u5927\u5C0F\u800C\u5B9A\uFF1B\u53EF\u4EE5\u628A\u4EFB\u4F55 .bin \u62D6\u653E\u5230\u677F\u5B50\u4E0A\u3002\u677F\u5B50\u7684\u5716\u662F\u793A\u610F\u5716\u3002", "Hold a button (or keys 0 = BTN_N, 1\u20133 = BTN1\u20133); Shift+click latches it. In bitstream mode the board runs the placed-and-routed bitstream that would be flashed (decoded back into a circuit, simulated cycle by cycle); the speed depends on the design size. Drop any .bin on the board. The board drawing is schematic.")}</span>`;
    }
    /** the board: main section (USB, FPGA, LEDs, button, PMOD1A/1B) and the break-off section */
    drawing() {
      const hdr = (x, y, pins, label, vertical = false) => {
        let s = `<text x="${x + (vertical ? 22 : 60)}" y="${y - 8}" class="vb-silk" text-anchor="middle">${label}</text>`;
        const rows = [[...pins.slice(0, 4), -1, -2], [...pins.slice(4), -1, -2]];
        rows.forEach((row, r) => row.forEach((p, k) => {
          const [px, py] = vertical ? [x + r * 22, y + k * 22] : [x + k * 22, y + r * 22];
          if (p < 0) {
            s += `<rect x="${px}" y="${py}" width="18" height="18" rx="2" class="vb-hdr-pwr"><title>${p === -1 ? "GND" : "3V3"}</title></rect>`;
            return;
          }
          s += `<g data-pin="${p}"><rect x="${px}" y="${py}" width="18" height="18" rx="2" class="vb-hdr" data-hdr="${p}"/></g>`;
        }));
        return s;
      };
      const led = (x, y, pin, color, label) => `<g data-pin="${pin}"><rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="2" class="vb-led-body"/><circle cx="${x}" cy="${y}" r="16" fill="${color}" filter="url(#vbGlow)" data-led="${pin}" style="opacity:0"/><rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="2" fill="${color}" data-led="${pin}" style="opacity:0"/><text x="${x}" y="${y + 22}" class="vb-silk" text-anchor="middle">${label}</text></g>`;
      const btn = (x, y, pin, label) => `<g data-pin="${pin}" data-btn="${pin}" class="vb-btn"><rect x="${x - 15}" y="${y - 15}" width="30" height="30" rx="3" class="vb-btn-base"/><circle cx="${x}" cy="${y}" r="10" class="vb-btn-cap"/><text x="${x}" y="${y + 30}" class="vb-silk" text-anchor="middle">${label}</text></g>`;
      return `<defs><filter id="vbGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="5"/></filter></defs>
      <rect x="10" y="20" width="640" height="290" rx="14" class="vb-pcb"/>
      <rect x="670" y="20" width="240" height="290" rx="14" class="vb-pcb"/>
      <line x1="660" y1="30" x2="660" y2="300" class="vb-perf"/>
      <text x="30" y="300" class="vb-silk vb-title">iCEBreaker</text>
      <rect x="0" y="135" width="42" height="56" rx="4" class="vb-usb"/><text x="48" y="128" class="vb-silk">USB</text>
      <rect x="70" y="140" width="52" height="46" rx="3" class="vb-chip"/><text x="96" y="167" class="vb-chip-t" text-anchor="middle">FTDI</text>
      <rect x="150" y="215" width="44" height="30" rx="2" class="vb-chip"/><text x="172" y="234" class="vb-chip-t" text-anchor="middle">flash</text>
      <g data-pin="35"><rect x="160" y="80" width="40" height="24" rx="5" class="vb-osc"/><text x="180" y="96" class="vb-chip-t" text-anchor="middle">12M</text><title>12 MHz</title></g>
      <rect x="245" y="95" width="140" height="140" rx="4" class="vb-chip vb-fpga"/>
      <text x="315" y="160" class="vb-chip-t vb-fpga-t" text-anchor="middle">iCE40UP5K</text>
      <text x="315" y="180" class="vb-chip-t" text-anchor="middle">SG48</text>
      ${led(430, 60, 11, "#ff3b30", "LEDR_N")}
      ${led(480, 60, 37, "#34c759", "LEDG_N")}
      ${btn(440, 255, 10, "BTN_N")}
      ${hdr(500, 120, PMOD1A2, "PMOD1A", true)}
      ${hdr(575, 120, PMOD1B2, "PMOD1B", true)}
      ${hdr(682, 120, PMOD2, "PMOD2", true)}
      ${led(810, 115, 26, "#ff3b30", "LED1")}
      ${led(810, 65, 27, "#34c759", "LED2")}
      ${led(860, 115, 25, "#34c759", "LED3")}
      ${led(810, 165, 23, "#34c759", "LED4")}
      ${led(760, 115, 21, "#34c759", "LED5")}
      ${btn(760, 250, 20, "BTN1")}
      ${btn(810, 250, 19, "BTN2")}
      ${btn(860, 250, 18, "BTN3")}`;
    }
  };

  // src/ide/highlight.ts
  var KEYWORDS = new Set("module interface package function import export inst param const var let assign always_ff always_comb initial final if else if_reset case switch default for in rev step return break input output inout modport struct enum union typedef embed include generate pub proto bind connect type as repeat inside outside unsafe alias true false".split(" "));
  var TYPES = new Set("logic bit clock clock_posedge clock_negedge reset reset_async_high reset_async_low reset_sync_high reset_sync_low u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 signed tri string".split(" "));
  var TOKEN = /(\/\/.*)|(\/\*)|("(?:\\.|[^"\\])*")|(\d+'s?[bodhBODH][0-9a-fA-FxXzZ_]+|\d+'[01xXzZ]|'[01xXzZ]|\d[\d_]*(?:\.\d+)?)|(\$[A-Za-z_]\w*)|(#\[[^\]]*\])|([A-Za-z_]\w*)|('[a-z_]\w*)/g;
  function esc3(s) {
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
          out.push(`<span class="t-com">${esc3(line)}</span>`);
          continue;
        }
        h += `<span class="t-com">${esc3(line.slice(0, e + 2))}</span>`;
        i = e + 2;
        inBlock = false;
      }
      TOKEN.lastIndex = i;
      let m;
      while (m = TOKEN.exec(line)) {
        h += esc3(line.slice(i, m.index));
        const t = m[0];
        if (m[1]) h += `<span class="t-com">${esc3(t)}</span>`;
        else if (m[2]) {
          const e = line.indexOf("*/", m.index + 2);
          const end = e < 0 ? line.length : e + 2;
          h += `<span class="t-com">${esc3(line.slice(m.index, end))}</span>`;
          if (e < 0) inBlock = true;
          TOKEN.lastIndex = end;
          i = end;
          if (inBlock) break;
          continue;
        } else if (m[3]) h += `<span class="t-str">${esc3(t)}</span>`;
        else if (m[4]) h += `<span class="t-num">${esc3(t)}</span>`;
        else if (m[5]) h += `<span class="t-sys">${esc3(t)}</span>`;
        else if (m[6]) h += `<span class="t-attr">${esc3(t)}</span>`;
        else if (m[7]) {
          if (KEYWORDS.has(t)) h += `<span class="t-kw">${t}</span>`;
          else if (TYPES.has(t)) h += `<span class="t-type">${t}</span>`;
          else if (/^[A-Z]/.test(t)) h += `<span class="t-name">${t}</span>`;
          else h += t;
        } else h += `<span class="t-dom">${esc3(t)}</span>`;
        i = TOKEN.lastIndex;
      }
      if (i < line.length) h += esc3(line.slice(i));
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
  var esc4 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  function projName(p) {
    const ex = p.from ? examples().find((e) => e.id === p.from) : void 0;
    return ex && (p.name === ex.title || p.name === ex.title_en) ? exTitle(ex) : p.name;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function fromExample(ex) {
    const files = ex.files.map((f) => ({ ...f }));
    if (ex.pcf) files.push({ name: PCF, src: ex.pcf });
    return { id: uid(), name: ex.title, files, synth: ex.synth, from: ex.id, open: [ex.files[0].name], active: ex.files[0].name, board: ex.board };
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
  var flow = (asic) => (asic ? ASIC_STAGES : FPGA_STAGES).map((s) => [s.key, stageLabel(s), s.tag]);
  var isAsicStage = (k) => ASIC_STAGES.some((s) => s.key === k && s.tag === "asic");
  var isFpgaStage = (k) => FPGA_STAGES.some((s) => s.key === k && s.tag === "fpga");
  var FLOW_TAB = "\u2699flow";
  var WELCOME = "\u2605welcome";
  var BOARD_TAB = "\u26A1board";
  var TUTORIAL = "https://github.com/ccc-eda/veryl2chip/blob/main/tutorial/README.tw.md";
  var tabName = (n) => n === FLOW_TAB ? tr("\u2699 \u5408\u6210\u6D41\u7A0B", "\u2699 Synthesis flow") : n === WELCOME ? tr("\u6B61\u8FCE", "Welcome") : n === BOARD_TAB ? tr("\u26A1 \u865B\u64EC iCEBreaker", "\u26A1 Virtual iCEBreaker") : n;
  var special = (n) => n === FLOW_TAB || n === WELCOME || n === BOARD_TAB;
  function file(name) {
    return proj.files.find((f) => f.name === name);
  }
  var PCF = "pins.pcf";
  function pcfOf(p) {
    return p.files.find((f) => f.name.endsWith(".pcf"))?.src;
  }
  function migratePcf(p) {
    if (p.pcf !== void 0) {
      if (!p.files.some((f) => f.name.endsWith(".pcf")) && p.pcf.trim()) p.files.push({ name: PCF, src: p.pcf });
      delete p.pcf;
    }
  }
  function original(name) {
    return proj.from ? examples().find((e) => e.id === proj.from)?.files.find((f) => f.name === name)?.src : void 0;
  }
  function openTabs() {
    return proj.open ?? (proj.open = []);
  }
  function openFile(name, line, col) {
    if (!special(name) && !file(name)) return;
    if (!openTabs().includes(name)) openTabs().push(name);
    proj.active = name;
    persist();
    showActive();
    if (line && !special(name)) ed.goto(line, col ?? 1, true);
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
    if (a && !special(a) && !file(a)) a = void 0;
    if (!a) a = openTabs().find((n) => n === FLOW_TAB || file(n)) ?? WELCOME;
    proj.active = a;
    if (!openTabs().includes(a)) openTabs().push(a);
    const isFile = !!file(a);
    $2("editorHost").classList.toggle("hidden", !isFile);
    $2("synOverlay").classList.toggle("hidden", a !== FLOW_TAB);
    $2("boardPane").classList.toggle("hidden", a !== BOARD_TAB);
    if (board) {
      if (a === BOARD_TAB) {
        if (boardWasRunning) {
          boardWasRunning = false;
          board.resume();
        }
      } else if (board.isRunning) {
        boardWasRunning = true;
        board.stop();
      }
    }
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
      t.innerHTML = `<span class="ic">${n === FLOW_TAB || n === BOARD_TAB ? "" : n === WELCOME ? "\u2605" : f?.name.endsWith(".veryl") ? "\u25C6" : "\u25A4"}</span><span class="nm">${esc4(tabName(n))}</span><span class="x" title="${tr("\u95DC\u9589", "Close")}"></span>`;
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
      o.textContent = projName(p);
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
      d.innerHTML = `<span class="ic">${f.name.endsWith(".veryl") ? "\u25C6" : "\u25A4"}</span><span class="nm">${esc4(f.name)}</span><span class="acts"><button class="icon" data-a="ren" title="${tr("\u91CD\u65B0\u547D\u540D", "Rename")}">\u270E</button><button class="icon" data-a="del" title="${tr("\u522A\u9664", "Delete")}">\u{1F5D1}</button></span>` + (n ? `<span class="tag" style="color:var(--err)">${n}</span>` : changed2 ? `<span class="tag dirty-dot" title="${tr("\u8207\u7BC4\u4F8B\u539F\u59CB\u78BC\u4E0D\u540C", "Changed from the example")}">M</span>` : "");
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
      el2.innerHTML = `<span class="ic">${d.kind === "module" ? d.test ? "\u2714" : "\u25A3" : d.kind === "interface" ? "\u21C4" : "{}"}</span><span class="nm">${esc4(d.name)}</span><span class="tag">${top ? tr("\u5408\u6210\u9802\u5C64", "synth top") : d.test ? "test" : d.kind === "module" ? "" : d.kind}</span>`;
      el2.title = `${d.file}:${d.line}`;
      el2.onclick = () => openFile(d.file, d.line);
      box.appendChild(el2);
    }
  }
  function validName(name) {
    if (!/^[\w.-]+$/.test(name)) return tr("\u6A94\u540D\u53EA\u80FD\u7528\u82F1\u6578\u5B57\u3001\u5E95\u7DDA\u3001\u9EDE\u548C\u6E1B\u865F", "File names may only use letters, digits, _ . and -");
    if (file(name)) return tr(`\u5DF2\u7D93\u6709 ${name}`, `${name} already exists`);
    return null;
  }
  function newFile() {
    let name = prompt(tr("\u65B0\u6A94\u540D\uFF08.veryl\uFF09", "New file name (.veryl)"), `module${proj.files.length}.veryl`)?.trim();
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
    let name = prompt(tr("\u65B0\u6A94\u540D", "New file name"), old)?.trim();
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
      alert(tr("\u5C08\u6848\u81F3\u5C11\u8981\u6709\u4E00\u500B\u6A94\u6848", "A project needs at least one file"));
      return;
    }
    if (!confirm(tr(`\u522A\u9664 ${name}\uFF1F`, `Delete ${name}?`))) return;
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
      if (f.name.endsWith(".json")) {
        try {
          importLab(JSON.parse(src), "");
        } catch (e) {
          alert(String(e.message ?? e));
        }
        return;
      }
      if (f.name.endsWith(".pcf")) {
        proj.files = proj.files.filter((x) => !x.name.endsWith(".pcf"));
      }
      const cur2 = file(f.name);
      if (cur2) cur2.src = src;
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
    if (proj.active === FLOW_TAB || proj.active === BOARD_TAB) proj.active = void 0;
    proj.open = openTabs().filter((n) => n === WELCOME || file(n));
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
    const name = prompt(tr("\u5C08\u6848\u540D\u7A31", "Project name"), "MyDesign")?.trim();
    if (!name) return;
    const p = blankProject(name);
    projects.push(p);
    switchProject(p.id);
  }
  function renameProject() {
    const name = prompt(tr("\u5C08\u6848\u540D\u7A31", "Project name"), projName(proj))?.trim();
    if (!name) return;
    proj.name = name;
    renderProjects();
    persist();
  }
  function deleteProject() {
    if (!confirm(tr(`\u522A\u9664\u5C08\u6848\u300C${projName(proj)}\u300D\uFF1F\uFF08\u5B58\u5728\u700F\u89BD\u5668\u88E1\u7684\u6A94\u6848\u6703\u4E00\u8D77\u522A\u6389\uFF09`, `Delete the project "${projName(proj)}"? (its files stored in the browser are deleted too)`))) return;
    projects = projects.filter((p) => p !== proj);
    if (!projects.length) projects.push(fromExample(examples().find((e) => e.id === "seq101") ?? examples()[0]));
    switchProject(projects[0].id);
  }
  function revertProject() {
    const ex = examples().find((e) => e.id === proj.from);
    if (!ex) {
      alert(tr("\u9019\u500B\u5C08\u6848\u4E0D\u662F\u5F9E\u7BC4\u4F8B\u958B\u7684", "This project was not opened from an example"));
      return;
    }
    if (!confirm(tr("\u6368\u68C4\u6240\u6709\u4FEE\u6539\uFF0C\u56DE\u5230\u7BC4\u4F8B\u539F\u59CB\u78BC\uFF1F", "Discard all changes and go back to the example's source?"))) return;
    proj.files = ex.files.map((f) => ({ ...f }));
    proj.synth = ex.synth;
    if (ex.pcf) proj.files.push({ name: PCF, src: ex.pcf });
    showActive();
    changed();
  }
  var labOf = (p) => ({ v: 1, name: projName(p), files: p.files, synth: p.synth, board: p.board, from: p.from });
  async function gz(data, compress) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  var b64url = (u) => {
    let s = "";
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  var unb64url = (s) => {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  };
  async function shareLab() {
    const code = b64url(await gz(JSON.stringify(labOf(proj)), true));
    const url = `${location.origin}${location.pathname}#lab=${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
    }
    prompt(tr(`\u5206\u4EAB\u9023\u7D50\uFF08${url.length} \u5B57\u5143\uFF0C\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F\uFF09\uFF1A\u958B\u555F\u5B83\u6703\u628A\u9019\u500B\u5BE6\u9A57\u532F\u5165\u6210\u65B0\u5C08\u6848`, `Share link (${url.length} characters, copied): opening it imports this lab as a new project`), url);
  }
  function exportLab() {
    saveAs(`${projName(proj).replace(/[^\w.-]+/g, "_") || "lab"}.lab.json`, JSON.stringify(labOf(proj), null, 1), "application/json");
  }
  function importLab(l, suffix) {
    if (!l || !Array.isArray(l.files)) throw new Error(tr("\u4E0D\u662F\u5BE6\u9A57\u6A94", "not a lab file"));
    const files = l.files.filter((f) => typeof f.name === "string" && typeof f.src === "string");
    const first = files.find((f) => f.name.endsWith(".veryl"))?.name ?? files[0]?.name;
    const p = { id: uid(), name: (l.name || "lab") + suffix, files, synth: l.synth, board: l.board, from: l.from, open: first ? [first] : [], active: first };
    projects.push(p);
    switchProject(p.id);
  }
  async function labFromHash(code) {
    try {
      const text = new TextDecoder().decode(await gz(unb64url(code), false));
      importLab(JSON.parse(text), tr("\uFF08\u5206\u4EAB\uFF09", " (shared)"));
    } catch (e) {
      alert(tr("\u7121\u6CD5\u958B\u555F\u5206\u4EAB\u7684\u5BE6\u9A57\uFF1A", "Cannot open the shared lab: ") + String(e.message ?? e));
    }
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
    }
  }
  function exportZip() {
    saveAs(
      `${projName(proj).replace(/[^\w.-]+/g, "_") || "project"}.zip`,
      projectZip(projName(proj), proj.files),
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
        h.textContent = exGroup(ex);
        box.appendChild(h);
      }
      const d = document.createElement("div");
      const opened = projects.some((p) => p.from === ex.id);
      d.className = "item";
      d.title = (ex.note ? exNote(ex) + "\n" : "") + ex.files.map((f) => f.name).join(", ");
      d.innerHTML = `<span class="ic">${opened ? "\u25CF" : "\u25CB"}</span><span class="nm">${esc4(exTitle(ex))}</span>`;
      d.onclick = () => {
        openExample(ex);
        renderExamples();
      };
      box.appendChild(d);
    }
  }
  function welcome() {
    const recent = projects.slice(-8).reverse();
    $2("welcome").innerHTML = `<h2>veryl2chip IDE</h2><p>${tr("Veryl \u2192 \u6A21\u64EC \u2192 \u5408\u6210 \u2192 FPGA / ASIC\uFF0C\u5168\u90E8\u5728\u700F\u89BD\u5668\u88E1\u3002", "Veryl \u2192 simulation \u2192 synthesis \u2192 FPGA / ASIC, all in the browser.")}</p>
    <div class="cols">
      <div><h3>${tr("\u958B\u59CB", "Start")}</h3><a data-a="newfile">${tr("\uFF0B \u65B0\u589E .veryl \u6A94", "\uFF0B New .veryl file")}</a><a data-a="newproj">${tr("\uFF0B \u65B0\u5C08\u6848", "\uFF0B New project")}</a><a data-a="examples">${tr("\u{1F4DA} \u958B\u555F\u7BC4\u4F8B\u2026", "\u{1F4DA} Open an example\u2026")}</a><a data-a="import">${tr("\u21EA \u532F\u5165 .veryl \u6A94\u2026", "\u21EA Import .veryl files\u2026")}</a><a href="${TUTORIAL}" target="_blank" rel="noopener">${tr("\u{1F4D6} \u5F9E\u96F6\u958B\u59CB\u7684\u6559\u5B78\uFF08\u5BEB Veryl \u2192 \u71D2\u9032 iCEBreaker\uFF09", "\u{1F4D6} Tutorial from scratch (write Veryl \u2192 flash an iCEBreaker)")}</a></div>
      <div><h3>${tr("\u6700\u8FD1\u7684\u5C08\u6848", "Recent projects")}</h3>${recent.map((p) => `<a data-p="${p.id}">${esc4(projName(p))}</a>`).join("")}</div>
      <div><h3>${tr("\u9019\u500B\u5C08\u6848", "This project")}</h3>${proj.files.map((f) => `<a data-f="${esc4(f.name)}">\u25C6 ${esc4(f.name)}</a>`).join("")}<a data-a="flow">${tr("\u2699 \u5408\u6210\u6D41\u7A0B", "\u2699 Synthesis flow")}</a></div>
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
      box.innerHTML = `<div class="none">${tr("\u6C92\u6709\u554F\u984C\u3002", "No problems.")}</div>`;
    }
    for (const p of problems) {
      const d = document.createElement("div");
      d.className = "prob " + p.severity;
      d.innerHTML = `<span class="sev">${p.severity === "error" ? "\u2297" : "\u26A0"}</span><span class="m">${esc4(p.msg)}</span>${p.file ? `<span class="loc">${esc4(p.file)} [${p.line}, ${p.col}]</span>` : ""}`;
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
    st.innerHTML = `<option value="">${tr("\u5168\u90E8 #[test]", "all #[test]")}</option>` + mods.map((m) => `<option value="${esc4(m.name)}">${esc4(m.name)}${m.test ? "  (test)" : ""}</option>`).join("");
    if (mods.some((m) => m.name === keep)) st.value = keep;
    const sy = $2("synthTop");
    const designs = mods.filter((m) => !m.test);
    const want = sy.value && designs.some((m) => m.name === sy.value) ? sy.value : designs.some((m) => m.name === proj.synth) ? proj.synth : designs[designs.length - 1]?.name ?? "";
    sy.innerHTML = designs.map((m) => `<option value="${esc4(m.name)}">${esc4(m.name)}</option>`).join("");
    sy.value = want;
    renderTests();
    renderOutline();
  }
  function renderTests() {
    const box = $2("testList");
    box.innerHTML = "";
    const tests = mods.filter((m) => m.test);
    if (!tests.length) {
      box.innerHTML = `<p class="side-hint">${tr("\u6C92\u6709 #[test] \u6A21\u7D44\u3002\u5728\u6A21\u7D44\u524D\u52A0\u4E0A <code>#[test(name)]</code>\uFF0C\u7528 <code>$tb::clock_gen</code>\u3001<code>$assert</code> \u5BEB testbench\u3002", "No #[test] modules. Put <code>#[test(name)]</code> before a module and write the testbench with <code>$tb::clock_gen</code> and <code>$assert</code>.")}</p>`;
      return;
    }
    for (const t of tests) {
      const s = testState.get(t.name);
      const d = document.createElement("div");
      d.className = "item " + (s ?? "");
      d.innerHTML = `<span class="ic">${s === "pass" ? "\u2713" : s === "fail" ? "\u2717" : s === "run" ? "\u2026" : "\u25CB"}</span><span class="nm">${esc4(t.name)}</span><span class="acts"><button class="icon" title="${tr("\u57F7\u884C", "Run")}">\u25B6</button></span>`;
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
  var KIND = (k) => ({ rtl: "RTL", opt: tr("\u901A\u7528\u9598", "generic gates"), ice40: "iCE40", asic: tr("\u6A19\u6E96\u5143\u4EF6", "standard cells") })[k] ?? k;
  async function simulate(top, mode, vcd) {
    const files = proj.files.filter((f) => f.name.endsWith(".veryl"));
    const gate = mode === "rtl" ? {} : { gate: mode, synth: synthTop() };
    if (mode !== "rtl" && !synthTop()) throw new Error(tr("\u6C92\u6709\u53EF\u5408\u6210\u7684\u6A21\u7D44\uFF08\u9598\u7D1A\u6A21\u64EC\u9700\u8981\u5408\u6210\u9802\u5C64\uFF09", "No synthesizable module (gate-level simulation needs a synthesis top)"));
    return core.call({ cmd: "simulate", files, top, max_time: 1e6, vcd, ...gate });
  }
  async function runTests(only) {
    if (!core) return;
    const top = only ?? ($2("simTop").value || null);
    const mode = $2("simMode").value;
    const names = top ? [top] : mods.filter((m) => m.test).map((m) => m.name);
    for (const n of names) testState.set(n, "run");
    renderTests();
    setBusy(true, tr(`\u25B6 \u6E2C\u8A66\u4E2D\uFF08${KIND(mode)}\uFF09\u2026`, `\u25B6 Testing (${KIND(mode)})\u2026`));
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
      const where = r.gate ? tr(`\u3000\u9598\u7D1A\uFF1A${r.gate.top} \u2192 ${r.gate.cells} \u500B${KIND(mode)}\u5143\u4EF6`, `\u3000gate level: ${r.gate.top} \u2192 ${r.gate.cells} ${KIND(mode)}`) : "";
      const msg = fails.length ? tr(`\u2717 ${fails.reduce((a, t) => a + t.fails, 0)} \u500B\u65B7\u8A00\u5931\u6557\uFF08${fails.map((t) => t.name).join(", ")}\uFF09`, `\u2717 ${fails.reduce((a, t) => a + t.fails, 0)} assertion(s) failed (${fails.map((t) => t.name).join(", ")})`) : tr(`\u2713 ${r.tops.length} \u500B\u6E2C\u8A66\u901A\u904E`, `\u2713 ${r.tops.length} test(s) passed`);
      $2("p-results").innerHTML = `<div class="banner ${fails.length ? "fail" : "pass"}">${esc4(msg + where)}</div><table><tr><th>testbench</th><th>${KIND(mode)}</th><th>${tr("\u7D50\u675F", "End")}</th></tr>${r.tops.map((t) => `<tr><td>${esc4(t.name)}</td><td class="${t.fails ? "fail" : "pass"}">${t.fails ? tr(`\u2717 ${t.fails} \u500B\u5931\u6557`, `\u2717 ${t.fails} failed`) : "\u2713 PASS"}</td><td>${t.finished ? "$finish" : tr("\u6642\u9593\u5230", "time limit")}</td></tr>`).join("")}</table>`;
      $2("sbTest").textContent = `${fails.length ? "\u2717" : "\u2713"} ${msg.slice(2)}\uFF08${((performance.now() - t0) / 1e3).toFixed(2)} s\uFF09`;
      for (const ln of r.log.split("\n")) if (/ASSERTION FAILED/.test(ln)) problems.push({ msg: ln.trim(), severity: "error", from: "run" });
      panel(fails.length ? "output" : "results");
    } catch (e) {
      for (const n of names) testState.delete(n);
      const errs = parseErrors(String(e.message ?? e), "run");
      problems.push(...errs);
      $2("p-output").textContent = String(e.message ?? e);
      $2("sbTest").textContent = tr("\u2717 \u932F\u8AA4", "\u2717 Error");
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
      alert(tr("\u6C92\u6709 #[test] \u6A21\u7D44\u53EF\u4EE5\u8DD1", "There are no #[test] modules to run"));
      return;
    }
    panel("results");
    const modes = synthTop() ? ["rtl", "opt", "ice40", "asic"] : ["rtl"];
    const res = /* @__PURE__ */ new Map();
    const cells = /* @__PURE__ */ new Map();
    const draw = (done) => {
      const rtl = res.get("rtl");
      let same = true;
      const rows = tests.map((t) => `<tr><td>${esc4(t)}</td>${modes.map((m) => {
        const v = res.get(m)?.get(t);
        if (v === void 0) return `<td class="na">${done ? "\u2014" : "\u2026"}</td>`;
        if (m !== "rtl" && rtl && v !== rtl.get(t)) same = false;
        return `<td class="${v === "0" ? "pass" : v === "err" ? "fail" : "fail"}">${v === "0" ? "\u2713" : v === "err" ? tr("\u932F\u8AA4", "error") : `\u2717 ${v}`}</td>`;
      }).join("")}</tr>`).join("");
      const allPass = [...res.values()].every((m) => [...m.values()].every((v) => v === "0"));
      $2("p-results").innerHTML = (done ? `<div class="banner ${allPass && same ? "pass" : "fail"}">${allPass && same ? tr(`\u2713 \u5168\u9762\u9A57\u8B49\u901A\u904E\uFF1A${tests.length} \u500B testbench \xD7 ${modes.length} \u7A2E\u5BE6\u4F5C\u7D50\u679C\u4E00\u81F4`, `\u2713 Full verification passed: ${tests.length} testbench(es) \xD7 ${modes.length} implementations agree`) : same ? tr("\u2717 \u6709\u6E2C\u8A66\u5931\u6557\uFF08\u5404\u5BE6\u4F5C\u7D50\u679C\u4E00\u81F4\uFF09", "\u2717 Tests fail (the same in every implementation)") : tr("\u2717 \u5408\u6210\u524D\u5F8C\u7D50\u679C\u4E0D\u4E00\u81F4\uFF01", "\u2717 Results before and after synthesis differ!")}</div>` : `<div class="banner">${tr("\u9A57\u8B49\u4E2D\u2026", "Verifying\u2026")}</div>`) + `<table><tr><th>testbench</th>${modes.map((m) => `<th>${KIND(m)}${cells.has(m) ? `<br><small>${tr(`${cells.get(m)} \u5143\u4EF6`, `${cells.get(m)} cells`)}</small>` : ""}</th>`).join("")}</tr>${rows}</table>` + (synthTop() ? `<p class="side-hint">${tr(`\u9598\u7D1A\uFF1A\u628A ${esc4(synthTop())} \u63DB\u6210\u5408\u6210\u5F8C\u7684\u7DB2\u8868\uFF0C\u8DD1\u540C\u4E00\u7D44 testbench\u3002`, `Gate level: ${esc4(synthTop())} is replaced by its synthesized netlist under the same testbenches.`)}</p>` : "");
    };
    setBusy(true, tr("\u2714 \u5168\u9762\u9A57\u8B49\u4E2D\u2026", "\u2714 Verifying\u2026"));
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
        problems.push(...parseErrors(`[${KIND(m)}] ` + String(e.message ?? e), "run"));
        renderProblems();
      }
      res.set(m, col);
    }
    draw(true);
    for (const t of tests) testState.set(t, res.get("rtl")?.get(t) === "0" ? "pass" : "fail");
    renderTests();
    $2("sbTest").textContent = tr(`\u2714 \u5168\u9762\u9A57\u8B49 ${((performance.now() - t0) / 1e3).toFixed(1)} s`, `\u2714 Full verification ${((performance.now() - t0) / 1e3).toFixed(1)} s`);
    setBusy(false);
  }
  function fillWaveTops() {
    const sel = $2("waveTop");
    sel.innerHTML = vcds.map((v) => `<option>${esc4(v.top)}</option>`).join("");
    sel.classList.toggle("hidden", vcds.length < 2 || curPanel !== "wave");
  }
  function runSynth(stage) {
    if (!synth) return;
    const top = synthTop();
    if (!top) {
      alert(tr("\u6C92\u6709\u53EF\u5408\u6210\u7684\u6A21\u7D44\uFF08#[test] \u6A21\u7D44\u4E0D\u80FD\u5408\u6210\uFF09", "No synthesizable module (#[test] modules cannot be synthesized)"));
      return;
    }
    const files = proj.files.filter((f) => f.name.endsWith(".veryl"));
    const key = JSON.stringify([files, top, pcfOf(proj)]);
    openFile(FLOW_TAB);
    if (window.innerHeight < 900) $2("panel").classList.add("collapsed");
    if (key !== synthKey || !synth.synthesized) {
      synthKey = key;
      const target = stage && isAsicStage(stage) ? "asic" : stage && isFpgaStage(stage) ? "fpga" : void 0;
      synth.open(files, top, pcfOf(proj), target ?? $2("flowTarget").value, stage);
    } else if (stage) synth.showStage(stage);
    sideView("flow");
  }
  function renderFlow(cur2) {
    const asic = $2("flowTarget").value === "asic";
    const box = $2("flowList");
    box.innerHTML = "";
    for (const [k, label, tag] of [...flow(asic), ["cmp", tr("\u21C4 FPGA vs ASIC \u6BD4\u8F03", "\u21C4 FPGA vs ASIC"), "cmp"]]) {
      const d = document.createElement("div");
      d.className = "item" + (k === cur2 ? " cur" : "") + (tag === "fpga" ? " stage-fpga" : tag === "asic" ? " stage-asic" : "");
      d.innerHTML = `<span class="ic">${k === "cmp" ? "\u21C4" : tag === "common" ? "\u25C7" : "\u25C6"}</span><span class="nm">${esc4(label.replace(/^(共|C|F|A) /, ""))}</span><span class="tag">${tag === "common" ? tr("\u5171\u7528", "common") : tag === "fpga" ? "FPGA" : tag === "asic" ? "ASIC" : ""}</span>`;
      d.onclick = () => runSynth(k);
      box.appendChild(d);
    }
  }
  var board = null;
  var boardWasRunning = false;
  var boardCore = null;
  function getBoardCore() {
    return boardCore ?? (boardCore = startCore(fromBase64(VERYL_WASM_B64)));
  }
  function ensureBoard() {
    if (board) return board;
    board = new VirtualBoard($2("boardPane"), getBoardCore);
    board.flashButton.onclick = () => flashBoard();
    board.onSetup = (s) => {
      proj.board = s;
      persist();
    };
    board.onPins = (text) => {
      const f = proj.files.find((x) => x.name.endsWith(".pcf"));
      if (f) f.src = text;
      else proj.files.push({ name: PCF, src: text });
      changed();
      flashBoard();
    };
    board.onLoaded = (info) => {
      problems = problems.filter((p) => p.from !== "run");
      for (const w of info.warnings) problems.push({ msg: tr("\u865B\u64EC\u677F\uFF1A", "Virtual board: ") + w, severity: "warning", from: "run" });
      renderProblems();
    };
    return board;
  }
  async function flashBoard() {
    const top = synthTop();
    if (!top) {
      alert(tr("\u6C92\u6709\u53EF\u5408\u6210\u7684\u6A21\u7D44\uFF08#[test] \u6A21\u7D44\u4E0D\u80FD\u71D2\u9304\uFF09", "No synthesizable module (#[test] modules cannot be flashed)"));
      return;
    }
    ensureBoard();
    board.setSetup(proj.board ?? examples().find((e) => e.id === proj.from)?.board ?? DEFAULT_SETUP);
    openFile(BOARD_TAB);
    if (window.innerHeight < 900) $2("panel").classList.add("collapsed");
    setBusy(true, tr("\u26A1 \u71D2\u9304\u5230\u865B\u64EC\u677F\u2026", "\u26A1 Flashing the virtual board\u2026"));
    try {
      const info = await board.flash(proj.files.filter((f) => f.name.endsWith(".veryl")), top, pcfOf(proj));
      $2("sbTest").textContent = tr(`\u26A1 ${info.top} \u5DF2\u71D2\u9304\u5230\u865B\u64EC\u677F`, `\u26A1 ${info.top} flashed to the virtual board`);
      problems = problems.filter((p) => p.from !== "run");
      for (const w of info.warnings) problems.push({ msg: tr("\u865B\u64EC\u677F\uFF1A", "Virtual board: ") + w, severity: "warning", from: "run" });
    } catch (e) {
      problems = problems.filter((p) => p.from !== "run");
      problems.push(...parseErrors(String(e.message ?? e), "run"));
      $2("sbTest").textContent = tr("\u2717 \u71D2\u9304\u5931\u6557", "\u2717 Flashing failed");
      panel("problems");
    }
    setBusy(false);
    renderProblems();
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
    const cur2 = $2("activity").querySelector(`button[data-view="${v}"]`);
    const already = cur2?.classList.contains("cur") && !$2("sidebar").classList.contains("hidden");
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
      { label: tr("\u57F7\u884C\u6E2C\u8A66", "Run tests"), key: "Ctrl+Enter", run: () => runTests() },
      { label: tr("\u5168\u9762\u9A57\u8B49\uFF08RTL + \u4E09\u7A2E\u9598\u7D1A\u7DB2\u8868\uFF09", "Full verification (RTL + three gate-level netlists)"), run: verifyAll },
      { label: tr("\u5408\u6210\u4E26\u6AA2\u8996\u6D41\u7A0B", "Synthesize and view the flow"), key: "Ctrl+Shift+B", run: () => runSynth() },
      ...[...flow(false).slice(3), ...flow(true).slice(3), ...flow(false).slice(0, 3)].map(([k, l]) => ({ label: `${tr("\u6D41\u7A0B\uFF1A", "Flow: ")}${l}`, run: () => runSynth(k) })),
      { label: tr("\u6D41\u7A0B\uFF1A\u21C4 FPGA vs ASIC \u6BD4\u8F03", "Flow: \u21C4 FPGA vs ASIC"), run: () => runSynth("cmp") },
      { label: tr("\u26A1 \u71D2\u9304\u5230\u865B\u64EC\u677F", "\u26A1 Flash to the virtual board"), run: flashBoard },
      { label: tr("\u65B0\u589E\u6A94\u6848", "New file"), run: newFile },
      { label: tr("\u65B0\u5C08\u6848", "New project"), run: newProject },
      { label: tr("\u532F\u5165 .veryl \u6A94", "Import .veryl files"), run: () => $2("importIn").click() },
      { label: tr("\u4E0B\u8F09\u5C08\u6848 .zip", "Download the project .zip"), run: exportZip },
      { label: tr("\u{1F517} \u5206\u4EAB\u5BE6\u9A57\uFF08\u7522\u751F\u9023\u7D50\uFF09", "\u{1F517} Share the lab (link)"), run: shareLab },
      { label: tr("\u532F\u51FA\u5BE6\u9A57\u6A94 .lab.json", "Export the lab .lab.json"), run: exportLab },
      { label: tr("\u91CD\u65B0\u547D\u540D\u5C08\u6848", "Rename project"), run: renameProject },
      { label: tr("\u9084\u539F\u6210\u7BC4\u4F8B\u539F\u59CB\u78BC", "Revert to the example source"), run: revertProject },
      { label: tr("\u522A\u9664\u5C08\u6848", "Delete project"), run: deleteProject },
      { label: tr("\u5207\u63DB\u9762\u677F", "Toggle panel"), key: "Ctrl+J", run: () => $2("panel").classList.toggle("collapsed") },
      { label: tr("\u986F\u793A\uFF1A\u554F\u984C", "View: Problems"), run: () => panel("problems") },
      { label: tr("\u986F\u793A\uFF1A\u8F38\u51FA", "View: Output"), run: () => panel("output") },
      { label: tr("\u986F\u793A\uFF1A\u6CE2\u5F62", "View: Waveform"), run: () => panel("wave") },
      { label: tr("\u6B61\u8FCE\u9801", "Welcome page"), run: () => openFile(WELCOME) },
      ...LANGS.map(([l, name]) => ({ label: `${tr("\u4ECB\u9762\u8A9E\u8A00\uFF1A", "Language: ")}${name}`, run: () => switchLang(l) })),
      ...projects.filter((p) => p !== proj).map((p) => ({ label: `${tr("\u5207\u63DB\u5C08\u6848\uFF1A", "Switch project: ")}${projName(p)}`, run: () => switchProject(p.id) })),
      ...examples().map((e) => ({ label: `${tr("\u958B\u555F\u7BC4\u4F8B\uFF1A", "Open example: ")}${exTitle(e)}`, run: () => openExample(e) }))
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
      ...proj.files.map((f) => ({ label: f.name, key: tr("\u6A94\u6848", "file"), run: () => openFile(f.name) })),
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
      d.innerHTML = `<span>${esc4(c.label)}</span>${c.key ? `<span class="k">${esc4(c.key)}</span>` : ""}`;
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
      $2("sbTest").textContent = tr("\u5DF2\u5132\u5B58\uFF08\u5728\u700F\u89BD\u5668\uFF09", "Saved (in the browser)");
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
      $2("sbPos").textContent = tr(`\u884C ${l}\uFF0C\u6B04 ${c}`, `Ln ${l}, Col ${c}`);
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
    $2("cmdBoard").onclick = () => flashBoard();
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
    $2("projShare").onclick = () => shareLab();
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
  function initLang() {
    const saved = load("lang", "");
    setLang(LANGS.some(([l]) => l === saved) ? saved : fromLocale(navigator.language));
    translateDom(document.body);
    const sel = $2("langSel");
    sel.innerHTML = LANGS.map(([l, name]) => `<option value="${l}">${name}</option>`).join("");
    sel.value = LANGS.find(([l]) => l === load("lang", ""))?.[0] ?? fromLocale(navigator.language);
    sel.onchange = () => switchLang(sel.value);
  }
  function switchLang(l) {
    clearTimeout(saveTimer);
    save("projects", projects);
    save("cur", proj.id);
    save("lang", l);
    location.reload();
  }
  async function boot() {
    for (const p of projects) migratePcf(p);
    initLang();
    wire();
    const hash = location.hash;
    const exId = /ex=([\w-]+)/.exec(hash)?.[1];
    const labCode = /lab=([\w-]+)/.exec(hash)?.[1];
    if (!projects.length) projects.push(fromExample(examples().find((e) => e.id === (exId ?? "tut_blinky")) ?? examples()[0]));
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
    if (proj.active === FLOW_TAB || proj.active === BOARD_TAB) proj.active = void 0;
    proj.open = openTabs().filter((n) => n === WELCOME || file(n));
    renderProjects();
    renderFlow();
    showActive();
    renderProblems();
    demoLink();
    if (labCode) await labFromHash(labCode);
    try {
      const t0 = performance.now();
      core = await startCore(fromBase64(VERYL_WASM_B64));
      $2("sbCore").textContent = `\u2713 WebAssembly ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? tr("\uFF08\u80CC\u666F\u57F7\u884C\u7DD2\uFF09", " (worker thread)") : ""}`;
      for (const id of ["cmdRun", "cmdVerify", "cmdSynth", "cmdBoard"]) $2(id).disabled = false;
      synth = new SynthOverlay(core, {
        embedded: true,
        onStage: (k) => {
          if (isAsicStage(k)) $2("flowTarget").value = "asic";
          else if (isFpgaStage(k)) $2("flowTarget").value = "fpga";
          renderFlow(k);
        }
      });
      await check();
      const st = /stage=(\w+)/.exec(hash)?.[1];
      if (st) runSynth(st);
      if (/[#&]run=1/.test(hash)) runTests();
      if (/[#&]verify=1/.test(hash)) verifyAll();
      if (/[#&]board=1/.test(hash)) flashBoard();
    } catch (e) {
      $2("sbCore").textContent = tr("\u2717 WebAssembly \u8F09\u5165\u5931\u6557", "\u2717 WebAssembly failed to load");
      $2("statusbar").classList.add("bad");
      problems.push({ msg: String(e), severity: "error", from: "run" });
      renderProblems();
    }
  }
  boot();
})();
