# 02 — Architecture technique

## 1. Stack

| Choix | Raison |
|---|---|
| **Three.js** (WebGL2) | Contrôle total des shaders, matériaux `transmission`/`iridescence` natifs — indispensables pour le verre du buddy |
| **TypeScript** | Le contrôleur de glisse a une douzaine d'états couplés ; typer évite les bugs de feeling silencieux |
| **Vite** | HMR instantané — on va itérer des centaines de fois sur des constantes de ressort |
| **postprocessing** (pmndrs) | Chaîne d'effets fusionnée en un pass. Meilleur bloom que le `UnrealBloomPass` de Three, et SMAA inclus |
| **HUD en DOM, pas en 3D** | Deux jauges seulement. En DOM elles restent nettes à toute densité de pixels, ne coûtent pas de passe de rendu, et **ne traversent pas le post-processing** — une jauge qui prendrait le flou radial serait illisible |
| **Zéro asset binaire** | Textures (nuages, bruit, herbe), sons et géométries générés au boot. Le repo reste léger et rien ne casse au déploiement |

## 2. Carte des modules

```
src/
├── main.ts                  bootstrap
├── core/
│   ├── Engine.ts            renderer, scène, caméra, composer, resize, PMREM
│   ├── Input.ts             clavier + tactile + gamepad → un axe unifié
│   ├── Run.ts               structure de partie : chrono, record, relance
│   ├── Spring.ts            ressorts amortis (le socle de tout le feeling)
│   ├── Noise.ts             valeur/Perlin/FBM pour CPU et GLSL
│   └── Palette.ts           la palette du doc 01, source unique de vérité
├── world/
│   ├── Terrain.ts           hauteur du sol, source unique CPU + GPU
│   ├── Sky.ts               dôme dégradé + soleil
│   ├── Environment.ts       PMREM ciel+herbe pour les réflexions du verre
│   ├── Clouds.ts            champ de billboards
│   ├── Ground.ts            grille en éventail déplacée par Terrain
│   ├── GrassTexture.ts      tuile de brins générée au boot (normale + albédo)
│   ├── GrassBlades.ts       touffes instanciées, dispersées par cellule monde
│   ├── Weather.ts           ombres de nuages + rafales, lues par le sol ET les brins
│   ├── Water.ts             plan à WATER_LEVEL découpé au discard par le relief
│   ├── Motes.ts             pollen en suspension, lumineux à contre-jour
│   ├── City.ts              skyline de cristal
│   ├── Boosters.ts          colonnes de vitesse, semées en chaîne
│   └── Rings.ts             anneaux de verre à franchir (bas et hauts)
├── player/
│   ├── Buddy.ts             le bonhomme MSN en verre
│   ├── Disc.ts              le CD + shader de diffraction
│   ├── Controller.ts        physique de glisse (doc 03 §2-3)
│   ├── Trail.ts             ruban derrière le disque
│   └── Spray.ts             particules d'herbe et d'écume
├── fx/
│   ├── PostFX.ts            bloom → SurfEffect → SMAA
│   ├── SurfEffect.ts        speed lines + aberration + vignette + étalonnage
│   ├── ShockRing.ts         anneaux d'impact
│   └── CameraRig.ts         ressort, FOV, roll, bruit, shake
├── hud/
│   └── Hud.ts               chrono, score, record, jauges, popups, fin (DOM)
├── audio/
│   └── Audio.ts             synthèse WebAudio
├── world/World.ts           assemblage du décor + lumières
└── Game.ts                  assemblage général, boucle, collecte
```

> Les shaders vivent dans le module qui les possède plutôt que dans un dossier
> `shaders/` séparé : chacun n'est utilisé qu'à un seul endroit, et les lire à
> côté de leurs uniformes évite des allers-retours. Seul le bruit est partagé
> (`core/Noise.ts`, chunk `GLSL_NOISE`).

## 3. Boucle

Pas fixe pour la simulation, rendu libre :

```
accumulator += min(realDelta, 0.1)        // clamp anti-spirale après un onglet en arrière-plan
while (accumulator >= 1/120 && steps++ < 16) {
    if (!hitstopActive) world.step(1/120)  // le hitstop gèle la SIM, pas le RENDU
    accumulator -= 1/120
}
camera.update(realDelta)                   // la caméra tourne en temps réel : elle doit rester fluide
render()
```

120 Hz de simulation : les ressorts de `steer` (ω=14) ont besoin de ça pour ne pas
osciller en escalier sur un écran 60 Hz.

Le retard qui n'a pas pu être rattrapé est **jeté** (`accumulator` replafonné à
deux pas). Sans ça, sur une machine qui ne suit pas, l'accumulateur grossit sans
fin et la simulation part en ralenti : le jeu ne répond plus au temps réel mais
à son propre retard, et *tout* devient mou — y compris la charge du saut.

## 3 quater. Un doigt fait tout

Sur mobile le doigt posé vaut **maintien du saut**, exactement comme la barre
d'espace : le glisser dirige, sa durée d'appui arme, le lever déclenche.

Deux pièges se sont révélés à l'usage :

- `jumpHeld` ne lisait que le clavier. Comme le saut se déclenche au
  relâchement, le tactile n'armait jamais et **ne pouvait pas sauter du tout**.
- Un appui très bref peut commencer *et* finir entre deux `update()`, et se
  perdre entièrement. Un verrou (`jumpLatch`) garantit au moins une lecture à
  `true`, donc au moins un petit saut : un tap franc répond toujours.

## 3 ter. Ce qui suit la caméra, et pourquoi

Tout élément « infini » doit être ancré sur le joueur. Le dôme de ciel ne
l'était pas, et le symptôme s'est manifesté en deux temps : vers `z ≈ -2000` son
bord traversait la caméra (l'écran scintillait), puis on en sortait et **tout
passait au noir** — après environ 70 s de jeu à vitesse de croisière.

Le sol, les nuages et la ville suivaient déjà. Le ciel a été le seul oublié
parce qu'il est le seul objet que rien ne recycle : sa géométrie n'a pas besoin
de bouger, seulement sa position.

## 3 bis. Une seule source de vérité pour le sol

`world/Terrain.ts` définit la hauteur du terrain **une fois**, et le chunk GLSL
est **généré** depuis les mêmes constantes plutôt que recopié. Deux versions
écrites à la main dérivent au premier ajustement, et le symptôme est vicieux :
le surfeur flotte de quelques centimètres ou s'enfonce dans la colline sans que
rien ne plante.

Des sinus plutôt qu'un bruit, pour deux raisons : reproductibles à l'identique
des deux côtés, et surtout **dérivables analytiquement**. La pente et la
courbure sortent d'un `cos`, sans échantillonner — c'est ce qui rend la
détection de crête exacte plutôt qu'approchée.

C'est la même source qui décide de l'eau : `WATER_LEVEL` est exporté depuis
`Terrain.ts` et injecté dans le chunk GLSL. La rive vue à l'écran (un `discard`
sur `terrainHeight < WATER_LEVEL`) est donc **exactement** celle où la physique
bascule en glisse — un décalage de quelques centimètres entre les deux se
verrait immédiatement, le disque planant sur de l'herbe ou coulant sur du sec.

La grille de sol est un **éventail ancré sur le joueur** : rangées serrées
devant lui (1,2 m) puis écartement géométrique jusqu'à l'horizon, largeur qui
croît avec la distance pour couvrir le champ de vision quel que soit le rapport
d'écran. Elle ne suit le joueur qu'en Z, **par pas entiers de maille** — un
suivi continu ferait glisser les sommets le long des pentes et scintiller tout
le relief.

