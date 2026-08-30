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

## 6. La passe « références Frutiger Aero »

Deux références apportées en cours de route ont recadré toute la direction :
une scène aquatique à globe de verre, et une pelouse électrique sous un ciel
d'azur avec une skyline posée sur l'horizon. Elles disent toutes les deux la
même chose, et ce n'est pas une question de palette.

### Le ciel était plat

Il était cyan du zénith à l'horizon. Sans écart de valeur entre le haut et le
bas du cadre, un ciel ne fait aucune profondeur — et surtout, des nuages blancs
n'ont plus rien sur quoi se détacher.

Le dégradé a **quatre** étages désormais (azur profond → azur → cyan → blanc).
Trois suffisaient tant que tout restait cyan ; avec un écart aussi large, trois
arrêts laissaient une bande dure au milieu du cadre.

Et la bande blanche d'horizon est **resserrée** : étalée jusqu'à 10° d'élévation,
elle délavait le ciel à la hauteur exacte où vivent les cumulus. Des nuages
blancs sur un ciel blanc, il n'en restait qu'un contour. Elle ne tient plus que
les deux premiers degrés.

La montée vers l'azur profond est calée sur le **cadre**, pas sur la géométrie :
le haut de l'image plafonne vers 22° d'élévation, donc un zénith qui n'arrive
qu'au zénith ne se voit jamais.

### Le soleil n'était pas dans l'image

Il était à 46° d'élévation et 30° d'azimut. En portrait, le champ vertical fait
62° mais l'horizontal n'en fait que 37 — un soleil à 30° d'azimut ne peut
structurellement pas entrer dans le cadre. On n'en voyait qu'une lueur de coin.

À **13° d'azimut et 19° d'élévation** il brûle dans l'image, avec six branches
longues, six courtes décalées et une traînée anamorphique. Les branches sont
construites dans le plan tangent au soleil : calculées en espace écran, elles
tourneraient avec le roulis de la caméra.

Conséquence voulue : la plaine passe en **contre-jour**, les crêtes prennent un
liseré et les flancs se séparent enfin.

### Les nuages étaient du carton découpé

Un empilement de gaussiennes, un dégradé vertical en guise d'ombrage, silhouette
parfaitement ronde. Trois changements, dans l'ordre d'importance :

1. **L'ombrage vient d'une normale, pas d'une hauteur.** Le champ de densité est
   accumulé dans un tampon flottant, on en prend le gradient, et on éclaire ce
   faux relief avec la vraie direction du soleil. Chaque lobe récupère sa joue
   claire et son creux sombre — du volume sans une ligne de rendu volumétrique.
   La lumière est orientée **vers l'observateur** : rasante, elle donnait un
   `ndl` de 0,31 sur tout le plat, donc des cumulus gris de bout en bout.
2. **Le noyau de densité déborde de 80 % du rayon nominal.** Coupé net au rayon,
   chaque lobe restait une bulle isolée : l'atlas rendait un chapelet de bulles.
   Deux lobes ne fusionnent que si leurs queues se recouvrent largement.
3. **Un liseré argenté** là où le nuage est mince, plus fort du côté du soleil.
   Sur une fenêtre étroite : allumé sur tout le pourtour, l'ensemble virait au
   dessin au néon.

Trois plans au lieu d'un : un banc massif sur l'horizon (30 % des nuages, pas
50 — à moitié ils formaient un mur qui bouchait la ville), une couche médiane,
quelques nuages proches et hauts qui donnent la vitesse.

### La plaine était plate

Les pentes du terrain plafonnent vers 11° : la normale ne s'écarte presque
jamais de la verticale, et un ombrage qui n'en dépend que rend une plaine plate
quoi qu'on fasse. C'est la **hauteur** qui varie — treize mètres d'un creux à
une crête. Lue sur une plage serrée (±6 m), elle colore chaque vallon et le
relief se lit d'un coup d'œil, comme sur une carte ombrée. C'est le terme le
plus rentable de tout le shader.

