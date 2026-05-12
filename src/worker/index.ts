import Redis from "ioredis";
import { markDueTasks } from "@/lib/repository";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
const pollSeconds = Number(process.env.WORKER_POLL_SECONDS || 300);

async function runOnce() {
  const lockKey = "review-assistant:worker-lock";
  const lock = await redis.set(lockKey, process.pid.toString(), "EX", Math.max(60, pollSeconds - 5), "NX");
  if (!lock) return;
  try {
    await scanMailbox();
    await markDueTasks();
    await notifyDueTasks();
  } finally {
    await redis.del(lockKey);
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