## 4. Monde infini et orientation

**Avant = -Z, droite écran = +X** (convention three.js). Le premier jet
avançait vers `+Z` : avec une caméra qui regarde dans cette direction, la
droite de l'écran devient `-X` et *chaque* signe du projet s'inverse
(direction, inclinaison, roulis, éjection du spray, point de fuite). Basculer
tôt a coûté huit lignes ; le garder aurait coûté un bug de signe par effet.


Le surfeur ne s'éloigne jamais de l'origine. C'est le **monde qui recule**.

- `worldZ` cumule la distance parcourue (double précision, pour le score).
- Tous les décors sont modulo-repliés sur une période le long de Z.
- La plaine est un plan fixe ; c'est son shader qui fait défiler l'UV.
- Les nuages sont repliés modulo une période le long de Z, donc recyclés en
  tête de zone dès qu'ils passent derrière la caméra ; la ville reste à
  distance constante avec une parallaxe latérale.

Ça évite la dérive de précision float32 et supprime tout budget de streaming.

## 5. Budget de performance

Cible : **60 fps en 1080p sur un GPU intégré de milieu de gamme**.

| Poste | Budget | Stratégie |
|---|---|---|
| Draw calls | ≤ 20 | Instancing pour les nuages, la ville et le spray |
| Triangles | ≤ 180 k | L'herbe domine ; densité pilotée par le niveau de qualité |
| Passes de post | 1 | Chaîne fusionnée par `postprocessing` |
| Transmission | 2 meshes | `transmission` force un render target supplémentaire — **le buddy uniquement** (tête + buste) |
| Textures | 0 fichier | Générées en canvas au boot |

Trois niveaux de qualité auto-détectés (nombre de nuages, nombre de particules de
spray, noyau du bloom, SMAA), avec repli automatique si le temps moyen d'image
dépasse 20 ms sur 2 s.

## 6. État partagé

Un seul objet `GameState`, lu par le post-processing et l'audio :

```ts
{ speed, steer, lean, carveCharge, combo, score, distance,
  airborne, boosting, popFlash, fps, started }
```

Personne n'écrit dedans à part le contrôleur. Il n'y a plus d'interface : cet
état ne sert qu'au post-processing (le combo pilote l'intensité du bloom) et à
l'audio.

## 7. Commandes

```bash
npm run dev            # serveur HMR
npm run build          # bundle de prod dans dist/
npm run preview        # sert le bundle de prod
npm run shot           # capture Playwright pour comparer à la référence
npm run check          # le carve doit payer plus qu'une ligne droite
npm run check:air      # élan, timing, plané, économie de boost
npm run check:input    # clavier ET tactile arment puis déclenchent le saut
npm run check:run      # le chrono mord, les anneaux paient, les vrilles aussi
npm run check:water    # on glisse assez vite, on coule trop lent, et ça coûte
npm run check:shake    # la secousse se voit, reste continue, ne bouge pas le point de vue
npm run check:flicker         # aucune frame noire sur une partie complète
npm run check:flicker:resize  # idem, sous tempête de redimensionnement
npm run check:flicker:mobile  # idem, profil téléphone, sous agression
npm run check:theme           # le jeu reste en plein jour en mode sombre
npm run check:shaders         # aucun shader cassé, profil bureau ET téléphone
npm run check:nan             # aucun normalize() qui peut rendre NaN (= pixels noirs)
npm run check:backticks       # aucun backtick dans un commentaire de shader
npm run check:perf            # profil par soustraction + objets trop près de la caméra
```

## 7 bis. Déploiement web

Le dépôt se déploie **tel quel** sur Vercel : `vercel.json` fixe le framework
(Vite), la commande de build et la sortie (`dist/`). Une seule subtilité —
l'`installCommand` porte `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Playwright est
une dépendance de développement (les vérifications automatiques pilotent un vrai
navigateur) et son script de post-installation télécharge plusieurs centaines de
mégaoctets de navigateurs dont un build de production n'a aucun usage.

`public/` est copié à la racine du site : icônes, manifeste et image de partage.
Sans les balises Open Graph, un lien collé dans une conversation n'affiche
qu'une URL nue — pour un jeu qui se vend à l'œil, c'est la moitié du travail
perdue.

### Le mode diagnostic

**Trois déclencheurs, et le premier ne suffisait pas.** `?diag=1` marche sur une
page servie normalement — mais le jeu tourne le plus souvent dans une visionneuse
d'artefacts, c'est-à-dire dans une **iframe qui a sa propre adresse**. La chaîne
de requête tapée dans la barre du navigateur ne lui parvient jamais : l'outil
était inaccessible exactement là où le joueur en a besoin. On l'ouvre donc aussi
depuis l'intérieur — touche **F3** ou **I**, ou **trois doigts** posés en même
temps (un doigt dirige, deux boostent ; trois est le premier geste libre).

Le panneau se rafraîchit **au temps** (250 ms), jamais toutes les N images : un
compteur d'images se fige précisément quand la cadence s'effondre, c'est-à-dire
au moment où l'on regarde le panneau.

Ce qu'il affiche, et pourquoi chaque ligne y est :

| Ligne | Ce qu'elle tranche |
|---|---|
| `noires rendu` / `presentées` | le rendu a-t-il produit du noir, ou le compositeur va-t-il en **afficher** ? Ce ne sont pas les mêmes questions (§7 ter) |
| `resize N evts -> M réels` | des événements en rafale sont bénins, le garde d'égalité les absorbe. Ce sont les redimensionnements **réels** qui réallouent le tampon — une page hôte dont la taille oscille en fait un par image |
| `tampon` vs `fenêtre` | un désaccord entre les deux signale un redimensionnement resté en travers |
| `DANS une iframe` | dit si l'on est embarqué, donc si un hôte peut composer par-dessus |
| `scheme` | valeur calculée **et** valeur en ligne : c'était la cause du flash précédent, et un hôte peut la réécrire |

### `?diag=1`

Le mode diagnostic tranche **une** question, et il faut la poser dans ces
termes : quand le joueur voit un flash noir, est-ce que le jeu a rendu une image
noire, ou est-ce que la page qui l'héberge a laissé voir sa toile de fond ?

La sonde lit le tampon de dessin après *chaque* rendu — un flash d'une image ne
se photographie pas — et affiche un compteur en clair :

- `noires > 0` : le rendu est en cause, c'est réparable dans ce code ;
- `noires = 0` alors que ça clignote : le tampon était valide à chaque image, le
  noir vient du compositeur, de l'iframe hôte ou d'un changement de thème.
  **Aucune** correction côté WebGL ne peut l'atteindre.

Elle est chargée en import dynamique et activée par l'URL uniquement :
`readPixels` synchronise le pipeline graphique, ce qui n'a rien à faire dans une
partie normale.

## 7 ter. La course entre le redimensionnement et le rendu

Le joueur signalait toujours des flashs noirs après la correction de
`color-scheme`. La sonde d'alors n'en trouvait aucun — et c'était **structurel**,
pas de la malchance : elle lisait le tampon *à l'intérieur* de `post.render()`,
donc elle répondait à « le jeu a-t-il dessiné une image noire ? » alors que la
question était « le compositeur va-t-il **afficher** une image noire ? ».

