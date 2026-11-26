import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// What the setup panel can tell about a project by reading files only (no process, no network). A guess the
// technical lead confirms: it never decides anything alone.
export interface DetectedModule { id: string; path: string; languages: string[]; frameworks: string[]; build?: string; test?: string; lint?: string }
export interface GitInfo { isRepo: boolean; branch?: string; defaultBranch?: string; originUrl?: string; host?: string }
export interface Detected { name: string; kind: "new" | "existing"; modules: DetectedModule[]; languages: string[]; frameworks: string[]; git: GitInfo; commands: { build?: string; test?: string; lint?: string } }

// The id of a module is lowercase words joined by dashes (the config's rule); the folder keeps its own name as the path.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "module";
const SKIP = new Set(["node_modules", "dist", "build", "target", "out", "vendor", "coverage", "venv", ".venv", "__pycache__"]);
const read = (file: string): string => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const JS_FRAMEWORKS: Record<string, string> = { react: "React", vue: "Vue", next: "Next.js", "@angular/core": "Angular", express: "Express", "@nestjs/core": "NestJS", svelte: "Svelte", "@capacitor/core": "Capacitor" };

// One directory: the language, frameworks and commands its manifest names, or undefined if it has none.
function inspect(dir: string): Omit<DetectedModule, "id" | "path"> | undefined {
  const has = (f: string) => existsSync(join(dir, f));
  if (has("package.json")) {
    let pkg: { dependencies?: object; devDependencies?: object; scripts?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(read(join(dir, "package.json")));
    } catch {
      // an unreadable manifest still marks a JavaScript module
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const s = pkg.scripts ?? {};
    return {
      languages: [has("tsconfig.json") || "typescript" in deps ? "TypeScript" : "JavaScript"],
      frameworks: Object.entries(JS_FRAMEWORKS).filter(([k]) => k in deps).map(([, v]) => v),
      ...(s.build && { build: "npm run build" }), ...(s.test && { test: "npm test" }), ...(s.lint && { lint: "npm run lint" }),
    };
  }
  const gradle = ["build.gradle.kts", "build.gradle"].find(has);
  if (gradle || has("pom.xml")) {
    const text = read(join(dir, gradle ?? "pom.xml")).toLowerCase();
    return {
      languages: [text.includes("kotlin") ? "Kotlin" : "Java"],
      frameworks: [...(text.includes("spring-boot") ? ["Spring Boot"] : []), ...(text.includes("quarkus") ? ["Quarkus"] : [])],
      ...(gradle ? { build: "./gradlew build", test: "./gradlew test" } : { build: "mvn verify", test: "mvn test" }),
    };
  }
  if (has("pyproject.toml") || has("requirements.txt")) {
    const text = (read(join(dir, "pyproject.toml")) + read(join(dir, "requirements.txt"))).toLowerCase();
    return { languages: ["Python"], frameworks: ["django", "fastapi", "flask"].filter((f) => text.includes(f)).map((f) => f[0]!.toUpperCase() + f.slice(1)), test: "pytest" };
  }
  if (has("go.mod")) return { languages: ["Go"], frameworks: [], build: "go build ./...", test: "go test ./..." };
  if (has("Cargo.toml")) return { languages: ["Rust"], frameworks: [], build: "cargo build", test: "cargo test" };
  return undefined;
}

// What a person pastes for "the GitLab host": an address, a clone URL or the bare name. The config holds the host only.
export function hostOf(text: string): string {
  const t = text.trim();
  const scp = /^[\w.-]+@([\w.-]+):/.exec(t);
  if (scp) return scp[1]!.toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t)?.[1]?.toLowerCase();
  const host = t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0]!.replace(/^.*@/, "");
  return (scheme === "ssh" ? host.replace(/:\d+$/, "") : host).toLowerCase(); // an ssh port is not the web address
}

// `.git` read directly: the branch and the origin URL, and the host the origin points to.
export function gitInfo(root: string): GitInfo {
  const dot = join(root, ".git");
  if (!existsSync(dot)) return { isRepo: false };
  const head = /^ref: refs\/heads\/(.+)$/m.exec(read(join(dot, "HEAD")))?.[1];
  const originUrl = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(read(join(dot, "config")))?.[1];
  const host = originUrl && (/^[\w.-]+@([\w.-]+(?::\d+)?)[:/]/.exec(originUrl)?.[1] ?? /^(?:https?|ssh):\/\/(?:[^@/]+@)?([\w.-]+(?::\d+)?)\//.exec(originUrl)?.[1]);
  // The branch merge requests go to: what origin says its default is, else main or master. Never the branch you are on
  // (after the setup is saved, that is the setup branch).
  const remoteHead = /refs\/remotes\/origin\/(.+)/.exec(read(join(dot, "refs", "remotes", "origin", "HEAD")))?.[1]?.trim();
  const has = (b: string) => existsSync(join(dot, "refs", "heads", b)) || existsSync(join(dot, "refs", "remotes", "origin", b)) || read(join(dot, "packed-refs")).includes(`refs/heads/${b}\n`) || read(join(dot, "packed-refs")).includes(`refs/remotes/origin/${b}\n`);
  const defaultBranch = remoteHead ?? (has("main") ? "main" : has("master") ? "master" : "main");
  return { isRepo: true, ...(head && { branch: head }), defaultBranch, ...(originUrl && { originUrl }), ...(host && { host: host.toLowerCase() }) };
}

const hasCommits = (root: string) => {
  try {
    return readdirSync(join(root, ".git", "refs", "heads")).length > 0;
  } catch {
    return false;
  }
};

export function detect(root: string): Detected {
  const rootInfo = inspect(root);
  const subs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .flatMap((e) => {
      const info = inspect(join(root, e.name));
      return info ? [{ id: slug(e.name), path: e.name, ...info }] : [];
    });
  // A manifest in the root and none below: one application, no modules. Manifests in folders below: those are the modules.
  const seen = new Map<string, number>();
  const modules = subs.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1; // two folders can give the same id: "my_app" and "my-app"
    seen.set(m.id, n);
    return n === 1 ? m : { ...m, id: `${m.id}-${n}` };
  });
  const all = [...(rootInfo ? [rootInfo] : []), ...subs];
  const uniq = (xs: string[]) => [...new Set(xs)];
  let pkgName: string | undefined;
  try {
    pkgName = JSON.parse(read(join(root, "package.json"))).name;
  } catch {
    pkgName = undefined;
  }
  const src = (n: string) => existsSync(join(root, n)) && statSync(join(root, n)).isDirectory();
  // A folder of repositories that is not one itself: the GitLab host is theirs, when they all agree.
  let git = gitInfo(root);
  if (!git.isRepo) {
    const hosts = uniq(readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => gitInfo(join(root, e.name)).host ?? []));
    if (hosts.length === 1) git = { ...git, host: hosts[0]! };
  }
  return {
    name: pkgName && !pkgName.startsWith("@") ? pkgName : basename(root),
    kind: all.length > 0 || src("src") || hasCommits(root) ? "existing" : "new",
    modules,
    languages: uniq(all.flatMap((m) => m.languages)),
    frameworks: uniq(all.flatMap((m) => m.frameworks)),
    git,
    commands: { ...(rootInfo?.build && { build: rootInfo.build }), ...(rootInfo?.test && { test: rootInfo.test }), ...(rootInfo?.lint && { lint: rootInfo.lint }) },
  };
}
