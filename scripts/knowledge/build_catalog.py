"""
Builds the catalog of the unified knowledge engine (data/knowledge/catalog.json) and gathers its texts
(data/knowledge/texts/*.json.gz) from:
  - the official snapshots of the reference registry (data/references/snapshots, manifest),
  - the project files, extracted page by page (scripts/knowledge/extract_pdf.py) into /home/claude/kb2/text,
  - the two files attached to the order of 2026-11-06 (the book «الميسّر» and the accounting study),
  - the specialists' verified quotations (/home/claude/kb2/passages/*.json) and references (/home/claude/kb2/refs/*.json).
The kind of every source is set here explicitly; nothing becomes binding because it is attached to the project.
Services come from the per-service basis of 2026-11-04 (data/references/impact) and from the specialists' links.

Usage: python3 -I scripts/knowledge/build_catalog.py <kb2_dir>
"""
import gzip, hashlib, json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KB2 = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/kb2"
OUT = os.path.join(ROOT, "data", "knowledge")
os.makedirs(os.path.join(OUT, "texts"), exist_ok=True)
os.makedirs(os.path.join(OUT, "specialist"), exist_ok=True)

basis = json.load(open(os.path.join(ROOT, "data/references/impact/basis-2026-11-04.json"), encoding="utf8"))
manifest = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data/references/manifest.json"), encoding="utf8"))["snapshots"]}
file_sha = json.load(open(os.path.join(KB2, "project/_sha.json")))

BASIS = {"GAA": "GAA-LAW", "NZR": "NAZARA-REG", "PEN": "PENALTIES", "BO": "BO-STD", "DON": "DONATIONS-REG", "PRD": "PRODUCTS-REG", "PRT": "PORTFOLIO-REG",
         "FND": "FUNDS-INSTR", "CIV": "CIVIL-TX", "COM": "COMPANIES", "UWD": "REPORTING-RULES", "GOV": "GOV-PRINCIPLES", "DRF": "DRAFTING-GUIDE",
         "WQF": "WAQIF-GUIDE", "TYP": "WAQF-TYPES-GUIDE", "INV": "INVEST-GUIDE", "AST": "ASSETS-GUIDE", "IRL": "INVEST-RULES", "Q100": "Q100",
         "NZG": "NAZIR-GUIDE", "RUG": "REG-USER-GUIDE"}
services = defaultdict(set)
for s in basis["services"]:
    for tier in ("ess", "aux", "gd"):
        for code, _ in s[tier]:
            if code in BASIS:
                services[BASIS[code]].add(s["code"])
# corrections from this order's findings
services["REVIVAL-REG"] |= {"N09", "N01"}           # IHY replaces the reporting rules (art. 30/2)
services["REPORTING-RULES"] = set()                 # repealed: history only
services["INVEST-RULES"] = {"I03", "I01", "I07"}    # guidance only (investment track: addressed to non-profit associations)

ACC_SERVICES = ["F01", "F02", "F03", "F05", "F06", "C05", "C09"]
INVEST_SERVICES = ["I01", "I03", "I04", "I09", "C10"]


def pages_of(name):
    return json.load(open(os.path.join(KB2, "text", name + ".json"), encoding="utf8"))


