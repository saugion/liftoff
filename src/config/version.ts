// "x.y" or "x.y.z", missing patch = 0. Anything else (pre-release tags, junk) is unparseable.
export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : undefined;
}

// Negative, zero or positive like a comparator; undefined when either side is unparseable.
export function compareVersions(a: string, b: string): number | undefined {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return undefined;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
