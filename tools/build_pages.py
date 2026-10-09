#!/usr/bin/env python3
"""Hasilkan halaman HTML statis dari satu template (PRD bagian 7: tanpa framework).

Jalankan:  python3 tools/build_pages.py
Output:    frontend/index.html, frontend/<slug>/index.html, privasi, syarat, 404.
Ubah SITE_URL / API_BASE / CONTACT_EMAIL di bawah sebelum rilis.
"""
import html
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "frontend"
SITE_URL = "https://konvertin.example"  # TODO: ganti dengan domain asli sebelum rilis (dipakai canonical & sitemap)
API_BASE = ""  # kosong = satu origin. Isi mis. "https://api.konvertin.id" kalau frontend di Pages terpisah.
CONTACT_EMAIL = ""  # TODO: isi email kontak (wajib untuk AdSense). Kosong = tautan kontak tidak ditampilkan.
MAX_MB, MAX_FILES, TTL = 25, 10, "1 jam"

SCAN_WARN = "PDF hasil scan (isinya gambar, bukan teks) belum didukung di versi ini karena butuh OCR."
LAYOUT_WARN = "Hasil PDF ke Word bisa berubah tata letaknya (tabel, kolom, font khusus). Cek hasilnya sebelum dipakai."

TOOLS = [
    dict(slug="pdf-ke-word", type="pdf_to_docx", kind="pdf", accept=".pdf", title="PDF ke Word", short="PDF ke DOCX", out="DOCX",
         desc="Ubah PDF berteks jadi dokumen Word (.docx) yang bisa diedit.",
         warn=[LAYOUT_WARN, SCAN_WARN],
         faq=[("Kenapa tata letak hasilnya beda dengan PDF?", "PDF menyimpan posisi tiap teks, sedangkan Word menyimpan alur paragraf. Mengubah satu ke yang lain berarti menebak struktur. Dokumen sederhana biasanya rapi, tabel rumit dan kolom banyak bisa bergeser."),
              ("Bisakah PDF hasil scan diubah?", "Belum. PDF scan isinya gambar, jadi butuh OCR. Fitur itu tidak ada di versi ini."),
              ("Apakah file saya aman?", "File diunggah ke server kami untuk diproses, lalu dihapus otomatis maksimal 1 jam setelah selesai. Lihat halaman privasi.")]),
    dict(slug="word-ke-pdf", type="docx_to_pdf", kind="docx", accept=".docx", title="Word ke PDF", short="DOCX ke PDF", out="PDF",
         desc="Ubah dokumen Word (.docx) jadi PDF yang tampilannya sama di semua perangkat.",
         warn=["Hanya format .docx. File .doc lama: buka di Word, simpan sebagai .docx dulu.", "Font yang tidak ada di server diganti font mirip, jadi baris bisa bergeser sedikit."],
         faq=[("Kenapa .doc ditolak?", "Format .doc lama tidak didukung di versi ini. Simpan ulang sebagai .docx dari Word."),
              ("Dokumen saya ada password.", "File terproteksi password ditolak. Buka kuncinya dulu di Word, simpan, lalu unggah.")]),
    dict(slug="ppt-ke-pdf", type="pptx_to_pdf", kind="pptx", accept=".pptx", title="PowerPoint ke PDF", short="PPTX ke PDF", out="PDF",
         desc="Ubah presentasi PowerPoint (.pptx) jadi PDF, satu slide per halaman.",
         warn=["Hanya format .pptx. Animasi dan transisi tidak ikut ke PDF.", "Font yang tidak ada di server diganti font mirip."],
         faq=[("Animasi slide ikut?", "Tidak. PDF adalah dokumen statis, tiap slide menjadi satu halaman.")]),
    dict(slug="excel-ke-pdf", type="xlsx_to_pdf", kind="xlsx", accept=".xlsx", title="Excel ke PDF", short="XLSX ke PDF", out="PDF",
         desc="Ubah spreadsheet Excel (.xlsx) jadi PDF.",
         warn=["Hanya format .xlsx. Lembar yang lebar bisa terpotong ke beberapa halaman; atur area cetak di Excel kalau perlu."],
         faq=[("Semua sheet ikut?", "Ya, semua sheet yang bisa dicetak masuk ke PDF sesuai pengaturan cetak di file Excel-nya.")]),
    dict(slug="pdf-ke-txt", type="pdf_to_txt", kind="pdf", accept=".pdf", title="PDF ke TXT", short="PDF ke teks polos", out="TXT",
         desc="Ambil teks dari PDF berteks jadi file .txt.",
         warn=[SCAN_WARN, "Hanya teks yang diambil. Gambar dan format tidak ikut."],
         faq=[("Tabel di PDF jadi apa?", "Teks tabel tetap terambil dengan jarak antar kolom dipertahankan semampunya, tapi bukan tabel sungguhan.")]),
    dict(slug="word-ke-txt", type="docx_to_txt", kind="docx", accept=".docx", title="Word ke TXT", short="DOCX ke teks polos", out="TXT",
         desc="Ambil teks dari dokumen Word (.docx) jadi file .txt.",
         warn=["Hanya teks yang diambil. Gambar, gaya, dan format tidak ikut."],
         faq=[]),
]

