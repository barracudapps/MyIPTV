/**
 * Traduction des catégories et genres les plus courants (iptv-org, TMDB/Jellyfin,
 * Internet Archive, listes IPTV). Les libellés inconnus restent tels quels ; le
 * filtrage utilise toujours le nom d'origine, seul l'affichage est traduit.
 */

const FR: Record<string, string> = {
  // Catégories de chaînes (iptv-org)
  general: "Généraliste", news: "Information", sports: "Sport", sport: "Sport", kids: "Jeunesse", children: "Jeunesse",
  music: "Musique", movies: "Cinéma", movie: "Cinéma", films: "Films", film: "Films", entertainment: "Divertissement",
  documentary: "Documentaire", documentaries: "Documentaires", lifestyle: "Art de vivre", religious: "Religion", religion: "Religion",
  business: "Économie", comedy: "Comédie", cooking: "Cuisine", food: "Cuisine", culture: "Culture", education: "Éducation",
  family: "Famille", legislative: "Parlementaire", outdoor: "Plein air", relax: "Détente", science: "Sciences", series: "Séries",
  shop: "Téléachat", shopping: "Téléachat", travel: "Voyage", weather: "Météo", animation: "Animation", auto: "Auto-moto",
  classic: "Classiques", undefined: "Autres", other: "Autres", others: "Autres", local: "Local", regional: "Régional",
  public: "Service public", radio: "Radio", tv: "Télévision", television: "Télévision", "classic tv": "Télé classique",
  // Genres (TMDB, Jellyfin, Internet Archive)
  action: "Action", adventure: "Aventure", drama: "Drame", horror: "Horreur", thriller: "Thriller", crime: "Policier",
  mystery: "Mystère", romance: "Romance", western: "Western", war: "Guerre", history: "Histoire", historical: "Historique",
  fantasy: "Fantastique", "science fiction": "Science-fiction", "sci-fi": "Science-fiction", "sci fi": "Science-fiction",
  biography: "Biographie", musical: "Comédie musicale", "film noir": "Film noir", noir: "Film noir", silent: "Muet",
  "silent film": "Film muet", short: "Court métrage", "short film": "Court métrage", "tv movie": "Téléfilm", reality: "Téléréalité",
  "talk show": "Talk-show", talk: "Talk-show", soap: "Feuilleton", "game show": "Jeu télévisé", "war & politics": "Guerre et politique",
  politics: "Politique", nature: "Nature", animals: "Animaux", health: "Santé", technology: "Technologie", tech: "Technologie",
  arts: "Arts", art: "Art", books: "Livres", fiction: "Fiction", poetry: "Poésie", philosophy: "Philosophie", humor: "Humour",
  humour: "Humour", "children's": "Jeunesse", juvenile: "Jeunesse", "young adult": "Jeunes adultes",
  "true crime": "Faits divers", spirituality: "Spiritualité", "society & culture": "Société et culture", society: "Société",
  "personal journals": "Journaux personnels", "leisure": "Loisirs", "hobbies": "Loisirs", fitness: "Forme", "kids & family": "Enfants et famille",
  "tv & film": "Télé et cinéma", "news & politics": "Info et politique", "education & learning": "Éducation", "sports & recreation": "Sport",
  // Musique
  electronic: "Électronique", rock: "Rock", pop: "Pop", jazz: "Jazz", "hip-hop": "Hip-hop", "hip hop": "Hip-hop", rap: "Rap",
  ambient: "Ambiant", "classical": "Classique", experimental: "Expérimental", folk: "Folk", country: "Country", blues: "Blues",
  reggae: "Reggae", metal: "Metal", punk: "Punk", soul: "Soul", "r&b": "R&B", latin: "Latino", world: "Musiques du monde",
  "world music": "Musiques du monde", dance: "Danse", techno: "Techno", house: "House", chillout: "Chill-out", lounge: "Lounge",
  oldies: "Rétro", hits: "Tubes", "top 40": "Top 40", talkradio: "Radio parlée",
};

const DICTS: Record<string, Record<string, string>> = { fr: FR };

function translatePart(part: string, dict: Record<string, string>): string {
  const key = part.trim().toLowerCase();
  return dict[key] ?? part.trim();
}

/** Traduit un libellé de catégorie ou de genre dans `lang` quand c'est possible. */
export function translateLabel(label: string, lang: string | undefined): string {
  // Décennies : « 50s », « 50's », « 1950's » -> « Années 1950 ».
  const decade = label.trim().match(/^(?:(1[89]|20))?(\d)0'?s$/i);
  if (decade && lang === "fr") return `Années ${decade[1] ?? (Number(decade[2]) >= 3 ? "19" : "20")}${decade[2]}0`;
  const dict = lang ? DICTS[lang] : undefined;
  if (!dict) return label;
  const whole = dict[label.trim().toLowerCase()];
  if (whole) return whole;
  // Libellés composés : « Action & Adventure », « Sci-Fi / Fantasy », « News and Politics ».
  const parts = label.split(/\s*(?:&|\/|\+|,|\band\b)\s*/i);
  if (parts.length > 1) {
    const translated = parts.map((p) => translatePart(p, dict));
    if (translated.some((t, i) => t !== parts[i].trim())) return translated.join(" et ");
  }
  return label;
}