Ce ne sont pas les mêmes. N'importe quel `requestAnimationFrame` inscrit après
la boucle de jeu peut réallouer le tampon de dessin une fois le rendu terminé,
et **un tampon réalloué est noir** : la spécification WebGL le remet à noir
transparent, ce qu'un contexte en `alpha: false` présente en noir opaque. La
couleur d'effacement ne sauve rien — elle ne s'applique qu'aux appels à
`clear()`, jamais à la réallocation.

Le déroulé exact :

```
frame N     la boucle se réarme (rAF), rend, PUIS un événement resize
            arrive et programme son propre rAF pour la frame suivante
frame N+1   la boucle s'exécute d'abord (elle était inscrite en premier)
            et rend.  PUIS le rAF de redimensionnement appelle setSize,
            qui réalloue le tampon.  La frame N+1 est présentée NOIRE.
```

Deux endroits déclenchaient ça, et le second est le plus vicieux :

1. `queueResize` programmait son propre `requestAnimationFrame` — c'est le cas
   ci-dessus, et il se joue à chaque rétraction de la barre d'adresse mobile ou
   à chaque redimensionnement d'iframe par une page hôte ;
2. `sampleFrame()` appelait `apply(true)` sur un repli de qualité. Il est appelé
   en **fin** de boucle, donc après le rendu : même réallocation, même noir. Il
   ne se joue qu'une fois par session, sur un appareil lent — donc typiquement
   dans les premières secondes de jeu sur téléphone.

La correction est la même pour les deux : ne plus jamais redimensionner hors de
la boucle. `queueResize` ne lève qu'un drapeau, `flushResize()` le consomme **en
tête** de la frame, et redimensionner-puis-rendre dans la même frame supprime la
course.

`scripts/flicker-check.mjs` porte désormais **deux** sondes : celle d'après
rendu, et une sonde de fin de tick qui se reprogramme depuis sa propre exécution
— elle passe donc en dernier et lit le tampon tel qu'il sera présenté. C'est
elle qui voit le bug ; l'ancienne affiche `noires=0` sur le code fautif. Une
vérification qui ne peut pas échouer ne prouve rien : celle-ci a été confrontée
au code d'avant correction, où elle rapporte bien une image noire présentée.

## 7 quater. Ce qui coûte, mesuré

Le joueur n'arrivait plus à faire tourner le jeu. On ne devine pas ce qui est
cher : `scripts/perf-check.mjs` **cache un maillage et regarde ce que l'image
reprend**, scène figée pour que toutes les configurations soient mesurées au
même endroit du parcours.

Trois pièges, tous rencontrés, tous fermés dans le script :

1. **Chronométrer `render()` ne mesure rien.** L'appel empile des commandes et
   rend la main avant que le travail soit fait : on mesurait le temps de
   préparation JS. C'est l'**intervalle entre images** qu'il faut prendre.
2. **Le premier passage paie la compilation des shaders.** Mesuré en premier, le
   cas de référence sortait systématiquement plus lent, et chaque maillage
   semblait alors économiser un quart de l'image. Une chauffe est jetée.
3. **La machine dérive** sur une session de plusieurs minutes. D'où un **témoin**
   : on remesure la référence à la fin, et l'écart donne le **plancher de bruit**
   du banc. Toute économie du même ordre est nulle.

Le témoin a mesuré **26 % de dérive**. Le tableau se lit donc ainsi :

| Poste | Mesuré | Verdict |
|---|---|---|
| sol | 50 % | **réel**, +24 points au-dessus du bruit |
| brins | 41 % | **réel**, +15 points |
| nuages, ville, pollen, plots | 27–28 % | au niveau du bruit : **nuls** |
| eau | 3 % | sous le bruit |

Sans le témoin, on aurait « optimisé » la ville — une silhouette à l'horizon.

### Le nombre d'octaves se choisit sur la fréquence

Le sol appelait `fbm()` **trois fois par pixel**, soit quinze octaves, et
`cloudShade()` deux fois de plus — lues aussi par les brins et par l'eau, donc
payées trois fois. Or un champ basse fréquence n'a que faire de ses octaves
hautes : à l'écran elles tombent sous le pixel, elles ne produisent que du coût
et du scintillement.

`fbm2()` et `fbm3()` sont **normalisées sur la même plage** que `fbm()` — sans
ça, changer le nombre d'octaves décalerait la couleur au lieu de seulement
l'alléger. Bilan : 15 octaves → 7 dans le sol, 10 → 4 dans les ombres de nuages.

### Le repli de qualité ne pouvait descendre qu'une fois

`downgraded` était un **booléen**. Un téléphone parti en `high` tombait en
`medium` et, s'il ramait toujours à huit images par seconde, y restait pour la
durée de la partie : le seul palier qui l'aurait sauvé n'était jamais atteint.
C'est maintenant un compteur, la fenêtre de mesure passe de 120 à 45 images (à
huit images par seconde, 120 images font quinze secondes avant le moindre
soulagement), et une fois en `low` il reste un dernier levier — **la
résolution**, le seul qui agisse proportionnellement sur tout, puisque le coût
est lié au fragment.

## 7 quinquies. Les objets qui entrent dans l'objectif

Le joueur : « ça pourrait être des objets qui viennent sur la caméra une
fraction de seconde ». Mesure, sur une partie normale :

```
anneau    au plus près  -0.98 m   2 images AVEC LA CAMÉRA DEDANS
colonne   au plus près  -0.01 m   4 images AVEC LA CAMÉRA DEDANS
```

Évidemment : le surfeur **traverse** les anneaux et les colonnes, donc la caméra
les traverse une fraction de seconde plus tard. Un tore et un voile translucides
**double face**, un cylindre de 6,4 m vu de l'intérieur — ça remplit tout le
cadre. Et à vingt images par seconde, quatre images font **deux cents
millisecondes** de plein écran. Ce qu'on appelle « un flash » à bas régime est
souvent un objet trop proche vu trop longtemps.

Le remède est un **fondu de proximité** (`smoothstep(0.8, 6.5, distance)`)
appliqué aux anneaux, aux colonnes et aux gouttelettes de gerbe — qui partent
vers l'arrière à une quinzaine de mètres par seconde et finissaient collées à
l'objectif. Il est calculé **par sommet** : il ne coûte rien, et sur une grande
surface il fait mieux que disparaître d'un bloc — la partie qui entre dans
l'objectif s'efface pendant que le reste tient.

Le pollen avait déjà le sien. C'est ce précédent qui aurait dû faire poser la
question pour tout le reste.

## 7 sexies. La vraie cause : `normalize(vec3(0))`

Dix corrections raisonnées sur le symptôme, dix échecs. Le défaut n'a **jamais**
été reproduit ici, et c'est ça qui aurait dû mettre la puce à l'oreille bien plus
tôt : sous rastériseur logiciel, il n'existe pas.

Le joueur a fini par donner les deux phrases décisives : « certaines particules
s'affichent bien, certaines sont noires » et « j'ai l'impression que ça arrive
quand je m'approche des colonnes lumineuses ».

```glsl
vViewW = normalize(cameraPosition - wp.xyz);   // Boosters.ts
```

Ce vecteur **s'annule** dès que la caméra atteint la surface. Et deux sections
plus haut, on avait déjà mesuré que la caméra entre **dans** les colonnes
(−0,01 m) et **dans** les anneaux (−0,98 m) : le joueur les traverse pour les
ramasser, elle le suit une fraction de seconde plus tard. `normalize(vec3(0))`
vaut `0/0`, c'est-à-dire **NaN**.

