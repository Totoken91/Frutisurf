# 02 — Architecture technique

## 1. Stack

| Choix | Raison |
|---|---|
| **Three.js** (WebGL2) | Contrôle total des shaders, matériaux `transmission`/`iridescence` natifs — indispensables pour le verre du buddy |
| **TypeScript** | Le contrôleur de glisse a une douzaine d'états couplés ; typer évite les bugs de feeling silencieux |
| **Vite** | HMR instantané — on va itérer des centaines de fois sur des constantes de ressort |
| **postprocessing** (pmndrs) | Chaîne d'effets fusionnée en un pass. Meilleur bloom que le `UnrealBloomPass` de Three, et SMAA inclus |
| **Pas de framework UI** | Le HUD est du DOM + CSS. React coûterait des frames pour zéro bénéfice |
| **Zéro asset binaire** | Textures (nuages, bruit, herbe), sons et géométries générés au boot. Le repo reste léger et rien ne casse au déploiement |

## 2. Carte des modules

```
src/
├── main.ts                  bootstrap + boucle
├── core/
│   ├── Engine.ts            renderer, scène, caméra, composer, resize, PMREM
│   ├── Input.ts             clavier + tactile + gamepad → un axe unifié
│   ├── Spring.ts            ressorts amortis (le socle de tout le feeling)
│   ├── Noise.ts             valeur/Perlin/FBM pour CPU et GLSL
│   └── Palette.ts           la palette du doc 01, source unique de vérité
├── world/
│   ├── Sky.ts               dôme dégradé + soleil
│   ├── Clouds.ts            champ de billboards
│   ├── Ground.ts            plaine infinie (shader)
│   ├── GrassField.ts        brins instanciés + sillage
│   ├── City.ts              skyline de cristal
│   ├── FishSchool.ts        poissons volants instanciés
│   └── Bubbles.ts           bulles irisées (décor + collectables)
├── player/
│   ├── Buddy.ts             le bonhomme MSN en verre
│   ├── Disc.ts              le CD + shader de diffraction
│   ├── Controller.ts        physique de glisse (doc 03 §2-3)
│   ├── Trail.ts             ruban derrière le disque
│   └── Spray.ts             particules d'herbe
├── fx/
│   ├── PostFX.ts            bloom → radial blur → aberration → vignette → SMAA
│   ├── SpeedLines.ts        streaks en espace écran
│   ├── ShockRing.ts         anneaux d'impact
│   └── CameraRig.ts         ressort, FOV, roll, bruit, shake, hitstop
├── hud/
│   ├── Hud.ts               binding état → DOM
│   └── hud.css              verre Aero
├── audio/
│   └── Audio.ts             synthèse WebAudio
└── shaders/
    ├── ground.glsl.ts
    ├── disc.glsl.ts
    ├── rim.glsl.ts
    ├── bubble.glsl.ts
    └── speedlines.glsl.ts
```

## 3. Boucle

Pas fixe pour la simulation, rendu libre :

```
accumulator += min(realDelta, 0.1)        // clamp anti-spirale après un onglet en arrière-plan
while (accumulator >= 1/120) {
    if (!hitstopActive) world.step(1/120)  // le hitstop gèle la SIM, pas le RENDU
    accumulator -= 1/120
}
camera.update(realDelta)                   // la caméra tourne en temps réel : elle doit rester fluide
render()
```

120 Hz de simulation : les ressorts de `steer` (ω=14) ont besoin de ça pour ne pas
osciller en escalier sur un écran 60 Hz.

## 4. Monde infini

Le surfeur ne s'éloigne jamais de l'origine. C'est le **monde qui recule**.

- `worldZ` cumule la distance parcourue (double précision, pour le score).
- Tous les décors sont modulo-repliés sur une période le long de Z.
- La plaine est un plan fixe ; c'est son shader qui fait défiler l'UV.
- Les brins d'herbe, bulles et poissons sont recyclés en tête de zone dès qu'ils
  passent derrière la caméra.

Ça évite la dérive de précision float32 et supprime tout budget de streaming.

## 5. Budget de performance

Cible : **60 fps en 1080p sur un GPU intégré de milieu de gamme**.

| Poste | Budget | Stratégie |
|---|---|---|
| Draw calls | ≤ 40 | Instancing pour herbe / poissons / bulles |
| Triangles | ≤ 180 k | L'herbe domine ; densité pilotée par le niveau de qualité |
| Passes de post | 1 | Chaîne fusionnée par `postprocessing` |
| Transmission | 1 seul objet | `transmission` force un render target supplémentaire — **le buddy uniquement**, les bulles utilisent un faux verre en shader |
| Textures | 0 fichier | Générées en canvas au boot |

Trois niveaux de qualité auto-détectés (densité d'herbe, résolution du bloom, nombre
de bulles), avec repli automatique si le temps moyen d'image dépasse 20 ms sur 2 s.

## 6. État partagé

Un seul objet `GameState` en lecture pour le HUD et l'audio :

```ts
{ speed, steer, lean, carveCharge, combo, score, distance,
  airborne, boosting, quality, fps }
```

Personne n'écrit dedans à part le contrôleur. Le HUD lit à 20 Hz (pas 120 : c'est du
DOM, et l'œil ne lit pas un compteur plus vite que ça).

## 7. Commandes

```bash
npm run dev       # serveur HMR
npm run build     # bundle de prod dans dist/
npm run preview   # sert le bundle de prod
npm run shot      # capture Playwright pour comparer à la référence
```
