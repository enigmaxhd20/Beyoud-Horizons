/** Logs an error with a label and stack so a failing callback can be located (even in minified bundles). */
export function logError(label: string, err: unknown): void {
  try {
    const e = err as { message?: string; stack?: string } | undefined;
    const text = `[PaleForest] ${label}: ${e?.message ?? String(err)}${e?.stack ? `\n${e.stack}` : ""}`;
    const c = (globalThis as unknown as { console?: { warn(m: string): void } }).console;
    c?.warn(text);
  } catch {}
}
