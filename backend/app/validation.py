"""Validasi file: magic bytes (bukan ekstensi), proteksi password, file bom."""
import zipfile
from pathlib import Path

from . import config
from .errors import ConvertError

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # .doc/.xls/.ppt lama, atau OOXML terenkripsi

# jenis konversi -> (jenis file input, ekstensi output, mime output, label)
CONVERSIONS = {
    "pdf_to_docx": ("pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx_to_pdf": ("docx", "pdf", "application/pdf"),
    "pptx_to_pdf": ("pptx", "pdf", "application/pdf"),
    "xlsx_to_pdf": ("xlsx", "pdf", "application/pdf"),
    "pdf_to_txt": ("pdf", "txt", "text/plain; charset=utf-8"),
    "docx_to_txt": ("docx", "txt", "text/plain; charset=utf-8"),
}

KIND_LABEL = {"pdf": "PDF", "docx": "DOCX", "pptx": "PPTX", "xlsx": "XLSX"}


def detect_kind(path: Path) -> str | None:
    """Kembalikan pdf/docx/pptx/xlsx dari isi file, atau None."""
    with open(path, "rb") as f:
        head = f.read(1024)
    if b"%PDF-" in head[:1024]:
        return "pdf"
    if head.startswith(OLE_MAGIC):
        raise ConvertError(
            "File ini terproteksi password atau memakai format lama (.doc/.xls/.ppt). "
            "Buka dulu di aplikasi Office, simpan sebagai .docx/.pptx/.xlsx tanpa password, lalu unggah lagi."
        )
    if head.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(path) as z:
                _check_zip_bomb(z)
                names = set(z.namelist())
        except zipfile.BadZipFile:
            raise ConvertError("File rusak dan tidak bisa dibuka. Coba unggah file lain.")
        if "[Content_Types].xml" not in names:
            return None
        if any(n.startswith("word/") for n in names):
            return "docx"
        if any(n.startswith("ppt/") for n in names):
            return "pptx"
        if any(n.startswith("xl/") for n in names):
            return "xlsx"
    return None


def _check_zip_bomb(z: zipfile.ZipFile) -> None:
    total = 0
    for info in z.infolist():
        total += info.file_size
        if info.compress_size and info.file_size / info.compress_size > config.MAX_ZIP_RATIO and info.file_size > 10 * 1024 * 1024:
            raise ConvertError("File ditolak karena isinya tidak wajar (rasio kompresi terlalu ekstrem).")
    if total > config.MAX_UNZIPPED_BYTES:
        raise ConvertError("File terlalu besar setelah dibuka (isi dokumen melebihi batas aman).")


def check_pdf(path: Path) -> int:
    """Cek PDF: rusak, terenkripsi, jumlah halaman. Return jumlah halaman."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise ConvertError("PDF ini dikunci dengan password. Buka kuncinya dulu, lalu unggah lagi.")
        pages = len(reader.pages)
    except ConvertError:
        raise
    except (PyPdfError, Exception):
        raise ConvertError("PDF rusak dan tidak bisa dibaca. Coba unduh ulang atau unggah file lain.")
    if pages > config.MAX_PDF_PAGES:
        raise ConvertError(f"PDF punya {pages} halaman. Batas saat ini {config.MAX_PDF_PAGES} halaman.")
    if pages == 0:
        raise ConvertError("PDF ini tidak punya halaman.")
    return pages


def validate_upload(path: Path, job_type: str) -> str:
    """Validasi file terhadap jenis konversi. Lempar ConvertError kalau tidak valid."""
    if job_type not in CONVERSIONS:
        raise ConvertError("Jenis konversi tidak dikenal.")
    expected = CONVERSIONS[job_type][0]
    if path.stat().st_size == 0:
        raise ConvertError("File kosong. Pilih file lain.")
    if path.stat().st_size > config.MAX_DOC_BYTES:
        raise ConvertError(f"File lebih besar dari {config.MAX_DOC_BYTES // 1024 // 1024} MB (batas dokumen tier gratis).", 413)
    kind = detect_kind(path)
    if kind is None:
        raise ConvertError(f"Format file tidak didukung atau tidak cocok. Konversi ini butuh file {KIND_LABEL[expected]}.")
    if kind != expected:
        raise ConvertError(f"Isi file ini {KIND_LABEL[kind]}, bukan {KIND_LABEL[expected]}. Pilih konversi yang sesuai.")
    if kind == "pdf":
        check_pdf(path)
    return kind
