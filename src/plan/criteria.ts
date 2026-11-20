// The acceptance criteria of a ticket as numbered items, so a plan can say which check proves which criterion. Deterministic and
// tolerant: Markdown, Jira wiki and rendered HTML. One item per top-level list entry or checkbox, one per Given/When/Then
// scenario; text with no structure is a single item. The ids (AC1, AC2, ...) follow the order of the text.
import { fromHtml } from "./ticket.js";

export interface Criterion { id: string; text: string }

const BULLET = /^(\s*)(?:([-*•])(?!\*)|(\d+[.)])|(#)(?!#))\s+(.*)$/; // `* x`, `- x`, `1. x`, `# x` (wiki); `** x` is nested
const STRIP = /^(?:\[[ xX]\]|\((?:\/|x|\*|y|n)\)|[☐☑✓✔])\s*/;
const SCENARIO = /^\W*(?:scenario(?: outline)?\b[^:\n]*:?|(?:scenario|example)\s*\d+\b[^:\n]*:?)/i;
const GIVEN = /^\W*given\b/i;
const THEN = /^\W*then\b/i;

const clean = (s: string): string => s.replace(STRIP, "").replace(/\s+/g, " ").trim();
const plain = (s: string): string => s.replace(/[*_`]/g, "").trim();

export function splitCriteria(text: string): Criterion[] {
  const lines = (/<[a-z][^>]*>/i.test(text) ? fromHtml(text) : text).replace(/\r\n?/g, "\n").split("\n");
  const body = lines.filter((l) => l.trim() !== "");
  if (body.length === 0) return [];
  const make = (texts: string[]): Criterion[] => texts.map(clean).filter((t) => t !== "").map((t, i) => ({ id: `AC${i + 1}`, text: t }));

  // Given/When/Then scenarios: a scenario starts at a "Scenario ..." line, or at a "Given" that follows a "Then".
  const hasGwt = body.some((l) => GIVEN.test(plain(l.replace(BULLET, "$5"))) || SCENARIO.test(plain(l)));
  if (hasGwt && body.some((l) => THEN.test(plain(l.replace(BULLET, "$5"))))) {
    const groups: string[][] = [];
    let seenThen = false;
    for (const raw of body) {
      const l = plain(raw.replace(BULLET, "$5"));
      const startsNew = SCENARIO.test(l) || (GIVEN.test(l) && seenThen);
      if (startsNew || groups.length === 0) { groups.push([]); seenThen = false; }
      groups[groups.length - 1]!.push(l);
      if (THEN.test(l)) seenThen = true;
    }
    return make(groups.map((g) => g.join(" ")));
  }

  // A list: the shallowest bullets are the items; deeper bullets and plain continuation lines belong to the item above.
  const bullets = body.map((l) => BULLET.exec(l));
  if (bullets.some((m) => m)) {
    const depth = Math.min(...bullets.flatMap((m) => (m ? [m[1]!.length] : [])));
    const items: string[] = [];
    body.forEach((l, i) => {
      const m = bullets[i];
      if (m && m[1]!.length === depth) items.push(m[5]!);
      else if (items.length > 0) items[items.length - 1] += ` ${(m ? m[5]! : l.trim()).replace(/^[*#-]+\s+/, "")}`;
    });
    return make(items);
  }
  return make([body.join(" ")]);
}
