"""Konverter dokumen. Dijalankan sebagai proses terpisah (lihat jobs.py) supaya
bisa dibatalkan, di-timeout, dan dibatasi memorinya.

CLI:  python -m app.converters <job_type> <input> <output> [options_json]
Exit code 0 = sukses. Pada gagal, pesan untuk user ditulis ke stderr dengan awalan 'USER:'.
"""
import inspect
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .errors import ConvertError

SCAN_MESSAGE = (
    "PDF ini tampaknya hasil scan (isinya gambar, tidak ada teks yang bisa dibaca). "
    "PDF hasil scan butuh OCR dan belum didukung di versi ini."
)


def _has_text(pdf: Path, max_pages: int = 10, min_chars: int = 3) -> bool:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf))
    total = 0
    for page in list(reader.pages)[:max_pages]:
        total += len((page.extract_text() or "").strip())
        if total >= min_chars:
            return True
    return False


# level -> (kualitas gambar 1-100 untuk downsampling, dpi target)
COMPRESS_LEVELS = {"light": (80, 150), "medium": (60, 120), "max": (40, 90)}


def _resize_pixmap(pix, mat):
    """Perkecil Pixmap dengan rasio terjaga lewat render ke halaman sementara."""
    import pymupdf as fitz

    tmp = fitz.open()
    page = tmp.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, pixmap=pix)
    out = page.get_pixmap(matrix=mat, alpha=False)
    tmp.close()
    return out


def compress_pdf(src: Path, dst: Path, options: dict | None = None) -> None:
    """Kecilkan PDF dengan menurunkan resolusi gambar di dalamnya.

    Tiga level (PRD C2). Kalau hasil malah lebih besar dari aslinya,
    file asli yang disalin ke output supaya user tidak rugi.
    """
    import pymupdf as fitz  # PyMuPDF: buka, ubah gambar, simpan

    level = (options or {}).get("level", "medium")
    quality, dpi = COMPRESS_LEVELS.get(level, COMPRESS_LEVELS["medium"])
    doc = fitz.open(str(src))
    try:
        seen: set[int] = set()
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                if xref in seen:  # gambar yang dipakai banyak halaman cukup sekali
                    continue
                seen.add(xref)
                if img[1]:  # punya mask transparan: jangan diganggu
                    continue
                base = doc.extract_image(xref)
                if base["ext"].lower() not in ("jpeg", "jpg", "png"):
                    continue
                w, h = base["width"], base["height"]
                target_w = max(1, int(round(w * dpi / 300)))
                pix = fitz.Pixmap(doc, xref)
                if pix.colorspace is None or pix.colorspace.n > 3 or pix.alpha:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                jpg = pix.tobytes("jpeg", quality)
                tw, th = w, h
                orig = len(base["image"])
                if target_w < w and len(jpg) >= orig:
                    # recompress saja tidak untung; turunkan resolusinya (downsample)
                    tw = target_w
                    th = max(1, int(round(h * target_w / w)))
                    mat = fitz.Matrix(tw / w, th / h)
                    small = _resize_pixmap(pix, mat)
                    jpg = small.tobytes("jpeg", quality)
                if len(jpg) < orig:
                    doc.update_stream(xref, jpg, compress=True)
                    for key, val in (("/Filter", "/DCTDecode"), ("/ColorSpace", "/DeviceRGB"), ("/BitsPerComponent", "8")):
                        doc.xref_set_key(xref, key.lstrip("/"), val)
                    doc.xref_set_key(xref, "Width", str(tw))
                    doc.xref_set_key(xref, "Height", str(th))
        doc.save(str(dst), garbage=4, deflate=True, clean=True)
    finally:
        doc.close()
    if dst.stat().st_size >= src.stat().st_size:
        shutil.copyfile(src, dst)


def pdf_to_docx(src: Path, dst: Path) -> None:
    if not _has_text(src):
        raise ConvertError(SCAN_MESSAGE)
    from pdf2docx import Converter

    cv = Converter(str(src))
    try:
        cv.convert(str(dst))
    finally:
        cv.close()