FUTURE = {
    "Gambar": [("Konversi gambar", "JPG, PNG, WEBP"), ("HEIC ke JPG", "Foto iPhone")],
    "Audio": [("Konversi audio", "MP3, WAV, M4A, OGG, FLAC")],
    "Kompres": [("Kompres gambar", "JPG, PNG, WEBP"), ("Kompres PDF", "3 level")],
}

e = html.escape


def head(title, desc, path, extra=""):
    return f"""<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE_URL}{path}">
<meta name="konvertin-api" content="{e(API_BASE)}">
<meta name="theme-color" content="#1a1816">
<link rel="stylesheet" href="/assets/style.css">
{extra}</head>
<body>
<a class="skip" href="#main">Lompat ke konten</a>
"""


NAV = """<header class="nav"><div class="wrap">
<a class="logo" href="/">konvertin<i>.</i></a>
<a href="/#tool">Tool</a><a href="/#cara-kerja">Cara kerja</a><a href="/#privasi">Privasi</a><a href="/#faq">FAQ</a>
<a class="btn sm" href="/#tool">Mulai konversi</a>
</div></header>
"""


def footer():
    contact = f'<a href="mailto:{e(CONTACT_EMAIL)}">Kontak</a>' if CONTACT_EMAIL else ""
    return f"""<footer><div class="wrap"><span>konvertin.</span><a href="/privasi/">Kebijakan privasi</a><a href="/syarat/">Syarat penggunaan</a>{contact}</div></footer>
"""


def tail(script=True, extra=""):
    return f"{extra}{'<script src=\"/assets/app.js\" defer></script>' if script else ''}\n</body>\n</html>\n"


