"""Validasi file: magic bytes (bukan ekstensi), proteksi password, file bom."""
import zipfile
from pathlib import Path

from . import config
from .errors import ConvertError

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # .doc/.xls/.ppt lama, atau OOXML terenkripsi

# jenis konversi -> (jenis file input, ekstensi output, mime output)
CONVERSIONS = {
    "pdf_to_docx": ("pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx_to_pdf": ("docx", "pdf", "application/pdf"),
    "docx_to_odt": ("docx", "odt", "application/vnd.oasis.opendocument.text"),
    "docx_to_md": ("docx", "md", "text/markdown; charset=utf-8"),
    "pptx_to_pdf": ("pptx", "pdf", "application/pdf"),
    "pptx_to_odp": ("pptx", "odp", "application/vnd.oasis.opendocument.presentation"),
    "pptx_to_txt": ("pptx", "txt", "text/plain; charset=utf-8"),
    "xlsx_to_pdf": ("xlsx", "pdf", "application/pdf"),
    "xlsx_to_ods": ("xlsx", "ods", "application/vnd.oasis.opendocument.spreadsheet"),
    "xlsx_to_csv": ("xlsx", "csv", "text/csv; charset=utf-8"),
    "csv_to_xlsx": ("csv", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pdf_to_txt": ("pdf", "txt", "text/plain; charset=utf-8"),
    "docx_to_txt": ("docx", "txt", "text/plain; charset=utf-8"),
    "txt_to_docx": ("txt", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    # kompresi: bukan konversi antarformat, hasilnya tetap PDF
    "compress_pdf": ("pdf", "pdf", "application/pdf"),
    "compress_docx": ("docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "compress_pptx": ("pptx", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
}

# jenis job kompres per jenis file input
COMPRESS_JOB = {"pdf": "compress_pdf", "docx": "compress_docx", "pptx": "compress_pptx"}

KIND_LABEL = {
    "pdf": "PDF", "docx": "DOCX", "pptx": "PPTX", "xlsx": "XLSX",
    "csv": "CSV", "txt": "TXT",
}

LEVELS = {"light", "medium", "max"}


def check_options(job_type: str, options: dict) -> dict:
    """Ambil hanya opsi yang dikenal untuk jenis job ini, dengan nilai yang aman."""
    if job_type in COMPRESS_JOB.values():
        level = options.get("level")
        return {"level": level if level in LEVELS else "medium"}
    return {}


def detect_kind(path: Path, filename: str | None = None) -> str | None:
    """Kembalikan jenis file yang didukung dari isinya, atau None."""
    extension = Path(filename).suffix.lower().lstrip(".") if filename else ""
    if extension in ("csv", "txt"):
        try:
            raw = path.read_bytes()
            if b"\x00" in raw:
                return None
            raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return None
        return extension
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


def validate_upload(path: Path, job_type: str, filename: str | None = None) -> str:
    """Validasi file terhadap jenis konversi. Lempar ConvertError kalau tidak valid."""
    if job_type not in CONVERSIONS:
        raise ConvertError("Jenis konversi tidak dikenal.")
    expected = CONVERSIONS[job_type][0]
    if path.stat().st_size == 0:
        raise ConvertError("File kosong. Pilih file lain.")
    if path.stat().st_size > config.MAX_DOC_BYTES:
        raise ConvertError(f"File lebih besar dari {config.MAX_DOC_BYTES // 1024 // 1024} MB (batas dokumen tier gratis).", 413)
    kind = detect_kind(path, filename)
    if kind is None:
        raise ConvertError(f"Format file tidak didukung atau tidak cocok. Konversi ini butuh file {KIND_LABEL[expected]}.")
    if kind != expected:
        raise ConvertError(f"Isi file ini {KIND_LABEL[kind]}, bukan {KIND_LABEL[expected]}. Pilih konversi yang sesuai.")
    if kind == "pdf":
        check_pdf(path)
    return kind
