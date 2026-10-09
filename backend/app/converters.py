"""Konverter dokumen. Dijalankan sebagai proses terpisah (lihat jobs.py) supaya
bisa dibatalkan, di-timeout, dan dibatasi memorinya.

CLI:  python -m app.converters <job_type> <input> <output>
Exit code 0 = sukses. Pada gagal, pesan untuk user ditulis ke stderr dengan awalan 'USER:'.
"""
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
}


def main(argv: list[str]) -> int:
    job_type, src, dst = argv[1], Path(argv[2]), Path(argv[3])
    try:
        HANDLERS[job_type](src, dst)
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