def write(rel, content):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def tool_page(t):
    others = "".join(f'<a class="tool" href="/{o["slug"]}/"><strong>{e(o["title"])}</strong><small>{e(o["short"])}</small></a>' for o in TOOLS if o is not t)
    warn = "".join(f"<p style='margin:0 0 6px'>{e(w)}</p>" for w in t["warn"])
    faq = "".join(f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in t["faq"])
    ld = json.dumps({"@context": "https://schema.org", "@type": "WebApplication", "name": f"Konvertin {t['title']}", "applicationCategory": "UtilitiesApplication",
                     "operatingSystem": "Web", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "IDR"}, "inLanguage": "id"}, ensure_ascii=False)
    tools_js = json.dumps([{"kind": o["kind"], "title": o["title"], "href": f"/{o['slug']}/"} for o in TOOLS], ensure_ascii=False)
    s = head(f"{t['title']} Online Gratis | Konvertin", t["desc"], f"/{t['slug']}/", f'<script type="application/ld+json">{ld}</script>\n')
    s += NAV + f"""<main id="main" class="wrap">
<div class="tool-head">
<div class="crumb"><a href="/">Beranda</a> / Dokumen / {e(t['title'])}</div>
<h1>{e(t['title'])}</h1>
<p>{e(t['desc'])}</p>
</div>
<div class="notice" role="note"><b>Perlu diketahui.</b>
{warn}</div>
<div id="tool" data-type="{t['type']}" data-accept="{t['accept']}" data-kind="{t['kind']}">
<label class="dropzone" id="dropzone">
<strong>Tarik file ke sini, atau klik untuk memilih</strong>
<span class="mono">{t['accept']} &rarr; .{t['out'].lower()}</span>
<input id="file-input" type="file" accept="{t['accept']}" multiple>
</label>
<p class="info" id="limit-info"></p>
<ul class="files" id="files" aria-live="polite"></ul>
<div class="opts"><b>Hasil</b><span>{e(t['out'])} (satu format, tanpa opsi tambahan)</span><b>Dihapus</b><span>otomatis maks {TTL} setelah selesai</span></div>
<div class="actions">
<button class="btn" id="go" type="button" disabled>Konversi</button>
<button class="btn ghost hidden" id="zip" type="button">Unduh semua (ZIP)</button>
<button class="btn ghost hidden" id="clear" type="button">Kosongkan daftar</button>
</div>
</div>
<!-- Slot iklan: dicadangkan di samping/bawah area upload saat AdSense aktif (Fase 4). Jangan menutupi dropzone, opsi, atau tombol unduh. -->
<section class="block prose" aria-labelledby="langkah">
<h2 id="langkah">Caranya</h2>
<ol class="steps"><li><b>Upload</b><span>Pilih atau tarik file {t['accept']}.</span></li><li><b>Konversi</b><span>Klik Konversi, tunggu progress selesai.</span></li><li><b>Download</b><span>Unduh hasil {e(t['out'])}.</span></li></ol>
</section>
{'<section class="prose" aria-labelledby="faq"><h2 id="faq">Pertanyaan</h2>' + faq + '</section>' if faq else ''}
<section class="others"><span class="label">Tool dokumen lain</span><div class="grid" style="margin-top:10px">{others}</div></section>
</main>
""" + footer() + tail(extra=f"<script>window.KONVERTIN_TOOLS={tools_js};</script>\n")
    write(f"{t['slug']}/index.html", s)


