/* Konvertin: logika halaman tool dokumen. JS polos, tanpa framework.
   Semua teks tampilan ada di objek T (satu bahasa dulu: id) supaya mudah ditambah bahasa lain. */
(function () {
  "use strict";

  var T = {
    id: {
      size_limit: "Maks {mb} MB per file, {n} file per proses.",
      too_many: "Maksimal {n} file sekali proses. Sisanya diabaikan.",
      too_big: "Lebih besar dari {mb} MB.",
      wrong_ext: "Tipe file tidak cocok untuk konversi ini.",
      uploading: "Mengunggah {p}%",
      queued: "Antre…",
      processing: "Memproses…",
      done: "Selesai",
      failed: "Gagal",
      cancelled: "Dibatalkan.",
      net_error: "Koneksi ke server putus. Cek internet lalu coba lagi.",
      cancel: "Batalkan",
      remove: "Hapus",
      download: "Unduh",
      retry: "Coba lagi",
      suggest: "Isi file ini {kind}. Pakai: ",
      zip_name: "konvertin-hasil.zip",
      convert: "Konversi",
      convert_n: "Konversi {n} file",
      server_busy: "Server sedang sibuk. Coba lagi sebentar lagi."
    }
  };
  var LANG = "id";
  function t(key, vars) {
    var s = (T[LANG] && T[LANG][key]) || key;
    for (var k in vars || {}) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }

  var API = (document.querySelector('meta[name="konvertin-api"]') || {}).content || "";
  var MAX_FILES = 10, MAX_MB = 25, CONCURRENCY = 2;

  // ---------- util ----------
  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- beranda: pencarian tool + Ctrl+K ----------
  var search = document.getElementById("tool-search");
  if (search) {
    var cards = [].slice.call(document.querySelectorAll("[data-tool]"));
    var cats = [].slice.call(document.querySelectorAll(".cat"));
    var empty = document.getElementById("search-empty");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase(), shown = 0;
      cards.forEach(function (c) {
        var ok = !q || c.getAttribute("data-tool").toLowerCase().indexOf(q) > -1;
        c.classList.toggle("hidden", !ok);
        if (ok) shown++;
      });
      cats.forEach(function (c) { c.classList.toggle("hidden", !c.querySelector("[data-tool]:not(.hidden)")); });
      if (empty) empty.style.display = shown ? "none" : "block";
    });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.focus(); search.select(); }
    });
  }

  // ---------- ZIP (store, tanpa kompresi) untuk unduh banyak hasil ----------
  var crcTable = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { var c = 0xffffffff; for (var i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(entries) { // entries: [{name, data:Uint8Array}]
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    entries.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
      parts.push(h.buffer, name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + sz;
    });
    var csize = central.reduce(function (a, p) { return a + (p.byteLength || p.length); }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" });
  }
  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---------- halaman tool ----------
  var root = document.getElementById("tool");
  if (!root || !root.hasAttribute("data-type")) return;
  var JOB_TYPE = root.getAttribute("data-type");
  var ACCEPT = (root.getAttribute("data-accept") || "").split(",");
  var drop = document.getElementById("dropzone");
  var input = document.getElementById("file-input");
  var list = document.getElementById("files");
  var goBtn = document.getElementById("go");
  var zipBtn = document.getElementById("zip");
  var clearBtn = document.getElementById("clear");
  var items = [];
  var running = 0, seq = 0;

  document.getElementById("limit-info").textContent = t("size_limit", { mb: MAX_MB, n: MAX_FILES });

  function extOk(name) { var m = /\.([^.]+)$/.exec(name.toLowerCase()); return !!m && ACCEPT.indexOf("." + m[1]) > -1; }

  function addFiles(fileList) {
    var arr = [].slice.call(fileList);
    if (items.length + arr.length > MAX_FILES) { alert(t("too_many", { n: MAX_FILES })); arr = arr.slice(0, MAX_FILES - items.length); }
    arr.forEach(function (f) {
      var it = { id: ++seq, file: f, status: "ready", dom: {}, result: null };
      if (f.size > MAX_MB * 1048576) { it.status = "failed"; it.msg = t("too_big", { mb: MAX_MB }); }
      items.push(it); render(it);
      if (!extOk(f.name) && it.status === "ready") suggestTool(it);
    });
    refresh();
  }

  // Deteksi dari isi file (magic bytes di server) lalu tawarkan tool yang benar
  function suggestTool(it) {
    var fd = new FormData(); fd.append("file", it.file);
    fetch(API + "/api/detect", { method: "POST", body: fd }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok && r.j.kind && root.getAttribute("data-kind") !== r.j.kind) {
          fail(it, t("wrong_ext"));
          var s = it.dom.state; s.appendChild(document.createTextNode(" " + t("suggest", { kind: r.j.label })));
          (window.KONVERTIN_TOOLS || []).filter(function (x) { return x.kind === r.j.kind; }).forEach(function (x, i) {
            if (i) s.appendChild(document.createTextNode(", "));
            var a = el("a", null, x.title); a.href = x.href; s.appendChild(a);
          });
        } else if (r.ok) { it.status = "ready"; render(it); refresh(); } else { fail(it, r.j.error || t("wrong_ext")); }
      }).catch(function () { fail(it, t("net_error")); });
    it.status = "checking"; render(it);
  }

  function render(it) {
    var d = it.dom;
    if (!d.li) {
      d.li = el("li", "file");
      d.name = el("div", "name", it.file.name);
      var right = el("div", "meta"); d.size = el("span", null, fmtSize(it.file.size));
      d.btn = el("button", "btn ghost sm"); d.btn.type = "button";
      right.appendChild(d.size); right.appendChild(document.createTextNode(" ")); right.appendChild(d.btn);
      d.state = el("div", "state"); d.state.setAttribute("role", "status");
      d.bar = el("div", "bar"); d.fill = el("i"); d.bar.appendChild(d.fill);
      d.li.appendChild(d.name); d.li.appendChild(right); d.li.appendChild(d.state); d.li.appendChild(d.bar);
      d.btn.addEventListener("click", function () { if (isActive(it)) cancel(it); else remove(it); });
      list.appendChild(d.li);
    }
    d.li.className = "file " + (it.status === "done" ? "done" : it.status === "failed" ? "failed" : "");
    d.btn.textContent = isActive(it) ? t("cancel") : t("remove");
    d.btn.setAttribute("aria-label", d.btn.textContent + " " + it.file.name);
    if (it.status === "done" && !d.dl) {
      d.dl = el("a", "btn sm", t("download")); d.dl.setAttribute("download", "");
      d.btn.parentNode.insertBefore(d.dl, d.btn);
    }
    if (d.dl && it.result) { d.dl.href = API + it.result.download_url; d.dl.setAttribute("download", it.result.download_name); }
  }
  function isActive(it) { return it.status === "uploading" || it.status === "queued" || it.status === "processing"; }
  function setState(it, text, pct) { it.dom.state.textContent = text; if (pct != null) it.dom.fill.style.width = pct + "%"; }
  function fail(it, msg) { it.status = "failed"; it.msg = msg; setState(it, t("failed") + ": " + msg, 100); render(it); refresh(); }
  function remove(it) { items = items.filter(function (x) { return x !== it; }); it.dom.li.remove(); refresh(); }

  function cancel(it) {
    if (it.xhr) it.xhr.abort();
    if (it.jobId) fetch(API + "/api/jobs/" + it.jobId, { method: "DELETE" }).catch(function () {});
    it.cancelled = true; if (it.timer) clearTimeout(it.timer);
    it.status = "failed"; setState(it, t("cancelled"), 0); render(it); running = Math.max(0, running - 1); refresh(); pump();
  }

  function start(it) {
    running++; it.status = "uploading"; it.cancelled = false; render(it); setState(it, t("uploading", { p: 0 }), 0);
    var fd = new FormData(); fd.append("file", it.file); fd.append("type", JOB_TYPE);
    var x = new XMLHttpRequest(); it.xhr = x;
    x.open("POST", API + "/api/jobs");
    x.upload.onprogress = function (e) { if (e.lengthComputable) { var p = Math.round(e.loaded / e.total * 100); setState(it, t("uploading", { p: p }), p * 0.3); } };
    x.onerror = function () { if (!it.cancelled) { running--; fail(it, t("net_error")); pump(); } };
    x.onload = function () {
      if (it.cancelled) return;
      var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status !== 202) { running--; fail(it, j.error || t("server_busy")); pump(); return; }
      it.jobId = j.job_id; it.status = "queued"; setState(it, t("queued"), 35); render(it); poll(it);
    };
    x.send(fd);
  }

  function poll(it) {
    if (it.cancelled) return;
    fetch(API + "/api/jobs/" + it.jobId).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) {
      if (it.cancelled) return;
      if (!r.ok) { running--; fail(it, r.j.error || t("server_busy")); pump(); return; }
      var j = r.j;
      if (j.status === "done") { running--; it.status = "done"; it.result = j; setState(it, t("done"), 100); render(it); refresh(); pump(); }
      else if (j.status === "failed") { running--; fail(it, j.error || t("server_busy")); pump(); }
      else { it.status = j.status; setState(it, t(j.status), j.status === "queued" ? 35 : 65); render(it); it.timer = setTimeout(function () { poll(it); }, 900); }
    }).catch(function () { it.timer = setTimeout(function () { poll(it); }, 2000); });
  }

  function pump() {
    items.forEach(function (it) { if (it.status === "queuedLocal" && running < CONCURRENCY) start(it); });
    refresh();
  }

  function refresh() {
    var ready = items.filter(function (i) { return i.status === "ready"; }).length;
    var done = items.filter(function (i) { return i.status === "done"; });
    var busy = items.some(function (i) { return i.status === "queuedLocal" || isActive(i); });
    goBtn.disabled = !ready;
    goBtn.textContent = ready > 1 ? t("convert_n", { n: ready }) : t("convert");
    zipBtn.classList.toggle("hidden", done.length < 2);
    clearBtn.classList.toggle("hidden", !items.length || busy);
  }

  goBtn.addEventListener("click", function () {
    items.forEach(function (it) {
      if (it.status === "ready") { it.status = "queuedLocal"; setState(it, t("queued"), 0); render(it); }
    });
    pump();
  });
  clearBtn.addEventListener("click", function () { items.slice().forEach(remove); input.value = ""; });
  zipBtn.addEventListener("click", function () {
    zipBtn.disabled = true;
    var used = {};
    Promise.all(items.filter(function (i) { return i.status === "done"; }).map(function (it) {
      return fetch(API + it.result.download_url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var n = it.result.download_name; if (used[n]) { n = n.replace(/(\.[^.]+)$/, " (" + used[n] + ")$1"); } used[it.result.download_name] = (used[it.result.download_name] || 0) + 1;
        return { name: n, data: new Uint8Array(buf) };
      });
    })).then(function (entries) { saveBlob(makeZip(entries), t("zip_name")); }).catch(function () { alert(t("net_error")); }).then(function () { zipBtn.disabled = false; });
  });

  input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  refresh();
})();