Un fragment NaN s'affiche **noir**. Et comme il alimente ensuite le flou de
bloom, qui est une moyenne pondérée, **un seul pixel invalide noircit tout son
voisinage**. Les deux plaintes — l'objet noir qui bouche la vue, et le
clignotement plein écran — étaient le même bug.

Le même piège existe **par particule** dans la gerbe et dans le pollen :

```glsl
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));   // Motes.ts
```

nul quand la caméra est à la verticale du grain. Un grain sur N tombait en NaN et
sortait noir pendant que ses voisins s'affichaient normalement — mot pour mot ce
que le joueur décrivait.

### Pourquoi aucun banc d'essai ne l'a vu

SwiftShader renvoie `0` pour `normalize(vec3(0))` et calcule `pow()` en pleine
précision. Le défaut est **propre au GPU** : c'est un comportement non spécifié
que chaque pilote traite à sa façon. Un banc d'essai en rendu logiciel est un
excellent détecteur de fautes de logique et un **détecteur nul** de fautes
numériques dépendantes du matériel. Il aurait fallu conclure ça après le
deuxième « ça flicke toujours », pas après le dixième.

### Ce qui est en place

`GLSL_SAFE` (dans `core/Noise.ts`) fournit deux garde-fous, inclus dans les dix
shaders concernés :

```glsl
vec3 nsafe(vec3 v, vec3 fallback){ float l = length(v); return l > 1e-5 ? v / l : fallback; }
float fsafe(float x){ return (x >= 0.0 || x <= 0.0) ? x : 0.0; }
```

`fsafe` teste la forme **niée** : un NaN est faux dans *toute* comparaison, y
compris avec lui-même, donc `x < 0.0` le laisserait passer.

S'y ajoute le plafonnement des bases de `pow()`. Sur beaucoup de GPU mobiles,
`pow(x, n)` est calculé en `exp2(n · log2(x))` : à `x = 0`, `log2(0) = -Inf`, et
le produit par un exposant élevé sort du domaine de la précision `mediump`. Le
pire site était `Environment.ts`, où le facteur solaire vaut exactement 0 sur
**toute la moitié** de la carte opposée au soleil — et cette passe alimente la
carte d'environnement **pré-filtrée**, dont le pré-filtrage *floute* : un NaN y
entre et ressort en taches noires sur **chaque objet en verre du jeu**.

### Deux vérifications, parce que le défaut ne se reproduit pas ici

- `npm run check:nan` — statique. Interdit `normalize()` sur un vecteur qui peut
  s'annuler. Confrontée au code d'avant correction, elle y trouve bien les sites
  fautifs ; c'est la seule preuve possible quand l'exécution ne reproduit rien.
- `npm run check:backticks` — un backtick dans un commentaire GLSL termine le
  template literal qui le porte, et l'erreur tombe des dizaines de lignes plus
  bas sur du code valide. C'est arrivé **quatre** fois. Une règle qu'on doit se
  rappeler est une règle qu'on oubliera.

## 8. Aucune frame noire

Le joueur voyait « flicker noir parfois ». Un flash d'une seule frame ne se
capture pas à la capture d'écran : `scripts/flicker-check.mjs` lit le tampon de
dessin **après chaque rendu** (quatre pixels, luminance maximale) et signale
toute frame dont le maximum est proche de zéro.

Quatre mécanismes peuvent noircir un canvas WebGL. Les quatre sont fermés :

| Cause | Ce qui se passait | Fermeture |
|---|---|---|
| NaN dans la chaîne de post | un seul pixel NaN, moyenné par le bloom à chaque mipmap, noircit **toute** l'image | pare-feu en dernière instruction de `SurfEffect` : toute comparaison avec NaN étant fausse, on retombe sur la texture d'entrée ; `atan(0,0)` et `normalize(vec3(0))` gardés à la source, `uCenter` borné côté CPU |
| Rafales de redimensionnement | la barre d'adresse mobile émet dix `resize` d'affilée, chacun réallouait toutes les cibles du composer | `Engine.apply()` ignore les tailles inchangées, borne à 1 px minimum, et ne s'exécute qu'une fois par frame |
| Perte de contexte GPU | sans `preventDefault`, le navigateur ne restaure jamais le contexte | `webglcontextlost` / `webglcontextrestored` gérés ; la boucle saute le rendu tant que le contexte est perdu |
| Changement de qualité | `setPixelRatio` redimensionne le tampon, le composer restait à l'ancienne taille | le repli de qualité repasse par `apply(true)` |

### La vraie cause : `color-scheme`

Même la couleur d'effacement n'a pas suffi. Le flash restait — parce qu'il ne
venait pas du canvas du tout.

Le jeu est un plein jour fixe : il ne doit jamais répondre au mode sombre du
lecteur. `:root { color-scheme: light }` disait exactement ça, et **elle a été
perdue** en réécrivant `style.css` deux tours plus tôt. Le symptôme est revenu
dans la foulée.

Sans elle, un lecteur en mode sombre donne au document une **toile de fond
noire** — la surface que le navigateur peint sous tout le reste. Elle ne se voit
jamais tant que la page est composée normalement, mais chaque hoquet du
compositeur (montée de couche, rafale de redimensionnement, défilement de la
page hôte, pression mémoire) la laisse apparaître le temps d'une image.

C'est un noir qu'**aucune correction côté WebGL ne peut atteindre** : la sonde
lit le tampon de dessin, qui lui est parfaitement valide. D'où deux mille images
sans rien trouver, trois tours de suite.

`!important` est indispensable : la visionneuse d'artefacts écrit
`documentElement.style.colorScheme` **en ligne** quand le lecteur choisit un
thème, et seule une déclaration importante d'auteur passe devant un style en
ligne normal. `npm run check:theme` le vérifie en simulant exactement ce geste.

En complément, l'interface a été rendue amicale pour le compositeur, pour
réduire la fréquence des hoquets au-dessus du canvas :

| Avant | Après | Pourquoi |
|---|---|---|
| jauge animée en `width` | `transform: scaleX()` | `width` déclenche mise en page **et** peinture à chaque image |
| pulsation en `filter: brightness` | pulsation en `opacity` | un filtre animé crée une couche de plus et la repeint |
| clignotement en `text-shadow` | clignotement en `opacity` | idem |
| points volants créés/supprimés | pool résident de 14 nœuds | insérer un nœud au-dessus d'un canvas recompose l'arbre de couches |
| position en `left`/`top` | position dans le `transform` | tout reste sur le compositeur |

Un bug visible est tombé avec : la transition CSS posée sur la jauge, combinée à
une valeur réécrite en continu, se relançait sans fin et laissait la barre
**bloquée à zéro** quelle que soit la réserve de boost. La valeur est maintenant
écrite à chaque image, sans transition.

### Le tour d'avant : la couleur d'effacement

Ces quatre fermetures n'ont pas suffi — le joueur voyait toujours des flashs
noirs. `npm run check:flicker:mobile` a tranché : il se fait passer pour un
iPhone (donc `detectQuality()` renvoie `low`, un tout autre pipeline : pas de
SMAA, bloom en noyau moyen, atlas de nuages en 512), joue dans une fenêtre
minuscule pour monter en cadence, et agresse pendant deux minutes — rafales de
redimensionnement, rotations, passages en arrière-plan, perte de contexte
provoquée.

