---
title: Session hygiene
type: practice
updated: 2026-11-20
summary: One session per ticket, steady model and effort, state in files, a clean restart between tasks, because every turn resends the whole history.
---

## Why
An agent session is a conversation that is sent back to the model in full on every turn. What you pay for, and what the
model has to sift through, grows with everything said so far. Two things follow:
- A session that mixes unrelated tasks carries the first task's history into the second, so you pay for it and the model
  can be distracted by it.
- The provider keeps a cached copy of the start of the conversation. Reading from that cache is much cheaper than reading the
  text fresh (on the API: 0.05x to 0.1x of the normal input price, 0.05x on Opus 5.5 and Sonnet 5.5; writing to it costs 1.25x
  for a 5-minute cache and 2x for a 1-hour one; checked 2026-11-20). Anything that changes the start of the conversation throws
  the cache away and you pay full price to rebuild it.

## When
Always, as a habit. It matters most on long sessions and on tickets that take more than one sitting.

## How here
- **One session per ticket.** Between unrelated tasks run `/clear`; it costs nothing. Run `/rename` first if you may want to
  come back (`/resume`).
- **State lives in files, not in the chat.** The plan file `.liftoff/plans/<KEY>.md` and the brain hold what the next session
  needs. If something would be lost by a `/clear`, write it there first.
- **Choose the model and the effort at the start and keep them.** Changing the model in the middle of a session (`/model`)
  makes the next turn read everything again without the cache. Changing the effort level keeps the cache only on Fable 5.1 and
  later, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (checked 2026-11-20). If the work really changed nature (from planning to a
  mechanical refactor), restart instead of switching.
- **The cache expires after 5 minutes of silence** by default. If you work in long pauses, the team may choose the 1-hour cache
  with `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` (the setting `promptCacheTtl` exists as well). It costs more to write, so use it only
  if pauses are the norm.
- **Compact at a natural break, not after a pause.** `/compact focus on <what matters>` after a long silence reads the whole
  conversation with a cold cache, which is the expensive case. To drop a wrong path, `/rewind` goes back to an earlier point that
  is still cached.
- **Do not correct in a loop.** After two corrections that did not work, stop: `/rewind` or `/clear` and give a better first
  message. Repeated corrections add text and rarely add direction.
- **Many screenshots hurt:** when the limit is exceeded the oldest images are dropped and the cache breaks.
- **Scheduled loops and check-ins on idle sessions** resend all the context each time. Prefer a fresh session per run.
- **Cheaper is not the goal.** Switching to a smaller model or lowering the effort on a hard bug usually costs more in the end
  (more iterations). Save on structure, not on judgment.
- Team detail (the team's real `/model` and effort defaults, its pause habits): add below.

## Example
Sara finishes PROJ-123 and the merge request is ready. She notes in the plan file that the retry logic was left for PROJ-130,
runs `/clear`, and starts PROJ-130 with "plan PROJ-130". The new session starts small and cached from its first turn.

Anti-example: she keeps going in the same session, asks for an unrelated dashboard fix, switches to a cheaper model to "save",
and the next turn reads the whole PROJ-123 history again, uncached.

Copilot in VS Code: whether `/clear`, `/rename` and the cache settings exist there, and how long its cache lives, is
**unverified**. Copilot has billed by token since 2026-06-01 (from a search snippet, unverified), so the same habit should
still pay off.
