"use server";

import { z } from "zod";
import { withSystem } from "@/server/db";
import { contactMessages } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { rateLimit } from "@/server/lib/rate-limit";
import { requestInfo } from "@/server/lib/request-info";
import { parseForm, toState } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { CONTACT_TOPICS } from "./contact-topics";

const phoneRe = /^(?:\+?966|0)?5\d{8}$/;

const schema = z
  .object({
    name: z.string().trim().min(2, "اكتب اسمك (حرفان على الأقل).").max(80, "الاسم أطول من 80 حرفًا."),
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))
      .refine((v) => !v || phoneRe.test(v), "اكتب رقم جوال سعوديًا صحيحًا، مثل 0551234567.")
      .optional()
      .default(""),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("اكتب بريدًا إلكترونيًا صحيحًا.").max(120)]).optional().default(""),
    topic: z.enum(CONTACT_TOPICS.map((t) => t.value) as [string, ...string[]], { message: "اختر موضوع الرسالة." }),
    body: z.string().trim().min(10, "اكتب رسالتك في عشرة أحرف على الأقل.").max(3000, "الرسالة أطول من 3000 حرف."),
    ref: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/).optional().default(""),
    consent: z.literal("on", { message: "وافق على معالجة بياناتك للرد على رسالتك." }),
    website: z.string().optional().default(""), // honeypot
    startedAt: z.coerce.number().optional(),
  })
  .refine((d) => d.phone || d.email, { message: "اكتب جوالك أو بريدك لنرد عليك.", path: ["phone"] });

/**
 * Public contact form. Anonymous, so it writes under the system context (public intake, no waqf data).
 * Defences: honeypot field, minimum fill time, per-IP rate limit (5/hour) and per-contact limit (3/day).
 */
export async function submitContact(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = parseForm(schema, fd);
    if ("state" in r) return r.state;
    const d = r.data;
    const success: ActionState = { ok: true, message: "وصلتنا رسالتك. سنرد عليك خلال يومي عمل على الوسيلة التي كتبتها." };

    // Bots fill hidden fields or submit instantly: answer as if accepted, store nothing.
    if (d.website || (d.startedAt && Date.now() - d.startedAt < 2500)) return success;

    const { ip, userAgent } = await requestInfo();
    if (!(await rateLimit(`contact:ip:${ip}`, 5, 3600)))
      return { error: "أرسلت عدة رسائل خلال ساعة. انتظر قليلًا ثم أعد المحاولة، أو راسلنا لاحقًا." };
    if (!(await rateLimit(`contact:to:${d.phone || d.email}`, 3, 86400)))
      return { error: "وصلتنا منك ثلاث رسائل اليوم. سنرد عليها قريبًا، ولا حاجة لإعادة الإرسال." };

    const topicLabel = CONTACT_TOPICS.find((t) => t.value === d.topic)?.label ?? d.topic;
    const body = d.ref ? `[مرجع: ${d.ref}]\n${d.body}` : d.body;
    await withSystem(async (tx) => {
      const [row] = await tx
        .insert(contactMessages)
        .values({ name: d.name, phone: d.phone || null, email: d.email || null, topic: topicLabel, body })
        .returning({ id: contactMessages.id });
      await audit(tx, {
        actorUserId: null,
        actorLabel: "زائر الموقع",
        action: "contact.submit",
        entityType: "contact_message",
        entityId: row.id,
        ip,
        userAgent,
        after: { topic: topicLabel, ref: d.ref || null, hasPhone: !!d.phone, hasEmail: !!d.email },
      });
    });
    return success;
  } catch (e) {
    return toState(e);
  }
}