def home():
    doc_cards = "".join(
        f'<a class="tool" data-tool="{e(t["title"] + " " + t["short"] + " dokumen")}" href="/{t["slug"]}/"><strong>{e(t["title"])}</strong><small>{e(t["short"])}</small></a>' for t in TOOLS)
    soon = ""
    for cat, tools in FUTURE.items():
        cards = "".join(f'<div class="tool soon" data-tool="{e(n + " " + cat)}"><strong>{e(n)}<span class="tag">Segera</span></strong><small>{e(d)}</small></div>' for n, d in tools)
        soon += f'<div class="cat"><span class="label">{cat}</span><div class="grid" style="margin-top:10px">{cards}</div></div>'
    s = head("Konvertin: Konverter File Dokumen Online, Tanpa Daftar", "Ubah PDF ke Word, Word ke PDF, PowerPoint dan Excel ke PDF, PDF ke teks. Tanpa daftar, file dihapus otomatis maksimal 1 jam.", "/")
    s += NAV + f"""<main id="main">
<div class="wrap hero">
<span class="label">Konverter file</span>
<h1>Ubah format dokumen tanpa instal apa-apa.</h1>
<p class="lead">PDF ke Word, Word ke PDF, PowerPoint dan Excel ke PDF. Pilih file, pilih tool, unduh hasilnya.</p>
<ul class="points"><li>tanpa daftar</li><li>file dihapus otomatis maks {TTL}</li><li>gratis</li></ul>
<a class="btn" href="#tool">Pilih tool</a>
</div>
<div class="wrap"><div class="facts">
<div><b>{len(TOOLS)}</b><span>konversi dokumen tersedia</span></div>
<div><b>{MAX_FILES}</b><span>file maksimal sekali proses</span></div>
<div><b>{MAX_MB} MB</b><span>batas ukuran per dokumen</span></div>
<div><b>0</b><span>akun yang harus dibuat</span></div>
</div></div>
<section class="block wrap" id="tool">
<div class="tools-head"><h2 style="margin:0">Tool</h2>
<label class="search"><span class="sr">Cari tool</span><input id="tool-search" type="search" placeholder="Cari: pdf, word, excel…" autocomplete="off"><kbd>Ctrl K</kbd></label></div>
<p class="empty" id="search-empty">Tidak ada tool yang cocok.</p>
<div class="cat"><span class="label">Dokumen</span><div class="grid" style="margin-top:10px">{doc_cards}</div></div>
{soon}
</section>
<section class="block wrap" id="cara-kerja"><h2>Cara kerja</h2>
<ol class="steps"><li><b>Upload</b><span>Tarik file ke kotak, atau pilih dari perangkat.</span></li><li><b>Pilih format</b><span>Tiap tool punya satu tujuan jelas, tidak perlu mengatur apa-apa.</span></li><li><b>Download</b><span>Unduh satu file, atau semua hasil sebagai ZIP.</span></li></ol></section>
<section class="block wrap" id="privasi"><h2>Privasi</h2>
<div class="two">
<div><h3>Lewat server kami</h3><p>Konversi dokumen (PDF, Word, PowerPoint, Excel) butuh LibreOffice dan tool lain di server, jadi file <b>diunggah</b> ke server kami. Diproses di wadah terisolasi tanpa akses internet, nama file di penyimpanan diacak, dan tidak ada orang yang membaca isinya.</p></div>
<div><h3>Kapan dihapus</h3><p>File asli dihapus segera setelah diproses. Hasil konversi dihapus otomatis maksimal {TTL} setelah dibuat. Tool gambar dan audio yang menyusul akan diproses di browser Anda.</p></div>
</div><p><a href="/privasi/">Baca kebijakan privasi lengkap</a></p></section>
<section class="block wrap"><h2>Batas pemakaian gratis</h2>
<table><thead><tr><th>Jenis</th><th>Batas</th></tr></thead><tbody>
<tr><td>Ukuran dokumen</td><td class="mono">maks {MAX_MB} MB per file</td></tr>
<tr><td>Jumlah file</td><td class="mono">maks {MAX_FILES} per proses</td></tr>
<tr><td>Halaman PDF</td><td class="mono">maks 200 halaman</td></tr>
<tr><td>Frekuensi</td><td class="mono">maks 20 konversi per jam per koneksi</td></tr>
<tr><td>Waktu proses</td><td class="mono">dihentikan setelah 120 detik</td></tr>
</tbody></table></section>
<section class="block wrap" id="faq"><h2>FAQ</h2>
<details><summary>Apakah PDF hasil scan bisa diubah ke Word?</summary><p>Belum. PDF hasil scan butuh OCR dan itu belum ada di versi ini. Kami menolaknya dengan pesan jelas, bukan menghasilkan dokumen kosong.</p></details>
<details><summary>Kenapa hasil PDF ke Word layoutnya berubah?</summary><p>PDF menyimpan posisi teks, bukan paragraf. Dokumen sederhana biasanya rapi; tabel rumit dan banyak kolom bisa bergeser. Cek hasilnya sebelum dikirim.</p></details>
<details><summary>Apakah file .doc, .xls, .ppt lama didukung?</summary><p>Belum. Simpan ulang sebagai .docx, .xlsx, atau .pptx dari aplikasi Office.</p></details>
<details><summary>Bagaimana dengan file ber-password?</summary><p>Ditolak dengan pesan jelas. Buka kuncinya dulu, lalu unggah lagi.</p></details>
<details><summary>Kapan tool gambar dan audio tersedia?</summary><p>Segera. Tool yang belum jadi diberi label "Segera" di daftar di atas.</p></details>
</section>
<div class="cta"><h2>Punya dokumen yang perlu diubah?</h2><a class="btn" href="#tool">Pilih tool</a></div>
</main>
""" + footer() + tail()
    write("index.html", s)


