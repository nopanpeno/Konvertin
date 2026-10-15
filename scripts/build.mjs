// Bangun halaman statis dari tools.json.
// Pakai: node scripts/build.mjs
// Output: frontend/. Env opsional: API_BASE ("/" = backend satu origin, atau URL backend; kosong = tool server berlabel Segera), ADS=1 (aktifkan slot iklan), SITE_URL (untuk sitemap), EMAIL (email kontak asli; default novankaresa@students.amikom.ac.id)
// FFMPEG_CORE_BASE: URL unduhan mesin audio. Kosong/tidak diisi = pakai salinan lokal di vendor/ffmpeg-core/ (tanpa CDN pihak ketiga).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools.json"), "utf8"));
const API_BASE = process.env.API_BASE || "";
const ADS = process.env.ADS === "1";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "novankaresa@students.amikom.ac.id";
// Mesin audio: default dari repo sendiri (vendor/ffmpeg-core), bukan CDN pihak ketiga.
const FFMPEG_LOCAL = existsSync(join(root, "vendor", "ffmpeg-core", "ffmpeg-core.wasm"));
const FFMPEG_CORE_BASE = process.env.FFMPEG_CORE_BASE || (FFMPEG_LOCAL ? "./vendor/ffmpeg-core" : "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd");
// Teks privasi harus cocok dengan asal mesin audio yang benar-benar dipakai build ini.
const FFMPEG_HOST = /^https?:\/\//.test(FFMPEG_CORE_BASE) ? new URL(FFMPEG_CORE_BASE).hostname : "";
const FFMPEG_NOTE = FFMPEG_HOST
  ? `Untuk konversi audio, browser mengunduh mesin pemroses (ffmpeg.wasm) dari ${FFMPEG_HOST}, layanan pihak ketiga.`
  : "Untuk konversi audio, browser memuat mesin pemroses (ffmpeg.wasm) dari situs ini sendiri, bukan dari pihak ketiga, lalu menyimpannya di browser.";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (path, content) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

const isSoon = (t) => t.side === "server" && !API_BASE;
const cats = data.categories;
const tools = data.tools;
const byCat = (id) => tools.filter((t) => t.cat === id);

// ---------- layout ----------
function layout({ title, desc, body, path, bodyClass = "", scripts = "" }) {
  const pathDepth = path.endsWith("/") ? path.split("/").filter(Boolean).length : 0;
  const rootHref = pathDepth ? "../".repeat(pathDepth) : "./";
  const homeHref = `${rootHref}index.html`;
  const stylesheet = `${rootHref}css/style.css`;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL ? `<link rel="canonical" href="${SITE_URL}${path}">` : ""}

<meta name="color-scheme" content="light">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="${rootHref}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body class="${bodyClass}${ADS ? " ads-on" : ""}">
<a class="skip" href="#main">Lewati ke isi</a>
<header class="nav">
  <div class="wrap">
    <a class="logo" href="${homeHref}" aria-label="Konvertin, beranda">konvertin<i>.</i></a>
    <nav aria-label="Utama">
      <ul>
        <li class="nl"><a href="${homeHref}#tool">Tool</a></li>
        <li class="nl"><a href="${homeHref}#cara-kerja">Cara kerja</a></li>
        <li class="nl"><a href="${homeHref}#privasi">Privasi</a></li>
        <li class="nl"><a href="${homeHref}#faq">FAQ</a></li>
        <li><a class="btn small" href="${homeHref}#tool">Mulai konversi</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="wrap">
    <div>konvertin. &middot; Konverter file untuk pemakaian sehari-hari.</div>
    <ul>
      <li><a href="${rootHref}privasi.html">Kebijakan privasi</a></li>
      <li><a href="${rootHref}syarat.html">Syarat penggunaan</a></li>
      <li><a href="mailto:${EMAIL}">Kontak</a></li>
    </ul>
  </div>
