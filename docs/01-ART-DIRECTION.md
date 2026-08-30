# 01 — Direction artistique

Objectif : que l'arrêt sur image du jeu **passe pour la référence**.
Pas « inspiré de ». Confondable.

---

## 1. Palette canonique

Ces valeurs sont extraites au k-means de l'image source. Elles sont la vérité.
Toute couleur du projet doit venir d'ici ou être justifiée contre §5.

```
/* CIEL */
--sky-zenith      #0FB8DE
--sky-mid         #15CEE8   /* dominante n°1 de l'image, 27 % */
--sky-horizon     #7FE6F2
--cloud-core      #FFFFFF
--cloud-shadow    #B2D2EB

/* PLAINE */
--grass-horizon   #8CFF84   /* le point le plus CLAIR du sol */
--grass-far       #75FC85
--grass-mid       #48FD76
--grass-near      #19E25F   /* le point le plus SOMBRE du sol */
--grass-shadow    #12A84E
--grass-streak    #6BFF92

/* SURFEUR */
--buddy-core      #1C9FE4
--buddy-glass     #35E4F9
--buddy-rim       #74F3F7
--buddy-hot       #BDF1F7

/* DISQUE */
--disc-silver     #DAECF4
--disc-drift-a    #1A94BA
--disc-drift-b    #C86BFF
--disc-drift-c    #FFE066

/* VILLE */
--city-face       #75CEDC
--city-lit        #C8E4EC
--city-deep       #2DA7C3

/* Ces bleus Aero ne servent plus au rendu depuis le retrait de l'interface.
   Ils restent la comme relevé de la référence. */
--aero-deep       #0C57C9
--aero-blue       #1063D7
--aero-cyan       #26D4EB
--aero-frost      #CBF1F0
```

## 2. Lumière

Un seul setup, jamais renégocié :

| Source | Type | Couleur | Intensité | Rôle |
|---|---|---|---|---|
| Key | Directionnelle, haute, arrière-droite | `#FFFFFF` | 2.6 | Highlights spéculaires sur le verre |
| Sky | Hemisphere ciel→sol | `#15CEE8` → `#3BFF7A` | 1.5 | **Le rebond vert du sol dans le buddy — indispensable** |
| Fill | Directionnelle, basse, avant-gauche | `#BDF1F7` | 0.6 | Débouche le contre-jour, garde le rim |
| Env | PMREM d'une skybox procédurale | — | 1.0 | Réflexions du verre et du CD |

**Aucune ombre portée projetée.** L'image de référence n'en a pas.
Le contact au sol se lit par un **halo vert additif** sous le disque, pas par une ombre.

## 3. Matériaux

### Buddy MSN — verre coloré

Silhouette relevée au pixel sur la référence, puis calée au comparatif côte à
côte (`scripts/` + le montage de `docs/reference.jpg`). Trois points que
l'intuition rate :

- le buste **n'est pas une cloche** : ses flancs sont quasi verticaux sur le
  tiers inférieur et la **base est plate et pleine**, pas rétrécie ;
- la tête **pose sur l'épaule** en la mordant d'environ 0,11 × la demi-largeur.
  Suspendue, on obtient un bonhomme de neige ; noyée, une quille ;
- chaque volume porte **son propre dégradé vertical** `#0A8FE8` → `#6FF2FB`.
  C'est le marqueur le plus reconnaissable de l'icône Windows Live.

**La teinte est portée par un terme additif, pas par le lobe diffus.** Avec une
key à 2.6 et un tone mapper, une couleur saturée passée dans l'éclairage de
scène ressort délavée. Le diffus est ramené à 0.22 et ne sert qu'à donner une
réponse sourde à la lumière.

`MeshPhysicalMaterial` :
```
color            #1C9FE4
transmission     0.18     ← la référence est bien plus OPAQUE qu'un verre creux :
                            le vert ne traverse qu'en lisière et sous la base
thickness        0.7
ior              1.42
roughness        0.06
clearcoat        1.0
clearcoatRoughness 0.02
iridescence      0.22
iridescenceIOR   1.5
attenuationColor #4CC8F0
attenuationDistance 3.2
envMapIntensity  0.45   ← plus haut, tout le ciel blanc revient dans le verre
```
Plus, injectés par `onBeforeCompile` : le dégradé, un **rim de Fresnel** (sans
lui le buddy disparaît sur le vert), une **arête basse incandescente** (la
lumière du sol entre par la base plate), un **assombrissement du flanc gauche**
qui donne le relief, et un voile spéculaire haut-gauche resserré.

