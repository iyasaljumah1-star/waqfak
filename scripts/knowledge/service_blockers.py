"""
What prevents activating each of the 64 services, as of this order (2026-11-06): computed from the per-service
reference impact (data/references/reports/service-impact.json), the knowledge-engine catalog (data/knowledge/catalog.json),
the link matrix (data/knowledge/reports/link-matrix.json) and the specialists' findings listed in SPECIALIST below.
Writes data/knowledge/reports/service-blockers.{json,md}. No service is activated or changed by this script.

Usage: python3 -I scripts/knowledge/service_blockers.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
impact = json.load(open(os.path.join(ROOT, "data/references/reports/service-impact.json"), encoding="utf8"))["rows"]
catalog = json.load(open(os.path.join(ROOT, "data/knowledge/catalog.json"), encoding="utf8"))["sources"]
matrix = {r["refCode"]: r for r in json.load(open(os.path.join(ROOT, "data/knowledge/reports/link-matrix.json"), encoding="utf8"))["rows"]}

# specialists' findings that block or condition a service (reports under /home/claude/kb2/reports, copied to the project)
SPECIALIST = {
    "C07": "آلية مراجعة المستشار الشرعي وتوقيعه مقترحة ولم تُعتمد؛ نصوص الكتب الحنبلية لم تُقابل بصور المطبوع؛ النوازل المعاصرة غير محررة.",
    "F02": "قرار الإطار المحاسبي (سوكبا للمنشآت غير الهادفة للربح افتراضياً) لم يُتخذ؛ «دليل الحسابات المعتمد من الهيئة» المشار إليه لم يُعثر عليه.",
    "F03": "قرار الإطار المحاسبي لم يُتخذ.",
    "F05": "قرار الإطار المحاسبي لم يُتخذ؛ نموذج البيان المالي للأوقاف الصغيرة في منصة الهيئة لم يُفحص.",
    "F06": "قرار الإطار المحاسبي لم يُتخذ؛ يلزم تأكيد مكتوب من الهيئة أو سوكبا قبل الإطلاق؛ الرأي بتوقيع محاسب قانوني مرخص.",
    "C09": "قرار الإطار المحاسبي لم يُتخذ.",
    "T02": "لا بيانات سكانية دون مستوى المنطقة منشورة لأغلب المؤشرات: يلزم طلب بيانات رسمي أو دراسة ميدانية؛ قرار المالك في جمع دليل المركز الوطني.",
    "I03": "وصف الخدمة يذكر «دليل قواعد وضوابط الاستثمار» سنداً، وهو موجه للجمعيات واسترشادي: يلزم تعديل الوصف (قرار المالك)؛ حدود الإرشاد العقاري دون ترخيص.",
    "I01": "دليل قواعد وضوابط الاستثمار استرشادي فقط.",
    "I07": "دليل قواعد وضوابط الاستثمار استرشادي فقط.",
    "I09": "إدارة أملاك الغير والإرشاد العقاري تحتاج ترخيصاً عقارياً (قرار المالك).",
    "C10": "المشورة في أوراق مالية بعينها تحتاج ترخيص هيئة السوق المالية (قرار المالك).",
    "T07": "لائحة صناديق الاستثمار لم يُتحقق من نصها.",
    "N01": "متطلب ترخيص الشخص الاعتباري (م5/2) غير محسوم تنظيمياً؛ لا يمنع الدراسة وإعداد طلب التعيين.",
}

by_service = {}
for e in catalog:
    for s in e["services"]:
        by_service.setdefault(s, []).append(e["refCode"])

rows = []
for r in impact:
    code = r["code"]
    srcs = sorted(set(by_service.get(code, [])))
    citable = [c for c in srcs if matrix.get(c, {}).get("approved")]
    blockers = []
    ess = [x for x in r["refs"] if x.get("tier") == "جوهري"]
    for x in ess:
        if x["classification"] != "معتمد":
            blockers.append(f"{x['name']}: {x['classification']}")
    if not citable:
        blockers.append("لا مقطع قابل للاستشهاد بعد في قاعدة المعرفة لهذه الخدمة (لا مراجعة بشرية معتمدة)")
    if code in SPECIALIST:
        blockers.append(SPECIALIST[code])
    if r["professional"] and r["professional"] not in ("لا",):
        blockers.append(f"يلزم: {r['professional']}")
    rows.append({"code": code, "name": r["name"], "kbSources": srcs, "citableNow": citable, "blockers": blockers, "provision": r["provision"]})

json.dump({"builtAt": "2026-11-06", "rows": rows}, open(os.path.join(ROOT, "data/knowledge/reports/service-blockers.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
L = ["# المتطلبات التي تمنع تفعيل كل خدمة — 2026-11-06", "", "لا تُفعّل أي خدمة بهذا الجدول. «مصادر قاعدة المعرفة»: المصادر المربوطة بالخدمة في الكتالوج. «قابل للاستشهاد الآن»: دون أي مراجعة اصطناعية.", "",
     "| الخدمة | مصادر قاعدة المعرفة | قابل للاستشهاد الآن | ما يمنع التفعيل | ما يمكن تقديمه الآن |", "|---|---|---|---|---|"]
for x in rows:
    L.append(f"| {x['code']} — {x['name']} | {len(x['kbSources'])} | {len(x['citableNow'])} | {'؛ '.join(x['blockers']).replace('|', '/')} | {x['provision']} |")
open(os.path.join(ROOT, "data/knowledge/reports/service-blockers.md"), "w", encoding="utf8").write("\n".join(L) + "\n")
print(len(rows), "services;", sum(1 for x in rows if x["citableNow"]), "with a citable source now;", sum(1 for x in rows if not x["kbSources"]), "with no KB source")
