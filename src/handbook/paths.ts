import { brainPaths } from "../brain/paths.js";

export const PAGE_ID = /^[a-z0-9][a-z0-9-]*$/;

// Every path is relative to the repo root, with forward slashes.
export interface HandbookPaths {
  dir: string; // <brain.dir>/handbook
  index: string;
  retired: string;
  personalSeen: string; // how many times the one-line pointer of each page was shown to this engineer
}

export function handbookPaths(brainDir: string): HandbookPaths {
  const b = brainPaths(brainDir);
  return { dir: `${b.dir}/handbook`, index: `${b.dir}/handbook/index.md`, retired: `${b.dir}/handbook/retired.txt`, personalSeen: ".liftoff/brain/handbook-seen.json" };
}

export const pageFile = (p: HandbookPaths, id: string): string => `${p.dir}/${id}.md`;
