# Connect: decisions taken in autopilot

Decisions I took on my own while implementing Connect (2026-11-08), that you should know about. Each is reversible; the commit that carries it is named.

1. **Specs treated as approved.** You asked me to implement everything designed, so the four module specs and the open questions 1-2 of `SPEC-connect.md` (new `connect-info` command; CLI moves to `plugin/bin/liftoff.mjs`) are taken as approved. The specs were committed as they were.
2. **v1 hash golden.** `test/fixtures/config/v1-hashes.json` records the hashes of the v1 fixtures, generated with the v0.1.0 code before touching `hash.ts` (`UPDATE_GOLDEN=1` regenerates it). The `connect-*` valid fixtures are excluded from it.
3. **Schema file re-serialized.** Adding the connector definitions rewrote `schema/liftoff.schema.json` with a generic JSON formatter (arrays on several lines), so its diff is large though the v1 content is unchanged.
4. **Port range** (1-65535) is checked in code, not in the schema pattern (the pattern only requires 1-5 digits); the error pointer is the same (`/tracker/url`, `/codeHost/host`).