</footer>
<script src="${rootHref}js/config.js"></script>
<script src="${rootHref}js/app.js" defer></script>
${scripts}
</body>
</html>
`;
}

// ---------- beranda ----------
function toolCard(t) {
  const tag = isSoon(t) ? `<span class="tag">Segera</span>` : `<span class="tag on">${t.side === "browser" ? "Di browser" : "Server"}</span>`;
  const inner = `<span><span class="t">${esc(t.name)}</span><span class="s">${esc(t.short)}</span></span>${tag}`;
  const search = esc((t.name + " " + t.short + " " + t.inputs + " " + t.slug).toLowerCase());
  return isSoon(t)
    ? `<li data-search="${search}"><div class="soon">${inner}</div></li>`
    : `<li data-search="${search}"><a href="./${t.slug}/index.html">${inner}</a></li>`;
}

const catBlocks = cats
  .map((c) => `    <div class="cat" data-cat="${c.id}">
      <h3>${c.label}</h3>
      <ul class="tool-list">
${byCat(c.id).map(toolCard).join("\n")}
      </ul>
    </div>`)
  .join("\n");

// pasangan format untuk kalimat di hero
const NAMA = { word: "Word", excel: "Excel", pptx: "PowerPoint" };
const nama = (x) => NAMA[x] || x.toUpperCase();
const pairs = tools
  .filter((t) => !isSoon(t) && /^[a-z0-9]+-ke-[a-z0-9]+$/.test(t.slug))
  .map((t) => { const [a, b] = t.slug.split("-ke-"); return [a, b, t.slug, nama(b)]; });
const index = layout({
  title: "Konvertin: Konverter File Gambar, Audio, dan Dokumen",
  desc: "Ubah format gambar dan audio, kompres gambar, PDF, Word, dan PowerPoint, ubah PDF dan Word. Tanpa daftar. Gambar dan audio diproses di browser, tidak diunggah.",
  path: "/",
  body: `
<section class="hero">
  <div class="wrap">
    <h1><span class="sr-only">Ubah format file</span><span class="swap" aria-hidden="true">Ubah <b id="swap-from">${nama(pairs[0] ? pairs[0][0] : "jpg")}</b> ke <b id="swap-to">${pairs[0] ? pairs[0][3] : "PNG"}</b></span></h1>
    <p class="lead">Gambar dan audio diproses di browser, jadi file tidak keluar dari perangkatmu. Dokumen diproses di server dan dihapus paling lama 1 jam setelah selesai. Tanpa akun.</p>
    <div class="hero-go">
      <a class="btn" href="#tool">Lihat semua tool</a>
    </div>
  </div>
</section>
<script>
(function () {
  var pairs = ${JSON.stringify(pairs.map((p) => [nama(p[0]), p[3]]))};
  var a = document.getElementById("swap-from"), b = document.getElementById("swap-to");
  if (!a || !b || pairs.length < 2) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var i = 0;
  setInterval(function () {
    i = (i + 1) % pairs.length;
    a.textContent = pairs[i][0];
    b.textContent = pairs[i][1];
  }, 1000);
})();
</script>

<section class="block" id="tool">
  <div class="wrap">
    <h2>Pilih konversi</h2>
    <div class="search">
      <label class="sr-only" for="q">Cari tool</label>
      <input id="q" type="search" placeholder="Cari: heic, kompres, mp3..." autocomplete="off">
      <kbd aria-hidden="true">Ctrl K</kbd>
    </div>
${catBlocks}
    <p class="empty" id="empty">Tidak ada tool yang cocok. Coba kata lain, misalnya nama format.</p>
  </div>
</section>

<section class="block" id="cara-kerja">
  <div class="wrap">
    <h2>Tiga langkah</h2>
    <ol class="steps">
      <li><h3>Upload</h3><p>Tarik file ke kotak, atau klik untuk memilih. Sampai 10 file sekaligus.</p></li>
      <li><h3>Pilih format</h3><p>Tool menawarkan format tujuan yang cocok dengan file kamu. Atur kualitas kalau perlu.</p></li>
      <li><h3>Download</h3><p>Unduh satu file, atau semua hasil sebagai ZIP.</p></li>
    </ol>
  </div>
