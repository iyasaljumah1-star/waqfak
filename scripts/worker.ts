/**
 * The engine's independent worker: drains the processing queue every few seconds, in its own process, so that requests
 * are processed whatever happens to the web process or the client's browser. Stops cleanly on SIGTERM/SIGINT after the
 * job in hand. Run with: npx tsx --conditions=react-server scripts/worker.ts
 */
import "./jobs/_shim";
import "dotenv/config";
import { drain } from "../src/server/engine/queue/worker";

const POLL_MS = Number(process.env.ENGINE_POLL_MS ?? 3000);
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { stopping = true; });

async function main() {
  const id = `worker-${process.pid}`;
  console.log(`[engine] worker ${id} started (poll ${POLL_MS} ms)`);
  while (!stopping) {
    try {
      const n = await drain({ max: 10, workerId: id });
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e) {
      console.error(`[engine] worker loop error: ${e instanceof Error ? e.constructor.name : "Error"}`);
      await new Promise((r) => setTimeout(r, POLL_MS * 3));
    }
  }
  console.log(`[engine] worker ${id} stopped`);
  process.exit(0);
}

void main();
