// Bangun halaman statis dari tools.json.
// Pakai: node scripts/build.mjs
// Output: frontend/. API_BASE="/" mengaktifkan tool server dan UI akun satu origin; kosong = build GitHub Pages tanpa UI akun dan tool server berlabel Segera.
// Env opsional lain: API_BASE (URL backend), ADS=1 + ADSENSE_ID + ADSENSE_SLOT (iklan), SITE_URL (untuk sitemap), EMAIL (email kontak asli; default novankaresa@students.amikom.ac.id)
// FFMPEG_CORE_BASE: URL unduhan mesin audio. Kosong/tidak diisi = pakai salinan lokal di vendor/ffmpeg-core/ (tanpa CDN pihak ketiga).
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend");
// versi file lewat isi, supaya browser tidak memakai css/js lama setelah deploy
const ver = (f) => createHash("md5").update(readFileSync(join(root, f))).digest("hex").slice(0, 8);
const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools.json"), "utf8"));
const apiBaseArg = process.argv.slice(2).find((arg) => arg.startsWith("--api-base="));
const API_BASE = process.env.API_BASE ?? apiBaseArg?.slice("--api-base=".length) ?? "";
if (API_BASE && API_BASE !== "/") {
  let apiUrl;
  try {
    apiUrl = new URL(API_BASE);
  } catch {
    throw new Error("API_BASE harus berupa URL backend lengkap atau '/'.");
  }
  if (!["https:", "http:"].includes(apiUrl.protocol) || (apiUrl.protocol === "http:" && !["localhost", "127.0.0.1"].includes(apiUrl.hostname))) {
    throw new Error("API_BASE publik harus memakai HTTPS; HTTP hanya diizinkan untuk localhost.");
  }
}
// Akun dan sesi saat ini hanya mendukung API satu origin; jangan tampilkan UI akun pada build statis.
const ACCOUNT_UI = API_BASE === "/";
const STATIC_MODE = !API_BASE;
const ADS = process.env.ADS === "1";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "novankaresa@students.amikom.ac.id";
// AdSense: ADS=1 + ADSENSE_ID (ca-pub-...) memuat skrip dan menulis ads.txt. ADSENSE_SLOT (angka) menampilkan satu unit iklan di bawah daftar file.
// Catatan: sebelum iklan benar-benar hidup untuk pengunjung EEA/UK, pasang banner persetujuan cookie.
const ADSENSE_ID = /^ca-pub-\d+$/.test(process.env.ADSENSE_ID || "") ? process.env.ADSENSE_ID : "";
const ADSENSE_SLOT = /^\d+$/.test(process.env.ADSENSE_SLOT || "") ? process.env.ADSENSE_SLOT : "";
const ADS_LIVE = ADS && !!ADSENSE_ID;
const guides = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "guides.json"), "utf8"));
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
function layout({ title, desc, body, path, bodyClass = "", scripts = "", noindex = false }) {
  const pathDepth = path.endsWith("/") ? path.split("/").filter(Boolean).length : 0;
  const rootHref = pathDepth ? "../".repeat(pathDepth) : "./";
  const homeHref = `${rootHref}index.html`;
  const stylesheet = `${rootHref}css/style.css?v=${ver("css/style.css")}`;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL ? `<link rel="canonical" href="${SITE_URL}${path}">` : ""}
${noindex ? `<meta name="robots" content="noindex">` : ""}
${ADS_LIVE ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_ID}" crossorigin="anonymous"></script>` : ""}

<meta name="color-scheme" content="light">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="${rootHref}logo-mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body class="${bodyClass}${path === "/" ? " home-page" : ""}${ADS ? " ads-on" : ""}">
<a class="skip" href="#main">Lewati ke isi</a>
<header class="nav">
  <div class="wrap">
    <a class="logo" href="${homeHref}" aria-label="Konvertin, beranda"><img src="${rootHref}logo.svg" alt="" width="159" height="41"></a>
    <nav aria-label="Utama">
      <ul>
        <li class="nl"><a href="${homeHref}#tool">Tool</a></li>
        <li class="nl"><a href="${homeHref}#cara-kerja">Cara kerja</a></li>
        <li class="nl"><a href="${homeHref}#privasi">Privasi</a></li>
        <li class="nl"><a href="${homeHref}#faq">FAQ</a></li>
        ${ACCOUNT_UI ? `<li id="account-login-item"><a id="account-link" href="${rootHref}akun.html">Masuk</a></li>
        <li id="account-menu-item" hidden>
          <details class="account-menu">
            <summary id="account-menu-name">Akun</summary>
            <div class="account-menu-panel">
              <a id="account-dashboard-link" data-user-href="${rootHref}profil.html" data-admin-href="${rootHref}admin.html" href="${rootHref}profil.html">Dashboard</a>
              <a id="account-settings-link" data-user-href="${rootHref}profil.html#settings" data-admin-href="${rootHref}admin.html#admin-tools" href="${rootHref}profil.html#settings">Pengaturan</a>
              <a id="account-history-link" href="${rootHref}riwayat.html">Riwayat konversi</a>
              <button id="account-menu-logout" data-account-logout type="button">Keluar</button>
            </div>
          </details>
        </li>` : ""}
        <li><a class="btn small" href="${homeHref}#tool">Mulai konversi</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="wrap footer-layout">
    <div class="footer-brand">
      <a class="footer-logo" href="${homeHref}" aria-label="Konvertin, kembali ke beranda"><img src="${rootHref}logo.svg" alt="" width="159" height="41"></a>
      <p>Ruang kerja file yang simpel, rapi, dan siap membantu.</p>
    </div>
    <div class="footer-links">
      <span class="footer-label">JELAJAHI KONVERTIN</span>
      <ul>
        <li><a href="${homeHref}#tool">Semua tool</a></li>
        <li><a href="${homeHref}#cara-kerja">Cara kerja</a></li>
        <li><a href="${homeHref}#privasi">Privasi file</a></li>
        <li><a href="${homeHref}#faq">FAQ</a></li>
      </ul>
    </div>
    <div class="footer-meta">
      <ul>
        <li><a href="${rootHref}tentang.html">Tentang</a></li>
        <li><a href="${rootHref}privasi.html">Kebijakan privasi</a></li>
        <li><a href="${rootHref}syarat.html">Syarat penggunaan</a></li>
        <li><a href="${rootHref}kontak.html">Kontak</a></li>
      </ul>
      <span>© ${new Date().getFullYear()} Konvertin</span>
    </div>
  </div>
