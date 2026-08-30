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
│   └── Boosters.ts          colonnes de vitesse, semées en chaîne
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
│   └── Gauges.ts            vitesse + jauge de boost (DOM)
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
npm run dev       # serveur HMR
npm run build     # bundle de prod dans dist/
npm run preview   # sert le bundle de prod
npm run shot      # capture Playwright pour comparer à la référence
```
