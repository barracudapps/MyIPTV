import { useRef, useState, type DragEvent } from "react";

export interface PlaylistFile {
  name: string;
  content: string;
}

export interface DroppedPlaylists {
  files: PlaylistFile[];
  links: string[];
  /** Fichiers déposés qui ne sont pas des listes M3U. */
  ignored: string[];
}

const MAX_FILE_BYTES = 200 * 1024 * 1024;

function looksLikePlaylist(name: string, content: string): boolean {
  if (/\.(m3u8?|txt)$/i.test(name)) return true;
  const head = content.slice(0, 4096);
  return head.includes("#EXTM3U") || head.includes("#EXTINF");
}

/** Lit des fichiers choisis ou déposés ; ne garde que les listes M3U. */
export async function readPlaylistFiles(list: Iterable<File>): Promise<{ files: PlaylistFile[]; ignored: string[] }> {
  const files: PlaylistFile[] = [];
  const ignored: string[] = [];
  for (const f of list) {
    if (f.size > MAX_FILE_BYTES) {
      ignored.push(f.name);
      continue;
    }
    const content = await f.text().catch(() => "");
    if (content && looksLikePlaylist(f.name, content)) files.push({ name: f.name, content });
    else ignored.push(f.name);
  }
  return { files, ignored };
}

/** Contenu d'un dépôt : fichiers de listes, ou liens glissés depuis un navigateur. */
export async function readDrop(dt: DataTransfer): Promise<DroppedPlaylists> {
  // Le DataTransfer n'est plus lisible après le premier await : tout est extrait d'abord.
  const dropped = [...dt.files];
  const rawText = dt.getData("text/uri-list") || dt.getData("text/plain");
  const { files, ignored } = await readPlaylistFiles(dropped);
  const text = files.length ? "" : rawText;
  const links = text
    .split(/[\s,;]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\/\S+$/i.test(u));
  return { files, links: [...new Set(links)], ignored };
}

function carriesPlaylists(e: DragEvent): boolean {
  const types = [...e.dataTransfer.types];
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
}

/**
 * Zone de dépôt : `over` indique qu'un élément est survolé (affichage d'un calque),
 * `bind` se branche sur l'élément conteneur.
 */
export function useDropZone(onDrop: (d: DroppedPlaylists) => void) {
  const [over, setOver] = useState(false);
  // Les enfants déclenchent dragenter/dragleave : on compte pour savoir quand on sort vraiment.
  const depth = useRef(0);
  const bind = {
    onDragEnter(e: DragEvent) {
      if (!carriesPlaylists(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver(e: DragEvent) {
      if (!carriesPlaylists(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave() {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    async onDrop(e: DragEvent) {
      if (!carriesPlaylists(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      onDrop(await readDrop(e.dataTransfer));
    },
  };
  return { over, bind };
}