**Deux mille images, zéro image noire, zéro image sombre.** Le rendu ne devient
donc jamais noir. Ce qui devient noir, c'est **le fond du tampon**.

Par défaut la couleur d'effacement d'un `WebGLRenderer` est le noir, et le
contexte est créé en `alpha: false` — le canvas est donc **opaque**, et le fond
CSS cyan posé au tour précédent ne pouvait structurellement jamais se voir.
Chaque fois qu'une image ne recouvre pas tout l'écran — contexte perdu puis
recréé, tampon réattribué après un changement de taille, trou du compositeur
entre deux images — c'est ce noir-là qui s'affiche.

La couleur d'effacement correcte n'a jamais été le noir : **c'est le ciel**. Le
dôme le recouvre en temps normal, donc le changement ne coûte rien, et le jour
où il manque on voit du ciel au lieu d'un trou.

En complément, le chemin téléphone a été allégé pour rendre la perte de
contexte moins probable : la **transmission** du verre est désactivée en
qualité `low`. Elle coûtait un rendu de scène complet par image — three.js
redessine tout l'opaque dans une cible dédiée pour que le verre ait quelque
chose à réfracter — pour un apport marginal à 0,18. Elle est remplacée par une
simple opacité.

## 9. Les chunks GLSL, et la dépendance qu'on oublie

Le masque de grève était écrit **trois fois** — dans le sol, dans les touffes,
dans les palmiers — avec les mêmes constantes recopiées à la main. Le jour où
l'on retouche la largeur de plage, deux copies sur trois suivent, et il pousse
de l'herbe sur le sable. Il vit désormais dans `Terrain.shoreGLSL()`, avec le
relief, pour la même raison que `terrainGLSL()` : une seule source de vérité par
grandeur.

L'extraction a immédiatement produit sa propre faute, et elle mérite d'être
notée parce qu'elle est **silencieuse** :

```
ERROR: 0:104: 'fbm2' : no matching overloaded function found
```

Le chunk de grève dépend de `fbm2`/`fbm3`. Le shader de sommet du sol l'incluait
sans inclure le bruit — et un shader qui ne compile pas ne dit rien : le
maillage disparaît, ou tombe sur un matériau de secours, sans une ligne dans la
console qu'on regarde. Le sol est resté **plusieurs heures sans compiler** ; tout
le travail sur le sable était invisible, et je le croyais fait.

Le correctif n'est pas « ajouter l'include manquant ». Une dépendance qu'il faut
penser à coller à la main juste au-dessus est une dépendance qu'on oubliera. Les
chunks portent donc une **garde d'inclusion**, exactement le `#pragma once` des
autres langages — le préprocesseur GLSL ES gère `#ifndef` depuis la 1.00, donc
ceci marche en WebGL1 comme en WebGL2 :

```glsl
#ifndef FS_NOISE
#define FS_NOISE
...
#endif
```

`shoreGLSL()` **tire** alors `GLSL_NOISE` lui-même. Inclure les deux reste sans
effet, et n'inclure que la grève fonctionne. Les deux propositions sont vraies en
même temps, ce qui est tout l'intérêt.

`npm run check:shaders` charge le jeu sur deux profils et échoue si une seule
erreur GLSL apparaît en console. C'est le seul filet contre cette classe de
faute, puisqu'elle ne casse jamais la page.

## 10. L'équipement

`src/core/Loadout.ts` ne connaît que des **nombres de jeu** : cinq
multiplicateurs par option, et rien qui touche à three.js. La peinture — les
livrées, la matière des montures — vit dans `player/Surfer.ts` et
`player/Disc.ts`. Mélanger l'équilibrage et la peinture dans la même table est
le plus court chemin vers une option qu'on n'ose plus retoucher parce qu'elle
est jolie.

`Game.applyLoadout()` est le **point d'entrée unique** : il écrit dans le
Controller *et* dans le Surfer. Deux appels séparés finiraient par diverger, et
l'écran promettrait une monture que la partie ne livre pas.

Les multiplicateurs s'appliquent **aux constantes**, jamais aux valeurs
instantanées : une monture ne change pas l'état du surfeur, elle change les
règles sous lui. C'est ce qui garantit qu'aucune combinaison ne peut sortir des
bornes du jeu — les seuils bougent, les `clamp` restent.

Une subtilité de signe : `plane` **divise** le seuil de déjaugeage
(`PLANE_ENTER / plane`) au lieu de le multiplier. C'est la coque qui déchausse
plus tôt, pas le surfeur qui va plus vite — et ça garde le sens « plus c'est
haut, mieux c'est » sur la jauge, qui est ce que le joueur lit.

`npm run check:pick` fait le parcours **au clic**, pas par `window.__game` :
l'écran s'ouvre-t-il au premier lancement et seulement là, un clic sur une carte
puis sur la validation applique-t-il le choix à la physique **et** à la livrée,
et le choix survit-il au rechargement.

### Les scripts et le premier lancement

Chaque lancement de Playwright est un profil neuf, donc un premier lancement,
donc l'écran d'équipement. Il couvre le rendu — toutes les captures montraient
le menu — et il intercepte les doigts — le banc d'entrées ne testait plus rien,
avec six échecs à la clé.

`scripts/lib/boot.mjs` sème le choix dans `localStorage` **avant** le
chargement, exactement comme un joueur qui revient. Fermer le panneau après coup
aurait été plus court et faux : la fermeture appelle `restart()`, et on mesurerait
alors une partie qui vient de repartir à zéro.

## 11. Plusieurs mondes, une seule scène

### Une base, cinq amplitudes

Les **fréquences**, les **phases** et les **fondus** de relief sont communs à
tous les mondes ; seules les cinq amplitudes changent. Ce n'est pas une économie
de code, c'est ce qui rend les mondes **interpolables** : une combinaison
linéaire des mêmes fonctions de base reste une fonction de la même famille, donc
on passe de la plaine à l'archipel en fondu continu.

Faire varier les fréquences aurait donné des mondes plus différents et un
changement de monde **inregardable** : le relief se serait mis à défiler
latéralement pendant toute la transition.

La contrainte est réelle et assumée : deux mondes ne peuvent pas différer par la
**taille** de leurs collines, seulement par leur **hauteur**. En pratique ça
suffit — une plaine et un archipel se distinguent par ce qui dépasse de l'eau,
pas par leur spectre.

### Le relief passe par des uniformes

`terrainGLSL()` génère toujours son code depuis `Terrain.ts`, mais les
amplitudes y sont devenues `uniform float uAmp[5]`. Le reste — fréquences,
phases, fondus — demeure littéral, donc le compilateur le replie. **Changer de
monde ne recompile rien.**

Le tableau `AMP` est **muté en place et jamais remplacé** : il est branché tel
quel comme valeur de l'uniforme dans chacun des six matériaux qui déplacent des
sommets. Écrire dedans met à jour le CPU *et* le GPU d'un coup, sans qu'aucun
matériau ait à être prévenu. Le remplacer par un nouveau tableau casserait ce
lien, et le sol du GPU se figerait sur l'ancien monde pendant que la physique
suivrait le nouveau : **le surfeur volerait au-dessus du décor**.

Le niveau de l'eau est un scalaire, donc il doit être poussé — `pushTerrain()`
le fait dans la même boucle que `pushDay()`, sur le même registre.