def write_text(code, payload):
    p = os.path.join(OUT, "texts", code + ".json.gz")
    with gzip.open(p, "wt", encoding="utf8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return "texts/" + code + ".json.gz"


catalog = []


ROLE = {"BOOK-MAYSAR": "sharia", "ACC-STUDY": "accounting", "INVEST-GUIDE": "investment", "INVEST-RULES": "investment", "ASSETS-GUIDE": "investment",
        "ANNUAL-REPORT-2024": "data"}
# pages of «الميسّر» a specialist showed to contradict the Hanbali school or attribute to it loosely (fiqh report §10.3,
# investment report §3); they are never cited
# 194 (borrowing: conditions not of the school) and 200 (attribution to the authority's statute not found): investment
# report §3; 231-232 (attribution to «the majority» and to Ahmad not established): fiqh report §10.3 (review B8)
BLOCKED = {"BOOK-MAYSAR": ["86", "101", "110", "194", "200", "212", "213", "231", "232"]}
# legal start of non-registry sources, when the source itself states it (a historical question needs it, review B10)
EFFECTIVE = {"SOCPA-NPO-2025": "2025-01-01"}


def add(**e):
    e.setdefault("services", sorted(services.get(e["refCode"], set())))
    e.setdefault("reviewRole", ROLE.get(e["refCode"]))
    e.setdefault("blockedPages", BLOCKED.get(e["refCode"], []))
    e.setdefault("quality", None)
    e.setdefault("effectiveOn", EFFECTIVE.get(e["refCode"]))
    e["services"] = sorted(set(e["services"]))
    catalog.append(e)


# A. official snapshots of registry instruments (citation decided by the reference guard)
for code, reg, snap, kind, title in [
    ("NAZARA-REG", "NZR", "NZR/uqn-p18926", "regulation", "لائحة تنظيم أعمال النظارة"),
    ("PRODUCTS-REG", "PRD", "PRD/uqn-4001176", "regulation", "لائحة المنتجات الاستثمارية الوقفية"),
    ("DONATIONS-REG", "DON", "DON/uqn-p27532", "regulation", "لائحة إنشاء الأوقاف أو تمويلها من خلال جمع التبرعات"),
    ("REVIVAL-REG", "IHY", "IHY/uqn-4001990", "regulation", "لائحة إحياء الأوقاف المجهولة والمعطلة"),
    ("BO-STD", "BO-STD", "BO-STD/upload-visual-f7a51daf", "regulation", "معايير المستفيد الحقيقي من الأوقاف"),
]:
    m = manifest[snap]
    text = open(os.path.join(ROOT, "data/references", m["file"]), encoding="utf8").read()
    add(refCode=code, registryId=reg, registrySnapshot=snap, refKind=kind, title=title, issuer="الهيئة العامة للأوقاف", version=snap,
        origin=f"{m['url']} ({m['via']})", originSha256=m["sha256"], textForm="statute", text=write_text(code, {"text": text}),
        note="النص من لقطة السجل؛ الاستشهاد بمادة منه يقرره حارس الاستشهاد في محرك المراجع.")

# B. project files, page by page
PROJECT = [
    # code, file, kind, registry, title, issuer, note
    ("GAA-LAW", "gaa-law", "statute", "GAA-LAW", "نظام الهيئة العامة للأوقاف", "مرسوم ملكي م/11 1437/2/26هـ", "ملف المشروع صور ممسوحة: النص بالتعرف الضوئي (OCR)، لا يُقتبس."),
    ("PENALTIES", "penalties-table", "regulation", "PEN-TABLE", "جدول المخالفات والجزاءات للائحة تنظيم أعمال النظارة", "الهيئة العامة للأوقاف (100/1/34/46)", "البيانات المنظمة للجدول في data/references/structured/PEN-TABLE."),
    ("PORTFOLIO-REG", "portfolios-reg-repealed", "regulation", "PRT", "لائحة إنشاء المحافظ الاستثمارية الوقفية (ملغاة)", "الهيئة العامة للأوقاف", "ملغاة بلائحة المنتجات (م35)."),
    ("FUNDS-INSTR", "funds-instructions-repealed", "official_instruction", "FND", "تعليمات الموافقة على إنشاء الصناديق الاستثمارية الوقفية (ملغاة)", "الهيئة العامة للأوقاف", "ملغاة بلائحة المنتجات (م35)."),
    ("REPORTING-RULES", "reporting-rules-repealed", "official_instruction", "QWB", "قواعد الإبلاغ عن الأوقاف المجهولة والمندثرة (ملغاة)", "مجلس إدارة الهيئة 45/1/22/44", "حلت محلها لائحة إحياء الأوقاف (م30/2)."),
    ("GOV-PRINCIPLES", "governance-principles", "official_guide", "GOV-PRIN", "مبادئ حوكمة الأوقاف", "مجلس إدارة الهيئة 47/1/15/ت 1447/06/13هـ", "مبادئ استرشادية معتمدة من المجلس."),
    ("NAZIR-GUIDE", "nazir-short-guide", "official_guide", None, "الدليل المختصر لمهمات ومسؤوليات ناظر الوقف", "الهيئة العامة للأوقاف — قطاع الشؤون التنظيمية", "دليل إرشادي."),
    ("DRAFTING-GUIDE", "waqf-document-drafting-guide", "official_guide", None, "الدليل الإرشادي لصياغة وثيقة الوقف", "الهيئة العامة للأوقاف", "دليل إرشادي."),
    ("WAQIF-GUIDE", "founders-guide", "official_guide", None, "الدليل الإرشادي للواقفين", "الهيئة العامة للأوقاف", "دليل إرشادي."),
    ("Q100", "100-qa", "official_guide", None, "مائة سؤال وجواب في مسائل الأوقاف", "الهيئة العامة للأوقاف (رجب 1447هـ)", "مادة تثقيفية."),
    ("ASSETS-GUIDE", "asset-selection-guide", "official_guide", None, "الدليل الإرشادي لاختيار الأصول الوقفية", "الهيئة العامة للأوقاف", "يصف نفسه غير ملزم، ويحيل إلى لائحتين ملغاتين."),
    ("INVEST-GUIDE", "waqf-investment-guide", "official_guide", None, "الدليل الإرشادي لاستثمار الأوقاف", "الهيئة العامة للأوقاف", "بلا تاريخ ولا اعتماد مذكور."),
    ("INVEST-RULES", "invest-rules-guide", "official_guide", None, "دليل قواعد وضوابط الاستثمار في المنظمات غير الربحية (الإصدار 4)", "الهيئة العامة للأوقاف", "موجه للجمعيات؛ استرشادي فقط، لا يُربط سندًا ملزمًا للاستثمار الوقفي."),
    ("REG-USER-GUIDE", "8589_1", "official_guide", None, "دليل المستخدم لخدمة تسجيل وقف", "الهيئة العامة للأوقاف", "دليل استخدام خدمة إلكترونية."),
    ("WAQF-TYPES-GUIDE", "waqf-types-guide", "official_guide", None, "الدليل الاسترشادي لتصنيف أنواع الوقف", "الهيئة العامة للأوقاف", "دليل استرشادي."),
    ("QUALITY-POLICY", "quality-policy", "official_guide", None, "سياسة الجودة — الهيئة العامة للأوقاف (ISO 9001:2015)", "الهيئة العامة للأوقاف", "سياسة داخلية للهيئة؛ لا تُربط بخدمة."),
    ("ANNUAL-REPORT-2024", "annual-report-2024", "statistical_source", None, "التقرير السنوي للهيئة العامة للأوقاف 2024", "الهيئة العامة للأوقاف", "تقرير رسمي؛ أرقامه لعام 2024."),
]
REPEALED = {"PORTFOLIO-REG", "FUNDS-INSTR", "REPORTING-RULES"}
for code, f, kind, reg, title, issuer, note in PROJECT:
    d = pages_of(f)
    add(refCode=code, registryId=reg, registrySnapshot=None, refKind=kind, title=title, issuer=issuer, version=f"ملف المشروع {f}.pdf",
        origin=f"ملف المشروع «{f}.pdf»", originSha256=d["sha256"], textForm="pages", text=write_text(code, {"pages": d["pages"]}),
        note=note, repealedFrom=("PRD" if code in ("PORTFOLIO-REG", "FUNDS-INSTR") else "IHY" if code == "REPORTING-RULES" else None))

# statutes delivered with engine-core as text (project docs)
for code, gz, title in [("CIVIL-TX", "civil-tx.txt.gz", "نظام المعاملات المدنية"), ("COMPANIES", "companies.txt.gz", "نظام الشركات ولوائحه التنفيذية")]:
    text = gzip.open(os.path.join(ROOT, "data/kb", gz), "rt", encoding="utf8").read()
    add(refCode=code, registryId=None, registrySnapshot=None, refKind="statute", title=title, issuer="مرسوم ملكي", version=f"ملف المشروع (data/kb/{gz})",
        origin="ملف المشروع (النص المستخرج)", originSha256=hashlib.sha256(text.encode()).hexdigest(), textForm="statute", text=write_text(code, {"text": text}),
        note="نظام غير مسجل في سجل المراجع ولم يُسترجع من مصدر رسمي: يُبحث فيه ولا يُستشهد به.")

# C. the two files attached to the order
for code, f, kind, title, issuer, svc, note in [
    ("BOOK-MAYSAR", "maysar", "contemporary_book", "الميسّر في فقه وإدارة الوقف", "عبدالرحمن بن إبراهيم العمران، ط1 1447هـ/2026م", ["C07"] + INVEST_SERVICES, "مرجع مساعد للبحث والتأطير؛ لا يُنسب منه قول إلى المذهب دون مصدره الأصلي."),
    ("ACC-STUDY", "acc-study", "academic_study", "المعايير المحاسبية للوقف – دراسة مقارنة", "د. بشير حزام صالح مهدي، 2023 (https://doi.org/10.59723/AWQ001/03)", ACC_SERVICES, "دراسة أكاديمية؛ ليست نصًا نظاميًا ولا معيارًا."),
]:
    d = pages_of(f)
    add(refCode=code, registryId=None, registrySnapshot=None, refKind=kind, title=title, issuer=issuer, version=f"ملف مرفق بالتكليف {d['sha256'][:12]}",
        origin="ملف مرفق بتكليف 2026-11-06", originSha256=d["sha256"], textForm="pages", text=write_text(code, {"pages": d["pages"]}), note=note, services=svc)

# D. specialists' verified quotations (sources not already held as official text)
SKIP = {"NZR-ART15", "NZR", "PRD", "NZR-SNAP", "IHY-SNAP", "NZR-ART9", "GAA-PENALTIES-NZR", "BOOK-MAYSAR", "ACC-STUDY-MAHDI-2023", "GAA-GOV-PRINCIPLES",
        "GAA-FAQ-109", "GAA-NAZIR-SHORT-GUIDE", "GAA-IRG-NPO", "GAA-INV-GUIDE", "GAA-ASSET-GUIDE"}
# corrections after the independent review: SOCPA's answers and opinion interpret a professional standard; GASTAT's
# use policy is a data licence — none of them is a binding instruction
KIND_FIX = {"SOCPA-NPO-QA": "professional_standard", "SOCPA-NPCO-OPINION-2025": "professional_standard", "GASTAT-USE-POLICY": "statistical_source"}
TRACK_ROLE = {"fiqh": "sharia", "accounting": "accounting", "investment": "investment", "t02": "data"}
refs, quotes = {}, defaultdict(list)
for track in ("fiqh", "accounting", "investment", "t02"):
    for r in json.load(open(os.path.join(KB2, "refs", track + ".json"), encoding="utf8")):
        cur = refs.setdefault(r["id"], dict(r, services=list(r.get("services", [])), _track=track))
        cur["services"] = sorted(set(cur["services"]) | set(r.get("services", [])))
        cur.setdefault("_editions", {})[track] = r.get("edition") or ""
    for p in json.load(open(os.path.join(KB2, "passages", track + ".json"), encoding="utf8")):
        quotes[p["refId"]].append(dict(p, _track=track))
    for kind in ("refs", "passages"):
        src = os.path.join(KB2, kind, track + ".json")
        open(os.path.join(OUT, "specialist", f"{kind}-{track}.json"), "w", encoding="utf8").write(open(src, encoding="utf8").read())
open(os.path.join(OUT, "specialist", "refs-t02-method.json"), "w", encoding="utf8").write(open(os.path.join(KB2, "refs", "t02-method.json"), encoding="utf8").read())

BOOK_ID = re.compile(r"book(?:_id)?\s*(\d{2,6})")
dropped = []
for rid, qs in quotes.items():
    if rid in SKIP or rid not in refs:
        continue
    r = refs[rid]
    kind = KIND_FIX.get(rid, r["kind"])
    # a classical book's quotations are grouped by the Turath book (edition) they were read in: one edition, one source
    groups = defaultdict(list)
    for q in qs:
        if "re-check" in (q.get("verifiedHow") or ""):
            dropped.append(f"{rid} {q['locator']}: marked for re-checking")
            continue
        m = BOOK_ID.search(q.get("verifiedHow") or "")
        key = m.group(1) if (kind == "classical_fiqh" and m) else ""
        if kind == "classical_fiqh" and not m:
            dropped.append(f"{rid} {q['locator']}: no Turath book id, edition unknown")
            continue
        groups[key].append(q)
    home = BOOK_ID.search(r.get("edition") or "") or BOOK_ID.search(r.get("sourceUrl") or "") or re.search(r"/book/(\d+)", r.get("sourceUrl") or "")
    home_id = home.group(1) if home else ""
    for key, qs2 in groups.items():
        seen, uniq = set(), []
        for q in qs2:
            if q["quote"] not in seen:
                seen.add(q["quote"])
                uniq.append({"locator": q["locator"], "quote": q["quote"], "verifiedHow": q.get("verifiedHow", ""), "topic": q.get("topic")})
        code = rid if (not key or key == home_id) else f"{rid}-B{key}"
        other = code != rid
        edition = (r.get("edition") or "غير محدد") if not other else f"طبعة Turath رقم {key} (غير الطبعة المعتمدة في مسار الفقه)"
        # for text sources the specialist's class is about the text's verification; for the T02 data sources it is about
        # the data's coverage (e.g. no sub-regional figures), not the accuracy of the quoted passage
        partial = r["_track"] != "t02" and r.get("classification", "") in ("مكتمل جزئياً", "غير متحقق")
        add(refCode=code, registryId=None, registrySnapshot=None, refKind=kind, title=r["title"] + (f" — Turath {key}" if other else ""), issuer=r.get("authorOrIssuer"),
            version=edition, origin=r.get("sourceUrl") or "تحقق المختص", originSha256=hashlib.sha256(json.dumps(uniq, ensure_ascii=False).encode()).hexdigest(), textForm="quotes",
            text=write_text(code, {"quotes": uniq}), services=r["services"], reviewRole=("sharia" if kind in ("classical_fiqh", "contemporary_book") else TRACK_ROLE[r["_track"]]),
            quality=("degraded" if partial else None),
            note=f"اقتباسات تحقق منها المختص ({r.get('classification', '')}){'؛ لا يُقتبس حرفياً قبل استكمال التحقق' if partial else ''}؛ لم تُقابل بالمطبوع: {r.get('verification', '')[:240]}")

json.dump({"builtAt": "2026-11-06", "sources": catalog}, open(os.path.join(OUT, "catalog.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("dropped:", dropped)
print(len(catalog), "sources;", sum(1 for c in catalog if c["services"]), "linked to services")