</footer>
<script src="${rootHref}js/config.js"></script>
${ACCOUNT_UI ? `<script src="${rootHref}js/accounts.js?v=${ver("js/accounts.js")}" defer></script>` : ""}
<script src="${rootHref}js/app.js?v=${ver("js/app.js")}" defer></script>
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
const NAMA = { word: "Word", excel: "Excel", pptx: "PowerPoint", gambar: "Gambar" };
const nama = (x) => NAMA[x] || x.toUpperCase();
const pairs = tools
  .filter((t) => !isSoon(t) && /^[a-z0-9]+-ke-[a-z0-9]+$/.test(t.slug))
  .map((t) => { const [a, b] = t.slug.split("-ke-"); return [a, b, t.slug, nama(b)]; });
const fromLabels = [...new Set(pairs.map((p) => nama(p[0])))];
const toLabels = [...new Set(pairs.map((p) => p[3]))];
// satu kotak per kata; semua label ditumpuk di sel yang sama supaya lebar kotak tetap
const slot = (id, labels) => `<b class="slot" id="${id}">${labels.map((l, i) => `<span${i === 0 ? ' class="on"' : ""}>${l}</span>`).join("")}</b>`;

const index = layout({
  title: "Konvertin: Konverter Dokumen, Spreadsheet, Presentasi, Gambar, dan Audio",
  desc: "Konversi file dokumen, spreadsheet, presentasi, gambar, dan audio di browser atau backend. File server dihapus otomatis.",
  path: "/",
  body: `
<section class="hero">
  <div class="wrap hero-layout">
    <div class="hero-copy">
      <p class="hero-eyebrow"><span aria-hidden="true"></span> Ruang konversi file yang praktis</p>
      <h1>Ubah file.<br><span>Lebih mudah.</span></h1>
      <div class="hero-conversion">
        <span class="hero-conversion-label">PILIHAN FORMAT</span>
        <div class="swap" aria-label="Contoh format yang didukung">
          <b class="slot" id="swap-from">${fromLabels.map((l, i) => `<span${i === 0 ? ' class="on"' : ""}>${l}</span>`).join("")}</b>
          <span class="swap-arrow" aria-hidden="true">→</span>
          <b class="slot" id="swap-to">${toLabels.map((l, i) => `<span${i === 0 ? ' class="on"' : ""}>${l}</span>`).join("")}</b>
        </div>
      </div>
      <p class="lead">${STATIC_MODE ? "Tool yang tersedia di GitHub Pages diproses di browser, jadi file tidak keluar dari perangkatmu. Tool yang membutuhkan server belum aktif di versi ini." : ACCOUNT_UI ? "Gambar dan audio diproses di browser. Konversi Office, spreadsheet, dan presentasi tertentu diproses di server lalu file dihapus paling lama 1 jam setelah selesai. Pakai tanpa akun, atau masuk untuk menyimpan riwayat." : "Gambar dan audio diproses di browser; tool dokumen dan Office tertentu diunggah ke server lalu dihapus otomatis. Versi ini belum menyediakan akun atau riwayat."}</p>
      <div class="hero-go">
        <a class="btn" href="#tool">Jelajahi semua tool <span aria-hidden="true">→</span></a>
        <a class="btn ghost" href="#cara-kerja">Lihat cara kerja</a>
      </div>
      <ul class="hero-highlights" aria-label="Keunggulan Konvertin">
        <li><span aria-hidden="true">✓</span> Tanpa instalasi</li>
        <li><span aria-hidden="true">✓</span> File server dihapus otomatis</li>
      </ul>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="hero-visual-glow"></div>
      <div class="hero-orbit hero-orbit-back"></div>
      <div class="hero-orbit hero-orbit-front"></div>
      <div class="hero-brand">
        <img src="./logo-mark.svg" alt="" width="184" height="184">
      </div>
      <div class="hero-file-card hero-file-doc">
        <span class="hero-file-icon">DOC</span>
        <span><strong>Dokumen</strong><small>Siap dikonversi</small></span>
        <span class="hero-file-check">✓</span>
      </div>
      <div class="hero-file-card hero-file-image">
        <span class="hero-file-icon">IMG</span>
        <span><strong>Gambar</strong><small>JPG · PNG · WEBP</small></span>
      </div>
      <div class="hero-format-chip hero-chip-top">XLSX <span>→</span> CSV</div>
      <div class="hero-format-chip hero-chip-bottom">WAV <span>→</span> MP3</div>
      <span class="hero-spark hero-spark-one"></span>
      <span class="hero-spark hero-spark-two"></span>
    </div>
  </div>
</section>
<script>
(function () {
  var pairs = ${JSON.stringify(pairs.map((p) => [nama(p[0]), p[3]]))};
  var a = document.getElementById("swap-from"), b = document.getElementById("swap-to");
  if (!a || !b || pairs.length < 2) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function show(slot, label) {
    Array.prototype.forEach.call(slot.children, function (s) { s.className = s.textContent === label ? "on" : ""; });
  }
  var i = 0;
  setInterval(function () {
    i = (i + 1) % pairs.length;
    show(a, pairs[i][0]);
    show(b, pairs[i][1]);
  }, 1800);
})();
</script>

<section class="block" id="tool">
  <div class="wrap home-section-wrap">
    <div class="section-heading">
      <div>
        <p class="section-kicker"><span>01</span> WORKSPACE</p>
        <h2>Pilih konversi</h2>
        <p class="section-intro">Temukan tool yang pas, pilih format, lalu lanjutkan dalam beberapa klik.</p>
      </div>
      <div class="tool-count"><strong>${tools.length.toString().padStart(2, "0")}</strong><span>tool tersedia</span></div>
    </div>
    <div class="tool-browser">
      <div class="search">
        <label class="sr-only" for="q">Cari tool</label>
        <input id="q" type="search" placeholder="Cari format atau tool..." autocomplete="off">
        <kbd aria-hidden="true">Ctrl K</kbd>
      </div>
      <span class="search-hint">Pilih kategori untuk mulai menjelajah</span>
    </div>
${catBlocks}
    <p class="empty" id="empty">Tidak ada tool yang cocok. Coba kata lain, misalnya nama format.</p>
  </div>
</section>

<section class="block" id="cara-kerja">
  <div class="wrap home-section-wrap">
    <div class="section-heading">
      <div>
        <p class="section-kicker"><span>02</span> ALUR SEDERHANA</p>
        <h2>Tiga langkah</h2>
        <p class="section-intro">Dari file awal sampai hasil siap diunduh, tanpa alur yang berbelit.</p>
      </div>
    </div>
    <ol class="steps">
      <li><span class="step-icon" aria-hidden="true">↥</span><span class="step-label">LANGKAH 01</span><h3>Masukkan file</h3><p>Tarik file ke area upload atau pilih dari perangkat. Bisa sampai 10 file sekaligus.</p></li>
      <li><span class="step-icon" aria-hidden="true">⇄</span><span class="step-label">LANGKAH 02</span><h3>Pilih format</h3><p>Pilih hasil yang kamu butuhkan dan sesuaikan opsi yang tersedia.</p></li>
      <li><span class="step-icon" aria-hidden="true">↓</span><span class="step-label">LANGKAH 03</span><h3>Unduh hasil</h3><p>Ambil file hasil satu per satu atau unduh sekaligus sebagai ZIP.</p></li>
    </ol>
  </div>
</section>

<section class="block" id="privasi">
  <div class="wrap home-section-wrap">
    <div class="section-heading">
      <div>
        <p class="section-kicker"><span>03</span> KONTROL FILE</p>
        <h2>File kamu, jelas ke mana</h2>
        <p class="section-intro">Kami jelaskan lokasi pemrosesan dan masa simpan supaya kamu tahu apa yang terjadi.</p>
      </div>
    </div>
    <div class="cols privacy-cards">
      <div><span class="privacy-index">A / LOKAL</span><h3>Di browser</h3><p>Gambar, audio, dan beberapa tool PDF diproses langsung di perangkat. File tidak diunggah ke server.</p><span class="privacy-status"><i></i> Tetap di perangkat</span></div>
      <div><span class="privacy-index">B / SERVER</span><h3>Di server</h3><p>Konversi Office dan spreadsheet tertentu diproses server. Nama file diacak selama proses.</p><span class="privacy-status"><i></i> Pemrosesan sementara</span></div>
      <div><span class="privacy-index">C / RETENSI</span><h3>Dihapus otomatis</h3><p>File hasil di server dihapus otomatis paling lama satu jam setelah konversi selesai.</p><span class="privacy-status"><i></i> Maks. 1 jam</span></div>
    </div>
  </div>
</section>

<section class="block" id="batas">
  <div class="wrap home-section-wrap">
    <div class="section-heading">
      <div>
        <p class="section-kicker"><span>04</span> PANDUAN PAKAI</p>
        <h2>Batas penggunaan</h2>
        <p class="section-intro">Batas ini membantu menjaga proses tetap andal dan hasil tetap nyaman diunduh.</p>
      </div>
      <span class="limit-badge"><span></span> Batas saat ini</span>
    </div>
    <div class="table-scroll">
    <table>
      <thead><tr><th>Jenis file</th><th>Ukuran maksimal</th><th>Catatan penggunaan</th></tr></thead>
      <tbody>
        <tr><td>Dokumen</td><td class="mono">25 MB</td><td>Tidak ada OCR. PDF hasil scan belum didukung.</td></tr>
        <tr><td>PDF di browser</td><td class="mono">50 MB</td><td>Gabung dan pisah PDF. Sampai 10 file per proses.</td></tr>
        <tr><td>Gambar</td><td class="mono">20 MB</td><td>Sampai 10 file per proses.</td></tr>
        <tr><td>Audio</td><td class="mono">50 MB / 10 menit</td><td>Mana yang lebih dulu tercapai.</td></tr>
      </tbody>
    </table>
    </div>
  </div>
</section>

<section class="block" id="faq">
  <div class="wrap home-section-wrap faq-layout">
    <div class="section-heading">
      <div>
        <p class="section-kicker"><span>05</span> PUSAT BANTUAN</p>
        <h2>Pertanyaan umum</h2>
        <p class="section-intro">Jawaban singkat untuk membantu kamu mulai menggunakan Konvertin.</p>
      </div>
      <a class="faq-contact" href="./kontak.html">Butuh bantuan? <span aria-hidden="true">↗</span></a>
    </div>
    <div class="faq-list">
    <details><summary>Apakah file saya diunggah?</summary><p>Tergantung tool. Gambar dan audio diproses di browser, jadi tidak diunggah. Konversi dokumen dan kompres PDF, Word, PowerPoint berjalan di server, dan file dihapus otomatis paling lama 1 jam setelah selesai.</p></details>
    <details><summary>Kenapa hasil PDF ke Word layoutnya berubah?</summary><p>PDF menyimpan posisi tiap huruf, bukan struktur paragraf. Mengubahnya ke Word berarti menebak struktur itu, dan tebakan tidak selalu tepat. Tabel rumit dan kolom ganda paling sering bergeser.</p></details>
    <details><summary>Bisa untuk PDF hasil scan?</summary><p>Belum. PDF hasil scan berisi gambar, jadi butuh OCR untuk jadi teks. OCR belum ada di versi ini.</p></details>
    <details><summary>Kenapa konversi audio mengunduh file besar dulu?</summary><p>Mesin konversi audio (sekitar 30 MB) dimuat sekali supaya audio bisa diproses di browser. Setelah itu disimpan oleh browser.</p></details>
    <details><summary>Kenapa kompres PNG hematnya kecil?</summary><p>PNG menyimpan gambar tanpa kehilangan data. Untuk hemat lebih besar, ubah ke WEBP atau JPG, atau kecilkan resolusinya.</p></details>
    <details><summary>Apakah ada batas jumlah konversi?</summary><p>Tool di browser tidak dibatasi. Tool server dibatasi sekitar 20 proses per jam per alamat IP untuk mencegah penyalahgunaan.</p></details>
    </div>
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
  if (t.split) {
    f.push(`<div class="field"><fieldset><legend>Cara pisah</legend><div class="seg">
<label><input type="radio" name="splitmode" value="range" checked><span>Ambil halaman</span></label>
<label><input type="radio" name="splitmode" value="all"><span>Semua halaman</span></label></div></fieldset></div>
<div class="field" id="f-pages"><label for="o-pages">Halaman yang diambil</label><input id="o-pages" type="text" inputmode="text" autocomplete="off" placeholder="contoh: 1-3, 5"><div class="hint">Angka dan rentang, dipisah koma.</div></div>`);
  }
  if (t.upscale) {
    f.push(`<div class="field"><fieldset><legend>Skala</legend><div class="seg">
<label><input type="radio" name="upscale" value="2" checked><span>2x</span></label>
<label><input type="radio" name="upscale" value="4"><span>4x</span></label></div><div class="hint">4x lebih lambat dan butuh memori lebih besar.</div></fieldset></div>`);
  }
  if (t.pageSize) {
    f.push(`<div class="field"><label for="o-page">Ukuran halaman</label><select id="o-page" name="page"><option value="a4" selected>A4, dengan margin</option><option value="asli">Ukuran asli gambar</option></select></div>`);
  }
  if (t.level) {
    f.push(`<div class="field"><fieldset><legend>Level kompres</legend><div class="seg">
<label><input type="radio" name="level" value="light"><span>Ringan</span></label>
<label><input type="radio" name="level" value="medium" checked><span>Sedang</span></label>
<label><input type="radio" name="level" value="max"><span>Maksimal</span></label></div><div class="hint">Maksimal paling kecil, kualitas gambar turun.</div></fieldset></div>`);
  }
  return f.join("\n");
}

function guideHtml(t) {
  const g = guides[t.slug];
  if (!g) return "";
  return `  <section class="guide">
    <h2>Cara memakai</h2>
    <p>${esc(g.use)}</p>
    <ol>${g.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    <h2>Pertanyaan umum</h2>
${g.faq.map((f) => `    <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}
  </section>`;
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
  const limit = t.side === "server" || t.maxMB ? `${t.maxMB} MB per file` : t.cat === "audio" ? "50 MB atau 10 menit per file" : "20 MB per file";
  const dataAttrs = [
    `data-op="${t.op}"`, `data-slug="${t.slug}"`, `data-accept="${esc(t.accept)}"`,
    t.job ? `data-job="${t.job}"` : "", t.outExt ? `data-out="${t.outExt}"` : "",
    t.maxMB ? `data-max-mb="${t.maxMB}"` : "", t.min ? `data-min="${t.min}"` : "", t.compare ? `data-compare="1"` : "",
    soon ? `data-soon="1"` : "",
  ].filter(Boolean).join(" ");

  const notes = (t.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  const body = `
<div class="wrap">
  <p class="crumb"><a href="${rootHref}index.html">Konvertin</a> / <a href="${rootHref}index.html#tool">${catLabel[t.cat]}</a> / ${esc(t.name)}</p>
  <div class="tool-head">
    <h1>${esc(t.h1)}</h1>
    <p>${esc(t.desc)}</p>
  </div>
${[t.warning ? `  <div class="notice"><b>Perlu diketahui</b>${esc(t.warning)}</div>` : "", soon ? `  <div class="notice"><b>Segera</b>Tool ini butuh server dan belum aktif. Tool gambar, audio, dan PDF dasar di beranda sudah bisa dipakai.${SITE_URL ? ` <a href="${rootHref}index.html#tool">Lihat tool yang sudah aktif</a>.` : ""}</div>` : ""].filter(Boolean).join("\n")}
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
${ADS_LIVE && ADSENSE_SLOT ? `      <div class="ad-slot" data-slot="bawah-upload"><ins class="adsbygoogle" style="display:block" data-ad-client="${ADSENSE_ID}" data-ad-slot="${ADSENSE_SLOT}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>` : ""}
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
${guideHtml(t)}
</div>
<div style="height:72px"></div>`;
  return layout({ title: `${t.title} | Konvertin`, desc: t.desc, path: `/${t.slug}/`, body, noindex: soon });
}

for (const t of tools) write(`${t.slug}/index.html`, toolPage(t));

// ---------- halaman statis ----------
write("404.html", layout({
  title: "Halaman tidak ditemukan | Konvertin", desc: "Halaman tidak ditemukan.", path: "/404.html",
  body: `<div class="wrap nf"><h1>Halaman tidak ada</h1><p class="muted">Alamat yang kamu buka tidak ditemukan. Mungkin salah ketik, atau tool itu belum dibuat.</p><a class="btn" href="./index.html#tool">Lihat semua tool</a></div>`,
}));

const accountPages = [
  ["akun.html", "Akun | Konvertin", `
<div class="wrap account-wrap">
  <p class="eyebrow">Ruang kerja Konvertin</p><h1>Akun Konvertin</h1>
  <p id="account-message" class="notice" role="status" hidden></p>
  <section id="account-signed-in" class="account-card" hidden>
    <h2 id="welcome-name"></h2><p>Kelola konversi, paket, dan preferensi akun dari dashboard.</p>
    <p><a id="signed-in-dashboard" class="btn" href="./profil.html">Buka dashboard</a>
    <a class="btn ghost" href="./riwayat.html">Riwayat konversi</a>
    <button class="btn ghost" id="logout-button" data-account-logout type="button">Keluar</button></p>
  </section>
  <div id="account-forms" class="account-columns">
    <form id="login-form" class="account-card">
      <p class="eyebrow">Selamat datang kembali</p><h2>Masuk</h2>
      <label>Email<input type="email" name="email" autocomplete="username" required maxlength="254"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
      <button class="btn" type="submit">Masuk ke akun</button>
      <div class="login-divider"><span>atau</span></div>
      <a class="btn google-login" href="/api/auth/google">Masuk atau daftar dengan Google</a>
      <p class="hint">Akun Google terverifikasi otomatis mendapat dashboard pengguna. Email admin yang dikonfigurasi mendapat akses admin; hanya akun Google pemilik yang diizinkan mendapat akses superadmin.</p>
    </form>
    <form id="register-form" class="account-card">
      <p class="eyebrow">Mulai gratis</p><h2>Buat akun</h2>
      <label>Nama lengkap<input type="text" name="display_name" autocomplete="name" required maxlength="80"></label>
      <label>Email<input type="email" name="email" autocomplete="email" required maxlength="254"></label>
      <label>Nomor telepon/WhatsApp (opsional)<input type="tel" name="phone" autocomplete="tel" maxlength="30"></label>
      <label>Password<input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="256"><span class="hint">Minimal 10 karakter.</span></label>
      <button class="btn" type="submit">Buat akun gratis</button>
    </form>
  </div>
  <form id="verification-resend-form" class="account-card">
    <h2>Belum menerima email verifikasi?</h2>
    <label>Email akun<input type="email" name="email" autocomplete="email" required maxlength="254"></label>
    <button class="btn ghost" type="submit">Kirim ulang tautan verifikasi</button>
  </form>
  <p class="muted">Daftar dengan email pribadi. Riwayat menyimpan metadata aktivitas, bukan isi file; file server tetap sementara.</p>
</div>`],
  ["profil.html", "Dashboard akun | Konvertin", `
<div class="wrap account-wrap dashboard-page user-dashboard">
  <p class="eyebrow">Ruang kerja Konvertin</p><h1>Dashboard pengguna</h1>
  <p class="muted">Pantau aktivitas, kuota, langganan, dan bantuan dari satu tempat.</p>
  <p id="account-message" class="notice" role="status" hidden></p>
  <div id="user-announcements"></div>
  <div id="user-notifications" aria-live="polite"></div>
  <section class="account-hero account-card">
    <div><p class="eyebrow">Akun aktif</p><h2 id="dashboard-welcome">Memuat akun...</h2><p id="dashboard-email" class="muted"></p><span id="dashboard-email-status" class="status-pill pending">Status verifikasi email</span></div>
    <div class="hero-actions"><a class="btn" href="./index.html#tool">Mulai konversi</a><a class="btn ghost" href="./riwayat.html">Buka riwayat</a></div>
  </section>
  <div class="stats-grid user-stats">
    <article class="stat-card"><span>Paket</span><strong id="account-plan-name">—</strong><small id="account-plan-status"></small></article>
    <article class="stat-card"><span>Sisa kuota hari ini</span><strong id="account-quota-remaining">—</strong><small id="account-quota-detail"></small></article>
    <article class="stat-card"><span>Maksimum file</span><strong id="account-file-limit">—</strong><small>Per file · batas server berlaku</small></article>
  </div>
  <div class="dashboard-links">
    <a href="#recent-activity">Riwayat konversi <span>›</span></a><a href="#billing">Paket &amp; tagihan <span>›</span></a><a href="#settings">Profil &amp; preferensi <span>›</span></a><a href="#help">Bantuan &amp; feedback <span>›</span></a>
  </div>
  <section id="recent-activity" class="dashboard-section">
    <div class="section-heading"><div><p class="eyebrow">Aktivitas terbaru</p><h2>Riwayat konversi</h2></div><a class="btn ghost" href="./riwayat.html">Lihat semua</a></div>
    <div id="recent-history" class="account-card"><p class="muted">Memuat aktivitas...</p></div>
  </section>
  <section id="billing" class="dashboard-section">
    <div class="section-heading"><div><p class="eyebrow">Paket dan pembayaran</p><h2>Kelola langganan</h2></div><p class="muted" id="billing-status"></p></div>
    <div id="plans-list" class="plan-grid"><p class="muted">Memuat paket...</p></div>
    <h3>Riwayat pembayaran</h3><div id="payment-list" class="table-scroll"><p class="muted">Memuat pembayaran...</p></div>
    <p class="hint">Pembayaran baru diproses melalui Midtrans. Langganan hanya aktif atau diperpanjang setelah notifikasi pembayaran tervalidasi. Jika masa aktif berakhir, akun otomatis kembali ke paket Free; pilihan notifikasi tetap mengikuti pengaturan akun.</p>
  </section>
  <section id="settings" class="dashboard-section">
    <div class="section-heading"><div><p class="eyebrow">Pengaturan</p><h2>Profil dan preferensi</h2></div></div>
    <div class="account-columns">
      <form id="profile-form" class="account-card"><h3>Profil</h3>
        <label>Nama lengkap<input type="text" name="display_name" required maxlength="80"></label>
        <label>Email<input type="email" name="email" disabled></label>
        <label>Nomor telepon/WhatsApp (opsional)<input type="tel" name="phone" autocomplete="tel" maxlength="30"></label>
        <button class="btn" type="submit">Simpan profil</button>
      </form>
      <form id="password-form" class="account-card"><h3>Keamanan akun</h3>
        <label>Password saat ini<input type="password" name="current_password" autocomplete="current-password" required maxlength="256"></label>
        <label>Password baru<input type="password" name="new_password" autocomplete="new-password" required minlength="10" maxlength="256"><span class="hint">Gunakan minimal 10 karakter.</span></label>
        <button class="btn" type="submit">Perbarui password</button>
      </form>
      <form id="preferences-form" class="account-card"><h3>Notifikasi</h3>
        <label class="check-label"><input type="checkbox" name="email_notifications"> Notifikasi penting melalui email</label>
        <label class="check-label"><input type="checkbox" name="product_updates"> Informasi produk dan pemeliharaan</label>
        <p class="hint">Preferensi disimpan pada akun. Pengiriman email memerlukan layanan email yang dikonfigurasi.</p>
        <button class="btn" type="submit">Simpan preferensi</button>
      </form>
    </div>
  </section>
  <section id="help" class="dashboard-section">
    <div class="section-heading"><div><p class="eyebrow">Kami siap membantu</p><h2>Bantuan dan feedback</h2></div></div>
    <div class="account-columns">
      <form id="support-form" class="account-card"><h3>Kirim laporan</h3>
        <label>Jenis laporan<select name="category"><option value="help">Minta bantuan</option><option value="bug">Laporkan masalah</option><option value="feedback">Berikan feedback</option><option value="billing">Masalah pembayaran</option></select></label>
        <label>Judul<input type="text" name="subject" required maxlength="120"></label>
        <label>Detail<textarea name="message" rows="5" required maxlength="5000"></textarea></label>
        <button class="btn" type="submit">Kirim ke tim Konvertin</button>
      </form>
      <div class="account-card"><h3>Laporan saya</h3><div id="support-list"><p class="muted">Memuat laporan...</p></div></div>
    </div>
  </section>
</div>`],
  ["riwayat.html", "Riwayat konversi | Konvertin", `
<div class="wrap account-wrap dashboard-page">
  <p class="eyebrow">Aktivitas akun</p><h1>Riwayat konversi</h1>
  <p id="account-message" class="notice" role="status" hidden></p>
  <div class="section-heading"><p class="muted">Status terbaru, hasil yang masih tersedia, dan riwayat aktivitasmu.</p><button class="btn ghost" id="clear-history" type="button">Hapus semua riwayat</button></div>
  <div id="history-list" class="account-card"><p>Memuat riwayat...</p></div>
  <p class="muted">File hasil server tersedia paling lama satu jam. Riwayat browser tidak menyimpan file; file hasil browser diunduh langsung ke perangkat.</p>
</div>`],
  ["admin.html", "Pusat Admin | Konvertin", `
<div class="wrap account-wrap dashboard-page admin-page">
  <div class="section-heading"><div><p class="eyebrow">Konvertin · Control center</p><h1>Pusat Admin</h1><p id="dashboard-email" class="muted"></p><p id="admin-role-summary" class="role-summary"></p></div><button class="btn ghost" id="admin-logout" data-account-logout type="button">Keluar</button></div>
  <p id="account-message" class="notice" role="status" hidden></p>
  <nav class="dashboard-links admin-nav" aria-label="Navigasi admin">
    <a href="#admin-overview">Ringkasan <span>›</span></a><a href="#admin-users">Akun user <span>›</span></a><a href="#admin-tools">Konverter &amp; batas <span>›</span></a>
    <a href="#admin-plans">Paket <span>›</span></a><a href="#admin-payments">Pembayaran <span>›</span></a><a href="#admin-jobs">Antrean <span>›</span></a>
    <a href="#admin-support">Bantuan <span>›</span></a><a href="#admin-announcements">Pengumuman <span>›</span></a><a href="#admin-audit">Log admin <span>›</span></a>
  </nav>
  <section id="admin-overview" class="dashboard-section">
    <div class="section-heading"><div><p class="eyebrow">Ikhtisar layanan</p><h2>Ringkasan operasional</h2></div>
      <label>Periode<select id="usage-days"><option value="7">7 hari</option><option value="30" selected>30 hari</option><option value="90">90 hari</option></select></label>
    </div>
    <div class="stats-grid admin-stats">
      <article class="stat-card"><span>Total user</span><strong id="admin-users-total">—</strong><small id="admin-users-new"></small></article>
      <article class="stat-card"><span>Konversi</span><strong id="admin-conversions-total">—</strong><small id="admin-conversions-failed"></small></article>
      <article id="admin-premium-stat" class="stat-card"><span>Pelanggan Premium</span><strong id="admin-premium-total">—</strong><small>Langganan aktif</small></article>
      <article id="admin-revenue-stat" class="stat-card"><span>Pendapatan 30 hari</span><strong id="admin-revenue-total">—</strong><small>Dari pembayaran berstatus paid</small></article>
      <article class="stat-card"><span>Keberhasilan proses</span><strong id="admin-success-rate">—</strong><small>Sesuai rentang waktu pilihan</small></article>
      <article class="stat-card"><span>Tiket terbuka</span><strong id="admin-open-tickets">—</strong><small>Perlu ditindaklanjuti</small></article>
    </div>
    <div class="account-columns">
      <div class="account-card"><h3>Tren penggunaan harian</h3><p id="usage-total" class="usage-total"></p><canvas id="usage-chart" width="900" height="300" aria-label="Grafik konversi per hari"></canvas><h3>Komposisi penggunaan</h3><div class="usage-mix"><canvas id="usage-mix-chart" width="320" height="260" aria-label="Diagram komposisi tool"></canvas><ul id="usage-mix-legend" class="usage-mix-legend"></ul></div><h3>Tool paling sering dipakai</h3><div id="usage-types"></div><p class="hint">Analitik dihitung dari aktivitas yang tercatat di Konvertin pada periode pilihan; bukan data pihak ketiga.</p></div>
      <div class="account-card"><h3>Kondisi sistem</h3><div id="system-status" class="system-metrics">Memuat metrik...</div></div>
    </div>
  </section>
  <section id="admin-users" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Akses dan pelanggan</p><h2>Kelola akun user</h2></div><input id="users-search" type="search" placeholder="Cari nama atau email" aria-label="Cari akun user"></div>
    <p class="hint">Admin dapat melihat data profil yang diberikan pengguna, riwayat metadata konversi, pembayaran, preferensi, dan tiket bantuan. Data sensitif yang tidak diperlukan tidak dikumpulkan.</p><div id="users-list" class="table-scroll"><p>Memuat user...</p></div>
    <dialog id="user-detail-dialog" class="account-dialog">
      <div class="section-heading"><div><p class="eyebrow">Data akun terpadu</p><h2 id="user-detail-title">Detail pengguna</h2></div><button id="user-detail-close" class="btn ghost" type="button">Tutup</button></div>
      <div id="user-detail-content"><p class="muted">Pilih akun untuk memuat data.</p></div>
      <form id="user-notification-form" class="account-card">
        <h3>Kirim notifikasi atau peringatan</h3><input type="hidden" name="user_id">
        <label>Jenis<select name="kind"><option value="info">Informasi</option><option value="warning">Peringatan</option><option value="critical">Peringatan keras</option></select></label>
        <label>Judul<input name="title" required maxlength="120"></label>
        <label>Pesan<textarea name="message" rows="4" required maxlength="3000"></textarea></label>
        <p id="user-notification-delivery" class="hint">Notifikasi tersimpan di dashboard user. Email terkirim jika sudah diverifikasi dan notifikasi email aktif.</p>
        <button class="btn" type="submit">Kirim notifikasi</button>
      </form>
    </dialog>
  </section>
  <section id="admin-tools" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Konfigurasi layanan</p><h2>Konverter, format, dan batas</h2></div></div>
    <form id="limits-form" class="account-card limits-grid">
      <label>Kuota Free per hari<input name="free_daily_quota" type="number" min="1" max="100000" required></label>
      <label>Kuota Premium per hari<input name="premium_daily_quota" type="number" min="1" max="100000" required></label>
      <label>Maksimum file Free (MB)<input name="free_max_file_mb" type="number" min="1" required></label>
      <label>Maksimum file Premium (MB)<input name="premium_max_file_mb" type="number" min="1" required></label>
      <p class="hint">Batas ukuran maksimum ini tidak dapat melewati limit server yang ditetapkan saat deployment. Batas halaman PDF adalah konfigurasi server.</p><button class="btn" type="submit">Simpan batas</button>
    </form>
    <h3>Format dan ketersediaan tool</h3><p class="hint">Daftar menunjukkan format yang benar-benar didukung aplikasi. Admin dapat mengaktifkan/nonaktifkan tool; format baru perlu ditambahkan melalui implementasi konverter.</p>
    <div id="features-list" class="table-scroll"><p>Memuat konverter...</p></div>
  </section>
  <section id="admin-plans" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Monetisasi</p><h2>Paket Free &amp; Premium</h2></div></div>
    <div id="admin-plans-list" class="table-scroll"><p>Memuat paket...</p></div>
  </section>
  <section id="admin-payments" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Midtrans · transaksi baru</p><h2>Pembayaran dan langganan</h2></div></div>
    <p id="gateway-status" class="notice"></p><div id="admin-payments-list" class="table-scroll"><p>Memuat transaksi...</p></div>
  </section>
  <section id="admin-jobs" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Kesehatan pemrosesan</p><h2>Antrean dan kegagalan</h2></div></div>
    <div id="jobs-list" class="table-scroll"><p>Memuat antrean...</p></div>
  </section>
  <section id="admin-support" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Layanan pelanggan</p><h2>Laporan dan permintaan bantuan</h2></div></div>
    <div id="admin-support-list" class="support-admin-list"><p>Memuat laporan...</p></div>
  </section>
  <section id="admin-announcements" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Komunikasi layanan</p><h2>Pengumuman &amp; pemeliharaan</h2></div></div>
    <form id="announcement-form" class="account-card">
      <input type="hidden" name="announcement_id">
      <label>Judul<input name="title" required maxlength="120"></label><label>Pesan<textarea name="message" rows="3" required maxlength="3000"></textarea></label>
      <div class="limits-grid"><label>Jenis<select name="kind"><option value="info">Informasi</option><option value="maintenance">Pemeliharaan</option><option value="warning">Peringatan</option></select></label>
        <label>Mulai ditampilkan (opsional)<input type="datetime-local" name="starts_at"></label>
        <label>Berakhir (opsional)<input type="datetime-local" name="ends_at"></label>
        <label class="check-label"><input type="checkbox" name="published" checked> Tampilkan saat jadwal aktif</label></div>
      <button class="btn" id="announcement-submit" type="submit">Terbitkan pengumuman</button>
      <button class="btn ghost" id="announcement-reset" type="button" hidden>Batal mengedit</button>
    </form><div id="announcements-list" class="support-admin-list"><p>Memuat pengumuman...</p></div>
  </section>
  <section id="admin-audit" class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Keamanan</p><h2>Log aktivitas admin</h2></div></div>
    <div id="audit-list" class="table-scroll"><p>Memuat log...</p></div>
  </section>
</div>`],
];
for (const [path, title, body] of accountPages) {
  if (ACCOUNT_UI) write(path, layout({
    title, desc: title, path: `/${path}`, body, noindex: true,
    scripts: path === "admin.html" ? `<script src="./js/admin.js?v=${ver("js/admin.js")}" defer></script>` : "",
  }));
  else if (existsSync(join(root, path))) unlinkSync(join(root, path));
}

write("privasi.html", layout({
  title: "Kebijakan Privasi | Konvertin", desc: "Apa yang diproses di browser, apa yang lewat server, dan kapan file dihapus.", path: "/privasi.html",
  body: `<div class="wrap prose">
<h1>Kebijakan privasi</h1>
<p class="muted">Terakhir diubah 15 Oktober 2026. Tinjau ulang sebelum rilis publik, terutama bagian iklan dan cookie.</p>
<h2>Yang diproses di browser</h2>
<p>Konversi gambar, kompres gambar, ubah ukuran gambar, upscale gambar, konversi audio, gabung PDF, pisah PDF, dan gambar ke PDF berjalan sepenuhnya di browser kamu. File tidak dikirim ke server kami. ${FFMPEG_NOTE}</p>
<h2>${STATIC_MODE ? "Privasi versi GitHub Pages" : "Yang lewat server"}</h2>
<p>${STATIC_MODE ? "Versi GitHub Pages ini hanya menyediakan tool yang berjalan di browser. Tool yang memerlukan server belum aktif." : "Konversi Office, spreadsheet CSV/XLSX, dan kompres dokumen tertentu membutuhkan server. File kamu diunggah, diproses di wadah terisolasi tanpa akses internet, dan hasilnya tersedia untuk kamu unduh."}</p>
${!STATIC_MODE ? `<ul>
<li>File input dan hasil dihapus otomatis paling lama 1 jam setelah selesai.</li>
<li>Nama file di penyimpanan diacak.</li>
<li>Kami tidak membaca isi file, dan isi file tidak dicatat di log.</li>
<li>Kami mencatat jenis konversi, status, dan waktu. Alamat IP dipakai sementara di memori untuk pembatasan laju dan tidak disimpan di database.</li>
</ul>` : `<p>Tool browser memproses file di perangkatmu. File tidak dikirim ke server Konvertin.</p>`}
<h2>Akun</h2>
${ACCOUNT_UI ? `<p>Kamu dapat memakai tool tanpa akun. Sistem mencatat jumlah konversi browser dan server secara agregat, termasuk penggunaan tanpa akun. Jika mendaftar, kami menyimpan email, nama tampilan, dan hash password untuk mengelola akun. Sesi masuk disimpan dalam cookie HttpOnly. Untuk akun login, riwayat mencatat jenis tool, sumber proses (browser/server), status, dan waktu; nama file serta isi file tidak dicatat. Riwayat disimpan sampai 1 tahun. File hasil tetap dihapus otomatis paling lama 1 jam setelah selesai.</p>
<p>Admin hanya dapat melihat jumlah penggunaan agregat per hari dan jenis tool, tanpa akses ke file atau riwayat per pengguna.</p>` : `<p>Fitur akun, riwayat, dan dashboard admin belum tersedia di situs GitHub Pages ini.</p>`}
<h2>Iklan dan cookie</h2>
<p>Situs ini direncanakan menampilkan iklan lewat Google AdSense. Saat iklan aktif, Google dapat memakai cookie untuk menampilkan iklan, dan kami akan menampilkan banner persetujuan cookie. Bagian ini harus diperbarui saat iklan dipasang.</p>
<h2>Kontak</h2>
<p>Pertanyaan soal privasi: ${EMAIL}.</p>
</div>`,
}));

write("tentang.html", layout({
  title: "Tentang Konvertin", desc: "Apa itu Konvertin, siapa yang membuatnya, dan kenapa sebagian besar konversi berjalan di browser.", path: "/tentang.html",
  body: `<div class="wrap prose">
<h1>Tentang Konvertin</h1>
<p>Konvertin adalah konverter file berbahasa Indonesia untuk pekerjaan sehari-hari: mengubah format gambar dan audio, memperkecil ukuran gambar, serta mengubah dokumen PDF, Word, PowerPoint, dan Excel.</p>
<h2>Kenapa dibuat</h2>
<p>${ACCOUNT_UI ? "Konvertin bisa dipakai tanpa akun, dan sebisa mungkin file tidak meninggalkan perangkatmu. Akun opsional menyimpan riwayat metadata konversi, bukan file." : STATIC_MODE ? "Versi GitHub Pages ini memakai tool browser dan tidak menyediakan akun. File yang diproses tool browser tidak diunggah ke server." : "Gambar dan audio diproses di browser; dokumen dikirim ke backend untuk diproses. Versi ini belum menyediakan akun."}</p>
<h2>Cara kerjanya</h2>
<ul>
<li><b>Gambar dan audio</b> diproses di browser. File tidak diunggah ke server kami.</li>
<li><b>Dokumen</b> membutuhkan server. Jika backend tersedia, file diproses di wadah terisolasi dan dihapus otomatis paling lama 1 jam setelah selesai.</li>
</ul>
<p>Rincian lengkap ada di <a href="./privasi.html">kebijakan privasi</a>.</p>
<h2>Pembuat</h2>
<p>Konvertin dibuat oleh seorang mahasiswa sebagai proyek kuliah, dan dikembangkan terbuka di <a href="https://github.com/nopanpeno/konvertin" rel="noopener">GitHub</a>. Masukan dan laporan masalah bisa dikirim lewat halaman <a href="./kontak.html">kontak</a>.</p>
<h2>Batasan yang jujur</h2>
<p>Hasil konversi bisa berbeda dari file asli, terutama PDF ke Word. Periksa hasilnya sebelum dipakai untuk hal penting. Tidak ada OCR, jadi PDF hasil scan belum didukung.</p>
</div>`,
}));

write("kontak.html", layout({
  title: "Kontak | Konvertin", desc: "Cara menghubungi Konvertin untuk laporan masalah, saran, atau pertanyaan.", path: "/kontak.html",
  body: `<div class="wrap prose">
<h1>Kontak</h1>
<p>Kirim laporan masalah, saran tool baru, atau pertanyaan ke <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>
<h2>Supaya laporan cepat ditangani</h2>
<ul>
<li>Sebutkan tool yang dipakai, misalnya "JPG ke WEBP".</li>
<li>Sebutkan jenis dan ukuran file, serta browser dan perangkat yang dipakai.</li>
<li>Jelaskan pesan yang muncul, atau apa yang kamu harapkan dan apa yang terjadi.</li>
<li>Jangan melampirkan file yang berisi data pribadi atau rahasia.</li>
</ul>
<p>Kami membalas sebisanya. Konvertin dikelola sendirian sebagai proyek kuliah, jadi balasan bisa butuh beberapa hari.</p>
<p>Kode sumber dan daftar masalah ada di <a href="https://github.com/nopanpeno/konvertin/issues" rel="noopener">GitHub</a>.</p>
</div>`,
}));

write("syarat.html", layout({
  title: "Syarat Penggunaan | Konvertin", desc: "Syarat memakai Konvertin.", path: "/syarat.html",
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
  const urls = ["/", ...tools.filter((t) => !isSoon(t)).map((t) => `/${t.slug}/`), "/tentang.html", "/privasi.html", "/syarat.html", "/kontak.html"];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
}
if (ADS_LIVE) write("ads.txt", `google.com, ${ADSENSE_ID.replace("ca-", "")}, DIRECT, f08c47fec0942fa0\n`);
write("robots.txt", `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
write(".nojekyll", "");
write("_headers", `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/vendor/ffmpeg-core/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`Selesai: ${tools.length} halaman tool + beranda. API_BASE=${API_BASE || "(kosong)"} ADS=${ADS}`);