> Le bas du dégradé est volontairement sous `#8BFFFE` : à cette valeur il
> dépassait le seuil de bloom (luminance 0.84 > 0.80) et se répandait en halo
> blanc sur toute la moitié inférieure.

### CD — diffraction
Shader custom. La règle : **ce n'est pas un miroir, c'est un réseau de diffraction.**
- Base argent `--disc-silver` en réflexion d'environnement, roughness 0.12.
- Par-dessus, un arc-en-ciel dont la teinte dépend de **l'angle azimutal autour du centre
  ET de l'angle de vue** : `hue = fract(atan(y,x)/TAU * 3.0 + dot(N,V) * 1.7 + time*0.05)`.
- Sillons : anneaux concentriques fins qui modulent la roughness (`sin(r * 900)`).
- Trou central + anneau clair, comme un vrai CD.
- Le dessous n'est pas noir : il capte le vert du sol en additif.

### Plaine
Shader custom sur une grille en éventail déplacée par `world/Terrain.ts`.

> **Écart assumé à la référence.** L'image source montre une plaine
> parfaitement plate à horizon rectiligne. Le relief a été demandé après coup :
> l'horizon ondule désormais. Tout le reste du traitement est conservé.

Trois termes ont été ajoutés pour rendre les collines **lisibles** — c'est de
la lisibilité de jeu, pas de la décoration : on ne peut pas timer un saut sur
une crête qu'on ne voit pas.

1. Versants **face à la caméra** plus clairs que les versants de dos. Le terme
   le plus efficace sur un relief doux. Ancré en espace monde, donc il ne pulse
   pas quand le joueur monte ou descend — un tint d'altitude relatif au joueur
   ferait respirer tout le paysage.
2. Teinte d'altitude absolue, discrète.
3. Ombrage directionnel franc, sur la normale réelle du terrain.

La longueur d'onde des collines jouables a été ramenée de 61 m à 42 m pour la
même raison : à 61 m la bosse était trop étalée pour se voir depuis une caméra
rasante.

- Gradient de valeur piloté par la distance : `--grass-horizon` → `--grass-near`.
  **Clair au loin, sombre au près.** (Règle n°1 du doc 00.)
- **Stries radiales** : bruit anisotrope étiré vers le point de fuite, pas un damier.
- Bandes de scroll pour lire la vitesse, faibles (alpha ≤ 0.08) — sinon ça fait tapis roulant.
- **Sheen spéculaire** : lobe large sur la normale du sol, blanc, qui produit un
  gonflement lumineux sur la bande d'horizon. C'est ça, la magie de la référence.
- Brins d'herbe instanciés uniquement dans les ~35 m devant la caméra, en cartes
  croisées, agités par un vent sinusoïdal. Ils meurent en fondu avant la limite pour
  éviter le pop.

### Nuages
Billboards. Pas de volumétrique — trop cher, et la référence a des nuages **plats et découpés**.
Texture procédurale (FBM seuillé) générée en canvas au boot, base plate, dôme bombé.

### Bulles
Sphères en `transmission: 1.0`, `thickness: 0.05`, plus une couche
**iridescence de film mince** (interférence dépendante de l'épaisseur et de l'angle).
Elles n'ont pas de couleur propre — uniquement une frange irisée sur le contour.

### Ville de cristal
Boîtes étirées, `transmission: 0.6`, teinte `--city-face`, écrasées par le fog.
Aucun détail de façade : à cette distance on ne lit que des silhouettes.

## 4. Post-processing (ordre imposé)

```
1. Bloom          seuil 0.80 · intensité 0.92 · rayon 0.72  → le gloss Aero
2. RadialBlur     centré au point de fuite, force ∝ vitesse  → la glisse
3. SpeedLines     stries radiales, alpha ∝ vitesse            → le vent
4. ChromaticAber  0.0006 au repos → 0.0035 en boost           → le punch
5. Vignette       0.28, douce                                  → recentre
6. SMAA                                                        → bords nets
```

