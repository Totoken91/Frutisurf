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
│   ├── City.ts              skyline de cristal
│   ├── Boosters.ts          colonnes de vitesse, semées en chaîne
│   └── Rings.ts             anneaux de verre à franchir (bas et hauts)
├── player/
│   ├── Buddy.ts             le bonhomme MSN en verre
│   ├── Disc.ts              le CD + shader de diffraction
│   ├── Controller.ts        physique de glisse (doc 03 §2-3)
│   ├── Trail.ts             ruban derrière le disque
│   └── Spray.ts             particules d'herbe
├── fx/
│   ├── PostFX.ts            bloom → SurfEffect → SMAA
│   ├── SurfEffect.ts        radial blur + speed lines + aberration + vignette
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
npm run check:flicker         # aucune frame noire sur une partie complète
npm run check:flicker:mobile  # idem, profil téléphone, sous agression
npm run check:theme           # le jeu reste en plein jour en mode sombre
```

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
