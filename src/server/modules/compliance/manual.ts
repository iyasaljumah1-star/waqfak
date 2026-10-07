/** Generic definition for manually added one-off obligations (status "retired": the engine never auto-creates it). */
export const MANUAL_OBLIGATION = {
  code: "OB-MAN-00",
  titleAr: "التزام يدوي",
  description: "تعريف عام للالتزامات التي يضيفها مدير الوقف يدويًا لمرة واحدة. لا ينشئه المحرك تلقائيًا؛ عنوان كل التزام يُحفظ في حدث إنشائه.",
  referenceText: "يضيفه مدير الوقف يدويًا (المرجع في وصف الالتزام)",
  authority: "internal" as const,
  obligationType: "manual",
  triggerEvent: "manual",
  offsetValue: null,
  offsetUnit: "none",
  recurrence: "none",
  appliesTo: {},
  severity: "medium" as const,
  requiredAction: "نفّذ الإجراء الموصوف وأرفق الدليل.",
  reminderOffsetsDays: [14, 3, 1],
  status: "retired" as const,
  verificationStatus: "verified" as const,
};
