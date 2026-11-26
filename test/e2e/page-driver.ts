import vm from "node:vm";
import { readFileSync } from "node:fs";

// Runs the setup page's own script the way a browser would, against a real server: a small DOM that keeps the buttons
// (drawn from the html, changed in place by the page), events that go to the page's own handlers, and clicks that
// refuse a button that is switched off. It exists because the page broke in ways no server test can see.
export function openPage(pageFile: string, address: string) {
  const u = new URL(address);
  const token = u.searchParams.get("t")!;
  const html = readFileSync(pageFile, "utf8");
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!.replace("__TOKEN__", token);
  type El = { id: string; _h: string; buttons: { dataset: { act: string }; disabled: boolean }[]; handlers: Record<string, (e: unknown) => unknown>; textContent: string; href: string };
  type Dom = El & { innerHTML: string; addEventListener(t: string, f: (e: unknown) => unknown): void; querySelectorAll(): El["buttons"] };
  const els: Record<string, Dom> = {};
  const buttons = (h: string) => [...h.matchAll(/<button\b([^>]*)>/g)].map((m) => ({ dataset: { act: /data-act="(\w+)"/.exec(m[1]!)?.[1] ?? "" }, disabled: /\sdisabled(\s|=|$)/.test(m[1]!) })).filter((b) => b.dataset.act);
  const el = (id: string): Dom =>
    (els[id] ??= {
      id, _h: "", buttons: [], handlers: {}, textContent: "", href: "",
      set innerHTML(v: string) { this._h = v; this.buttons = buttons(v); },
      get innerHTML() { return this._h; },
      addEventListener(t: string, f: (e: unknown) => unknown) { this.handlers[t] = f; },
      querySelectorAll() { return this.buttons; },
    } as Dom);
  let pending = 0; // requests the page has sent and not had an answer to: the page is quiet when there are none
  const track = async (p: string, o: RequestInit) => {
    pending++;
    try {
      return await fetch(u.origin + p, o);
    } finally {
      pending--;
    }
  };
  const ctx = vm.createContext({ document: { getElementById: el }, history: { replaceState() {} }, location: { pathname: "/" }, fetch: track, console, setTimeout });
  vm.runInContext(script, ctx);
  const app = () => el("app");
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // waits until the page has answered everything it asked and has drawn (no fixed pause: a busy machine is slower)
  const settle = async () => {
    const until = Date.now() + 15_000;
    do await tick(30);
    while ((pending > 0 || app().innerHTML === "") && Date.now() < until);
    await tick(30);
    if (pending > 0) throw new Error("the page is still waiting for the server");
  };
  const api = {
    get text() { return app().innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); },
    get html() { return app().innerHTML; },
    state: <T>(expr: string) => vm.runInContext(expr, ctx) as T,
    button: (act: string) => app().buttons.find((b) => b.dataset.act === act),
    // what a person does: only a button that is on can be pressed
    async click(act: string, data: Record<string, string> = {}) {
      const b = api.button(act);
      if (!b) throw new Error(`there is no '${act}' button on this screen: ${api.text.slice(0, 120)}`);
      if (b.disabled) throw new Error(`the '${act}' button is switched off, a person could not press it`);
      await app().handlers.click!({ target: { closest: () => ({ dataset: { act, ...data }, disabled: false }) } });
      await settle();
    },
    type(props: Record<string, unknown>) { app().handlers.input!({ target: props }); },
    change(props: Record<string, unknown>) { app().handlers.change!({ target: props }); },
    settle,
  };
  return settle().then(() => api);
}

