export const MAX_REVISIONS: number;
export const BASE_DIR: string;
export const CATALOG_FILE: string;
export function fingerprint(front: { title?: unknown; type?: unknown; summary?: unknown; status?: unknown }, body: string): string;
export function splitPage(text: string): { front: Record<string, unknown>; frontLines: string[]; body: string };
export function shippedText(source: string, since: string): string;
export function buildCatalog(options?: { cwd?: string; version?: string; write?: boolean; max?: number }): { changed: boolean; catalog: { format: number; pages: { id: string; type: string; status?: string; revisions: { rev: number; since: string; base: string; text: string }[] }[] } };