Les points 2 à 5 sont fusionnés dans un seul effet (`fx/SurfEffect.ts`) :
les séparer coûterait quatre lectures de framebuffer pour rien.

Tone mapping : **Neutral** (Khronos PBR Neutral), exposure 1.0. Sortie sRGB.

> Le plan initial était ACES Filmic. Mesuré contre la référence, ACES
> désature violemment les cyans et les verts quasi hors-gamut et rend
> l'image **pastel** : `#8CFF84` sortait à `#39F05B`. Neutral préserve la
> saturation et ne comprime que le roll-off des hautes lumières.

**Seuil de bloom : 0.80, pas 0.62.** Les verts saturés de la plaine sont très
lumineux ; à 0.62 le bloom attrapait *tout le sol* et délavait l'image. On ne
fait briller que les vrais highlights — nuages, verre, disque, spray.

### Colonnes de vitesse — le seul accent chaud

Ambre (`#FFB842` → `#FFF0B8`), et c'est délibéré. Un additif **cyan** se noie
sur une plaine vert saturé : le vert est déjà proche de la saturation et
l'ajout ne fait que pâlir. L'ambre est la seule teinte qui tranche encore.

C'est aussi le seul accent chaud de la référence (1,6 % de l'image), donc le
budget du §5 est respecté : quelques colonnes fines, jamais plus de 2 % des
pixels.

### Matière de la plaine

Trois termes ajoutés pour sortir de l'aplat :

1. **Grandes taches de prairie** (60-160 m). Elles donnent de la matière sans
   ajouter un triangle, et survivent à la distance là où le micro-détail
   disparaît.
2. **Brume d'horizon**, qui sépare les plans lointains — sans elle, des collines
   à 300 m et à 900 m ont la même valeur et le relief s'aplatit.
3. **Soleil à trois lobes** (diffusion large, couronne, cœur cueilli par le
   bloom) plus une traînée horizontale discrète. Un seul lobe fait une tache
   collée au ciel.

> Piège rencontré : nommer une variable `meadow` et non `patch` — ce dernier est
> un **mot réservé en GLSL ES**. Sous ce nom le shader ne compilait pas et le
> sol disparaissait entièrement, laissant voir le dôme de ciel à travers.

### Anneaux de verre

Un tore de 5,4 m de rayon, plus un voile intérieur presque transparent qui ne
s'allume que sur son bord : le trou doit se **voir** de loin sans jamais masquer
le paysage qu'on traverse.

La teinte porte l'information de jeu : **cyan** au sol, **violet iridescent** en
hauteur. La couleur dit qu'il faut sauter avant même qu'on ait jugé la hauteur à
l'œil.

Le premier jet mélangeait la couleur vers un bleu profond avant l'éclairage. Les
anneaux sortaient **gris** sur la plaine verte, invisibles à trente mètres. Ils
sont désormais peints à des valeurs volontairement au-dessus de 1 — la cible est
un tampon demi-flottant, et c'est ce dépassement qui fait mordre le bloom.

Un reflet court le long du tore : fixe, il ferait plastique. Au passage, l'anneau
**gonfle** de 42 % en se dissolvant — l'expansion se lit en vision périphérique
bien mieux qu'un changement de couleur, et on garde les yeux sur la suite.

### Étalonnage à la vitesse

La passe de post pousse le contraste (+18 %) et la saturation (+12 %) avec la
vitesse et le boost. C'est ce qui fait que le boost **se voit** avant qu'on lise
la jauge. Très discret à l'arrêt, sinon la plaine devient criarde quand il ne se
passe rien.

## 5. Garde-fous

Avant de valider un rendu, vérifier les cinq règles du doc 00 :

- [ ] Le sol est-il plus clair à l'horizon qu'au premier plan ?
- [ ] Les stries convergent-elles au point de fuite ?
- [ ] La ligne d'horizon est-elle nette ?
- [ ] Existe-t-il un seul matériau mat à l'écran ? (si oui : bug)
- [ ] Le chaud dépasse-t-il 2 % des pixels ? (si oui : bug)

Et le test final : **plisser les yeux.** Il doit rester trois masses —
cyan en haut, vert en bas, un point bleu brillant au centre. Si le buddy
se perd dans le vert, augmenter le rim, pas la taille.
