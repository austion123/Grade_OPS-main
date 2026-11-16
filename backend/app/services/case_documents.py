"""Offline extraction. Media counts are reported separately from readable text."""
import io
import re
import shutil
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

DRAW = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
PRES = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def xml(archive, name):
    info = archive.getinfo(name)
    if info.file_size > 8_000_000:
        raise ValueError("文档 XML 超过解析上限。")
    raw = archive.read(info)
    markup = raw.upper().replace(b"\0", b"")
    if b"<!DOCTYPE" in markup or b"<!ENTITY" in markup:
        raise ValueError("不支持包含自定义实体的文档。")
    return ET.fromstring(raw)


def convert(data, filename):
    tool = shutil.which("soffice") or shutil.which("libreoffice")
    if not tool:
        raise ValueError("服务器未安装 LibreOffice，无法转换 .ppt。请另存为 .pptx 后重试。")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "case.ppt"
        source.write_bytes(data)
        try:
            subprocess.run([tool, f"-env:UserInstallation={(root / 'profile').as_uri()}", "--headless",
                            "--convert-to", "pptx", "--outdir", directory, str(source)],
                           check=True, timeout=45, capture_output=True)
            return (root / "case.pptx").read_bytes()
        except (subprocess.SubprocessError, OSError) as exc:
            raise ValueError(f"{filename} 转换失败，请另存为 .pptx 后重试。") from exc


def slides(data, filename):
    if filename.lower().endswith(".ppt"):
        data = convert(data, filename)
    with ZipFile(io.BytesIO(data)) as archive:
        presentation = xml(archive, "ppt/presentation.xml")
        rels = xml(archive, "ppt/_rels/presentation.xml.rels")
        by_id = {node.get("Id"): node.get("Target", "") for node in rels}
        rel_id = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        order = presentation.findall(f"./{PRES}sldIdLst/{PRES}sldId")
        if not order or len(order) > 200:
            raise ValueError("演示文稿须包含 1 至 200 页。")
        pages = []
        for i, slide in enumerate(order, 1):
            target = by_id[slide.attrib[rel_id]]
            path = target.lstrip("/") if target.startswith("/") else "ppt/" + target
            document = xml(archive, path)
            paragraphs = ["".join(n.text or "" for n in paragraph.iter(DRAW + "t")).strip()
                          for paragraph in document.iter(DRAW + "p")]
            if not paragraphs:
                paragraphs = [(n.text or "").strip() for n in document.iter(DRAW + "t")]
            text = "\n".join(part for part in paragraphs if part)
            pages.append({"page": i, "text": text,
                          "images": len(list(document.iter(PRES + "pic"))),
                          "charts": sum(n.tag.endswith("}chart") for n in document.iter())})
        if not any(page["text"] for page in pages):
            raise ValueError("未提取到文字。图片或扫描件暂不支持 OCR，请上传含可选中文字的版本。")
        if sum(len(page["text"]) for page in pages) > 100_000:
            raise ValueError("案例文字超过 100,000 字符，请拆分后重试。")
        return pages


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(self.hidden - 1, 0)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


KNOWLEDGE_FORMATS = ".pdf,.docx,.pptx,.ppt,.xlsx,.odt,.ods,.odp,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm"


def knowledge_text(data, filename):
    ext = Path(filename).suffix.lower()
    if ext in {".pptx", ".ppt"}:
        text = "\n".join(f"第 {p['page']} 页：{p['text']}" for p in slides(data, filename))
    elif ext == ".pdf":
        import pymupdf
        with pymupdf.open(stream=data, filetype="pdf") as document:
            text = "\n".join(f"第 {p.number+1} 页：{p.get_text()}" for p in document)
    elif ext in {".docx", ".xlsx", ".odt", ".ods", ".odp"}:
        with ZipFile(io.BytesIO(data)) as archive:
            if ext == ".docx":
                names = ["word/document.xml"]
            elif ext == ".xlsx":
                names = [n for n in archive.namelist() if re.fullmatch(r"xl/(sharedStrings|worksheets/sheet\d+)\.xml", n)]
            else:
                names = ["content.xml"]
            if len(names) > 100:
                raise ValueError("文档工作表过多，请拆分后重试。")
            text = "\n".join(line.strip() for name in names for line in xml(archive, name).itertext() if line.strip())
    elif ext in KNOWLEDGE_FORMATS.split(","):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("gb18030")
        if ext in {".html", ".htm"}:
            parser = VisibleText()
            parser.feed(text)
            text = "\n".join(parser.parts)
    else:
        raise ValueError("不支持此文档格式。")
    if not text.strip():
        raise ValueError("未提取到可用文字。")
    if len(text) > 500_000:
        raise ValueError("文档文字超过 500,000 字符，请拆分后上传。")
    return text.strip()
