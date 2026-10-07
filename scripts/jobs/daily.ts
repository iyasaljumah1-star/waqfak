/**
 * Daily compliance & housekeeping job.
 * Run: npx tsx --conditions=react-server scripts/jobs/daily.ts
 * (cron example: 15 2 * * *  cd /srv/waqfak && npx tsx --conditions=react-server scripts/jobs/daily.ts)
 *
 * Steps (each in its own system-context transaction, recorded in job_runs):
 *   resyncAll → recomputeStatuses → sendReminders → documentExpiryReminders (if the documents module provides it) → cleanup
 * The same job can be triggered over HTTP: POST /api/jobs/daily with header x-job-secret (only when JOB_SECRET is set).
 */
import "./_shim";
import "dotenv/config";
import { runDailyJob } from "../../src/server/modules/compliance/jobs";

runDailyJob({ trigger: "script" }).then(
  (r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === "failed" ? 1 : 0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