</section>

<section class="block" id="privasi">
  <div class="wrap">
    <h2>Apa yang pergi ke mana</h2>
    <div class="cols">
      <div><h3>Di browser kamu</h3><p>Konversi dan kompres gambar, ubah ukuran gambar, dan konversi audio. File tidak keluar dari perangkat. Kamu bisa putus internet setelah halaman terbuka, kecuali pemuat audio belum pernah diunduh.</p></div>
      <div><h3>Lewat server</h3><p>Konversi dokumen (PDF, Word, PowerPoint, Excel) dan kompres PDF, Word, PowerPoint. File diunggah, diproses di wadah terisolasi tanpa akses internet, namanya diacak, dan tidak dibaca manusia.</p></div>
      <div><h3>Kapan dihapus</h3><p>File di server dihapus otomatis paling lama 1 jam setelah selesai. Isi file tidak dicatat di log.</p></div>
    </div>
  </div>
</section>

<section class="block" id="batas">
  <div class="wrap">
    <h2>Batas awal</h2>
    <div class="table-scroll">
    <table>
      <thead><tr><th>Jenis</th><th>Ukuran maksimal</th><th>Catatan</th></tr></thead>
      <tbody>
        <tr><td>Dokumen</td><td class="mono">25 MB</td><td>Tidak ada OCR. PDF hasil scan belum didukung.</td></tr>
        <tr><td>Gambar</td><td class="mono">20 MB</td><td>Sampai 10 file per proses.</td></tr>
        <tr><td>Audio</td><td class="mono">50 MB / 10 menit</td><td>Mana yang lebih dulu tercapai.</td></tr>
      </tbody>
    </table>
    </div>
  </div>
</section>

<section class="block" id="faq">
  <div class="wrap">
    <h2>Pertanyaan yang sering muncul</h2>
    <details><summary>Apakah file saya diunggah?</summary><p>Tergantung tool. Gambar dan audio diproses di browser, jadi tidak diunggah. Konversi dokumen dan kompres PDF, Word, PowerPoint berjalan di server, dan file dihapus otomatis paling lama 1 jam setelah selesai.</p></details>
    <details><summary>Kenapa hasil PDF ke Word layoutnya berubah?</summary><p>PDF menyimpan posisi tiap huruf, bukan struktur paragraf. Mengubahnya ke Word berarti menebak struktur itu, dan tebakan tidak selalu tepat. Tabel rumit dan kolom ganda paling sering bergeser.</p></details>
    <details><summary>Bisa untuk PDF hasil scan?</summary><p>Belum. PDF hasil scan berisi gambar, jadi butuh OCR untuk jadi teks. OCR belum ada di versi ini.</p></details>
    <details><summary>Kenapa konversi audio mengunduh file besar dulu?</summary><p>Mesin konversi audio (sekitar 30 MB) dimuat sekali supaya audio bisa diproses di browser. Setelah itu disimpan oleh browser.</p></details>
    <details><summary>Kenapa kompres PNG hematnya kecil?</summary><p>PNG menyimpan gambar tanpa kehilangan data. Untuk hemat lebih besar, ubah ke WEBP atau JPG, atau kecilkan resolusinya.</p></details>
    <details><summary>Apakah ada batas jumlah konversi?</summary><p>Tool di browser tidak dibatasi. Tool server dibatasi sekitar 20 proses per jam per alamat IP untuk mencegah penyalahgunaan.</p></details>
  </div>