La normale est aussi **recalculée par pixel** depuis le terrain analytique. La
normale de sommet interpolée laissait des bandes horizontales franches : la
grille est en éventail, ses rangées lointaines font des dizaines de mètres de
profondeur, et interpoler une normale sur un triangle aussi grand casse à
chaque rangée.

S'y ajoutent de grandes **nappes de lumière** basse fréquence (150 à 400 m) et
des **bandes de tonte** de 28 m. La dose est asymétrique : on assombrit plus
qu'on n'éclaircit, parce qu'éclaircir délave le vert électrique qui fait
l'identité du jeu.

### L'horizon n'existait pas

La plaine s'arrêtait net et les tours poussaient dans l'herbe : une découpe de
papier. Une **ligne d'arbres** donne au regard un palier entre le vert du sol et
le verre du fond — c'est la seule chose qui sépare la pelouse de la référence de
son horizon.

Un plan, une silhouette découpée au bruit dans le fragment. Deux détails l'ont
rendue visible : elle **écrit la profondeur** (sans quoi le banc de nuages situé
un kilomètre plus loin se peignait par-dessus), et elle est plantée à 700 m et
non au pied de la ville — le relief culmine à 13 m et dépasse la ligne d'œil, il
faut s'en dégager franchement pour exister.

La ville, elle, est revenue de 1700 m à **1150 m** : au-delà de 1600 elle passait
derrière le banc de nuages et disparaissait. Une promesse qu'on ne voit jamais
n'est pas une promesse.

## 7. La passe « retours de jeu »

Quatre remarques du joueur, quatre problèmes réels.

### « On ne voit pas la ville »

Trois causes cumulées, corrigées ensemble : le banc de nuages d'horizon était
posé **sur** la ligne (il est monté à 240-400 m, sa base passe désormais
au-dessus des tours), la brume écrasait la skyline à 36 % (ramenée à 20 %), et
les tours étaient trop courtes pour lire à un kilomètre. Elles sont plus hautes
et plus fines — c'est la **verticalité** qui fait lire une skyline, pas le
nombre de boîtes — et une face sur deux prend maintenant le soleil, sans quoi
une tour de verre n'est qu'un rectangle uniforme.

Distance ramenée de 1150 à **980 m**.

### « Trop de nuages »

44 au lieu de 72 en qualité haute, et le banc d'horizon ne représente plus que
22 % de l'effectif au lieu de 30.

### « Le motif vertical dans l'herbe est bizarre »

Il l'était. Les stries étaient un bruit **écrasé 70×** le long de Z : des traits
interminables dans l'axe de la course, qui en perspective se lisaient comme des
rayures verticales collées à l'écran. Un motif de fond d'écran, pas une prairie.

Remplacé par deux octaves aux **mêmes fréquences en x et en z** : les taches
sont rondes, elles défilent avec le sol au lieu de glisser dessus, et rien n'a
plus de direction privilégiée. Les bandes de tonte, elles aussi alignées sur x,
ont été tournées **en travers** de la course — elles servent au passage de
lecture de vitesse.

### « Mauvaise teinte de vert : chartreuse, pas radioactif »

La rampe tirait vers l'émeraude — teinte 140 à 150°, un vert **bleuté** très
saturé. La chartreuse est jaune-vert, teinte 80 à 95°. Le jaune dans le vert est
ce qui donne la lumière du soleil dans l'herbe ; sans lui, une plaine reste
froide quelle que soit la saturation qu'on y met.

Premier essai raté dans l'autre sens : trop sombre. Chartreuse veut dire
jaune-vert **lumineux**, et une rampe basse combinée aux multiplicateurs
d'ombrage rendait un kaki militaire. Valeurs remontées d'environ 25 % en clarté,
coefficients d'ombrage resserrés en conséquence.

| | Avant (émeraude) | Après (chartreuse) |
|---|---|---|
| ombre | `#12a84e` | `#519222` |
| proche | `#14d955` | `#76c22e` |
| médian | `#48fd76` | `#9ed93e` |
| lointain | `#75fc85` | `#bdea58` |
| horizon | `#8cff84` | `#d8f286` |

Le rebond hémisphérique et les particules d'herbe lisent la même palette : la
teinte du buddy et de la gerbe a suivi toute seule.

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
