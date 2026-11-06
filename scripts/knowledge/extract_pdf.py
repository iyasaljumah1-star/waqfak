"""
Page-by-page text extraction of an Arabic PDF for the knowledge base, keeping the page as the locator.

Why not plain pdftotext: in many of the project's PDFs the lam-alef ligature («لا», «لأ», «لإ») comes out reversed
(«الصالة» for «الصلاة», «اإلسالم» for «الإسلام») and presentation forms are left unfolded. Here each line is rebuilt
from the PDF characters ordered right to left, so a ligature keeps its own two letters in order; digit and Latin runs
are restored left to right; presentation forms are folded with NFKC; unmapped glyphs (U+FFFD) are dropped.

A page with too little text (a scanned image) is read with OCR (tesseract, Arabic) and marked as such: OCR text is
searchable but never quoted as the text of a law without being checked on the page image.

Usage: python3 -I extract_pdf.py <file.pdf> <out.json> [--ocr-below CHARS] [--force-ocr]
Output: {"file", "sha256", "pages": [{"file": n, "printed": "12"|null, "method": "text"|"ocr", "chars": n, "text"}]}
Reads the file only; no network.
"""
import hashlib, json, re, subprocess, sys, tempfile, unicodedata, os

import pdfplumber

ARABIC = re.compile(r"[؀-ۿﭐ-﷿ﹰ-﻿]")
LTR_RUN = re.compile(r"[0-9\u0660-\u0669A-Za-z][0-9\u0660-\u0669A-Za-z.,:/%@_\-+]*[0-9\u0660-\u0669A-Za-z%]|[0-9\u0660-\u0669A-Za-z]")
OPEN_CLOSE = re.compile(r"\([^()\n]{0,60}\)")
CLOSE_OPEN = re.compile(r"\)[^()\n]{0,60}\(")


def is_mark(ch):
    return all(unicodedata.category(c) == "Mn" for c in ch)


def page_lines(chars):
    base = [c for c in chars if not is_mark(c["text"]) and c["text"].strip() != "�"]
    marks = [c for c in chars if is_mark(c["text"])]
    lines = []  # [top, bottom, [chars]]
    for c in sorted(base, key=lambda c: c["top"]):
        if lines and abs(lines[-1][0] - c["top"]) <= max(2.5, 0.35 * c["size"]):
            lines[-1][2].append(c)
            lines[-1][1] = max(lines[-1][1], c["bottom"])
        else:
            lines.append([c["top"], c["bottom"], [c]])
    for m in marks:  # a diacritic joins the line whose band is nearest to it
        if not lines:
            break
        mid = (m["top"] + m["bottom"]) / 2
        best = min(lines, key=lambda l: 0 if l[0] - 4 <= mid <= l[1] + 4 else min(abs(mid - l[0]), abs(mid - l[1])))
        best[2].append(m)
    out = []
    for _, _, cs in lines:
        rtl = any(ARABIC.search(c["text"]) for c in cs)
        cs.sort(key=lambda c: ((-1 if rtl else 1) * (c["x0"] + c["x1"]) / 2, 1 if is_mark(c["text"]) else 0))
        s, prev = "", None
        for c in cs:
            gap = (prev["x0"] - c["x1"]) if (prev is not None and rtl) else (c["x0"] - prev["x1"]) if prev is not None else 0
            if prev is not None and not is_mark(c["text"]) and gap > 0.25 * c["size"]:
                s += " "
            s += c["text"]
            if not is_mark(c["text"]):
                prev = c
        if ARABIC.search(s):
            s = LTR_RUN.sub(lambda m: m.group(0)[::-1], s)
            # brackets: some PDFs store the mirrored glyph, others the logical one — decide per line from the pairs seen
            if len(CLOSE_OPEN.findall(s)) > len(OPEN_CLOSE.findall(s)):
                s = s.translate(str.maketrans("()[]{}", ")(][}{"))
        s = re.sub(r"\)([0-9٠-٩]{1,3})\(", r"(\1)", s)  # a lone footnote mark «)12(»
        s = unicodedata.normalize("NFKC", s).replace("�", "")
        s = re.sub(r"ـ+", "", s)
        s = re.sub(r"[ \t]+", " ", s).strip()
        if s and not is_mark(s.replace(" ", "")):
            out.append(s)
    return out


def printed_number(lines):
    for l in lines[:2] + lines[-2:]:
        t = l.strip()
        if re.fullmatch(r"[0-9]{1,3}", t):
            return t
    return None


def ocr_page(path, pno):
    with tempfile.TemporaryDirectory() as d:
        base = os.path.join(d, "p")
        subprocess.run(["pdftoppm", "-r", "300", "-f", str(pno), "-l", str(pno), "-gray", "-png", path, base], check=True)
        img = [f for f in os.listdir(d) if f.endswith(".png")][0]
        r = subprocess.run(["tesseract", os.path.join(d, img), "-", "-l", "ara", "--psm", "4"], capture_output=True, text=True, check=True)
        return [re.sub(r"\s+", " ", l).strip() for l in r.stdout.splitlines() if l.strip()]


def main(path, out, ocr_below=200, force_ocr=False):
    data = open(path, "rb").read()
    res = {"file": os.path.basename(path), "sha256": hashlib.sha256(data).hexdigest(), "pages": []}
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            lines = page_lines(page.chars)
            text = "\n".join(lines)
            method = "text"
            if force_ocr or len(text) < ocr_below:
                lines = ocr_page(path, pno)
                text = "\n".join(lines)
                method = "ocr"
            res["pages"].append({"file": pno, "printed": printed_number(lines), "method": method, "chars": len(text), "text": text})
    json.dump(res, open(out, "w", encoding="utf8"), ensure_ascii=False)
    print(f"{res['file']}: {len(res['pages'])} pages, ocr={sum(p['method'] == 'ocr' for p in res['pages'])}, chars={sum(p['chars'] for p in res['pages'])}")


if __name__ == "__main__":
    a = sys.argv[1:]
    ob = int(a[a.index("--ocr-below") + 1]) if "--ocr-below" in a else 200
    main(a[0], a[1], ob, "--force-ocr" in a)