</section>`,
});
write("index.html", index);

// ---------- halaman tool ----------
const FORMAT_LABEL = { jpg: "JPG", png: "PNG", webp: "WEBP", mp3: "MP3", wav: "WAV", m4a: "M4A", ogg: "OGG", flac: "FLAC" };
const catLabel = Object.fromEntries(cats.map((c) => [c.id, c.label]));

function optionsHtml(t) {
  const f = [];
  if (t.formats && t.formats.length > 1) {
    f.push(`<div class="field"><label for="o-format">Format tujuan</label><select id="o-format" name="format">${t.formats
      .map((x) => `<option value="${x}"${x === t.defaultFormat ? " selected" : ""}>${FORMAT_LABEL[x]}</option>`).join("")}</select></div>`);
  } else if (t.formats) {
    f.push(`<div class="field"><label>Format tujuan</label><div class="mono">${FORMAT_LABEL[t.formats[0]]}</div><input type="hidden" id="o-format" name="format" value="${t.formats[0]}"></div>`);
  } else if (t.outExt) {
    f.push(`<div class="field"><label>Hasil</label><div class="mono">${t.outExt.toUpperCase()}</div></div>`);
  }
  if (t.quality) {
    f.push(`<div class="field" id="f-quality"><label for="o-quality">Kualitas <output id="o-quality-v">80</output></label><input id="o-quality" type="range" min="10" max="100" value="80" step="1"><div class="hint">Makin rendah, makin kecil file.</div></div>`);
  }
  if (t.target) {
    f.push(`<div class="field"><label for="o-target">Target ukuran (KB, opsional)</label><input id="o-target" type="number" min="10" step="10" inputmode="numeric" placeholder="contoh: 200"><div class="hint">Kalau diisi, slider kualitas diabaikan. Tidak berlaku untuk PNG yang tidak diperkecil resolusinya.</div></div>`);
  }
  if (t.resize) {
    f.push(`<div class="field"><label for="o-w">Lebar (px)</label><input id="o-w" type="number" min="1" max="10000" inputmode="numeric"></div>
<div class="field"><label for="o-h">Tinggi (px)</label><input id="o-h" type="number" min="1" max="10000" inputmode="numeric"><div class="hint">Rasio terkunci. Isi salah satu.</div></div>`);
  }
  if (t.bitrate) {
    f.push(`<div class="field" id="f-bitrate"><fieldset><legend>Bitrate</legend><div class="seg">
<label><input type="radio" name="bitrate" value="128"><span>128</span></label>
<label><input type="radio" name="bitrate" value="192" checked><span>192</span></label>
<label><input type="radio" name="bitrate" value="320"><span>320</span></label></div><div class="hint">kbps. Tidak berlaku untuk WAV dan FLAC.</div></fieldset></div>`);
  }
  if (t.trim) {
    f.push(`<div class="field"><label for="o-ts">Potong dari detik (opsional)</label><input id="o-ts" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>
<div class="field"><label for="o-te">Sampai detik (opsional)</label><input id="o-te" type="number" min="1" step="1" inputmode="numeric" placeholder="akhir"></div>`);
  }
  if (t.level) {
    f.push(`<div class="field"><fieldset><legend>Level kompres</legend><div class="seg">
<label><input type="radio" name="level" value="light"><span>Ringan</span></label>
<label><input type="radio" name="level" value="medium" checked><span>Sedang</span></label>
<label><input type="radio" name="level" value="max"><span>Maksimal</span></label></div><div class="hint">Maksimal paling kecil, kualitas gambar turun.</div></fieldset></div>`);
  }
  return f.join("\n");
}

function toolPage(t) {
  const rootHref = "../";
  const soon = isSoon(t);
  const related = tools.filter((x) => x.slug !== t.slug && x.cat === t.cat && !isSoon(x)).slice(0, 5)
    .concat(tools.filter((x) => x.slug !== t.slug && x.cat !== t.cat && x.op === t.op && !isSoon(x)).slice(0, 2));
  const where = t.side === "browser"
    ? "Diproses di browser kamu. File tidak diunggah ke server."
    : "Diproses di server dalam wadah terisolasi. File dihapus otomatis paling lama 1 jam setelah selesai.";
  const maxFiles = t.side === "server" ? 10 : 10;
  const limit = t.side === "server" ? `${t.maxMB} MB per file` : t.cat === "audio" ? "50 MB atau 10 menit per file" : "20 MB per file";
  const dataAttrs = [
    `data-op="${t.op}"`, `data-slug="${t.slug}"`, `data-accept="${esc(t.accept)}"`,
    t.job ? `data-job="${t.job}"` : "", t.outExt ? `data-out="${t.outExt}"` : "",
    t.maxMB ? `data-max-mb="${t.maxMB}"` : "", t.compare ? `data-compare="1"` : "",
    soon ? `data-soon="1"` : "",
  ].filter(Boolean).join(" ");

  const notes = (t.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  const body = `
