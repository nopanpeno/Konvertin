/* Konvertin: satu file JS untuk semua halaman. Tanpa framework.
   Teks antarmuka ada di objek TEXT supaya bahasa lain mudah ditambah. */
(function () {
  "use strict";

  var CFG = window.KONVERTIN || { apiBase: "", ads: false, ffmpegCoreBase: "" };

  // ---------- teks (id = Bahasa Indonesia) ----------
  var TEXT = {
    id: {
      ready: "siap",
      working: "proses",
      done: "selesai",
      error: "gagal",
      remove: "Hapus",
      download: "Unduh",
      cancelled: "Dibatalkan.",
      tooMany: "Maksimal {n} file sekaligus. Sisanya diabaikan.",
      tooBig: "File terlalu besar: {size}. Batas untuk tool ini {max}.",
      wrongType: "Tipe file tidak cocok. Tool ini menerima {types}. Isi file kamu terbaca sebagai {got}.",
      unknownType: "Isi file tidak dikenali. File mungkin rusak, atau formatnya tidak didukung tool ini.",
      imgDecode: "Gambar tidak bisa dibuka. File mungkin rusak.",
      heicFail: "Foto HEIC tidak bisa dibaca. File mungkin rusak atau memakai varian HEIC yang belum didukung.",
      webpUnsupported: "Browser kamu belum bisa membuat WEBP. Pilih JPG atau PNG, atau pakai browser yang lebih baru.",
      audioTooLong: "Audio berdurasi {min} menit. Batas gratis 10 menit.",
      audioFail: "Audio tidak bisa diproses. File mungkin rusak atau memakai codec yang belum didukung.",
      ffmpegLoad: "Pemuat audio gagal diunduh. Cek koneksi internet lalu coba lagi.",
      loadingEngine: "Mengunduh pemuat audio (sekitar 30 MB, sekali saja)...",
      targetMiss: "Target {t} KB belum tercapai. Hasil terkecil yang bisa dibuat {size}.",
      alreadySmall: "Sudah optimal, file asli dikembalikan.",
      saved: "hemat {p}%",
      bigger: "lebih besar {p}%",
      uploading: "Mengunggah...",
      queued: "Antre di server...",
      processing: "Memproses di server...",
      serverDown: "Server tidak bisa dihubungi. Coba lagi sebentar lagi.",
      serverTimeout: "Proses terlalu lama dan dihentikan. Coba file yang lebih kecil.",
      rateLimit: "Terlalu banyak proses dari alamat kamu. Coba lagi dalam beberapa menit.",
      sumDone: "{n} file selesai.",
      sumSaved: "Total {before} jadi {after}, hemat {p}%.",
      zipName: "konvertin-hasil.zip",
      generic: "Terjadi kesalahan saat memproses file ini. Coba lagi, atau coba file lain.",
      noMatch: "Tidak ada tool yang cocok. Coba kata lain, misalnya nama format."
    }
  };
  var LANG = "id";
  function t(key, vars) {
    var s = (TEXT[LANG] && TEXT[LANG][key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
    return s;
  }

  // ---------- util ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + " MB";
  }
  function baseName(name) { var i = name.lastIndexOf("."); return i > 0 ? name.slice(0, i) : name; }
  function extOf(name) { var i = name.lastIndexOf("."); return i >= 0 ? name.slice(i + 1).toLowerCase() : ""; }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("script " + src)); };
      document.head.appendChild(s);
    });
  }
  function KError(msg) { var e = new Error(msg); e.user = true; return e; }

  // ---------- beranda: cari tool ----------
  function initHome() {
    var q = $("#q");
    if (!q) return;
    var items = $$("[data-search]");
    function run() {
      var v = q.value.trim().toLowerCase(), shown = 0;
      items.forEach(function (li) {
        var m = !v || li.getAttribute("data-search").indexOf(v) !== -1;
        li.style.display = m ? "" : "none";
        if (m) shown++;
      });
      $$(".cat").forEach(function (c) {
        var any = $$("[data-search]", c).some(function (li) { return li.style.display !== "none"; });
        c.style.display = any ? "" : "none";
      });
      $("#empty").style.display = shown ? "none" : "block";
    }
    q.addEventListener("input", run);
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        q.focus(); q.select();
        q.scrollIntoView({ block: "center" });
      }
    });
  }

  // ---------- deteksi tipe lewat magic bytes ----------
  function sniff(file) {
    return file.slice(0, 16).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      function at(i, str) { for (var k = 0; k < str.length; k++) if (b[i + k] !== str.charCodeAt(k)) return false; return true; }
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
      if (b[0] === 0x89 && at(1, "PNG")) return "png";
      if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
      if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
      if (at(0, "%PDF")) return "pdf";
      if (at(0, "OggS")) return "ogg";
      if (at(0, "fLaC")) return "flac";
      if (at(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) {
        return (b[1] === 0xf1 || b[1] === 0xf9) ? "aac" : "mp3";
      }
      if (at(4, "ftyp")) {
        var brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
        if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|heif)/.test(brand)) return "heic";
        return "m4a"; // M4A, MP4, isom, dll
      }
      if (b[0] === 0x50 && b[1] === 0x4b) return "zip"; // docx, pptx, xlsx
      if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole"; // terenkripsi atau format lama
      return "";
    });
  }
  var KIND_LABEL = { jpg: "JPG", png: "PNG", webp: "WEBP", heic: "HEIC", wav: "WAV", pdf: "PDF", ogg: "OGG", flac: "FLAC", mp3: "MP3", aac: "AAC", m4a: "M4A", zip: "dokumen Office", ole: "dokumen lama atau terenkripsi" };
  function allowedKinds(accept) {
    var out = {};
    accept.split(",").forEach(function (e) {
      e = e.replace(".", "");
      var map = { jpeg: "jpg", heif: "heic", docx: "zip", pptx: "zip", xlsx: "zip", aac: "aac" };
      out[map[e] || e] = true;
      if (e === "m4a" || e === "aac") { out.m4a = true; out.aac = true; }
    });
    return out;
  }

  // ---------- gambar ----------
  var IMG_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

  function loadHeic() {
    return window.heic2any ? Promise.resolve() : loadScript("/vendor/heic2any.min.js");
  }
  function heicToBlob(file, type, quality) {
    return loadHeic().then(function () {
      return window.heic2any({ blob: file, toType: type, quality: quality });
    }).then(function (r) { return Array.isArray(r) ? r[0] : r; })
      .catch(function () { throw KError(t("heicFail")); });
  }
  function decodeImage(file, kind) {
    var p = kind === "heic" ? heicToBlob(file, "image/png", 1) : Promise.resolve(file);
    return p.then(function (blob) {
      return createImageBitmap(blob);
    }).catch(function (e) {
      if (e && e.user) throw e;
      throw KError(t("imgDecode"));
    });
  }
  function drawToCanvas(bmp, w, h, opaque) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (opaque) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    return c;
  }
  function canvasBlob(c, type, q) {
    return new Promise(function (res, rej) {
      c.toBlob(function (b) {
        if (!b) return rej(KError(t("imgDecode")));
        if (b.type !== type) return rej(KError(type === "image/webp" ? t("webpUnsupported") : t("imgDecode")));
        res(b);
      }, type, q);
    });
  }
  function encode(bmp, fmt, quality, scale, w, h) {
    var W = w || Math.max(1, Math.round(bmp.width * scale));
    var H = h || Math.max(1, Math.round(bmp.height * scale));
    var c = drawToCanvas(bmp, W, H, fmt === "jpg");
    return canvasBlob(c, IMG_MIME[fmt], fmt === "png" ? undefined : quality);
  }

  // cari hasil <= target (byte): turunkan kualitas dulu, lalu resolusi
  function encodeToTarget(bmp, fmt, targetBytes) {
    var scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2];
    var best = null, i = 0;
    function track(b) { if (!best || b.size < best.size) best = b; return b; }
    function nextScale() {
      if (i >= scales.length) return Promise.resolve({ blob: best, hit: false });
      var s = scales[i++];
      if (fmt === "png") {
        return encode(bmp, fmt, 1, s).then(track).then(function (b) { return b.size <= targetBytes ? { blob: b, hit: true } : nextScale(); });
      }
      return encode(bmp, fmt, 0.05, s).then(track).then(function (low) {
        if (low.size > targetBytes) return nextScale();
        var lo = 0.05, hi = 0.95, good = low, n = 0;
        function step() {
          if (n++ >= 7) return { blob: good, hit: true };
          var mid = (lo + hi) / 2;
          return encode(bmp, fmt, mid, s).then(function (b) {
            if (b.size <= targetBytes) { good = b; lo = mid; } else hi = mid;
            return step();
          });
        }
        return Promise.resolve(step());
      });
    }
    return nextScale();
  }

  function outFmtFor(kind) { return kind === "jpg" ? "jpg" : kind === "png" ? "png" : "webp"; }

  var imageOps = {
    "image-convert": function (item, o, ctx) {
      var fmt = o.format;
      var direct = item.kind === "heic" && fmt === "jpg";
      if (direct) {
        ctx.progress(0.2);
        return heicToBlob(item.file, "image/jpeg", o.quality / 100).then(function (b) {
          return { blob: b, name: baseName(item.file.name) + ".jpg" };
        });
      }
      return decodeImage(item.file, item.kind).then(function (bmp) {
        ctx.progress(0.5);
        return encode(bmp, fmt, o.quality / 100, 1).then(function (b) {
          return { blob: b, name: baseName(item.file.name) + "." + fmt };
        });
      });
    },
    "image-resize": function (item, o, ctx) {
      return decodeImage(item.file, item.kind).then(function (bmp) {
        var W = o.w, H = o.h, w, h;
        if (!W && !H) throw KError("Isi lebar atau tinggi dulu.");
        if (W && H) { var r = Math.min(W / bmp.width, H / bmp.height); w = Math.round(bmp.width * r); h = Math.round(bmp.height * r); }
        else if (W) { w = W; h = Math.round(bmp.height * W / bmp.width); }
        else { h = H; w = Math.round(bmp.width * H / bmp.height); }
        w = Math.max(1, Math.min(w, 10000)); h = Math.max(1, Math.min(h, 10000));
        ctx.progress(0.5);
        return encode(bmp, o.format, o.quality / 100, 1, w, h).then(function (b) {
          return { blob: b, name: baseName(item.file.name) + "-" + w + "x" + h + "." + o.format };
        });
      });
    },
    "image-compress": function (item, o, ctx) {
      var fmt = outFmtFor(item.kind);
      return decodeImage(item.file, item.kind).then(function (bmp) {
        ctx.progress(0.4);
        var p;
        if (o.targetKB) {
          p = encodeToTarget(bmp, fmt, o.targetKB * 1024);
        } else {
          p = encode(bmp, fmt, o.quality / 100, 1).then(function (b) { return { blob: b, hit: true }; });
        }
        return p.then(function (r) {
          var out = { name: baseName(item.file.name) + "-kompres." + (fmt), compare: true };
          if (!o.targetKB && r.blob.size >= item.file.size) {
            out.blob = item.file; out.name = item.file.name; out.note = t("alreadySmall");
          } else {
            out.blob = r.blob;
            if (o.targetKB && !r.hit) out.note = t("targetMiss", { t: o.targetKB, size: fmtSize(r.blob.size) });
          }
          return out;
        });
      });
    }
  };

  // ---------- audio (ffmpeg.wasm) ----------
  var ffState = { ff: null, loading: null, onProgress: null };
  function getFFmpeg(notify) {
    if (ffState.ff) return Promise.resolve(ffState.ff);
    if (ffState.loading) return ffState.loading;
    notify(t("loadingEngine"));
    ffState.loading = loadScript("/vendor/ffmpeg-util.js")
      .then(function () { return loadScript("/vendor/ffmpeg.js"); })
      .then(function () {
        var base = CFG.ffmpegCoreBase;
        return Promise.all([
          window.FFmpegUtil.toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
          window.FFmpegUtil.toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
        ]);
      })
      .then(function (urls) {
        var ff = new window.FFmpegWASM.FFmpeg();
        ff.on("progress", function (e) { if (ffState.onProgress) ffState.onProgress(Math.min(1, Math.max(0, e.progress))); });
        return ff.load({ coreURL: urls[0], wasmURL: urls[1] }).then(function () { ffState.ff = ff; return ff; });
      })
      .catch(function (e) { ffState.loading = null; console.error(e); throw KError(t("ffmpegLoad")); });
    return ffState.loading;
  }
  function audioDuration(file) {
    return new Promise(function (res) {
      var a = new Audio(), url = URL.createObjectURL(file), done = false;
      function fin(v) { if (done) return; done = true; URL.revokeObjectURL(url); res(v); }
      a.preload = "metadata";
      a.onloadedmetadata = function () { fin(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { fin(0); };
      setTimeout(function () { fin(0); }, 4000);
      a.src = url;
    });
  }
  var AUDIO = {
    mp3: { codec: "libmp3lame", mime: "audio/mpeg", br: true },
    wav: { codec: "pcm_s16le", mime: "audio/wav", br: false },
    m4a: { codec: "aac", mime: "audio/mp4", br: true },
    ogg: { codec: "libvorbis", mime: "audio/ogg", br: true },
    flac: { codec: "flac", mime: "audio/flac", br: false }
  };
  function audioConvert(item, o, ctx) {
    var spec = AUDIO[o.format];
    return audioDuration(item.file).then(function (d) {
      if (d > 600) throw KError(t("audioTooLong", { min: Math.round(d / 60) }));
      return getFFmpeg(ctx.note);
    }).then(function (ff) {
      ctx.note("");
      ctx.setCancel(function () { ff.terminate(); ffState.ff = null; ffState.loading = null; });
      ffState.onProgress = ctx.progress;
      var inName = "in." + (extOf(item.file.name) || "bin"), outName = "out." + o.format;
      return item.file.arrayBuffer().then(function (buf) {
        return ff.writeFile(inName, new Uint8Array(buf));
      }).then(function () {
        var args = ["-i", inName];
        if (o.ts > 0) args.push("-ss", String(o.ts));
        if (o.te > 0) args.push("-to", String(o.te));
        args.push("-vn", "-c:a", spec.codec);
        if (spec.br) args.push("-b:a", o.bitrate + "k");
        args.push(outName);
        return ff.exec(args);
      }).then(function (code) {
        if (code !== 0) throw KError(t("audioFail"));
        return ff.readFile(outName);
      }).then(function (data) {
        ff.deleteFile(inName).catch(function () {});
        ff.deleteFile(outName).catch(function () {});
        if (!data || !data.length) throw KError(t("audioFail"));
        return { blob: new Blob([data], { type: spec.mime }), name: baseName(item.file.name) + "." + o.format };
      });
    }).finally(function () { ffState.onProgress = null; });
  }

  // ---------- server ----------
  function serverJob(item, o, ctx, cfg) {
    return new Promise(function (resolve, reject) {
      var api = CFG.apiBase.replace(/\/$/, "");
      var xhr = new XMLHttpRequest(), aborted = false, jobId = null, timer = null;
      ctx.setCancel(function () {
        aborted = true; clearTimeout(timer); xhr.abort();
        if (jobId) fetch(api + "/api/jobs/" + jobId, { method: "DELETE" }).catch(function () {});
        reject(KError(t("cancelled")));
      });
      var fd = new FormData();
      fd.append("type", cfg.job);
      fd.append("options", JSON.stringify(o.server || {}));
      fd.append("file", item.file, item.file.name);
      xhr.open("POST", api + "/api/jobs");
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) ctx.progress(0.4 * e.loaded / e.total); };
      xhr.upload.onload = function () { ctx.note(t("queued")); };
      xhr.onerror = function () { reject(KError(t("serverDown"))); };
      xhr.onload = function () {
        var body = {}; try { body = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status === 429) return reject(KError(t("rateLimit")));
        if (xhr.status >= 400) return reject(KError(body.detail || t("serverDown")));
        jobId = body.job_id;
        var started = Date.now();
        (function poll() {
          if (aborted) return;
          fetch(api + "/api/jobs/" + jobId).then(function (r) { return r.json(); }).then(function (j) {
            if (aborted) return;
            if (j.status === "failed") return reject(KError(j.error_message || t("audioFail")));
            if (j.status === "done") {
              return fetch(api + "/api/jobs/" + jobId + "/download").then(function (r) {
                if (!r.ok) throw KError(t("serverDown"));
                return r.blob();
              }).then(function (blob) {
                var name = baseName(item.file.name) + (cfg.job === "compress_pdf" ? "-kompres" : "") + "." + cfg.out;
                var out = { blob: blob, name: name, compare: !!cfg.compare };
                if (cfg.compare && blob.size >= item.file.size) { out.blob = item.file; out.name = item.file.name; out.note = t("alreadySmall"); }
                resolve(out);
              }).catch(reject);
            }
            ctx.note(j.status === "processing" ? t("processing") : t("queued"));
            ctx.progress(0.4 + Math.min(0.55, (Date.now() - started) / 200000));
            if (Date.now() - started > 240000) return reject(KError(t("serverTimeout")));
            timer = setTimeout(poll, 1000);
          }).catch(function (e) { reject(e && e.user ? e : KError(t("serverDown"))); });
        })();
      };
      xhr.send(fd);
    });
  }

  // ---------- halaman tool ----------
  function initTool() {
    var root = $("#tool[data-op]");
    if (!root) return;
    var cfg = {
      op: root.dataset.op, accept: root.dataset.accept, job: root.dataset.job, out: root.dataset.out,
      compare: !!root.dataset.compare || root.dataset.op === "image-compress", soon: !!root.dataset.soon,
      maxMB: root.dataset.maxMb ? +root.dataset.maxMb : (root.dataset.op.indexOf("audio") === 0 ? 50 : 20)
    };
    var MAX_FILES = 10;
    var allowed = allowedKinds(cfg.accept);
    var items = [], seq = 0, running = false, cancelled = false, cancelFn = null;
    var els = {
      drop: $("#drop"), input: $("#file"), list: $("#files"), go: $("#go"), cancel: $("#cancel"),
      zip: $("#zip"), sum: $("#sum"), alert: $("#alert"), alertText: $("#alert-text"), opts: $("#opts")
    };

    if (cfg.soon) { els.input.disabled = true; els.drop.style.opacity = ".5"; els.drop.style.pointerEvents = "none"; return; }

    function showAlert(msg) { els.alert.hidden = !msg; els.alertText.textContent = msg || ""; }

    function readOpts() {
      function v(id) { var e = $(id); return e ? e.value : ""; }
      var fmt = v("#o-format");
      var bitrate = ($("input[name=bitrate]:checked") || {}).value;
      var level = ($("input[name=level]:checked") || {}).value;
      var q = +v("#o-quality") || 80;
      return {
        format: fmt, quality: q, bitrate: +bitrate || 192,
        targetKB: +v("#o-target") || 0, w: +v("#o-w") || 0, h: +v("#o-h") || 0,
        ts: +v("#o-ts") || 0, te: +v("#o-te") || 0,
        server: level ? { level: level } : {}
      };
    }

    function render() {
      els.list.innerHTML = "";
      items.forEach(function (it) {
        var li = document.createElement("li");
        li.className = "file"; li.dataset.state = it.state; li.id = "f" + it.id;
        var name = document.createElement("span"); name.className = "name"; name.textContent = it.file.name; name.title = it.file.name;
        var state = document.createElement("span"); state.className = "state"; state.textContent = t(it.state === "idle" ? "ready" : it.state);
        var acts = document.createElement("span"); acts.className = "acts";
        if (it.state === "done" && it.result) {
          var a = document.createElement("a"); a.className = "dl"; a.textContent = t("download");
          a.href = it.url; a.download = it.result.name; acts.appendChild(a);
        }
        if (!running) {
          var rm = document.createElement("button"); rm.type = "button"; rm.className = "rm"; rm.textContent = t("remove");
          rm.setAttribute("aria-label", t("remove") + " " + it.file.name);
          rm.onclick = function () { removeItem(it.id); }; acts.appendChild(rm);
        }
        var meta = document.createElement("span"); meta.className = "meta";
        meta.textContent = fmtSize(it.file.size) + (it.result ? " → " + fmtSize(it.result.blob.size) : "");
        var bar = document.createElement("div"); bar.className = "bar"; bar.innerHTML = "<i></i>";
        li.appendChild(name); li.appendChild(state); li.appendChild(acts);
        li.appendChild(meta);
        li.appendChild(bar);
        var m = it.note || it.error;
        if (m) { var p = document.createElement("p"); p.className = "msg" + (it.error ? "" : " ok"); p.textContent = m; li.appendChild(p); }
        els.list.appendChild(li);
      });
      var pending = items.some(function (i) { return i.state === "idle" || i.state === "error"; });
      els.go.disabled = running || !pending;
      els.go.hidden = running;
      els.cancel.hidden = !running;
      var doneCount = items.filter(function (i) { return i.state === "done"; }).length;
      els.zip.hidden = running || doneCount < 2;
      summary();
    }

    function summary() {
      var done = items.filter(function (i) { return i.state === "done" && i.result; });
      if (!done.length) { els.sum.hidden = true; return; }
      var before = 0, after = 0;
      done.forEach(function (i) { before += i.file.size; after += i.result.blob.size; });
      var txt = t("sumDone", { n: done.length });
      if (cfg.compare && before > 0) {
        var p = Math.round((1 - after / before) * 100);
        txt = t("sumSaved", { before: fmtSize(before), after: fmtSize(after), p: Math.max(p, 0) });
      }
      els.sum.textContent = txt; els.sum.hidden = false;
    }

    function setProgress(it, f) {
      var bar = $("#f" + it.id + " .bar i");
      if (bar) bar.style.width = Math.round(f * 100) + "%";
    }
    function setNote(it, msg) {
      it.note = msg; var li = $("#f" + it.id); if (!li) return;
      var p = $(".msg", li);
      if (!msg) { if (p && !it.error) p.remove(); return; }
      if (!p) { p = document.createElement("p"); p.className = "msg ok"; li.appendChild(p); }
      p.textContent = msg;
    }

    function removeItem(id) {
      items = items.filter(function (i) { if (i.id === id && i.url) URL.revokeObjectURL(i.url); return i.id !== id; });
      render();
    }
    function resetDone() {
      if (running) return;
      items.forEach(function (i) {
        if (i.state === "done") { if (i.url) URL.revokeObjectURL(i.url); i.state = "idle"; i.result = null; i.url = null; i.note = ""; }
      });
      render();
    }

    function addFiles(fileList) {
      showAlert("");
      var arr = Array.prototype.slice.call(fileList), notes = [];
      var room = MAX_FILES - items.length;
      if (arr.length > room) { notes.push(t("tooMany", { n: MAX_FILES })); arr = arr.slice(0, Math.max(room, 0)); }
      var jobs = arr.map(function (f) {
        return sniff(f).then(function (kind) {
          var it = { id: ++seq, file: f, kind: kind, state: "idle", note: "", error: "" };
          var err = "";
          if (f.size > cfg.maxMB * 1048576) err = t("tooBig", { size: fmtSize(f.size), max: cfg.maxMB + " MB" });
          else if (!kind) err = t("unknownType");
          else if (!allowed[kind]) err = t("wrongType", { types: cfg.accept.replace(/\./g, "").toUpperCase().split(",").join(", "), got: KIND_LABEL[kind] || kind });
          else if (kind === "zip" && !cfg.accept.split(",").some(function (e) { return e === "." + extOf(f.name); })) err = t("wrongType", { types: cfg.accept.replace(/\./g, "").toUpperCase(), got: extOf(f.name).toUpperCase() });
          else if (kind === "ole") err = "File terproteksi password atau memakai format lama. Simpan ulang sebagai DOCX/PPTX/XLSX tanpa password.";
          if (err) { it.state = "error"; it.error = err; it.invalid = true; }
          return it;
        });
      });
      Promise.all(jobs).then(function (news) {
        items = items.concat(news);
        if (notes.length) showAlert(notes.join(" "));
        render();
      });
    }

    // drop & pilih
    els.input.addEventListener("change", function () { addFiles(els.input.files); els.input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.remove("over"); });
    });
    els.drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    ["dragover", "drop"].forEach(function (ev) { window.addEventListener(ev, function (e) { e.preventDefault(); }); });

    // opsi
    var q = $("#o-quality"), qv = $("#o-quality-v");
    if (q) q.addEventListener("input", function () { qv.textContent = q.value; });
    function syncOpts() {
      var fmt = $("#o-format") ? $("#o-format").value : "";
      var fq = $("#f-quality"); if (fq && (cfg.op === "image-convert" || cfg.op === "image-resize")) fq.hidden = fmt === "png";
      var fb = $("#f-bitrate"); if (fb && AUDIO[fmt]) fb.hidden = !AUDIO[fmt].br;
    }
    els.opts.addEventListener("input", function () { syncOpts(); resetDone(); });
    syncOpts();

    // jalankan
    function runItem(it, o) {
      var ctx = {
        progress: function (f) { setProgress(it, f); },
        note: function (m) { setNote(it, m); },
        setCancel: function (fn) { cancelFn = fn; }
      };
      if (imageOps[cfg.op]) return imageOps[cfg.op](it, o, ctx);
      if (cfg.op === "audio-convert") return audioConvert(it, o, ctx);
      if (cfg.op === "server") return serverJob(it, o, ctx, cfg);
      return Promise.reject(KError("Tool tidak dikenal."));
    }

    els.go.addEventListener("click", function () {
      var o = readOpts();
      var queue = items.filter(function (i) { return i.state === "idle" || (i.state === "error" && !i.invalid); });
      if (!queue.length) return;
      running = true; cancelled = false; showAlert("");
      queue.forEach(function (i) { i.state = "idle"; i.error = ""; });
      render();
      var chain = Promise.resolve();
      queue.forEach(function (it) {
        chain = chain.then(function () {
          if (cancelled) { it.note = t("cancelled"); return; }
          it.state = "working"; it.note = ""; render();
          return runItem(it, o).then(function (r) {
            it.result = r; it.url = URL.createObjectURL(r.blob); it.state = "done";
            it.note = r.note || "";
            if (cfg.compare && r.compare && r.blob !== it.file) {
              var p = Math.round((1 - r.blob.size / it.file.size) * 100);
              var s = p >= 0 ? t("saved", { p: p }) : t("bigger", { p: -p });
              it.note = (it.note ? it.note + " " : "") + s.charAt(0).toUpperCase() + s.slice(1) + ".";
            }
          }).catch(function (e) {
            it.state = "error";
            it.error = cancelled ? t("cancelled") : (e && e.user) ? e.message : t("generic");
            if (!(e && e.user)) console.error(e);
          }).then(function () { cancelFn = null; render(); });
        });
      });
      chain.then(function () { running = false; render(); });
    });

    els.cancel.addEventListener("click", function () {
      cancelled = true;
      if (cancelFn) cancelFn();
    });

    els.zip.addEventListener("click", function () {
      var done = items.filter(function (i) { return i.state === "done" && i.result; });
      var lib = window.JSZip ? Promise.resolve() : loadScript("/vendor/jszip.min.js");
      lib.then(function () {
        var zip = new window.JSZip(), used = {};
        done.forEach(function (i) {
          var n = i.result.name;
          if (used[n]) { var e = extOf(n); n = baseName(n) + "-" + (++used[i.result.name]) + (e ? "." + e : ""); } else used[n] = 1;
          zip.file(n, i.result.blob);
        });
        return zip.generateAsync({ type: "blob" });
      }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = t("zipName");
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      }).catch(function () { showAlert("ZIP gagal dibuat. Unduh file satu per satu."); });
    });

    render();
  }

  initHome();
  initTool();
})();