### Le registre de peinture

`World.paint()` écrit les vingt et une couleurs du monde dans les uniformes, et
la liste est **tenue à la main**, comme le registre `lit`. Un balayage
automatique attraperait des uniformes de même nom qui n'ont rien à voir, et
surtout il rendrait invisible l'oubli d'un décor ajouté plus tard.

Un uniforme absent est ignoré **quand on l'a dit** — les tours et la ligne
d'arbres ne partagent pas les mêmes noms — et signalé sinon. Le premier jet
comptait simplement les manques et attendait « quatre » : il y en avait trois, et
l'alerte n'a signalé que ma propre erreur de comptage. **Un nombre magique ne dit
pas quoi manque ; un drapeau par appel, si.** `check:shaders` échoue sur toute
erreur de console, donc le filet était déjà tendu.

### Le ciel se fond, les clés ne se fondent pas

`Daylight` évalue **deux** jeux de keyframes — celui du monde qu'on quitte, celui
qu'on rejoint — et mélange les **résultats**. Interpoler les tables de clés
donnerait des teintes qui n'existent dans aucun des deux mondes, parce que deux
mondes n'ont pas leurs moments clés aux mêmes couleurs.

En régime établi `mix` vaut 1 et les deux jeux sont identiques : on paie alors
une évaluation de trop par image, ce qui est le prix — parfaitement négligeable —
de n'avoir **aucun cas particulier** à maintenir entre « en transition » et « pas
en transition ».

### `check:worlds`

Un monde qui n'est qu'une palette ne demande aucune vérification. Dès qu'il
change le relief et le niveau de l'eau, il change le **jeu**, et il devient
possible d'en livrer un dans lequel on ne peut rien faire.

C'est exactement ce qui est arrivé. Okinawa, à moitié sous l'eau, coulait le
joueur dans le premier lagon : on démarre à 18 m/s, le seuil de déjaugeage était
à 25, la vitesse tombait à 5, et il ne restait plus assez de terre entre deux
nappes pour se relancer. **La capture montrait un joli lagon turquoise et le mot
COULÉ en travers de l'écran.** Rien dans le code ne l'aurait signalé.

Le banc pose trois questions à chaque monde, et l'autopilote de `check:run` y
répond :

| | Mesure | Seuil |
|---|---|---|
| Géométrie | largeur de la nappe la plus large | ≤ 250 m, sinon couler au milieu coûte la partie |
| Géométrie | terre moyenne entre deux nappes | ≥ 30 m, de quoi repasser de 5 à 25 m/s |
| Survie | temps tenu par l'autopilote | ≥ la moitié de la plaine |
| Enlisement | part du temps sous 22 m/s | ≤ 35 % |

État mesuré :

```
monde        eau    nappe max  terre moy   survie   score    anneaux  coules  glisses  enlise
plaine        17%       106 m       214 m     217 s  2398089      111       0       45      1%
okinawa       50%       125 m        42 m     161 s  3990593       69       0      108      2%
bliss          0%         0 m        -- m     186 s   971481       84       0        0      1%
chrome        28%       107 m       129 m     199 s  3244109       96       0       55      0%
```


## 12. La version publiée n'était testée par rien

L'écran d'équipement a ajouté un `<div id="pick">` à `index.html`. Le script qui
assemble l'artefact mono-fichier, lui, construisait sa **propre coquille HTML**,
avec un `<canvas id="stage">` et un `<div id="hud">` écrits à la main. Il n'a pas
suivi.

Résultat : dans la version publiée, `Select` cherchait son nœud, ne le trouvait
pas, et le module mourait sur

```
TypeError: Cannot set properties of null (setting 'innerHTML')
```

**avant la première image.** Le joueur voyait un aplat cyan — le fond de secours
du canvas — avec le HUD figé dessus. Le HUD s'affichait parce qu'il est construit
plus tôt dans le constructeur ; le jeu, lui, n'avait jamais démarré.

Zéro test échouait. `npm run dev`, les captures, les shaders, les entrées, le
flicker, les mondes : **tout tournait sur `index.html`**, servi par Vite. Le
fichier réellement livré n'était chargé par rien. C'est la définition d'un angle
mort, et il a coûté deux versions publiées mortes.

Le commentaire juste au-dessus du code fautif disait déjà, à propos du CSS, que
« la dupliquer ici la ferait dériver au premier ajustement ». C'était vrai du
style et tout aussi vrai du corps ; je ne l'avais appliqué qu'à **la moitié du
problème**.

Deux corrections, et la seconde compte plus que la première :

1. le corps de l'artefact est **extrait de `index.html`**, plus jamais recopié.
   Tout élément ajouté à la page de développement s'y retrouve automatiquement ;
2. `npm run check:artifact` charge **le fichier réellement publié** et exige
   qu'il démarre : aucune exception, le jeu instancié, les nœuds présents, et la
   simulation qui avance.

### Le compteur d'images mentait

Trouvé en passant, en cherchant pourquoi le banc trouvait le jeu lent. La boucle
bornait le temps d'image à 100 ms — ce qui est **juste** pour la simulation, sans
quoi un onglet revenu au premier plan rattraperait dix secondes d'un coup — puis
réutilisait cette valeur bornée pour le compteur d'images et pour le déclencheur
de baisse de qualité.

Conséquence : sous dix images par seconde, le compteur affichait 10 quoi qu'il
arrive. Mesuré sur rastériseur logiciel : **1,2 image réelle par seconde,
annoncée comme 12,7**. Le chiffre qu'on regarde pour savoir si le jeu rame était
précisément celui qui ne pouvait pas le dire, et le mécanisme censé soulager une
machine lente lisait la même valeur aveugle.

Deux durées désormais : `raw` pour ce qu'on mesure et ce qu'on affiche, `real`
borné pour ce que la simulation consomme.


## 13. Le vent, troisième source de vérité partagée

Le projet en a maintenant trois, et elles ont toutes la même forme :

| Source | Fichier | Tableau partagé | Jumeau GLSL |
|---|---|---|---|
| le relief | `Terrain.ts` | `AMP`, `SHORE` | `terrainGLSL()`, généré depuis les constantes |
| la houle | `Terrain.ts` | `SWELL` | `swellGLSL()`, écrit à côté de son jumeau TS |
| **le vent** | `Weather.ts` | `WIND` | `WEATHER_GLSL`, `gustAt` / `gustPush` |

Le protocole est le même dans les trois cas et il n'a rien d'accessoire : le
tableau est **muté en place, jamais remplacé**, parce qu'il est branché tel quel
comme valeur d'uniforme dans chaque matériau concerné. Une écriture suffit donc à
mettre à jour la physique **et** le GPU, sans plomberie de notification et sans
qu'on ait à se souvenir de qui doit être prévenu. Le remplacer par un tableau
neuf casserait le lien en silence : le CPU suivrait le nouveau monde pendant que
le GPU resterait figé sur l'ancien.

### La rafale était déjà là, elle ne servait qu'à décorer

`gustAt` existait depuis les palmiers : une vague qui traverse le champ dans
l'axe du vent, lue par l'herbe et par les palmes pour les coucher. Le joueur ne
sentait rien.

Octobre s'en sert comme mécanique. Le `Controller` lit **la même fonction, au
même instant**, et applique une poussée latérale — exactement ce que la houle
fait déjà pour l'océan. La rafale qu'on voit arriver dans les feuilles est celle
qui déporte le disque, au mètre et à la seconde près.