<div class="wrap">
  <p class="crumb"><a href="${rootHref}index.html">konvertin.</a> / <a href="${rootHref}index.html#tool">${catLabel[t.cat]}</a> / ${esc(t.name)}</p>
  <div class="tool-head">
    <h1>${esc(t.h1)}</h1>
    <p>${esc(t.desc)}</p>
  </div>
  ${t.warning ? `<div class="notice"><b>Perlu diketahui</b>${esc(t.warning)}</div>` : ""}
  ${soon ? `<div class="notice"><b>Segera</b>Tool ini butuh server dan belum aktif. Tool gambar dan audio di beranda sudah bisa dipakai.${SITE_URL ? ` <a href="${rootHref}index.html#tool">Lihat tool yang sudah aktif</a>.` : ""}</div>` : ""}
  <div class="notice err" id="alert" role="alert" hidden><b>Ada masalah</b><span id="alert-text"></span></div>

  <div class="tool-grid" id="tool" ${dataAttrs}>
    <div>
      <label class="dropzone" id="drop">
        <input type="file" id="file" accept="${esc(t.accept)}" multiple>
        <strong>Tarik file ke sini</strong>
        <span>atau klik untuk memilih, atau tempel dengan Ctrl+V. Sampai ${maxFiles} file.</span>
        <span class="formats">${esc(t.inputs)} &middot; ${limit}</span>
      </label>
      <ul class="files" id="files" aria-live="polite"></ul>
      <div class="ad-slot" data-slot="bawah-upload" aria-hidden="true"></div>
    </div>
    <form class="panel options" id="opts" onsubmit="return false">
      <h2>Opsi</h2>
${optionsHtml(t)}
      <div class="actions">
        <button class="btn" type="button" id="go" disabled>Konversi</button>
        <button class="btn ghost" type="button" id="cancel" hidden>Batalkan</button>
        <button class="btn ghost" type="button" id="zip" hidden>Unduh semua (ZIP)</button>
      </div>
      <p class="sum" id="sum" hidden></p>
    </form>
  </div>

  <div class="tool-notes">
    <div>
      <h2>Yang perlu kamu tahu</h2>
      <ul><li>${where}</li><li>Format masuk: ${esc(t.inputs)}.</li>${notes}</ul>
    </div>
    <div>
      <h2>Tool lain</h2>
      <ul class="related">${related.map((r) => `<li><a href="${rootHref}${r.slug}/index.html">${esc(r.name)}</a></li>`).join("")}</ul>
    </div>
  </div>
</div>
<div style="height:72px"></div>`;
  return layout({ title: `${t.title} | konvertin.`, desc: t.desc, path: `/${t.slug}/`, body });
}

for (const t of tools) write(`${t.slug}/index.html`, toolPage(t));

// ---------- halaman statis ----------
write("404.html", layout({
  title: "Halaman tidak ditemukan | konvertin.", desc: "Halaman tidak ditemukan.", path: "/404.html",
  body: `<div class="wrap nf"><h1>Halaman tidak ada</h1><p class="muted">Alamat yang kamu buka tidak ditemukan. Mungkin salah ketik, atau tool itu belum dibuat.</p><a class="btn" href="./index.html#tool">Lihat semua tool</a></div>`,
}));

write("privasi.html", layout({
  title: "Kebijakan Privasi | konvertin.", desc: "Apa yang diproses di browser, apa yang lewat server, dan kapan file dihapus.", path: "/privasi.html",
  body: `<div class="wrap prose">
