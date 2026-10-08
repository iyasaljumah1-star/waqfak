# وقفك — Waqfak

منصة رقمية مؤسسية متخصصة في الأوقاف تجمع:
- **الموقع العام**، وفيه الخدمات والمكتبة والأدوات والتقييم المجاني.
- **بوابة الواقف والناظر والمجلس**، وفيها ملف الوقف الكامل والامتثال والحوكمة والطلبات.
- **بوابة المستفيد**.
- **لوحة إدارة الشركة**.

| الوثيقة | المحتوى |
|---|---|
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | ما تم تنفيذه واختباره ونشره، وما بقي، وما يحتاج منك |
| [ARCHITECTURE.md](ARCHITECTURE.md) | بنية المشروع ونموذج الأمان |
| [RUNBOOK.md](RUNBOOK.md) | التشغيل والنشر والصيانة والاستجابة للحوادث |
| [docs/RTM.md](docs/RTM.md) | مصفوفة تتبع المتطلبات (المصدر ← المتطلب ← الميزة ← الصفحة/API/الجدول ← الحالة) |
| [docs/DATABASE.md](docs/DATABASE.md) · [docs/schema.sql](docs/schema.sql) | مخطط قاعدة البيانات |
| [CONVENTIONS.md](CONVENTIONS.md) | قواعد التطوير |

## تشغيل سريع (تطوير)

```bash
npm ci
cp .env.example .env    # عبّئ DATABASE_URL وDATABASE_OWNER_URL والمفاتيح
npm run db:migrate && npm run db:seed && npm run db:seed-demo
npm run dev
```

## نشر الإنتاج

```bash
bash deploy/install.sh   # Docker + PostgreSQL + Caddy (HTTPS تلقائي) + نسخ احتياطي + مهام يومية
```

التفاصيل في [RUNBOOK.md](RUNBOOK.md).
