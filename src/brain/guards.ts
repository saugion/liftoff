// Text guards shared by brain-check and the lessons loop. Accident guards, not guarantees: they catch the usual
// phrasing, a human review is what decides.

// Phrases that read like an instruction to an agent.
export const INSTRUCTION_LIKE = [
  /ignore (all|any|previous) instructions/i,
  /you (must|should) now/i,
  /as an ai/i,
  /system prompt/i,
  /\b(agents?|assistant) (must|should|always|never)\b/i,
];
export const instructionLike = (line: string): boolean => INSTRUCTION_LIKE.some((re) => re.test(line));

// What a quality bar is made of (English and Italian).
const BAR = "tests?|test suite|e2e|checks?|lint(?:er|ing)?|typecheck(?:ing)?|type checks?|coverage|ci|pipeline|code review|reviews?|hooks?|controlli|revisione|copertura";
// Verbs that lower it, and phrases that say it is not needed.
const LOWER = "skip(?:ping)?|ignore|ignoring|disable|disabling|bypass(?:ing)?|omit|omitting|remove|removing|delete|deleting|drop|dropping|turn off|salta(?:re)?|ignora(?:re)?|disabilita(?:re)?|ometti(?:ere)?|rimuovi(?:ere)?|elimina(?:re)?";
const NOT_NEEDED = `(?:no need (?:to|for)|not needed|unnecessary|non serve|non occorre|non è necessario|non e' necessario|non bisogna|inutile)`;

const WEAKEN: RegExp[] = [
  new RegExp(`\\b(?:${LOWER})\\b[^.;\\n]{0,40}\\b(?:${BAR})\\b`, "i"),
  new RegExp(`${NOT_NEEDED}[^.;\\n]{0,40}\\b(?:${BAR}|lanciare|eseguire|run(?:ning)?|write|writing|scrivere)\\b`, "i"),
  new RegExp(`\\b(?:${BAR})\\b[^.;\\n]{0,25}(?:not needed|not required|unnecessary|optional|non servono|non sono necessari|opzionali)`, "i"),
  /\b(?:lower|reduce|relax|decrease|abbassa(?:re)?|riduci(?:re)?)\b[^.;\n]{0,30}\b(?:coverage|threshold|bar|soglia|copertura)\b/i,
  /\b(?:don'?t|do not|stop)\b[^.;\n]{0,15}\b(?:run(?:ning)?|write|writing|add(?:ing)?)\b[^.;\n]{0,20}\b(?:tests?|checks?|lint)\b/i,
];
// "never skip tests" / "mai saltare i test" say the opposite of lowering the bar.
const NEGATED = /\b(?:never|always|must not|should not|do not ever|mai|non devi|non si deve)\s+(?:ever\s+)?$/i;

// True when the rule would lower the quality bar (skip tests, relax checks, lower a threshold).
export function weakensBar(rule: string): boolean {
  for (const re of WEAKEN) {
    const m = re.exec(rule);
    if (!m) continue;
    if (NEGATED.test(rule.slice(0, m.index))) continue;
    return true;
  }
  return false;
}
