import io
import time
import zipfile

import pytest

PDF = "application/pdf"


def _post(client, data: bytes, name: str, jtype: str):
    return client.post("/api/jobs", files={"file": (name, data)}, data={"type": jtype})


def _wait(client, job_id: str, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/api/jobs/{job_id}").json()
        if r["status"] in ("done", "failed"):
            return r
        time.sleep(0.5)
    raise AssertionError("timeout")


def test_health_and_conversions(client):
    assert client.get("/api/health").json() == {"ok": True}
    c = client.get("/api/conversions").json()
    assert {
        kind: {item["type"] for item in conversions}
        for kind, conversions in c["conversions"].items()
    } == {
        "pdf": {"pdf_to_docx", "pdf_to_txt"},
        "docx": {"docx_to_pdf", "docx_to_txt"},
        "pptx": {"pptx_to_pdf"},
        "xlsx": {"xlsx_to_pdf"},
    }
    assert c["max_mb"] == 25 and c["max_pages"] == 200


def test_windows_worker_uses_supported_process_options(monkeypatch):
    from app import jobs

    monkeypatch.setattr(jobs.subprocess, "CREATE_NEW_PROCESS_GROUP", 512, raising=False)
    assert jobs._process_options("docx_to_pdf", windows=True) == {"creationflags": 512}


def test_office_conversion_reports_missing_libreoffice(monkeypatch, tmp_path):
    from app import converters
    from app.errors import ConvertError

    monkeypatch.setattr(converters.shutil, "which", lambda _: None)
    monkeypatch.setenv("KONVERTIN_SOFFICE_PATH", "")
    monkeypatch.setenv("PROGRAMFILES", str(tmp_path))
    monkeypatch.setenv("PROGRAMFILES(X86)", str(tmp_path))
    with pytest.raises(ConvertError, match="LibreOffice belum terpasang"):
        converters._soffice_to_pdf(tmp_path / "in.docx", tmp_path / "out.pdf")


def test_detect(client, sample_pdf, sample_docx):
    r = client.post("/api/detect", files={"file": ("x.bin", sample_pdf)}).json()
    # PDF juga menawarkan opsi kompresi (tetap berformat pdf)
    assert r["kind"] == "pdf" and {o["output"] for o in r["options"]} == {"docx", "txt", "pdf"}
    r = client.post("/api/detect", files={"file": ("x.pdf", sample_docx)}).json()
    assert r["kind"] == "docx"


def test_docx_to_pdf(client, sample_docx):
    r = _post(client, sample_docx, "Kontrak Saya.docx", "docx_to_pdf")
    assert r.status_code == 202
    s = _wait(client, r.json()["job_id"])
    assert s["status"] == "done", s
    assert s["download_name"] == "Kontrak Saya.pdf"
    d = client.get(s["download_url"])
    assert d.content.startswith(b"%PDF")


def test_xlsx_to_pdf(client, sample_xlsx):
    s = _wait(client, _post(client, sample_xlsx, "a.xlsx", "xlsx_to_pdf").json()["job_id"])
    assert s["status"] == "done", s


def test_pptx_to_pdf(client):
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    text_box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1))
    text_box.text = "Konvertin PowerPoint"
    source = io.BytesIO()
    presentation.save(source)

    response = _post(client, source.getvalue(), "presentasi.pptx", "pptx_to_pdf")
    assert response.status_code == 202
    status = _wait(client, response.json()["job_id"])
    assert status["status"] == "done", status
    assert status["download_name"] == "presentasi.pdf"
    from pypdf import PdfReader

    result = client.get(status["download_url"])
    assert result.content.startswith(b"%PDF")
    pdf = PdfReader(io.BytesIO(result.content))
    assert len(pdf.pages) == 1
    assert "Konvertin PowerPoint" in pdf.pages[0].extract_text()


def test_pdf_to_docx(client, sample_pdf):
    s = _wait(client, _post(client, sample_pdf, "laporan.pdf", "pdf_to_docx").json()["job_id"])
    assert s["status"] == "done", s
    from docx import Document

    doc = Document(io.BytesIO(client.get(s["download_url"]).content))
    assert "Laporan Praktikum Konvertin" in "\n".join(p.text for p in doc.paragraphs)


