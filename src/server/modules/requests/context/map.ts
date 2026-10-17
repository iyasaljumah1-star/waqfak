/**
 * Which waqf-file records each service starts from (PURE). A service lists only what its work actually reads: the
 * request page shows these blocks with their source, date and status, the analysis reasons over them, and missing or
 * outdated ones become completion requests or tasks. Services with no waqf yet (design, needs analysis, wills) start
 * from the client's answers only.
 */
import type { ContextKey } from "./types";

export const SERVICE_CONTEXT: Record<string, ContextKey[]> = {
  // التأسيس
  T03: ["waqf.terms", "assets.register"],
  T04: ["waqf.identity", "waqf.terms", "documents.key"],
  T05: ["assets.register"],
  T06: ["waqf.identity", "waqf.nazara", "waqf.terms", "assets.register", "documents.key"],
  T07: ["assets.register", "documents.key"],
  T08: ["waqf.identity", "waqf.nazara", "finance.records", "documents.key"],
  T09: ["waqf.identity", "waqf.nazara", "documents.key"],
  // الوصايا
  W05: ["waqf.identity", "waqf.terms", "documents.key"],
  // النظارة والإدارة
  N01: ["waqf.identity", "waqf.terms", "waqf.nazara", "assets.register", "finance.records", "beneficiaries.register", "documents.key", "compliance.obligations", "risks.register"],
  N02: ["board.composition", "governance.rules", "board.meetings"],
  N03: ["waqf.nazara", "governance.policies", "compliance.obligations"],
  N04: ["waqf.nazara", "assets.register", "finance.records", "documents.key"],
  N05: ["board.composition", "governance.rules", "board.meetings", "board.resolutions"],
  N06: ["waqf.nazara", "compliance.obligations"],
  N07: ["waqf.terms", "beneficiaries.register", "finance.records"],
  N08: ["waqf.identity", "waqf.nazara", "assets.register", "finance.records", "documents.key", "compliance.obligations"],
  N09: ["waqf.identity", "documents.key"],
  // الحوكمة
  G01: ["waqf.identity", "waqf.nazara", "board.composition", "governance.rules", "governance.policies"],
  G02: ["waqf.identity", "waqf.terms", "waqf.nazara", "board.composition"],
  G03: ["waqf.nazara", "board.composition", "governance.rules"],
  G04: ["waqf.identity", "waqf.terms", "assets.register", "finance.records", "governance.evaluations", "history.requests"],
  G05: ["waqf.terms", "beneficiaries.register", "governance.policies"],
  G06: ["board.composition", "governance.rules", "governance.policies"],
  G07: ["waqf.nazara", "waqf.terms", "board.composition"],
  G08: ["finance.records", "governance.policies", "board.resolutions", "compliance.obligations", "risks.register", "history.requests"],
  G09: ["waqf.nazara", "board.composition", "governance.rules", "board.meetings", "board.resolutions", "governance.policies", "finance.records", "compliance.obligations", "risks.register", "governance.evaluations", "documents.key"],
  G10: ["beneficiaries.register", "waqf.nazara", "board.composition"],
  // المالية
  F01: ["waqf.terms", "finance.records", "assets.register"],
  F02: ["waqf.identity", "finance.records"],
  F03: ["finance.records"],
  F04: ["waqf.terms", "finance.records", "assets.register"],
  F05: ["waqf.identity", "finance.records"],
  F06: ["waqf.identity", "finance.records", "documents.key", "history.requests"],
  F07: ["waqf.identity", "finance.records"],
  F08: ["finance.records", "assets.register"],
  F09: ["waqf.identity", "waqf.nazara", "documents.key"],
  // الاستثمار والأصول
  I01: ["waqf.terms", "assets.register", "finance.records", "governance.policies"],
  I02: ["waqf.terms", "assets.register", "finance.records"],
  I03: ["assets.register", "governance.policies"],
  I04: ["waqf.terms", "assets.register", "documents.key"],
  I05: ["assets.register", "governance.policies"],
  I06: ["waqf.identity", "assets.register"],
  I07: ["assets.register", "finance.records", "governance.policies"],
  I08: ["assets.register", "documents.key"],
  I09: ["assets.register", "finance.records"],
  // الامتثال والتقارير والاستشارات
  C01: ["waqf.identity", "governance.policies", "compliance.obligations", "documents.key"],
  C02: ["waqf.identity", "waqf.nazara", "board.composition", "governance.policies", "finance.records", "assets.register", "compliance.obligations", "risks.register", "documents.key"],
  C03: ["waqf.identity", "compliance.obligations", "documents.key", "finance.records", "governance.policies", "beneficiaries.register"],
  C04: ["waqf.identity", "compliance.obligations", "documents.key"],
  C05: ["waqf.identity", "finance.records", "board.meetings", "board.resolutions", "assets.register", "beneficiaries.register"],
  C06: ["beneficiaries.register", "finance.records"],
  C07: ["waqf.terms"],
  C08: ["waqf.identity", "waqf.nazara", "waqf.terms", "documents.key"],
  C09: ["finance.records"],
  C10: ["assets.register", "governance.policies"],
  C11: ["waqf.terms", "documents.key"],
  C12: ["waqf.terms", "waqf.nazara", "beneficiaries.register"],
  C13: ["waqf.identity", "waqf.nazara", "documents.key"],
};

export const contextFor = (code: string): ContextKey[] => SERVICE_CONTEXT[code] ?? [];
