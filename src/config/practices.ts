import { PRACTICE_DEFAULTS, type Config, type PracticeId, type PracticeMode } from "./types.js";

// The mode of a practice: what the lead wrote, else its default. `ticket-po-review` is on (the behaviour that existed before
// the switch); the practices that add a step to Plan or Build are off until the lead turns them on (the pilot rule).
export const practiceMode = (config: Config, id: PracticeId): PracticeMode => config.practices?.[id] ?? PRACTICE_DEFAULTS[id];

// Local pilot metrics: `pilot.metrics`, else the older `brain.lessons.metrics`, else off.
export const metricsOn = (config: Config): boolean => config.pilot?.metrics ?? config.brain?.lessons?.metrics ?? false;

// Every practice with its resolved mode, for the commands the skills call.
export const resolvedPractices = (config: Config): Record<PracticeId, PracticeMode> =>
  Object.fromEntries((Object.keys(PRACTICE_DEFAULTS) as PracticeId[]).map((id) => [id, practiceMode(config, id)])) as Record<PracticeId, PracticeMode>;