def _soffice_to_pdf(src: Path, dst: Path) -> None:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise RuntimeError("LibreOffice tidak terpasang")
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        outdir = td_p / "out"
        outdir.mkdir()
        # salin ke nama aman: hindari karakter aneh & konflik
        tmp_in = td_p / ("in" + src.suffix)
        shutil.copyfile(src, tmp_in)
        cmd = [
            exe, "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nofirststartwizard",
            f"-env:UserInstallation=file://{td_p}/profile",
            "--convert-to", "pdf:writer_pdf_Export" if src.suffix == ".docx" else "pdf",
            "--outdir", str(outdir), str(tmp_in),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=110)
        out = outdir / "in.pdf"
        if r.returncode != 0 or not out.exists():
            raise ConvertError("Dokumen ini gagal diubah ke PDF. Pastikan file tidak rusak dan bisa dibuka di Office.")
        shutil.move(str(out), dst)


def docx_to_pdf(src: Path, dst: Path) -> None:
    _soffice_to_pdf(src, dst)


def pptx_to_pdf(src: Path, dst: Path) -> None:
    _soffice_to_pdf(src, dst)


def xlsx_to_pdf(src: Path, dst: Path) -> None:
    _soffice_to_pdf(src, dst)


def pdf_to_txt(src: Path, dst: Path) -> None:
    if not _has_text(src):
        raise ConvertError(SCAN_MESSAGE)
    exe = shutil.which("pdftotext")
    if exe:
        r = subprocess.run([exe, "-layout", "-enc", "UTF-8", str(src), str(dst)], capture_output=True, timeout=100)
        if r.returncode == 0 and dst.exists():
            return
    from pypdf import PdfReader

    reader = PdfReader(str(src))
    dst.write_text("\n\n".join((p.extract_text() or "") for p in reader.pages), encoding="utf-8")


def docx_to_txt(src: Path, dst: Path) -> None:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        doc = Document(str(src))
    except Exception:
        raise ConvertError("DOCX rusak dan tidak bisa dibaca. Coba simpan ulang dari Word lalu unggah lagi.")
    lines: list[str] = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            lines.append(Paragraph(child, doc).text)
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                lines.append("\t".join(c.text.strip() for c in row.cells))
            lines.append("")
    dst.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


HANDLERS = {
    "pdf_to_docx": pdf_to_docx,
    "docx_to_pdf": docx_to_pdf,
    "pptx_to_pdf": pptx_to_pdf,
    "xlsx_to_pdf": xlsx_to_pdf,
    "pdf_to_txt": pdf_to_txt,
    "docx_to_txt": docx_to_txt,
    "compress_pdf": compress_pdf,
}


def main(argv: list[str]) -> int:
    job_type, src, dst = argv[1], Path(argv[2]), Path(argv[3])
    options: dict = {}
    if len(argv) > 4:
        try:
            options = json.loads(argv[4])
        except (ValueError, TypeError):
            options = {}
    try:
        handler = HANDLERS[job_type]
        if "options" in inspect.signature(handler).parameters:
            handler(src, dst, options)
        else:
            handler(src, dst)
        if not dst.exists() or dst.stat().st_size == 0:
            raise ConvertError("Konversi selesai tapi hasilnya kosong. Coba file lain.")
        return 0
    except ConvertError as e:
        print("USER:" + e.message, file=sys.stderr)
        return 2
    except subprocess.TimeoutExpired:
        print("USER:Konversi terlalu lama dan dihentikan. Coba file yang lebih kecil.", file=sys.stderr)
        return 3
    except MemoryError:
        print("USER:File terlalu berat diproses. Coba file yang lebih kecil.", file=sys.stderr)
        return 3
    except Exception as e:  # jangan bocorkan isi file ke log
        print(f"INTERNAL:{type(e).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
