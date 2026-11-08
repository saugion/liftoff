// Single-quote for the shell. Pattern validation (connect-config) is the first defence, this is the second.
export const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
