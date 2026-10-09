// Bangun halaman statis dari tools.json.
// Pakai: node scripts/build.mjs
// Env opsional: API_BASE (URL backend), ADS=1 (aktifkan slot iklan), SITE_URL (untuk sitemap)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "scripts/tools.json"), "utf8"));
const API_BASE = process.env.API_BASE || "";
const ADS = process.env.ADS === "1";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

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
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL ? `<link rel="canonical" href="${SITE_URL}${path}">` : ""}
<meta name="theme-color" content="#1a1714">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css">
</head>
<body class="${bodyClass}${ADS ? " ads-on" : ""}">
<a class="skip" href="#main">Lewati ke isi</a>
<header class="nav">
  <div class="wrap">
    <a class="logo" href="/" aria-label="Konvertin, beranda">konvertin<i>.</i></a>
    <nav aria-label="Utama">
      <ul>
        <li><a href="/#tool">Tool</a></li>
        <li><a href="/#cara-kerja">Cara kerja</a></li>
        <li><a href="/#privasi">Privasi</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a class="btn small" href="/#tool">Mulai konversi</a></li>
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
      <li><a href="/privasi.html">Kebijakan privasi</a></li>
      <li><a href="/syarat.html">Syarat penggunaan</a></li>
      <li><a href="mailto:halo@konvertin.example">Kontak</a></li>
    </ul>
  </div>
</footer>
<script src="/js/config.js"></script>
<script src="/js/app.js" defer></script>
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
    : `<li data-search="${search}"><a href="/${t.slug}/">${inner}</a></li>`;
}

const catBlocks = cats
  .map((c) => `    <div class="cat" data-cat="${c.id}">
      <h3>${c.label}</h3>
      <ul class="tool-list">
${byCat(c.id).map(toolCard).join("\n")}
      </ul>
    </div>`)
  .join("\n");

