# 04 — Roadmap

| # | Jalon | Contenu | Critère de sortie |
|---|---|---|---|
| 0 | **Prep** | Docs 00-04, scaffold, palette, dépendances | `npm run dev` affiche un canvas |
| 1 | **Le monde** | Ciel, plaine + stries, nuages, ville, poissons, bulles | Arrêt sur image comparable à la référence, sans personnage |
| 2 | **Le sujet** | Buddy verre, CD irisé, halo de contact | Le buddy se détache du fond vert au test du plissement d'yeux |
| 3 | **La glisse** | Contrôleur, caméra, carve, saut, boost, hitstop | Recette du doc 03 §9 : jouable et agréable **sans aucun effet** |
| 4 | **Le juice** | Spray, trail, speed lines, anneaux, sillage dans l'herbe | Le pop de carve donne envie de le refaire |
| 5 | **HUD + post** | Panneaux Aero, bloom, aberration, vignette | Le HUD est indiscernable de celui de la référence |
| 6 | **Finition** | Audio, qualité adaptative, tactile, écran titre | 60 fps stables, comparaison finale à la référence |

## Risques identifiés

| Risque | Impact | Parade |
|---|---|---|
| `transmission` coûte cher | Chute de framerate | Un seul objet transmissif (le buddy) ; les bulles simulent le verre en shader |
| Les verts sortent du gamut sRGB | Postérisation, aplats sales | ACES + exposure 1.15, et on désature légèrement avant le bloom |
| L'herbe instanciée fait du pop | Casse l'immersion | Fondu d'échelle sur les 20 % de fin de zone, jamais de coupe franche |
| La glisse est molle | **Échec du projet** | Jalon 3 validé *avant* tout effet visuel — les effets ne doivent jamais compenser des ressorts ratés |
| Le HUD mange le gameplay | Écran illisible | Le HUD vit dans les 18 % haut et 14 % bas ; la bande centrale reste vide |
