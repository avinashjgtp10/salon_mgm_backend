import logger from "../../config/logger";
import { supportRepo } from "./support.repository";
import { notifySupport } from "./support.notifications";

// Once a minute, looks at callback requests that are still open and raises "due soon" (within 10 minutes of the requested time)
// and "overdue" (the time has passed). Each is raised once per callback: notifySupport de-duplicates on the event, so this
// sweep, a restart, or several backend instances can all run it without repeating a notification.
const DUE_SOON_MS = 10 * 60_000;
const SWEEP_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runCallbackDeadlineSweep(now = Date.now()) {
  if (running) return;
  running = true;
  try {
    for (const cb of await supportRepo.getOpenCallbacksWithTime()) {
      const due = Date.parse(cb.callback_at);
      if (!Number.isFinite(due)) continue;
      if (due < now) await notifySupport(cb, { kind: "overdue" });
      else if (due - now <= DUE_SOON_MS) await notifySupport(cb, { kind: "due_soon" });
    }
  } catch (err: any) {
    logger.warn("Callback deadline sweep failed", { error: err?.message });
  } finally {
    running = false;
  }
}

export function startCallbackDeadlineScheduler() {
  if (timer) return;
  const sweep = () => void runCallbackDeadlineSweep();
  sweep();
  timer = setInterval(sweep, SWEEP_MS);
}

export function stopCallbackDeadlineScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
