import { readEvents, summarizeTicketReviews } from "../brain/metrics.js";
import { metricsOn } from "../config/index.js";
import { resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";

// Read-only. The pilot counters that do not need the brain: the PO's review of tickets, by month. No ticket key, no text, no
// name in it, so it can be pasted into the pilot results by hand. (The lessons metrics stay in `lesson-metrics`.)
export const pilotMetrics: Handler = ({ root }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  if (!metricsOn(read.config)) return { exitCode: 0, body: { ok: true, enabled: false, ticketReviews: [], note: "metrics are off (pilot.metrics: false, or no pilot section): nothing is recorded" } };
  return {
    exitCode: 0,
    body: {
      ok: true,
      enabled: true,
      ticketReviews: summarizeTicketReviews(readEvents(resolveReal(root))),
      note: "local only: copy it by hand into the pilot results. noEditApprovals counts batches approved with no question answered and nothing changed or dropped; it does not see edits made to the drafts afterwards, so it is an approximation",
    },
  };
};
