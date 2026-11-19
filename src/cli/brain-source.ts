import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { brainPaths, symlinkProblem } from "../brain/paths.js";
import { parseLesson } from "../brain/lesson.js";
import { KINDS, type SourceKind, cleanText, lessonBody, sourceFile, ticketBody } from "../brain/source.js";
import { connectors, projectsOf } from "../config/index.js";
import { secretGuard } from "../config/secrets.js";
import { KEY_RE, slugify } from "../plan/build.js";
import { readTicket, readWithMap } from "../plan/ticket.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "source-invalid" | "source-secret" | "no-tracker" | "no-lessons" | "usage", message: string, extra: object = {}, exitCode: 1 | 2 = 1): Outcome => ({
  exitCode,
  body: { ok: false, errors: [{ code, message, ...extra }] },
});

const NOT_A_GUARANTEE = "(an accident guard, not a guarantee)";
const MAX_TICKET_JSON = 2_000_000;
const PREVIEW_LINES = 40;

// Copies one source into <dir>/raw/, content-addressed and read-only by convention. The only writer of raw/.
export const brainSource: Handler = ({ root, file, key, kind, write }) => {
  if (!kind || !(KINDS as readonly string[]).includes(kind)) return fail("usage", `brain-source needs --kind ${KINDS.join("|")}`, {}, 2);
  if (!file) return fail("usage", "brain-source needs --file <path>", {}, 2);
  const k = kind as SourceKind;

  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const config = read.config;
  if (!config.brain) return brainFail("no-brain", NO_BRAIN);

  const realRoot = resolveReal(root);
  const paths = brainPaths(config.brain.dir);
  const link = symlinkProblem(realRoot, paths);
  if (link) return brainFail("brain-invalid", `${link} is or contains a symlink: the brain must be plain folders inside the repo`, { file: link });
  if (!existsSync(join(realRoot, paths.raw))) return brainFail("brain-invalid", `${paths.raw} not found: run brain-init first`, { file: paths.raw });

  const abs = resolve(root, file);
  let real: string;
  try {
    real = resolveReal(abs);
  } catch {
    return fail("source-invalid", `cannot read ${file}`);
  }
  if (k !== "ticket") {
    if (!isInside(realRoot, real)) return fail("source-invalid", `${file} is outside the repository`);
    const rel = relative(realRoot, real).split("\\").join("/");
    if (isInside(join(realRoot, paths.dir), real)) return fail("source-invalid", `${file} is inside the brain: sources come from outside it`);
    if (k === "doc" && (rel === ".liftoff" || rel.startsWith(".liftoff/"))) return fail("source-invalid", `${file} is in .liftoff (personal files): only a plan, an MR description or a lesson may come from there`);
    if (k === "lesson") {
      if (!config.brain.lessons) return fail("no-lessons", "liftoff.yaml has no brain.lessons section: the lead enables lessons in liftoff.yaml");
      if (!/^\.liftoff\/brain\/lessons\/[a-z0-9][a-z0-9-]{1,39}\.md$/.test(rel)) return fail("source-invalid", `${file} is not a personal lesson (.liftoff/brain/lessons/<key>.md)`);
    }
  }

  let buf: Buffer;
  try {
    if (!statSync(real).isFile()) return fail("source-invalid", `${file} is not a regular file`);
    if (statSync(real).size > (k === "ticket" ? MAX_TICKET_JSON : 1_000_000)) return fail("source-invalid", `${file} is too large`);
    buf = readFileSync(real);
  } catch {
    return fail("source-invalid", `cannot read ${file}`);
  }

  let id: string, from: string, body: string;
  if (k === "ticket") {
    const { tracker } = connectors(config);
    if (!tracker) return fail("no-tracker", "liftoff.yaml has no tracker: run the Connect skill first");
    const ticket = readTicket(buf.toString("utf8"));
    if ("error" in ticket) return fail("source-invalid", ticket.error);
    const km = KEY_RE.exec(ticket.key);
    const project = km && projectsOf(config).find((p) => p.project === km[1]);
    if (!project) return fail("source-invalid", `${ticket.key} is not an issue key of a configured project`);
    const type = project.issueTypes.find((t) => t.name.toLowerCase() === ticket.issueType.toLowerCase());
    const text = cleanText(Buffer.from(ticketBody({ key: ticket.key, summary: ticket.summary, issueType: ticket.issueType, description: ticket.description, criteria: readWithMap(ticket, type).acceptanceCriteria.text })));
    if ("error" in text) return fail("source-invalid", `the ticket text is ${text.error}`);
    id = ticket.key;
    from = `${tracker.url}/browse/${ticket.key}`;
    body = text.body;
  } else if (k === "lesson") {
    const lesson = parseLesson(buf.toString("utf8"));
    if (!lesson.ok) return fail("source-invalid", `${file} is not a valid lesson: ${lesson.errors.join("; ")}`);
    const text = cleanText(Buffer.from(lessonBody(lesson.lesson)));
    if ("error" in text) return fail("source-invalid", `the lesson text is ${text.error}`);
    id = lesson.lesson.key;
    from = relative(realRoot, real).split("\\").join("/");
    body = text.body;
  } else {
    const text = cleanText(buf);
    if ("error" in text) return fail("source-invalid", `${file} is ${text.error}`);
    body = text.body;
    from = relative(realRoot, real).split("\\").join("/");
    if (k === "doc") id = slugify(basename(real).replace(/\.[^.]*$/, ""));
    else {
      const id0 = key ?? /^ticket:\s*([A-Z][A-Z0-9_]*-[0-9]+)\s*$/m.exec(body.split("\n---")[0] ?? "")?.[1] ?? /^([A-Z][A-Z0-9_]*-[0-9]+)/.exec(basename(real))?.[1];
      if (!id0 || !KEY_RE.test(id0)) return fail("source-invalid", `cannot tell which ticket this ${k} belongs to: pass --key PROJ-123`);
      id = id0;
    }
  }
  if (secretGuard({ text: body }).length > 0) return fail("source-secret", `the text looks like a credential, so nothing was written ${NOT_A_GUARANTEE}. Remove it from the source and run this again`);

  const out = sourceFile(k, id, from, body);
  const path = `${paths.dir}/${out.rel}`;
  const target = join(realRoot, path);
  let action: "create" | "created" | "exists" = write ? "created" : "create";
  if (existsSync(target)) {
    if (readFileSync(target, "utf8") !== out.content) return fail("source-invalid", `${path} exists with different content: raw files are never overwritten`, { file: path });
    action = "exists";
  } else if (write) atomicWrite(target, out.content);
  // What will be (or was) stored: the header line and the first lines of the body, so the engineer sees it before saying yes.
  const lines = body.split("\n");
  const header = out.content.slice(0, out.content.indexOf("\n"));
  return { exitCode: 0, body: { ok: true, path, action, sha256: out.sha, bytes: Buffer.byteLength(out.content), header, preview: lines.slice(0, PREVIEW_LINES).join("\n"), previewTruncated: lines.length > PREVIEW_LINES, written: action === "created" } };
};