def test_compress_pdf_shrinks_embedded_image_and_keeps_text(client, big_jpeg):
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    source = io.BytesIO()
    pdf = canvas.Canvas(source)
    pdf.drawString(72, 780, "Laporan tetap terbaca")
    pdf.drawImage(ImageReader(io.BytesIO(big_jpeg)), 36, 300, width=520, height=390)
    pdf.save()
    original = source.getvalue()

    response = _post(client, original, "laporan.pdf", "compress_pdf")
    assert response.status_code == 202
    status = _wait(client, response.json()["job_id"])
    assert status["status"] == "done", status
    assert status["download_name"] == "laporan-kompres.pdf"
    result = client.get(status["download_url"]).content

    from pypdf import PdfReader

    assert len(result) < len(original)
    assert "Laporan tetap terbaca" in PdfReader(io.BytesIO(result)).pages[0].extract_text()


def test_pdf_to_txt(client, sample_pdf):
    s = _wait(client, _post(client, sample_pdf, "laporan.pdf", "pdf_to_txt").json()["job_id"])
    assert s["status"] == "done", s
    assert "Baris isi nomor 3" in client.get(s["download_url"]).text


def test_docx_to_txt(client, sample_docx):
    s = _wait(client, _post(client, sample_docx, "k.docx", "docx_to_txt").json()["job_id"])
    assert s["status"] == "done", s
    t = client.get(s["download_url"]).text
    assert "Pasal 1" in t and "Budi" in t


def test_scan_pdf_rejected_with_honest_message(client, blank_scan_pdf):
    for jt in ("pdf_to_docx", "pdf_to_txt"):
        s = _wait(client, _post(client, blank_scan_pdf, "scan.pdf", jt).json()["job_id"])
        assert s["status"] == "failed" and "scan" in s["error"].lower() and "OCR" in s["error"]


def test_magic_bytes_not_extension(client, sample_docx):
    # DOCX diberi nama .pdf dan dipakai untuk pdf_to_docx -> ditolak
    r = _post(client, sample_docx, "palsu.pdf", "pdf_to_docx")
    assert r.status_code == 400 and "DOCX" in r.json()["error"]


def test_garbage_rejected(client):
    r = _post(client, b"hello world, bukan dokumen", "a.pdf", "pdf_to_docx")
    assert r.status_code == 400


def test_empty_rejected(client):
    assert _post(client, b"", "a.pdf", "pdf_to_docx").status_code == 400


def test_unknown_type(client, sample_pdf):
    assert _post(client, sample_pdf, "a.pdf", "pdf_to_mp3").status_code == 400


def test_encrypted_pdf_rejected(client, sample_pdf):
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter()
    for p in PdfReader(io.BytesIO(sample_pdf)).pages:
        w.add_page(p)
    w.encrypt("rahasia")
    b = io.BytesIO()
    w.write(b)
    r = _post(client, b.getvalue(), "k.pdf", "pdf_to_docx")
    assert r.status_code == 400 and "password" in r.json()["error"]


def test_old_ole_format_rejected(client):
    r = _post(client, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600, "a.docx", "docx_to_pdf")
    assert r.status_code == 400 and "password" in r.json()["error"]


def test_zip_bomb_rejected(client):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<x/>")
        z.writestr("word/document.xml", b"\0" * (60 * 1024 * 1024))
    r = _post(client, b.getvalue(), "bom.docx", "docx_to_pdf")
    assert r.status_code == 400


def test_too_large(client, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "MAX_DOC_BYTES", 1024)
    r = _post(client, b"%PDF-" + b"0" * 5000, "a.pdf", "pdf_to_txt")
    assert r.status_code == 413


def test_rate_limit(client, sample_pdf, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "RATE_LIMIT_JOBS", 2)
    codes = [_post(client, b"junk", "a.pdf", "pdf_to_txt").status_code for _ in range(3)]
    assert codes == [400, 400, 429]


def test_cancel_and_not_found(client, sample_pdf):
    jid = _post(client, sample_pdf, "a.pdf", "pdf_to_txt").json()["job_id"]
    assert client.delete(f"/api/jobs/{jid}").status_code == 200
    assert client.get(f"/api/jobs/{jid}/download").status_code == 404
    assert client.get("/api/jobs/tidak-ada").status_code == 404


def test_cleanup_deletes_files(client, sample_docx):
    from app import config, jobs

    s = _wait(client, _post(client, sample_docx, "k.docx", "docx_to_txt").json()["job_id"])
    assert s["status"] == "done"
    assert any(config.STORAGE_DIR.iterdir())
    jobs._set(s["job_id"], expires_at=time.time() - 1)
    jobs.cleanup_expired()
    assert client.get(f"/api/jobs/{s['job_id']}").status_code == 404
    assert not list(config.STORAGE_DIR.glob("*.out")) or all(
        f.name != jobs.get(s["job_id"]) for f in config.STORAGE_DIR.iterdir()
    )
