// Belt and braces: the real guarantee is test/static-guard.test.ts (no network imports in src or the bundle).
// This makes any accidental network call from code under test fail loudly. Node's permission model does not cover the network.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

const blocked = (what: string) => () => {
  throw new Error(`network disabled in tests: ${what}`);
};

const patch = (target: object, names: string[], label: string) => {
  for (const name of names) (target as Record<string, unknown>)[name] = blocked(`${label}.${name}`);
};

patch(net, ["connect", "createConnection"], "net");
(net.Socket.prototype as unknown as Record<string, unknown>)["connect"] = blocked("net.Socket.connect");
patch(tls, ["connect"], "tls");
patch(dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns");
patch(dns.promises, ["lookup", "resolve", "resolve4", "resolve6"], "dns.promises");
patch(http, ["request", "get"], "http");
patch(https, ["request", "get"], "https");
globalThis.fetch = (() => Promise.reject(new Error("network disabled in tests: fetch"))) as typeof fetch;

syncBuiltinESMExports();
