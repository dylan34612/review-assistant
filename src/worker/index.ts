import { query } from "@/lib/db";
import { markDueTasks } from "@/lib/repository";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";

const pollSeconds = Number(process.env.WORKER_POLL_SECONDS || 300);
const lockId = 91234177;

async function runOnce() {
  const lock = await query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [lockId]);
  if (!lock.rows[0]?.locked) return;
  try {
    await scanMailbox();
    await markDueTasks();
    await notifyDueTasks();
  } finally {
    await query("select pg_advisory_unlock($1)", [lockId]);
  }
}

async function main() {
  console.log(`Review Assistant worker started; polling every ${pollSeconds}s`);
  for (;;) {
    try {
      await runOnce();
    } catch (error) {
      console.error(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