Elle est **centrée** (`gustPush = gustAt * 2 - 1`), et c'est le point de design :
une rafale toujours orientée dans le même sens serait une taxe qu'on contre une
fois pour toutes. Centrée, elle balance, et il faut la lire en continu.

Elle mord d'autant plus que le disque tient moins au sol — × 0,8 à plat, × 1,15
en glisse, × 1,35 en l'air. Et comme le champ est ancré en monde, la période
ressentie dépend de la vitesse : le vent se durcit exactement quand on a le moins
de temps pour le corriger, sans une ligne de code de plus.

### Le banc doit recevoir le monde ENTIER

`check:worlds` avait déjà oublié de passer `swell` à `setTerrain`, et mesurait
donc un océan plat. Il aurait oublié `wind` de la même façon : Octobre aurait été
déclaré jouable sur une version de lui-même **sans sa mécanique principale**.

Deux mesures nouvelles en découlent, et elles portent sur le résultat plutôt que
sur la cause :

- le **temps passé collé au bord** du couloir (> 30 m sur 34). Un vent qu'on ne
  peut pas contrer plaque le pilote contre la paroi et l'y garde : la trajectoire
  cesse d'être un choix. Le seuil est à 25 % ;
- la **poussée moyenne mesurée**, comparée à celle que le monde déclare. Un
  `wind` écrit dans le mauvais tableau ne se verrait nulle part ailleurs.

### Trois systèmes instanciés qui ne coûtent rien quand ils dorment

Feuilles et pluie existent dans **tous** les mondes, à densité nulle hors
d'Octobre. Les créer à la demande aurait coûté une compilation de shader au
moment précis où l'on veut un fondu sans à-coup — c'est-à-dire exactement ce que
toute l'architecture des mondes existe pour éviter.

Le prix de leur sommeil est une ligne :

```glsl
if (uDensity < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
```

L'instance sort du volume de vue, le rastériseur n'a rien à faire, et il ne reste
qu'un appel de dessin par système.

### `uOvercast` : baisser la lumière ne suffit pas

`power`, dans les clés de ciel, règle l'**intensité** de la lumière directe. Il
ne touche pas au dôme, qui porte son propre soleil — cœur, couronne, étoile à
douze branches, traînée anamorphique. Un monde couvert dont on baisse seulement
la puissance garde donc une étoile de cinéma plantée au milieu de son ciel de
plomb.

D'où un uniforme séparé, et la règle générale dont il est le troisième exemple
après la brume de la ville et le reflet de l'eau : **ce qui décrit une propriété
du ciel ne peut pas se dériver d'un réglage de lumière.**


## 14. Le décor ancré au monde, et l'invariant qu'il impose

Le quartier d'octobre (comme les palmiers, les touffes et le pollen avant lui)
est un semis de cellules qui **suit le joueur**. Quand celui-ci franchit un pas
de grille, l'ancre recule d'un cran et chaque instance hérite du z de sa
voisine. C'est ce qui fait défiler un décor infini sans jamais en allouer un
seul.

Le prix à payer tient en une ligne, et il n'a rien d'évident :

> **Le contenu d'une cellule ne doit dépendre que de sa position monde, jamais
> de son index d'instance.**

Sinon le contenu ne suit pas le z, et **tout le décor change de place à la
fois**. C'est arrivé : le côté du lampadaire se lisait sur `mod(row, 2)`. Tous
les mâts, leurs halos et leurs flaques sautaient d'un bord à l'autre de la route
tous les vingt mètres — soit deux fois par seconde en croisière. Les maisons de
second rang et les arbres faisaient de même.

La correction n'est pas un réglage, c'est une **signature** : les fonctions de
contenu (`lampAt`, `townSide`) ne reçoivent plus que le z. Une seule fonction,
`townZ`, a le droit de convertir un index de rangée en position monde. Ce dont
une fonction ne peut pas parler, elle ne peut pas en dépendre.

### Pourquoi `check:town` est statique et non visuel

Le premier banc mesurait l'image : on avançait le joueur par pas de deux mètres
et on comparait l'écart image à image **aux franchissements de grille** et
ailleurs. Ça ne marche pas, et l'échec est instructif — un lampadaire à
l'horizon fait trois pixels. Même en faisant sauter *tous* les mâts d'un bord à
l'autre, l'écart aux franchissements sortait à **1,08 fois** celui des autres
pas : parfaitement noyé dans les huit pour cent de parallaxe que deux mètres
d'avance produisent de toute façon.

(Le tout premier jet était encore pire : il calculait l'écart *image à image*
dans la boucle de rendu, et lisait donc l'écart entre les deux dernières images
— toutes deux postérieures au pas. Sur une scène gelée, deux images consécutives
sont identiques : le banc mesurait zéro et déclarait tout normal, sur la version
qui sautait comme sur celle qui ne sautait pas.)

L'invariant, lui, est **structurel** : il porte sur ce dont une fonction a le
droit de dépendre. On le vérifie donc là où il vit — dans la signature et le
corps des fonctions de placement. C'est exact, instantané, ça ne flotte pas avec
la charge de la machine, et c'est vérifié : réintroduire le bug fait tomber
trois assertions sur huit.

### Ce qu'aucun autre banc ne pouvait voir

`check:shaders` compile, `check:worlds` mesure une physique que le décor ne
touche pas, et les captures sont des **arrêts sur image** — or un décor qui se
téléporte est parfaitement correct sur chaque image prise séparément. **Le
défaut n'existe qu'entre deux images.** C'est une classe entière de bugs que la
suite ne couvrait pas, et le joueur l'a trouvée en trois secondes de jeu.

### Deux outils de diagnostic qui valent mieux qu'un avis

Les deux corrections les plus lourdes du quartier ne sont pas venues d'un œil
exercé mais de deux vues qu'on ne se donne pas spontanément.

**La vue de dessus.** Poser la caméra à cent quatre-vingt-dix mètres au-dessus
du joueur, regard vertical, coûte dix lignes dans un script jetable — et elle
répond en une image à une question sur laquelle on peut tourner une heure
depuis le sol : *est-ce que les maisons bordent la rue, ou est-ce qu'elles sont
éparpillées ?* Depuis la caméra de course, un semis passe pour du désordre. De
dessus, il n'y a pas de doute possible.

**Couper les couches une par une.** Rendre la même vue en masquant un maillage
à la fois et en comparant la moyenne d'une bande de l'image dit *qui* peint
quoi. C'est ce qui a montré que le premier plan d'octobre tombait de
`(121, 83, 56)` à `(18, 15, 10)` dès qu'on retirait la contribution du quartier
au sol : le paysage était noir et on ne regardait que le beurre des lampadaires.
Aucune quantité de réglage à vue n'aurait trouvé ça, parce qu'à l'écran le
résultat n'a l'air ni trop sombre ni trop clair — il a l'air **beige**.

