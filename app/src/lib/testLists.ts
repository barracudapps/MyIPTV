/**
 * Listes d'exemple du mode test, pour vérifier le parcours d'ajout d'une source.
 *
 * - La liste légale contient des flux officiels gratuits (diffuseurs publics, FAST).
 * - La liste « suspecte » est entièrement simulée : les noms imitent ceux des offres
 *   pirates pour déclencher l'analyse de risque, mais toutes les adresses utilisent le
 *   domaine réservé `example.invalid` (RFC 2606), qui ne mène nulle part.
 */

export const LEGAL_TEST_LIST = `#EXTM3U
#EXTINF:-1 tvg-id="TV5MondeFBS.fr" tvg-country="FR" tvg-language="French" group-title="Généraliste",TV5Monde France Belgique Suisse
https://ott.tv5monde.com/Content/HLS/Live/channel(fbs)/variant.m3u8
#EXTINF:-1 tvg-id="TiVi5Monde.fr" tvg-country="FR" tvg-language="French" group-title="Jeunesse",TiVi5Monde
https://ott.tv5monde.com/Content/HLS/Live/channel(tivi5)/variant.m3u8
#EXTINF:-1 tvg-id="EuronewsFrench.fr" tvg-country="FR" tvg-language="French" group-title="Information",Euronews (français)
https://2f6c5bf4.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmxheHhUVi1ldV9FdXJvbmV3c0ZyYW5jYWlzX0hMUw/playlist.m3u8
`;

function simulated(): string {
  const lines = ["#EXTM3U"];
  const premium = [
    "FR| BEIN SPORTS 1 FHD",
    "FR| BEIN SPORTS 2 FHD",
    "FR| BEIN SPORTS 3 HD",
    "FR| CANAL+ 4K",
    "FR| CANAL+ SPORT FHD",
    "FR| CINÉ+ PREMIER",
    "FR| RMC SPORT 1 FHD",
    "FR| RMC SPORT 2 FHD",
    "UK| SKY SPORTS MAIN EVENT",
    "UK| SKY CINEMA PREMIERE",
    "DAZN 1 FHD",
    "ES| MOVISTAR LALIGA",
    "FR| OCS MAX",
    "PPV EVENT 1",
  ];
  premium.forEach((name, i) => {
    lines.push(`#EXTINF:-1 group-title="SPORTS PREMIUM",${name}`, `http://example.invalid:8080/live/demo/demo/${1000 + i}.ts`);
  });
  for (let i = 0; i < 60; i++) {
    lines.push(`#EXTINF:-1 group-title="VOD | FILMS 2026",Film récent de démonstration ${i + 1} (2026)`, `http://example.invalid:8080/movie/demo/demo/${5000 + i}.mkv`);
  }
  return lines.join("\n");
}

export const SUSPICIOUS_TEST_LIST = simulated();
