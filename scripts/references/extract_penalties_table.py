"""
Positional extraction of the Nazara penalties table (جدول المخالفات والجزاءات) from the authority's PDF.

How it works (no guessing of cell boundaries):
- the table's own drawn rules give the grid: vertical rules -> the 9 sanction columns (3 waqf sizes x 3
  repetitions), the description column and the number column; horizontal rules -> the rows;
- a cell's text is built from the PDF characters inside its box, ordered right to left (logical order for Arabic),
  with runs of digits restored left to right, then folded with NFKC (presentation forms -> letters);
- every cell keeps its page and bounding box, so each value can be checked against the page image.

Usage: python3 -I extract_penalties_table.py <file.pdf> <out.json>
Reads the file only; no network.
"""
import hashlib, json, re, sys, unicodedata

import pdfplumber

SIZES = ["large", "medium", "small"]  # right to left in the header bands
REPS = ["first", "second", "third"]


def cluster(values, tol=3.0):
    out = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


def text_in(chars, box):
    x0, top, x1, bottom = box
    inside = [c for c in chars if x0 <= (c["x0"] + c["x1"]) / 2 < x1 and top <= (c["top"] + c["bottom"]) / 2 < bottom]
    lines = []
    for c in sorted(inside, key=lambda c: c["top"]):
        if lines and abs(lines[-1][0] - c["top"]) <= 2.5:
            lines[-1][1].append(c)
        else:
            lines.append([c["top"], [c]])
    out = []
    for _, cs in lines:
        s = "".join(c["text"] for c in sorted(cs, key=lambda c: -c["x0"]))
        # numbers are stored left to right: restore runs like «000.01» -> «10.000»
        s = re.sub(r"[0-9][0-9.,/%\-]*[0-9%]|[0-9]", lambda m: m.group(0)[::-1], s)
        if re.search(r"[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]", s):
            s = s.translate(str.maketrans("()[]", ")(]["))  # mirrored brackets in right-to-left runs
        out.append(s)
    s = unicodedata.normalize("NFKC", " ".join(out))
    s = re.sub(r"[ـ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def main(path, out):
    data = open(path, "rb").read()
    result = {"source_file_sha256": hashlib.sha256(data).hexdigest(), "pages": [], "rows": [], "notes": [], "issues": []}
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            chars = page.chars
            full = text_in(chars, (0, 0, page.width, page.height))
            result["pages"].append({"page": pno, "text": full})
            v = cluster([l["x0"] for l in page.lines if abs(l["x0"] - l["x1"]) < 1])
            h = cluster([l["top"] for l in page.lines if abs(l["top"] - l["bottom"]) < 1])
            if len(v) < 12 or len(h) < 4:
                continue  # not a table page
            # 12 vertical edges: 9 sanction columns, description, number.
            v = v[-12:] if len(v) > 12 else v
            cols = [(v[i], v[i + 1]) for i in range(len(v) - 1)]
            num_col, desc_col, sanction_cols = cols[-1], cols[-2], list(reversed(cols[:-2]))  # right to left
            if len(sanction_cols) != 9:
                result["issues"].append({"page": pno, "issue": f"expected 9 sanction columns, found {len(sanction_cols)}"})
                continue
            table_top = h[0]
            for r in range(len(h) - 1):
                top, bottom = h[r], h[r + 1]
                code = text_in(chars, (num_col[0], top, num_col[1], bottom))
                desc = text_in(chars, (desc_col[0], top, desc_col[1], bottom))
                if not code or not re.fullmatch(r"[0-9]{1,2}(-[0-9]{1,2})?", code):
                    continue  # header rows
                if "-" not in code:
                    band = text_in(chars, (sanction_cols[-1][0], top, sanction_cols[0][1], bottom))
                    result["rows"].append({"kind": "group", "group": int(code), "title": band or desc, "page": pno})
                    continue
                item, group = code.split("-")  # printed «1-2» = item 1 of group 2 (right-to-left reading)
                cells = {}
                for i, (x0, x1) in enumerate(sanction_cols):
                    cells[f"{SIZES[i // 3]}.{REPS[i % 3]}"] = {"raw": text_in(chars, (x0, top, x1, bottom)), "bbox": [round(x0, 1), round(top, 1), round(x1, 1), round(bottom, 1)]}
                result["rows"].append({"kind": "violation", "code": f"{group}-{item}", "printed": code, "page": pno, "description": desc, "cells": cells})
            # Notes with legal effect printed under the table («*تضاعف الغرامة…»).
            for m in re.finditer(r"\*[^*]+?ريال\.?", full):
                result["notes"].append({"page": pno, "text": m.group(0).strip()})
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