// The control panel's own script, the same way: it listens on the document (not on one element), draws a form, a navigation
// and a preview, and its buttons carry data-a (the action) and data-l (the list they act on).
export function openPanel(pageFile: string, address: string) {
  const u = new URL(address);
  const token = u.searchParams.get("t")!;
  const script = /<script>([\s\S]*)<\/script>/.exec(readFileSync(pageFile, "utf8"))![1]!.replace("__TOKEN__", token);
  const els: Record<string, { innerHTML: string; textContent: string; className: string }> = {};
  const el = (id: string) => (els[id] ??= { innerHTML: "", textContent: "", className: "" });
  const listeners: Record<string, ((e: unknown) => unknown)[]> = {}; // the panel registers more than one listener for a click
  const handlers = new Proxy({} as Record<string, (e: unknown) => Promise<void>>, {
    get: (_t, type: string) => async (e: unknown) => {
      for (const f of listeners[type] ?? []) await f(e);
    },
  });
  let pending = 0;
  const track = async (p: string, o: RequestInit) => {
    pending++;
    try {
      return await fetch(u.origin + p, o);
    } finally {
      pending--;
    }
  };
  const ctx = vm.createContext({
    document: { getElementById: el, addEventListener: (t: string, f: (e: unknown) => unknown) => void (listeners[t] ??= []).push(f), activeElement: null, querySelector: () => null },
    history: { replaceState() {} }, location: { pathname: "/" }, fetch: track, console, setTimeout, clearTimeout,
  });
  vm.runInContext(script, ctx);
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const form = () => el("form").innerHTML;
  // the form and the navigation both hold buttons a person can press
  const screen = () => form() + el("nav").innerHTML;
  const buttons = () => [...screen().matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1]!, label: m[2]!.replace(/<[^>]+>/g, "").trim(), disabled: /\sdisabled(\s|=|$)/.test(m[1]!) }));
  const api = {
    get text() { return form().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); },
    get html() { return form(); },
    buttons,
    // validation runs a moment after an edit; wait for it and for everything the page asked
    async settle() {
      await tick(450);
      const until = Date.now() + 15_000;
      while (pending > 0 && Date.now() < until) await tick(30);
      await tick(60);
    },
    button: (label: string | RegExp) => buttons().find((b) => (typeof label === "string" ? b.label === label : label.test(b.label))),
    // a button by what it does (its data attributes), for the ones that only an icon or a card names
    byAction: (attrs: string) => buttons().find((b) => b.attrs.includes(attrs)),
    async press(label: string | RegExp) {
      const b = typeof label === "string" && label.startsWith("data-") ? api.byAction(label) : api.button(label);
      if (!b) throw new Error(`no '${label}' button here: ${api.text.slice(0, 160)}`);
      if (b.disabled) throw new Error(`the '${label}' button is switched off, a person could not press it`);
      const data = Object.fromEntries([...b.attrs.matchAll(/data-([a-z]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      await handlers.click!({ target: { closest: () => ({ dataset: data }), dataset: data } });
      await api.settle();
    },
    async type(list: string, i: number, field: string, value: string) {
      handlers.input!({ target: { dataset: { l: list, i: String(i), f: field }, value, tagName: "INPUT" } });
      await api.settle();
    },
    // a single field (data-k) or the token box (data-tk)
    async fill(key: string, value: string) {
      handlers.input!({ target: { dataset: key === "token" ? { tk: "" } : { k: key }, value, tagName: "INPUT" } });
      await api.settle();
    },
    async pick(key: string, value: string) {
      handlers.change!({ target: { dataset: { k: key }, value, tagName: "SELECT" } });
      await api.settle();
    },
    async choose(list: string, i: number, field: string, value: string) {
      handlers.change!({ target: { dataset: { l: list, i: String(i), f: field }, value, tagName: "SELECT" } });
      await api.settle();
    },
    state: <T>(expr: string) => vm.runInContext(expr, ctx) as T,
  };
  // loading takes several requests in a row: open once the page has drawn and nothing is pending (no fixed pause)
  const opened = async () => {
    const until = Date.now() + 15_000;
    do await api.settle();
    while (form() === "" && Date.now() < until);
    return api;
  };
  return opened();
}
