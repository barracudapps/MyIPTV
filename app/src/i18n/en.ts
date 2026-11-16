import player from "./en/player";
import sources from "./en/sources";
import settings from "./en/settings";
import live from "./en/live";
import library from "./en/library";

/** Interface en anglais : une table par zone de l'application. */
export const EN: Record<string, string> = { ...player, ...sources, ...settings, ...live, ...library };
