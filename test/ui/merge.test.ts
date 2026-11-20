import { parseDocument } from "yaml";
import { describe, expect, it } from "vitest";
import { applyPatch } from "../../ui/merge.js";

const SRC = `# team config
liftoff: 1
project:
  name: demo # keep me
  kind: existing
tracker:
  kind: jira-dc
  url: https://jira.example.com
  issueTypes:
    - name: Bug
      branchType: fix
      template: "## Steps"
    - name: Story
      template: "As a"
modules:
  items:
    - id: api
      path: services/api
      description: REST
    - id: web
      path: apps/web
`;
const run = (patch: Record<string, unknown>) => {
  const doc = parseDocument(SRC);
  applyPatch(doc, patch);
  return { text: doc.toString(), js: doc.toJS() };
};

describe("applyPatch", () => {
  it("changes a scalar and keeps comments and everything not mentioned", () => {
    const { text, js } = run({ project: { name: "other" } });
    expect(js.project).toEqual({ name: "other", kind: "existing" });
    expect(text).toContain("# team config");
    expect(js.tracker.issueTypes[0].template).toBe("## Steps");
  });

  it("null deletes a key, a leaf that is absent from the patch stays", () => {
    const { js } = run({ modules: { items: [{ id: "api", path: "services/api", description: null }, { id: "web", path: "apps/web" }] } });
    expect(js.modules.items[0]).toEqual({ id: "api", path: "services/api" });
  });

  it("keeps learned fields of a renamed item ($was), drops removed items, appends new ones", () => {
    const { js } = run({ tracker: { issueTypes: [{ $was: "Bug", name: "Defect", branchType: "fix" }, { name: "Task" }] } });
    expect(js.tracker.issueTypes).toEqual([{ name: "Defect", branchType: "fix", template: "## Steps" }, { name: "Task" }]);
  });

  it("removes the first of two items without shifting the other", () => {
    const { js } = run({ modules: { items: [{ id: "web", path: "apps/web2" }] } });
    expect(js.modules.items).toEqual([{ id: "web", path: "apps/web2" }]);
  });

  it("creates a section that did not exist and never writes $was or nulls into it", () => {
    const { js } = run({ brain: { afterBuild: "propose", lessons: { capture: "ask", metrics: null } } });
    expect(js.brain).toEqual({ afterBuild: "propose", lessons: { capture: "ask" } });
  });

  it("deletes a whole section with null", () => {
    expect(run({ tracker: null }).js.tracker).toBeUndefined();
  });

  it("the practices and the plugin pin: a new section is added, `off` is kept as the word, the rest stays", () => {
    const { text, js } = run({ practices: { "ticket-po-review": "off" }, plugin: { version: "0.5" } });
    expect(js.practices).toEqual({ "ticket-po-review": "off" });
    expect(js.plugin).toEqual({ version: "0.5" });
    expect(text).toContain("# team config");
    expect(text).toContain("keep me");
    expect(parseDocument(text).toJS().practices["ticket-po-review"]).toBe("off");
  });
});