Corollaire pour les bancs de capture : **un banc qui gèle le joueur doit aussi
éteindre tout ce qui le suit**. Le ruban et l'aura étaient déjà masqués ; la
gerbe était seulement *silencieuse*, et les particules émises pendant les six
mille pas de repérage se figeaient en une plaque **turquoise** à bord droit dans
un coin du cadre — sur un monde d'octobre, la seule chose cyan de l'image. On a
déjà pris cet artefact pour un défaut du monde une fois (c'était la gerbe, sur
l'océan) ; il coûte une demi-heure à chaque fois qu'on l'oublie.


## 15. Le flou de mouvement, et pourquoi le flou radial ne suffisait pas

Le premier jet étirait l'image depuis le point de fuite, proportionnellement à
la vitesse affichée. Ça donne le bon effet dans un seul cas — foncer tout
droit — et **rien du tout** dans tous les autres : un virage serré, une caméra
qui encaisse une réception, un saut, un demi-tour en l'air ne produisaient pas
un pixel de flou, alors que ce sont exactement les moments où l'œil en attend.

On calcule donc la vraie vitesse à l'écran de chaque pixel, par **reprojection** :

1. la profondeur donne la position monde du pixel (`uInvVP`, l'inverse de la
   matrice vue-projection de cette image) ;
2. on reprojette cette position monde avec la matrice de l'image **précédente**
   (`uPrevVP`) ;
3. l'écart des deux positions écran est le vecteur vitesse, et on floute le long
   de ce vecteur.

C'est la méthode standard. Elle coûte une texture de profondeur — que le
compositeur crée tout seul dès qu'un effet déclare `EffectAttribute.DEPTH` — et
six échantillons, et elle rend gratuitement tout ce que le flou radial ne savait
pas faire : le sol file sous les pieds pendant que l'horizon reste net, le décor
balaie l'écran dans un virage, et le ciel bouge quand la caméra tourne. (Le ciel
a une profondeur de 1 : sa position monde tombe sur le plan lointain, ce qui est
exact — il ne bouge pas quand on avance, il bouge quand on tourne.)

Quatre détails qui ne se devinent pas :

- **La durée d'obturation est fixe, pas la frame.** Flouter exactement le
  déplacement d'une image donne deux fois plus de flou à trente images par
  seconde qu'à soixante : le rendu changerait avec la machine. On rapporte donc
  le déplacement à une pose fixe (1/64 s), et le flou redevient une propriété du
  **monde** et non du débit. (Même règle que le lissage de l'axe de l'aura, qui
  a exactement le même défaut si on le fait à taux fixe par image.)
- **Le vecteur est borné.** Une réception secoue la caméra assez fort pour
  étirer tout le cadre en une image ; sans borne, l'image devient illisible pile
  au moment où le joueur doit reprendre le contrôle.
- **L'échantillonnage est centré** sur le pixel, de −0,5 à +0,5 du vecteur. Tiré
  d'un seul côté, le flou **déplace** l'image au lieu de l'étaler, et tout le
  cadre glisse d'un demi-vecteur — ce qui se lit comme un défaut de
  synchronisation, pas comme de la vitesse.
- **Le surfeur est épargné.** Un flou par reprojection ne connaît que la caméra :
  il floute tout ce qui bouge par rapport à elle, donc aussi le personnage, qui
  pourtant ne bouge pas d'un pixel à l'écran. Sans correction il part en bouillie
  dès qu'on carve — c'est-à-dire pile quand on a besoin de le voir. On épargne
  donc un disque autour de sa position écran, ce que fait n'importe quel jeu de
  course avec sa voiture, et pour une deuxième raison qui vaut à elle seule : le
  point que l'œil suit doit rester le point net de l'image.

Le coût n'a **pas** pu être mesuré ici : sur le rastériseur logiciel des bancs,
l'écart entre deux mesures du même code est de l'ordre de trente pour cent, et
le flou passe dessous. Ce qui est mesurable, c'est qu'il n'introduit ni image
noire ni NaN (`check:flicker`).

### Un seuil de banc doit être loin de la valeur observée

`check:artifact` vérifiait que le jeu parcourt soixante mètres en trente
secondes de montre. Il a fini par échouer à **cinquante-neuf**. Le moteur jette
le retard qu'il ne peut pas rattraper : la distance parcourue en temps de montre
mesure donc la **machine** et non le jeu, et il a suffi que le flou de mouvement
coûte dix pour cent de cadence au rastériseur logiciel pour passer dessous.

Le seuil est descendu à vingt-cinq mètres — ça prouve exactement la même chose,
le jeu tourne, sans être une mesure de performance déguisée. C'est la troisième
fois que ce piège se referme (`check:input` attendait des durées de montre,
`check:artifact` avait déjà un seuil d'images par seconde posé sur la valeur
observée) et la règle vaut d'être écrite : **un banc binaire se règle loin de la
valeur observée, sinon c'est un banc de performance qui s'ignore.**


## 16. Le couloir de route, ou comment ajouter un terme au relief

Le relief est une somme de cinq sinus, écrite **deux fois** : en TypeScript pour
la physique, en GLSL généré depuis les mêmes constantes pour le rendu. Y ajouter
un terme — ici l'aplanissement de la rue — demande trois choses, et en oublier
une se voit tout de suite.

**1. Le terme lui-même, des deux côtés.** Le chunk GLSL est *généré* depuis la
liste des couches, donc le marquage « cette couche compte dans la version
lissée » se fait une fois, dans la génération. Les quatre constantes de
géométrie du couloir voyagent dans un `Vector4` partagé, muté en place comme
`AMP` : une seule copie, et changer de monde ne recompile rien.

**2. La dérivée, y compris celle du masque.** Le relief est
`h = base + m(x) · (cible − base)`. La dérivée en x porte donc **aussi sur le
masque** :

```
∂h/∂x = base'ₓ + m'(x)·(cible − base) + m·(cible'ₓ − base'ₓ)
∂h/∂z =  base'_z                      + m·(cible'_z − base'_z)
```

Oublier `m'(x)·(cible − base)` donne une normale fausse sur les deux bords du
couloir — c'est-à-dire exactement là où la pente change le plus. Ça ne se voit
pas sur une capture et ça se sent immédiatement à la manette : le disque décolle
sur une bosse qui n'existe pas. C'est la raison pour laquelle le couloir dépend
de **x seulement** et pas des rues transversales : une dépendance en z aurait
demandé la même rigueur sur un terme périodique, pour un gain visuel nul (on
traverse une rue latérale en une demi-seconde).

**3. Rien qui casse la continuité.** Le masque est un `smoothstep`, donc C¹. Un
`max()` pour garantir la sortie de l'eau aurait été C⁰ et se serait senti comme
une arête. Il n'y en a pas besoin : les deux couches longues ne descendent
jamais aussi bas que la somme des cinq, donc lisser suffit à passer au-dessus du
niveau de l'eau — mesuré, 0 % de route immergée contre 9 % avant.

### Un banc à l'autopilote ne mesure pas la jouabilité

`check:worlds` déclarait le vent d'octobre corrigeable : **zéro pour cent** du
temps collé au bord du couloir. Le joueur le déclarait injouable. Les deux
mesures sont exactes, et l'écart est la leçon : **un autopilote qui corrige en
permanence ne se plaint pas.** Il n'a pas de but secondaire — il ne vise pas un
anneau, il ne prépare pas un saut, il ne fait rien pendant qu'il compense.

Le banc reste utile (il attrape le cas où le vent plaque le pilote contre la
paroi), mais il ne peut pas répondre à « est-ce agréable ». Aucun seuil ne le
pourra ; ce n'est pas un défaut du seuil, c'est la limite de la méthode. Ce que
le banc a bien fait, en revanche, c'est **chiffrer la correction** : score à
l'autopilote de 2,7 M à 4,4 M, vent moyen de 4,9 à 1,7 m/s.
