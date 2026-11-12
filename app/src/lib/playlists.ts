import type { Source } from "../types";

/**
 * Contenu des fichiers M3U importés, rangé dans IndexedDB : une liste de quelques
 * mégaoctets suffit à remplir le stockage local (~5 Mo), et plus aucun réglage
 * n'est alors enregistré.
 */
const DB = "myiptv";
const STORE = "playlists";

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const putPlaylist = (id: string, content: string) => run("readwrite", (s) => s.put(content, id)).then(() => undefined);
export const getPlaylist = (id: string) => run<string | undefined>("readonly", (s) => s.get(id));
export const deletePlaylist = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);

/** Source prête pour le backend : le contenu d'un fichier importé est relu au besoin. */
export async function withContent(source: Source): Promise<Source> {
  if (source.kind !== "m3uText" || source.content) return source;
  const content = await getPlaylist(source.id).catch(() => undefined);
  if (content == null) throw new Error("Le contenu de ce fichier importé est introuvable : ajoutez-le de nouveau.");
  return { ...source, content };
}
