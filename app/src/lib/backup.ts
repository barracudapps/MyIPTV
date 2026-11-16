import { getBackend } from "../platform";
import { buildPayload, parsePayload, shareableSources, type SharePayload } from "./share";
import { useSettings } from "../store/settings";
import { t } from "./t";

/** Fichier de sauvegarde chiffré par mot de passe (PBKDF2 + AES-GCM). */
interface SealedBackup {
  app: "MyIPTV";
  kind: "backup-sealed";
  version: 1;
  salt: string;
  iv: string;
  data: string;
}

const ROUNDS = 200_000;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Le chiffrement demande WebCrypto, absent des pages non sécurisées de certaines TV. */
export const canEncrypt = typeof crypto !== "undefined" && !!crypto.subtle;

async function keyFrom(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ROUNDS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(plain: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), new TextEncoder().encode(plain));
  // Encodage par morceaux : String.fromCharCode(...) déborde la pile sur de gros fichiers.
  let data = "";
  const bytes = new Uint8Array(cipher);
  for (let i = 0; i < bytes.length; i += 0x8000) data += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const sealed: SealedBackup = { app: "MyIPTV", kind: "backup-sealed", version: 1, salt: b64(salt), iv: b64(iv), data: btoa(data) };
  return JSON.stringify(sealed);
}

export interface BackupOptions {
  history: boolean;
  password?: string;
}

/** Sauvegarde complète : sources, comptes, profils (et leur historique), thèmes, réglages. */
export async function exportBackup(opt: BackupOptions): Promise<{ name: string; where: string }> {
  const s = useSettings.getState();
  const payload = await buildPayload({
    sourceIds: shareableSources(s.sources).map((x) => x.id),
    meta: true,
    profiles: true,
    themes: true,
    settings: true,
    history: opt.history,
  });
  const json = JSON.stringify(payload);
  const content = opt.password ? await seal(json, opt.password) : json;
  const day = new Date().toISOString().slice(0, 10);
  const name = `MyIPTV-sauvegarde-${day}.myiptv`;
  const backend = await getBackend();
  if (backend.saveFile) return { name, where: await backend.saveFile(name, content) };
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name, where: t("Téléchargements du navigateur") };
}

/** Le fichier est-il chiffré (mot de passe nécessaire) ? */
export function isSealed(text: string): boolean {
  try {
    return (JSON.parse(text) as Partial<SealedBackup>).kind === "backup-sealed";
  } catch {
    return false;
  }
}

/** Lit une sauvegarde, en la déchiffrant au besoin. */
export async function readBackup(text: string, password?: string): Promise<SharePayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t("Ce fichier n'est pas une sauvegarde MyIPTV."));
  }
  const sealed = parsed as Partial<SealedBackup>;
  if (sealed.kind !== "backup-sealed") return parsePayload(text);
  if (!canEncrypt) throw new Error(t("Cet appareil ne sait pas déchiffrer les sauvegardes protégées."));
  if (!password) throw new Error(t("Mot de passe requis."));
  try {
    const key = await keyFrom(password, unb64(sealed.salt!));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv!) }, key, unb64(sealed.data!));
    return parsePayload(new TextDecoder().decode(plain));
  } catch (e) {
    if (e instanceof Error && e.message.includes("MyIPTV")) throw e;
    throw new Error(t("Mot de passe incorrect."));
  }
}