const index = layout({
  title: "Konvertin: Konverter File Gambar, Audio, dan Dokumen",
  desc: "Ubah format gambar dan audio, kompres gambar dan PDF, ubah PDF dan Word. Tanpa daftar. Gambar dan audio diproses di browser, tidak diunggah.",
  path: "/",
  body: `
<section class="hero">
  <div class="wrap">
    <span class="label">Konverter file</span>
    <h1>Ubah file. Tanpa ribet.</h1>
    <p class="lead">Ubah format gambar dan audio, kecilkan ukuran gambar dan PDF, ubah PDF dan Word. Gambar dan audio diproses di browser kamu.</p>
    <ul class="points">
      <li>Tanpa daftar</li>
      <li>Gambar dan audio tidak diunggah</li>
      <li>Gratis</li>
    </ul>
    <a class="btn" href="#tool">Pilih tool</a>
  </div>
</section>

<div class="facts">
  <div class="wrap">
    <div class="fact"><b>${cats.length}</b><span>kategori: gambar, audio, kompres, dokumen</span></div>
    <div class="fact"><b>10</b><span>file maksimal per proses</span></div>
    <div class="fact"><b>0</b><span>akun yang perlu dibuat</span></div>
    <div class="fact"><b>1 jam</b><span>batas file tersimpan di server</span></div>
  </div>
</div>

<section class="block" id="tool">
  <div class="wrap">
    <span class="label">Tool</span>
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
    <span class="label">Cara kerja</span>
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
    <span class="label">Privasi</span>
    <h2>Apa yang pergi ke mana</h2>
    <div class="cols">
      <div><h3>Di browser kamu</h3><p>Konversi dan kompres gambar, ubah ukuran gambar, dan konversi audio. File tidak keluar dari perangkat. Kamu bisa putus internet setelah halaman terbuka, kecuali pemuat audio belum pernah diunduh.</p></div>
      <div><h3>Lewat server</h3><p>Konversi dokumen (PDF, Word, PowerPoint, Excel) dan kompres PDF. File diunggah, diproses di wadah terisolasi tanpa akses internet, namanya diacak, dan tidak dibaca manusia.</p></div>
      <div><h3>Kapan dihapus</h3><p>File di server dihapus otomatis paling lama 1 jam setelah selesai. Isi file tidak dicatat di log.</p></div>
    </div>
  </div>
</section>

<section class="block" id="batas">
  <div class="wrap">
    <span class="label">Batas pemakaian gratis</span>
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
    <span class="label">FAQ</span>
    <h2>Pertanyaan yang sering muncul</h2>
    <details><summary>Apakah file saya diunggah?</summary><p>Tergantung tool. Gambar dan audio diproses di browser, jadi tidak diunggah. Konversi dokumen dan kompres PDF berjalan di server, dan file dihapus otomatis paling lama 1 jam setelah selesai.</p></details>
    <details><summary>Kenapa hasil PDF ke Word layoutnya berubah?</summary><p>PDF menyimpan posisi tiap huruf, bukan struktur paragraf. Mengubahnya ke Word berarti menebak struktur itu, dan tebakan tidak selalu tepat. Tabel rumit dan kolom ganda paling sering bergeser.</p></details>
    <details><summary>Bisa untuk PDF hasil scan?</summary><p>Belum. PDF hasil scan berisi gambar, jadi butuh OCR untuk jadi teks. OCR belum ada di versi ini.</p></details>
    <details><summary>Kenapa konversi audio mengunduh file besar dulu?</summary><p>Mesin konversi audio (sekitar 30 MB) dimuat sekali supaya audio bisa diproses di browser. Setelah itu disimpan oleh browser.</p></details>
    <details><summary>Kenapa kompres PNG hematnya kecil?</summary><p>PNG menyimpan gambar tanpa kehilangan data. Untuk hemat lebih besar, ubah ke WEBP atau JPG, atau kecilkan resolusinya.</p></details>
    <details><summary>Apakah ada batas jumlah konversi?</summary><p>Tool di browser tidak dibatasi. Tool server dibatasi sekitar 20 proses per jam per alamat IP untuk mencegah penyalahgunaan.</p></details>
  </div>
</section>

<section class="block cta">
  <div class="wrap">
    <h2>File kamu sudah siap?</h2>
    <a class="btn" href="#tool">Pilih tool</a>
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
  <p class="crumb"><a href="/">konvertin.</a> / <a href="/#tool">${catLabel[t.cat]}</a> / ${esc(t.name)}</p>
  <div class="tool-head">
    <h1>${esc(t.h1)}</h1>
    <p>${esc(t.desc)}</p>
  </div>
  ${t.warning ? `<div class="notice"><b>Perlu diketahui</b>${esc(t.warning)}</div>` : ""}
  ${soon ? `<div class="notice"><b>Segera</b>Tool ini butuh server dan belum aktif. Tool gambar dan audio di beranda sudah bisa dipakai.</div>` : ""}
  <div class="notice err" id="alert" role="alert" hidden><b>Ada masalah</b><span id="alert-text"></span></div>

  <div class="tool-grid" id="tool" ${dataAttrs}>
    <div>
      <label class="dropzone" id="drop">
        <input type="file" id="file" accept="${esc(t.accept)}" multiple>
        <strong>Tarik file ke sini</strong>
        <span>atau klik untuk memilih. Sampai ${maxFiles} file.</span>
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
      <ul class="related">${related.map((r) => `<li><a href="/${r.slug}/">${esc(r.name)}</a></li>`).join("")}</ul>
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
  body: `<div class="wrap nf"><span class="label">404</span><h1>Halaman tidak ada</h1><p class="muted">Alamat yang kamu buka tidak ditemukan. Mungkin salah ketik, atau tool itu belum dibuat.</p><a class="btn" href="/#tool">Lihat semua tool</a></div>`,
}));

write("privasi.html", layout({
  title: "Kebijakan Privasi | konvertin.", desc: "Apa yang diproses di browser, apa yang lewat server, dan kapan file dihapus.", path: "/privasi.html",
  body: `<div class="wrap prose">
<span class="label">Kebijakan privasi</span>
<h1>Kebijakan privasi</h1>
<p class="muted">Draft. Terakhir diubah 9 Oktober 2026. Tinjau ulang sebelum rilis publik, terutama bagian iklan dan cookie.</p>
<h2>Yang diproses di browser</h2>
<p>Konversi gambar, kompres gambar, ubah ukuran gambar, dan konversi audio berjalan sepenuhnya di browser kamu. File tidak dikirim ke server kami. Untuk konversi audio, browser mengunduh mesin pemroses (ffmpeg.wasm) dari jaringan pengiriman konten publik (jsDelivr).</p>
<h2>Yang lewat server</h2>
<p>Konversi dokumen (PDF, Word, PowerPoint, Excel) dan kompres PDF membutuhkan server. File kamu diunggah, diproses di wadah terisolasi tanpa akses internet, dan hasilnya tersedia untuk kamu unduh.</p>
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
<p>Pertanyaan soal privasi: halo@konvertin.example (ganti dengan alamat asli sebelum rilis).</p>
</div>`,
}));

write("syarat.html", layout({
  title: "Syarat Penggunaan | konvertin.", desc: "Syarat memakai Konvertin.", path: "/syarat.html",
  body: `<div class="wrap prose">
<span class="label">Syarat penggunaan</span>
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
  ffmpegCoreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd"
};
`);

if (SITE_URL) {
  const urls = ["/", ...tools.filter((t) => !isSoon(t)).map((t) => `/${t.slug}/`), "/privasi.html", "/syarat.html"];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
}
write("robots.txt", `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1a1714"/><circle cx="16" cy="16" r="6" fill="#ff7a2f"/></svg>\n`);
write("_headers", `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n`);

console.log(`Selesai: ${tools.length} halaman tool + beranda. API_BASE=${API_BASE || "(kosong)"} ADS=${ADS}`);