<h1>Kebijakan privasi</h1>
<p class="muted">Draft. Terakhir diubah 9 Oktober 2026. Tinjau ulang sebelum rilis publik, terutama bagian iklan dan cookie.</p>
<h2>Yang diproses di browser</h2>
<p>Konversi gambar, kompres gambar, ubah ukuran gambar, dan konversi audio berjalan sepenuhnya di browser kamu. File tidak dikirim ke server kami. ${FFMPEG_NOTE}</p>
<h2>Yang lewat server</h2>
<p>Konversi dokumen (PDF, Word, PowerPoint, Excel) dan kompres PDF, Word, PowerPoint membutuhkan server. File kamu diunggah, diproses di wadah terisolasi tanpa akses internet, dan hasilnya tersedia untuk kamu unduh.</p>
<ul>
<li>File input dan hasil dihapus otomatis paling lama 1 jam setelah selesai.</li>
<li>Nama file di penyimpanan diacak.</li>
<li>Kami tidak membaca isi file, dan isi file tidak dicatat di log.</li>
<li>Kami mencatat metadata teknis sebatas perlu untuk operasi: jenis konversi, ukuran, status, waktu, dan alamat IP untuk pembatasan laju.</li>
</ul>
<h2>Akun</h2>
<p>Tidak ada akun. Kami tidak meminta nama atau email untuk memakai tool.</p>
<h2>Iklan dan cookie</h2>
<p>Situs ini direncanakan menampilkan iklan lewat Google AdSense. Saat iklan aktif, Google dapat memakai cookie untuk menampilkan iklan, dan kami akan menampilkan banner persetujuan cookie. Bagian ini harus diperbarui saat iklan dipasang.</p>
<h2>Kontak</h2>
<p>Pertanyaan soal privasi: ${EMAIL}.</p>
</div>`,
}));

write("syarat.html", layout({
  title: "Syarat Penggunaan | konvertin.", desc: "Syarat memakai Konvertin.", path: "/syarat.html",
  body: `<div class="wrap prose">
<h1>Syarat penggunaan</h1>
<p class="muted">Draft. Terakhir diubah 9 Oktober 2026. Tinjau ulang sebelum rilis publik.</p>
<h2>Pemakaian</h2>
<p>Konvertin gratis untuk pemakaian dasar dengan batas ukuran dan jumlah yang tertera di beranda. Kamu bertanggung jawab atas file yang kamu proses dan hak atas isinya. Jangan unggah file yang melanggar hukum atau hak orang lain.</p>
<h2>Tanpa jaminan hasil</h2>
<p>Hasil konversi, terutama PDF ke Word, bisa berbeda dari file asli. Periksa hasilnya sebelum dipakai untuk hal penting. Layanan diberikan apa adanya, tanpa jaminan ketersediaan atau kecocokan untuk tujuan tertentu.</p>
<h2>Pembatasan</h2>
<p>Kami membatasi jumlah proses per alamat IP dan boleh menolak file yang mencurigakan atau berukuran tidak wajar untuk menjaga layanan tetap stabil.</p>
<h2>Perubahan</h2>
<p>Syarat ini bisa berubah. Tanggal perubahan terakhir ada di atas halaman.</p>
</div>`,
}));

// ---------- config, sitemap, robots, favicon ----------
write("js/config.js", `// Dibuat oleh scripts/build.mjs. Ubah lewat env API_BASE dan ADS, lalu build ulang.
window.KONVERTIN = {
  apiBase: ${JSON.stringify(API_BASE)},
  ads: ${ADS},
  ffmpegCoreBase: ${JSON.stringify(FFMPEG_CORE_BASE)}
};
`);

if (SITE_URL) {
  const urls = ["/", ...tools.filter((t) => !isSoon(t)).map((t) => `/${t.slug}/`), "/privasi.html", "/syarat.html"];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
}
write("robots.txt", `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1a1714"/><circle cx="16" cy="16" r="6" fill="#ff7a2f"/></svg>\n`);
write("_headers", `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/vendor/ffmpeg-core/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`Selesai: ${tools.length} halaman tool + beranda. API_BASE=${API_BASE || "(kosong)"} ADS=${ADS}`);
