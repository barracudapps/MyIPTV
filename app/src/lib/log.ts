import { isTauri } from "../platform";

/**
 * Relaie les erreurs et avertissements de l'interface vers les journaux de l'application
 * (terminal en développement), pour diagnostiquer ce que la webview ne montre pas.
 */
export function installLogBridge() {
  if (!isTauri) return;
  let send: ((level: string, message: string) => void) | null = null;
  import("@tauri-apps/api/core").then(({ invoke }) => {
    send = (level, message) => void invoke("log_frontend", { level, message: message.slice(0, 2000) }).catch(() => undefined);
  });
  const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  for (const level of ["error", "warn", "info"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      // Les infos ne concernent que le lecteur, pour ne pas noyer les journaux.
      const text = fmt(args);
      if (level !== "info" || text.startsWith("[lecteur]")) send?.(level, text);
    };
  }
  window.addEventListener("error", (e) => send?.("error", `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => send?.("error", `Promesse rejetée : ${fmt([e.reason])}`));
}