def legal():
    contact = f'Pertanyaan: <a href="mailto:{e(CONTACT_EMAIL)}">{e(CONTACT_EMAIL)}</a>.' if CONTACT_EMAIL else ""
    s = head("Kebijakan Privasi | Konvertin", "Apa yang terjadi pada file Anda di Konvertin, kapan dihapus, dan data apa yang dicatat.", "/privasi/") + NAV + f"""<main id="main" class="wrap prose" style="padding:40px 0">
<span class="label">Diperbarui 9 Oktober 2026</span>
<h1>Kebijakan privasi</h1>
<h2>File dokumen Anda</h2>
<ul>
<li>Konversi dokumen (PDF, DOCX, PPTX, XLSX) dilakukan di server kami. File Anda diunggah lewat HTTPS.</li>
<li>File asli dihapus segera setelah diproses. Hasil konversi dihapus otomatis maksimal {TTL} setelah dibuat. Anda juga bisa membatalkan proses, yang langsung menghapus file terkait.</li>
<li>Nama file di penyimpanan diacak. Proses berjalan di wadah terisolasi tanpa akses internet.</li>
<li>Tidak ada manusia yang membaca isi file Anda. Isi file tidak dicatat di log.</li>
</ul>
<h2>Data yang dicatat</h2>
<ul>
<li>Catatan teknis job: jenis konversi, status, waktu, dan pesan galat. Dihapus bersama file.</li>
<li>Alamat IP dipakai sementara di memori untuk pembatasan frekuensi (maks 20 konversi per jam).</li>
</ul>
<h2>Iklan dan cookie</h2>
<p>Situs ini direncanakan memakai Google AdSense. Saat iklan aktif, akan ada banner persetujuan cookie dan halaman ini diperbarui.</p>
<h2>Kontak</h2>
<p>{contact or "Informasi kontak akan ditambahkan sebelum rilis."}</p>
</main>
""" + footer() + tail(script=False)
    write("privasi/index.html", s)
    s = head("Syarat Penggunaan | Konvertin", "Syarat penggunaan layanan konversi file Konvertin.", "/syarat/") + NAV + """<main id="main" class="wrap prose" style="padding:40px 0">
<span class="label">Diperbarui 9 Oktober 2026</span>
<h1>Syarat penggunaan</h1>
<ul>
<li>Gunakan hanya untuk file yang Anda berhak olah. Dilarang mengunggah file berbahaya atau mencoba mengganggu layanan.</li>
<li>Layanan diberikan apa adanya. Hasil konversi, terutama PDF ke Word, bisa berbeda dari aslinya. Periksa hasilnya sebelum dipakai.</li>
<li>Kami membatasi ukuran, jumlah halaman, dan frekuensi konversi untuk menjaga layanan tetap stabil.</li>
<li>File dihapus otomatis. Simpan hasil konversi segera setelah selesai, kami tidak menyimpan cadangan.</li>
</ul>
</main>
""" + footer() + tail(script=False)
    write("syarat/index.html", s)
    s = head("Halaman tidak ditemukan | Konvertin", "Halaman tidak ditemukan.", "/404.html") + NAV + """<main id="main" class="wrap prose" style="padding:80px 0">
<span class="label">404</span><h1>Halaman tidak ditemukan</h1>
<p>Alamat yang Anda buka tidak ada, atau sudah pindah. Kembali ke daftar tool dan pilih konversi yang Anda butuhkan.</p>
<a class="btn" href="/#tool">Lihat tool</a>
</main>
""" + footer() + tail(script=False)
    write("404.html", s)


def sitemap():
    urls = ["/"] + [f"/{t['slug']}/" for t in TOOLS] + ["/privasi/", "/syarat/"]
    body = "".join(f"<url><loc>{SITE_URL}{u}</loc></url>" for u in urls)
    write("sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>')
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")


if __name__ == "__main__":
    for t in TOOLS:
        tool_page(t)
    home()
    legal()
    sitemap()
    print("ok:", len(TOOLS) + 5, "halaman")
