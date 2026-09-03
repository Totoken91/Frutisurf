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

## 8. La matière de l'herbe

Jusqu'ici la plaine n'avait que du bruit fractal : des taches, pas des brins. À
trois mètres de la caméra on voyait un aplat coloré, et c'est ce qui trahissait
le plus le rendu — **une prairie se reconnaît à son grain bien avant sa
couleur**.

### La texture, générée au boot

Une tuile de 512 px, dessinée au trait : quelques milliers de brins courbes,
effilés, d'orientation **libre** (un biais directionnel réapparaît à l'écran
sous forme de rayures dès que la caméra rase le sol — le défaut précédent du
projet). Tout trait proche d'un bord est redessiné de l'autre côté, sinon une
couture apparaît tous les mètres.

Quatre canaux :

| | Contenu | Usage |
|---|---|---|
| R, G | normale du micro-relief | **le canal qui compte** |
| B | variation d'albédo | touffes claires, creux sombres |
| A | couverture de brins | masque du spéculaire |

La normale fait tout. Avec un soleil bas et de face, ce sont les milliers de
micro-facettes qui accrochent la lumière ; aucune quantité de bruit sur la
*couleur* ne fera de l'herbe. Elle est aussi la chose la plus facile à trop
doser : au premier essai le sol lisait comme du **cuir craquelé**. Le
micro-relief doit accrocher la lumière, pas sculpter le sol.

Deux échantillons de la même tuile, à 1 m et à 7,7 m de période : un seul et
l'œil voit la grille au bout de trois secondes. Le grand ne porte que la
couleur — lui donner du relief sculptait des plaques de dix mètres et ramenait
le crépi.

Les deux échelles multipliées par 1000 donnent des entiers. Ce n'est pas un
hasard : le sol replie sa coordonnée Z modulo 1000 m, et une période de tuile
qui n'y tient pas un nombre entier de fois y ferait une couture franche en
travers de la plaine.

Ce bloc **remplace** deux appels de bruit fractal : plus juste *et* moins cher.
Une texture avec mipmaps se filtre toute seule là où un bruit procédural se met
à scintiller dès que le motif passe sous le pixel.

### Les touffes, en géométrie

Une texture reste plate : au premier plan on voit une image d'herbe collée sur
un plan. Ce qui fait la différence, c'est la **silhouette** — des brins qui
dépassent, qui coupent l'horizon local, qui bougent indépendamment du sol.

Dispersion par **cellule monde**. Chaque instance porte un indice de grille ; le
shader en déduit la cellule monde à partir de la position du joueur, la hache
pour en tirer une place, une orientation et une hauteur. Les touffes ne suivent
donc pas le joueur : elles restent où elles sont, et c'est l'ensemble des
cellules visitées qui glisse. Des décalages fixes dans un carré qu'on déplace
donneraient une prairie qui rame avec la caméra — défaut immédiatement visible
et impossible à ignorer une fois qu'on l'a vu.

Trois réglages trouvés en regardant :

- les quatre brins d'une touffe ne partent **pas du même point**. Groupés, une
  instance faisait un buisson isolé et la prairie ressemblait à un champ
  d'ailerons de requin ; dispersés, la même dépense couvre quatre fois plus de sol ;
- la hauteur a été **divisée par deux** (11 à 22 cm). À 25-46 cm chaque touffe
  lisait comme un arbuste planté dans une pelouse tondue. Un brin sur huit
  dépasse quand même : une hauteur uniforme donne un tapis, pas une prairie ;
- le brin n'est **jamais plus sombre que le sol**. Basé sur le vert d'ombre, le
  champ se lisait comme un semis de piquants sombres au lieu d'une matière
  continue.

Rayon volontairement court, une douzaine de mètres : au-delà le brin passe sous
le pixel et ne fait plus que du bruit, alors que la même dépense concentrée près
du joueur double la densité perçue. Le fondu s'étale sur la moitié du rayon —
coupé court, la limite se lit comme un cercle tracé autour du joueur.

Pas de transparence : la hauteur tombe à zéro aux bords. Un fondu en alpha
imposerait un tri par profondeur pour quelques milliers d'instances, et
laisserait un anneau franc là où le seuil coupe.

Le champ existe **aussi sur téléphone**, avec un rayon réduit. Il avait d'abord
été coupé là par prudence, mais c'était une erreur de diagnostic : le poste
coûteux sur mobile était la transmission du verre — un rendu de scène complet
par image — pas la géométrie. Vingt-cinq mille triangles à shader trivial ne
coûtent rien, et sans eux le premier plan redevient l'aplat vert que le jeu
vient justement de quitter.

## 9. L'atmosphère

Cinq additions, choisies pour ce qu'elles apportent et non pour ce qu'elles
coûtent.

### Les ombres de nuages

**Le détail qui donne son échelle à un paysage ouvert.** Une plaine uniformément
éclairée n'a pas de taille : on ne sait pas si elle fait cent mètres ou dix
kilomètres. Des plages d'ombre de deux cents mètres qui la traversent lentement
répondent à la question sans un mot.

Leur contour est **franc**. Étalé, il se confond avec une variation d'albédo et
ne se lit plus comme une ombre. Et elles ne s'atténuent **pas** avec la distance
— c'est justement au loin qu'elles font leur travail.

Ce qui reste à l'ombre n'est pas du gris : c'est la lumière du **ciel**, donc du
bleu. Une ombre qui se contente d'assombrir est le signe le plus sûr d'un rendu
qui triche.

Le sol et les touffes lisent la **même fonction au même endroit** (`Weather.ts`).
Sans ça, les brins resteraient en plein soleil dans une plage d'ombre et le
décor se dissocierait en deux couches.

### L'ombre portée du surfeur

Analytique : une ellipse molle centrée sur la projection du disque **le long des
rayons du soleil**. Une ombre posée à la verticale trahirait immédiatement
l'absence de calcul d'éclairage — c'est le décalage qui la rend crédible, et
c'est aussi lui qui dit au joueur à quelle hauteur il vole. Elle s'élargit et
pâlit avec l'altitude.

Une carte d'ombre pour un seul objet coûterait une passe entière et un tampon de
plus, pour un résultat qu'une distance au centre décrit exactement.

### Les rafales

Un vent constant se lit comme une inclinaison figée. C'est la **vague** qui
traverse le champ qu'on lit comme du vent — elle donne son épaisseur à l'air.

### Les rais de lumière, essayés puis retirés

Un flou radial depuis le soleil qui n'accumulait que ce qui dépassait un seuil,
de sorte que les crêtes et les nuages découpaient les rais tout seuls. Trois
réglages successifs ont corrigé un ciel entièrement blanchi (seuil trop bas),
des rais alimentés par des anneaux cyan saturés (seuil par canal au lieu de la
luminance), puis douze copies fantômes du personnage en escalier dans le ciel
(échantillons régulièrement espacés, réglés par un bruit de gradient entrelacé).

Techniquement correct, et **retiré quand même** : le flou est radial depuis le
soleil, donc il étire la lumière de *tout* ce qui dépasse le seuil, y compris
les objets proches. Un anneau ou une colonne de vitesse au premier plan se
mettait à traîner une comète dirigée vers un point de l'écran sans rapport avec
lui. Un rai est censé venir d'**une source lointaine** ; appliqué uniformément,
l'effet dit le contraire et l'œil le refuse immédiatement.

Ce qui reste : la couronne du soleil est dans le dôme de ciel lui-même, où elle
n'a besoin d'aucune passe de post-traitement pour être à sa place.

### Le pollen

Quelques centaines de grains qui dérivent, presque invisibles de dos et lumineux
face au soleil. Le détail le moins cher et le plus rentable du projet : il donne
au vide entre la caméra et l'horizon une **matière**. Sans lui, l'air d'un jeu
est parfaitement transparent, ce qui n'arrive jamais dehors un jour de soleil.

C'est le *contraste* entre les grains face au soleil et ceux qui lui tournent le
dos qui fait la profondeur ; un pollen d'intensité uniforme n'est qu'un semis de
points blancs.

## 10 bis. La grève

L'herbe s'arrêtait net sur la ligne de flottaison. Une découpe à la courbe de
niveau, parfaitement régulière — un liseré peint, pas une côte.

### Perturber la hauteur, pas adoucir le seuil

Ce qui fait une grève naturelle, c'est qu'elle n'a **pas** de largeur constante :
elle s'étale dans les creux, se pince sur les pointes, et sa limite haute est
déchiquetée par les langues de sable qui remontent dans l'herbe.

On obtient tout ça en perturbant la **hauteur** avant de la seuiller, plutôt
qu'en adoucissant le seuil. Adoucir donne un dégradé régulier ; perturber donne
une côte. Trois échelles de bruit s'y superposent — les anses (0,055), les
langues (0,17), la dentelure fine (0,62) — et une quatrième, très basse (0,010),
fait varier la largeur elle-même sur des centaines de mètres.

> La largeur est une **hauteur**, pas une distance au sol. Sur une pente douce
> elle donne une plage large, sur une pente raide un simple ourlet — exactement
> le comportement d'une vraie côte, gratuitement.

### Le sable doit être sombre

Un sable clair est un réflexe de peintre, pas de moteur. Dans un pipeline
linéaire avec bloom, un beige à 240/255 sature immédiatement et toute la grève
part en blanc — c'est ce qu'a donné le premier essai, à `0xf2e2b4`.

Le sable se tient à la **même luminance que l'herbe voisine** et ne s'en
distingue que par sa **teinte**. C'est le seul moyen d'obtenir du chaud sans
obtenir du blanc.

De même, le sable mouillé n'est pas du sable sec assombri : il est plus **saturé
et plus froid**, parce que le film d'eau lui renvoie le ciel. Un simple
assombrissement donne de la boue.

### Le grain se joue sur trois échelles, et c'est la plus large qui compte

Les deux fréquences fines ne survivent qu'au premier plan : au-delà elles
passent sous le pixel, s'y moyennent, et la grève redevient un aplat. Une
variation **large** — des plaques de sable plus clair et plus sombre sur une
dizaine de mètres — reste lisible à toute distance.

S'y ajoutent la **laisse de mer** (les lignes que l'eau laisse en se retirant,
qui suivent la ligne de flottaison donc la hauteur), de rares éclats de
coquillage, et une frange d'écume sèche tout en bas.

Le fond du lac est **du sable, pas de l'herbe noyée** : il vire au turquoise en
profondeur mais garde son grain, ce qui rend les hauts-fonds lisibles à travers
la surface.

### Les touffes lisent le MÊME masque

`GrassBlades` recalcule la grève avec les mêmes bruits, les mêmes fréquences et
la même largeur variable. Une touffe verte plantée au milieu du sable trahirait
immédiatement que les deux couches ne se parlent pas. Quelques oyats survivent
en haut de plage : une coupure nette est moins crédible qu'une frange
clairsemée.

### `patch` est un mot réservé

Troisième fois que ce piège coûte une session, après `cast` et `shade`. Un
maillage dont le shader ne compile pas **disparaît sans un mot**.

Quatrième depuis : **`flat`**, qui est un qualificateur d'interpolation en
GLSL ES 3.0. La liste noire du projet est donc `cast`, `shade`, `patch`,
`flat` — et la vraie leçon n'est pas d'apprendre la liste, c'est que
`check:shaders` existe précisément parce qu'on ne l'apprendra jamais.

## 10. L'eau

### Un niveau, pas des lacs

Il n'y a pas de lac dans le projet. Il y a `WATER_LEVEL = -5.5` et un plan
parfaitement plat, découpé au `discard` partout où le terrain repasse au-dessus.
Les rives sont donc les **courbes de niveau** du relief : organiques, toutes
différentes, et exactes — parce que la même constante sert au CPU et au GPU. Une
étendue d'eau dessinée à la main aurait coûté un éditeur, une sérialisation et
un risque de désaccord entre ce qu'on voit et ce sur quoi on glisse.

La géométrie est la **même grille en éventail** que le sol : dense sous le nez de
la caméra, lâche au loin, ancrée au joueur par les mêmes pas entiers de maille.

### Ce qui fait qu'une surface est de l'eau

Une nappe turquoise posée sur l'herbe reste du plastique. Quatre termes, dans
l'ordre où ils comptent :

1. **Les paillettes.** Le terme décisif, et il doit être **dur** :
   `pow(N·H, 340) × 5`. Un spéculaire large donne du satin ; c'est une multitude
   de points nets qui donne du liquide au soleil.
2. **Le Fresnel.** Le ciel se réfléchit à l'incidence rasante. Sans lui, une
   étendue vue de loin n'est qu'une tache bleue.
3. **La profondeur.** Turquoise clair sur les hauts-fonds, ardoise au large, et
   une opacité qui suit : c'est ce dégradé qui fait exister le **volume** sous
   la surface.
4. **Les rides**, deux couches de fbm qui dérivent en **sens contraire**. Une
   seule couche donne un motif qui glisse en bloc, et l'œil lit tout de suite
   une texture qu'on translate.

L'écume de rive suit la ligne de flottaison, donc encore la courbe de niveau :
gratuite et toujours juste.

### Le sillage

Deux branches en V ouvertes à ~20°, plus le remous central. Il **bombe** la
normale en plus de blanchir la couleur : une traînée blanche sans relief est
peinte sur l'eau, elle ne la déplace pas.

Il est mélangé **avant** les paillettes. Posé après, il les effaçait, et le
sillage devenait une bande mate au milieu d'une surface qui scintille partout
ailleurs — exactement l'inverse de l'effet voulu.

### Le défaut le plus voyant du projet, corrigé au passage

Les particules de gerbe n'avaient **aucun masque** : chaque particule était le
quad lui-même. Sur des brins d'herbe verts, personne ne l'avait vu ; en écume
presque blanche et en mélange additif, la gerbe est devenue une pluie de
**carrés nets**. Une ellipse inscrite dans le quad, à bord adouci, règle les
deux cas d'un coup. L'écume est en outre volontairement rentrée (α ×0,55) : un
blanc en additif sature immédiatement et se met à bloomer en pavé.

Les particules gardent leur nature **au spawn**, dans un attribut par instance.
En uniforme global, les brins verts encore en vol viraient au blanc à l'instant
où l'on touchait l'eau, et l'écume redevenait verte en touchant la rive.

### Deux pièges GLSL, encore

Le sol a cessé de se dessiner **entièrement** pendant trois captures, et ce
qu'on voyait à sa place — le dôme de ciel — donnait une image délavée qu'on
pouvait prendre pour un problème de post-traitement.

- `shade` était **déjà déclaré** quarante lignes plus haut, dans la même portée ;
- `cast` est un **mot réservé** en GLSL ES, comme `patch` avant lui.

Deux erreurs de compilation, aucun symptôme lisible : un maillage qui ne
compile pas disparaît, c'est tout. D'où `npm run check:shaders`, qui charge le
jeu en profil bureau **et** téléphone et échoue si la console porte la moindre
erreur GLSL. Et `npm run shot` remonte désormais ces erreurs en premier et en
clair, au lieu de les noyer dans la liste des 404.

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


## 11. L'interface : Aqua peint, pas glassmorphism

Le réflexe moderne pour « interface en verre » est le `backdrop-filter`. C'est
un contresens sur deux plans.

**Historique** : l'Aqua de 2004-2008 ne floutait rien — il n'en avait pas les
moyens. Il **peignait** une réflexion. C'est pour ça que ces interfaces ont
une signature aussi reconnaissable : ce ne sont pas des surfaces translucides,
ce sont des objets en verre **plein**, éclairés.

**Technique** : `backdrop-filter` relève et refloute la scène à chaque image.
Au-dessus d'un canvas WebGL plein écran, sur un téléphone faible, c'est la
chose la plus chère qu'on puisse poser. Un dégradé peint coûte un remplissage,
une fois, sur une couche déjà promue.

L'époque avait raison pour la mauvaise raison, et le résultat est à la fois
plus juste et gratuit.

### Les quatre couches, dans cet ordre

| # | Couche | Rôle | Le piège |
|---|---|---|---|
| 1 | **Biseau chromé** | clair en haut → ardoise → **une dernière ligne claire tout en bas** | sans la lèvre du bas, l'objet n'a pas d'épaisseur |
| 2 | **Corps** | dégradé avec une **coupure nette vers 47 %** | un fondu continu donne du plastique ; la cassure donne du verre |
| 3 | **Cap spéculaire** | blanc à bord **franc** sur la moitié haute, avec sa propre courbure basse | un fondu jusqu'en bas tue l'effet |
| 4 | **Rebond** | lueur diffuse contre le bord inférieur **intérieur** | sans elle, le volume est creux |

La couche 2 est celle que tout le monde rate. **La coupure nette est l'Aqua.**

### Ce qui n'est pas dans le pod

Le score n'a **pas** de pod. Trois pastilles vitrées feraient trois centres et
l'œil ne saurait plus lequel surveiller. Mais du texte nu à côté de deux
volumes en verre a l'air d'un oubli. La réponse est un **rail** — une ligne
chromée sous le nombre, avec une pastille lumineuse au bout : ça le rattache à
la famille de matériaux sans lui donner le même poids.

### Le glow critique a cinq couches

Un `box-shadow: 0 0 40px` est un placeholder, pas un glow. Sous 4 secondes, le
chrono empile : **cœur chaud** blanc (1 px), **corps** ambre (7 px), **halo**
décalé vers le rouge (20 px), **bloom additif** en `mix-blend-mode: screen`, et
**deux respirations de périodes incommensurables** — 0,62 s pour la pulsation,
1,13 s pour le bloom — pour que l'œil n'y trouve jamais de boucle.

### Détails qui ne se voient que quand ils manquent

- **Chiffres tabulaires** partout (`font-variant-numeric: tabular-nums`). Sans
  ça, la vitesse fait danser tout le pod à chaque changement de chiffre, et
  l'œil suit le tremblement au lieu du nombre.
- **Ombres portées colorées**, jamais grises. Une ombre neutre sous une
  interface en plein jour est la signature la plus visible d'un rendu qui n'a
  pas été regardé.
- **Les rayures de la jauge ne défilent que pendant la dépense.** Une animation
  permanente dans le coin de l'œil devient du bruit, et on cesse de la voir
  bouger précisément quand elle a quelque chose à dire.
- **Révélation en deux temps** sur les bannières : un éclair d'anticipation qui
  s'ouvre, puis le texte qui s'installe. Une apparition instantanée n'a pas de
  poids.
- **Bande haute uniquement.** Le bas de l'écran est à la fois la zone du pouce
  et le champ de jeu : deux raisons indépendantes de n'y rien mettre.

`npm run shot:ui` capture les **sept états** — course, multiplicateur, boost,
chrono critique, deux bannières, fin de partie. Une interface passe l'essentiel
de son temps dans des états qu'une capture ordinaire ne montre jamais, et ce
sont ceux qui portent le plus de matière.

## 12. Le cycle jour/nuit

`src/world/Daylight.ts` est à la lumière ce que `Terrain.ts` est au relief :
**la** source, et la seule. Tout ce qui a une couleur la tient d'ici — dôme de
ciel, sol, eau, brins, nuages, ville, palmiers, éoliennes, pollen, et les deux
lampes de la scène. Rien n'est plus destructeur pour une ambiance qu'une couche
qui n'a pas reçu le mémo : la nuit tombe sur le ciel pendant que l'herbe reste
en plein midi.

**Trois minutes** pour un tour complet, et **le cycle ne se remet pas à zéro
entre deux parties**. Une course de quarante secondes en traverse donc un gros
cinquième : on part en fin de matinée, on finit au soleil rasant. Remettre
l'heure à zéro à chaque relance aurait figé le jeu sur une seule lumière, celle
du départ, et tout ce travail n'aurait servi qu'aux captures.

Quatre palettes clés, interpolées en `smoothstep` — une interpolation linéaire
fait un **coude visible** au passage de chaque clé, et l'œil accroche dessus :

| Moment | Zénith | Horizon | Ce qu'il apporte |
|---|---|---|---|
| Aube | `#1e4a8c` froid | `#ffd3a0` chaud | Le **grand écart vertical**. C'est lui qui fait un lever de soleil, pas l'orange. |
| Midi | `#0d6fe0` | `#c6ecfa` | La palette Frutiger Aero d'origine, celle de la référence. |
| Crépuscule | `#24306e` violet | `#ffb072` braise | L'inverse de l'aube, et le contraste le plus fort des quatre. |
| Nuit | `#081436` | `#3b6094` | Bleu de minuit, **jamais noir** — un jeu de vitesse qui s'éteint devient injouable. |

Ce n'est pas une diffusion atmosphérique : le rendu physique donne des ciels
justes et **ternes**, alors qu'on cherche des ciels de carte postale.

**L'azimut du soleil reste presque fixe**, et c'est une décision de mise en
scène, pas une approximation. En portrait le champ horizontal ne fait que 37° :
un soleil qui traverserait vraiment le ciel d'est en ouest passerait
l'essentiel de la journée hors cadre, et tout le travail sur les rasants ne se
verrait jamais. C'est son **élévation** qui raconte l'heure, avec une courbe
aplatie près de l'horizon (puissance 0,7 sur le sinus) pour que le soleil y
**traîne** au lieu de le franchir en trois secondes.

`daylight(couleur, ombre)` fait le reste, et son intérêt tient en une ligne :
**la lumière directe se colore pendant que l'ombre prend le ciel**. C'est la
seule façon d'obtenir une nuit qui ne soit pas du jour assombri — à minuit la
directe est faible et bleutée, mais le remplissage du ciel devient
proportionnellement dominant, et c'est lui qui donne la clarté laiteuse des
nuits dégagées. Un `c *= 0.3` nocturne donnerait une image sale.

`npm run shot` sur `scripts/daylight-shot.mjs` capture **sept heures** côte à
côte : un cycle ne se juge pas sur une capture, il se juge sur la **cohérence
entre les couches** à chaque instant.

## 13. Palmiers et éoliennes

Deux ajouts, deux problèmes différents.

**Les palmiers** doivent pousser exactement où le sol dessine du sable — pas à
peu près. Or le masque de plage vit en GLSL et repose sur des bruits fractals
que la version TypeScript de `fbm2D` ne reproduit **pas** à l'identique : ce
sont deux implémentations différentes. Placer les palmiers depuis le CPU, même
avec le même algorithme apparent, donnerait une dérive. Ils sont donc placés
**dans le vertex shader**, avec `shoreMask()` — le chunk partagé — et un
palmier hors grève est replié sur un point dégénéré : il ne coûte alors plus un
seul fragment, et il ne peut structurellement pas apparaître au mauvais endroit.

Le pli des palmes est ce qui fait la palme : un quad plat lit comme une pale de
ventilateur, quelle que soit la texture. Et la rafale est un **dégradé** le long
de la feuille — une palme rigide qui pivote lit comme un essuie-glace.

**Les éoliennes** sont l'élément le plus littéralement Frutiger Aero qui soit :
l'esthétique entière est bâtie sur l'imagerie de la technologie propre du milieu
des années 2000. Elles vivent **loin** — 620 m, devant la ville. Posées près du
joueur elles deviendraient des obstacles visuels qui balaient l'écran ; au loin
elles ne font que ce qu'on leur demande, donner une **échelle** au paysage et un
mouvement lent qui contredit la vitesse du premier plan. À 150 km/h, une chose
qui tourne lentement au fond du cadre rend la course plus rapide, pas moins.

Leur **phase** diffère par instance. Sans décalage, quatorze éoliennes tournent
au même instant dans la même position — ce qui ne s'observe jamais dans la
nature et se remarque immédiatement : le paysage se met à battre.

## 14. L'écran d'équipement

Même grammaire Aqua que le HUD : biseau chromé, corps à **coupure nette**, cap
spéculaire à bord franc, rebond. Aucun `backdrop-filter`, ici non plus.

Deux partis pris propres à cet écran :

**Le paysage reste vivant derrière, mais le jeu s'arrête.** La distinction a
coûté une correction. Le premier jet laissait tout tourner sauf le chrono, au
motif qu'un fond figé derrière une interface donne l'impression d'un menu
**collé par-dessus** un jeu. C'était vrai et c'était quand même faux : le
surfeur filait à trente mètres par seconde pendant qu'on lisait les libellés,
et au premier lancement on avait traversé un kilomètre de plaine avant d'avoir
choisi. **Le jeu se jouait tout seul.**

Ce qui devait vivre, ce n'était pas la course, c'était le paysage. Le cycle
jour/nuit tourne toujours, les nuages passent, la pluie tombe, les vagues
roulent, et le monde survolé se fond sous les yeux du joueur — c'est même la
seule raison d'être de cet écran. Mais le surfeur attend, et rien ne se marque.

**On peut annuler.** Le panneau n'avait qu'une issue, « c'est parti », qui
relance la partie : l'ouvrir par curiosité au milieu d'une course coûtait la
course. Une croix en haut à droite, et Échap, remettent le monde survolé à sa
place et rendent la main là où on l'avait laissée.

**La carte au repos est un creux, pas une plaque.** Un puits sombre dans le
panneau, comme un logement vide ; la sélection le **remplit**. C'est la même
logique que la jauge de boost — un trou, puis de la matière dedans — et c'est
ce qui rend l'état choisi lisible sans avoir besoin d'une bordure.

Les emblèmes sont dessinés **en CSS**, pas en images : nets à toute densité de
pixels, et rien ajouté au chargement. Trois silhouettes différentes pour les
montures — un disque irisé, un disque noir, une cartouche carrée — parce qu'à
38 pixels c'est la silhouette qui distingue, jamais la texture.

Les trois livrées de buddy tiennent une règle commune : **le bas est clair, le
haut plus dense**. L'inverse donne un personnage qui a l'air posé la tête en
bas, parce que la lumière du monde vient d'en haut. GIVRE a dû descendre son
haut à `#3f7fc4` : un verre presque blanc sature dans le bloom et **perd sa
silhouette** au lieu de gagner en clarté.

## 15. Les cinq mondes

Un monde n'est pas une scène chargée à la place d'une autre : c'est un **jeu de
paramètres** appliqué à la seule et même scène — cinq amplitudes de relief, un
niveau d'eau, une largeur de grève, vingt et une couleurs, quatre densités de
décor et quatre palettes de ciel. Rien n'est détruit, rien n'est reconstruit,
aucun shader n'est recompilé.

Ce n'est pas une économie. C'est ce qui permet de **fondre** d'un monde à
l'autre : la plaine s'inonde et devient l'archipel sous les yeux du joueur
pendant qu'il lit l'écran de sélection. Un monde chargé à la place d'un autre
n'aurait jamais pu faire ça.

### Le ciel EST le monde

Chaque monde a ses **quatre keyframes**, pas seulement ses couleurs de sol. Une
palette de terrain sous un ciel partagé donne quatre variantes du même endroit ;
c'est le ciel qui décide de quel endroit il s'agit.

| Monde | Signature du ciel |
|---|---|
| **PLAINE** | la référence Frutiger Aero : azur profond au zénith, blanchi à l'horizon. |
| **OKINAWA** | la même course du soleil, mais l'air d'un lagon — plus de blanc à l'horizon, un midi **surpuissant**. Sous les tropiques ce qu'on lit d'une photo n'est pas la couleur du ciel, c'est **l'écrasement des ombres**. |
| **BLISS** | le plus **saturé** et le plus contrasté verticalement : un bleu presque violet qui tombe sur un blanc franc, **sans passer par du cyan**. Le cyan est partout ailleurs dans ce jeu ; ici il est volontairement absent, et c'est ce qui rend le monde reconnaissable en une image. |
| **CHROME** | le seul qui ne connaisse **pas le plein jour**. Son « midi » est un crépuscule violet, et c'est délibéré : toute l'imagerie Y2K — visualiseurs de lecteur multimédia, écrans de veille en fil de fer, chrome liquide — repose sur des **néons**, et un néon a besoin de nuit. Un Chrome en plein soleil serait juste une plaine violette. |
| **OCTOBRE** | le seul **couvert**. Sa lumière ne vient jamais d'un point, elle vient de tout le ciel à la fois — et une lumière sans direction est une lumière **sans heure**. On ne sait plus s'il est onze heures du matin ou cinq heures du soir, et c'est exactement la sensation d'un jour de pluie. Voir §17. |

### Ce que chaque monde change de sa palette

**OKINAWA.** Le sable des Ryukyu est un sable **corallien** : presque blanc, très
légèrement rose. Il monte donc nettement plus haut que celui de la plaine, qui
est calé sur la luminance de l'herbe. La végétation d'île est plus **sombre** et
plus bleue que la prairie — ce sont des feuillages épais, pas de l'herbe rase.

**BLISS.** Le vert n'est pas le chartreuse de la plaine : plus franc, plus dense,
tirant au bleu dans l'ombre. De l'herbe grasse de printemps. Et les cumulus les
plus blancs et les plus contrastés du jeu, parce qu'ici ils sont le **seul
sujet** — il n'y a rien d'autre à regarder.

**CHROME.** Le sol n'est plus de l'herbe mais une dalle sombre, et la grille
lumineuse par-dessus fait tout le travail. L'eau devient du mercure : presque
noire en profondeur, violet électrique en surface.

### La grille Y2K

Deux mailles — 4 m et 20 m — et surtout **aucun appel à `fwidth`**.
L'anti-aliasing par dérivées est l'outil évident pour une grille, mais il repose
sur une extension dont la disponibilité dépend du profil GLSL, et ce projet a
déjà perdu assez de temps sur des shaders qui échouent en silence. La largeur du
fil est calculée depuis la **distance** : même travail, réglable à la main, et
qui marche partout.

L'extinction au loin n'est pas cosmétique. Une grille qui ne s'atténue pas moire
dès la ligne d'horizon, et une grille qui moire lit comme un bug — jamais comme
une texture.

La dalle est **assombrie de 58 %** avant que le néon s'y pose : un néon ne se
voit que sur du sombre, et la couleur du monde n'y suffit pas. C'est le
**contraste** qui fait le néon.

### Ce qui suit l'horizon doit relire l'horizon

La brume de la ville et de la ligne d'arbres était une couleur de palette fixe.
Sous le ciel magenta de Chrome, la forêt virait **turquoise** — une bande d'un
autre monde posée au milieu de celui-ci. Elle relit désormais l'horizon du cycle,
exactement comme le reflet de l'eau. Règle générale : **tout ce qui se dissout
dans l'horizon doit lire l'horizon courant**, jamais une constante.

### Les décors ne s'éteignent pas, ils s'en vont

Chaque densité de décor a sa propre façon de disparaître, et aucune n'est un
fondu d'opacité générique :

- les **palmiers** déciment le semis — le seuil de tirage monte, les individus
  les moins bien placés partent. Un palmier à moitié transparent est un bug, un
  bosquet plus clair est un paysage ;
- l'**herbe** rentre dans le sol : sa hauteur tombe. Un champ qui pâlit est un
  calque qu'on éteint, un champ qui se couche est une saison qui change ;
- la **ligne d'arbres** s'abaisse, pour la même raison ;
- seules les **tours** et les **éoliennes** se dissolvent vraiment — elles sont
  déjà à moitié dans le ciel, la brume fait le reste.

## 16. La lampe, l'aura, et deux fautes de composition

### Une source s'ajoute APRÈS l'éclairage, jamais avant

Le personnage projette une **lampe** au sol : une flaque de sa couleur qui
voyage avec lui, sur l'herbe, le sable, l'eau et les palmiers. Sans elle, un
buddy vert reste un autocollant fluorescent — c'est la flaque qui fait la
lumière, pas le verre.

Elle est passée à la main en trois uniformes, pas en `PointLight` : le sol, les
brins, l'eau et les palmiers sont des `ShaderMaterial` écrits à la main qui
n'utilisent **pas** le système d'éclairage de three, et le seul matériau qui
l'utilise est le verre du buddy. Une lampe ponctuelle aurait donc éclairé
exactement l'objet qui brille déjà.

Le premier jet l'ajoutait **avant** `daylight()`. La nuit la multipliait alors
par sa propre lumière — bleue et faible — et le vert acide ressortait gris
sombre. C'est exactement la même faute que le reflet de l'eau teinté deux fois,
et elle mérite la même règle : **une source s'ajoute au résultat éclairé, elle
n'y participe pas.**

Deux réglages ont ensuite dû être repris sur capture :

- **le plafond.** Sans borne, l'aura poussait la puissance au double de ce que
  le rendu encaisse : sur le sol sombre de Chrome, la flaque saturait à blanc
  pur sur un tiers de l'écran. Une lampe qui déborde n'éclaire pas, elle
  **efface** ;
- **la décroissance.** Au carré, la moitié du rayon gardait encore un quart de
  la puissance : la flaque n'avait pas de bord et teintait tout le premier plan
  d'un aplat uniforme. Au **cube**, elle a un cœur et une limite — et le sol du
  monde revient au bout de quelques mètres.

### L'aura ne peut pas être plus petite que ce qu'elle entoure

Le premier jet lui donnait le rayon du personnage. Elle était donc **dans** le
personnage : le buddy est un volume opaque, il masquait sa propre aura, et il
n'en dépassait qu'un liseré qu'on prenait pour du bloom. Une aura doit
envelopper **largement** ce qu'elle entoure, sinon elle n'existe que pour le
tampon de profondeur.

### Le piège de l'additif : l'alpha compté deux fois

Le mélange additif de three multiplie la source par son alpha avant de
l'ajouter. En sortant l'alpha à la fois dans la couleur **et** dans l'alpha, on
l'appliquait deux fois : une aura calculée à 0,3 d'intensité arrivait à 0,09 à
l'écran, et aucun réglage de couleur ne pouvait la rattraper.

C'est la faute classique de l'additif, et elle se voit d'autant moins qu'elle ne
casse rien — elle rend juste **tout terne**. La règle : en additif, l'alpha vaut
1 et toute la modulation vit dans le RVB.

### L'eau au fil des heures

La couleur finale — corps de l'eau **et** reflet du ciel confondus — passait
dans `daylight()` tout à la fin, donc le reflet était teinté une seconde fois.
Un cyan saturé multiplié par un orange saturé ne donne ni cyan ni orange : ça
donne un gris verdâtre, et le lac devenait de la boue exactement au moment où il
aurait dû être le plus beau.

Trois corrections, et elles tiennent en une phrase chacune :

- seul le **corps** de l'eau reçoit l'heure ; le reflet est déjà à la bonne
  couleur ;
- plus le soleil est bas, plus l'eau devient un **miroir** — c'est toute la
  différence entre un lac de midi, qui a une couleur propre, et un lac de
  couchant, qui n'a plus que des reflets ;
- la **paillette** prend la couleur du soleil. C'est elle qui dessine le chemin
  de lumière sur l'eau, et un chemin blanc sous un soleil orange est la faute
  qu'on remarque sans savoir la nommer.

### Six montures, et pourquoi deux sont carrées

Ce qui distingue une monture à distance de jeu n'est ni sa couleur ni sa
texture : c'est sa **silhouette** et sa **taille**. Six disques ronds de teintes
différentes se ressemblent tous dès qu'ils font quarante pixels.

MINIDISC et DISQUETTE sont donc de vraies **cartouches carrées**, avec leur
volet métallique décentré — la seule chose qui casse la symétrie radiale. Le
shader garde un seul chemin : la distance euclidienne devient une distance de
Tchebychev, qui fait des carrés concentriques là où l'autre faisait des cercles,
et tout le reste continue de fonctionner sans y penser.

Le buddy est aussi remonté de 0,55 à 0,92 au-dessus du disque. Ils étaient bien
là, mais le buste posait presque dessus et la caméra de poursuite n'en laissait
dépasser qu'un croissant. **Six montures soigneusement distinctes dont on ne voit
qu'un croissant sont six montures identiques.**


## 16 bis. Ce que trois mesures ont trouvé dans les cinq mondes

Trois défauts partagés par **tous** les mondes, invisibles tant qu'on regarde
une capture sans la mesurer, évidents dès qu'on la mesure.

### Le premier plan était un aplat, et il manquait de la VALEUR, pas du détail

Mesure sur la plaine, colonne de pixels du bas du cadre (six mètres) au tiers
supérieur du sol (quarante mètres) : la luminance allait de **184 à 192**.
Trois pour cent. Le bas de l'image était une dalle de couleur posée devant un
paysage, dans les cinq mondes.

Le réflexe est d'ajouter du détail — plus de brins, plus de grain. C'est le
mauvais diagnostic : le grain de brin était déjà là. Ce qui manquait était la
**valeur**, et elle était bridée à trois endroits :

- **le gain de la strie.** Les deux champs de bruit qui la portent ont une
  moyenne de 0,48 et un écart-type d'un dixième ; les moyenner le réduit encore.
  À un gain de 1,32, la strie ne parcourait qu'un **quart** de la plage
  disponible — alors que les deux couleurs qu'elle mélange, l'ombre et la
  strie, sont séparées de cent niveaux. Même diagnostic que le tapis de
  feuilles d'octobre, même remède : caler le gain sur la statistique du champ,
  pas à vue.
- **l'occlusion de la canopée.** Les creux entre les touffes n'étaient que 7 %
  plus sombres que les touffes. Une herbe dont les creux ne sont pas plus
  sombres que les pointes est une moquette.
- **l'assombrissement de proximité.** L'herbe sous les pieds n'est pas vue de
  dessus mais **de biais** : on regarde dans la canopée, entre les brins. Elle
  est donc plus sombre que la même herbe à cinquante mètres. Ancré sur la
  distance, donc il défile avec le sol — une vignette d'écran ferait la même
  tache, mais collée à l'œil, et l'œil la lit comme un filtre.

### Le surfeur effaçait sa propre ombre

Le jeu projette depuis toujours une ombre de contact au sol : une ellipse molle
centrée sur la projection du disque le long des rayons du soleil. Elle n'a
jamais existé à l'écran, pour **deux** raisons cumulées, et il a fallu la
peindre en rouge vif pour les voir :

1. **Elle était plus petite que ce qu'elle projette.** Un mètre quinze de
   rayon, contre un disque plus large : au sol, où le décalage solaire est nul,
   elle passait entièrement dessous. Le projeteur n'est pas le disque seul,
   c'est le buddy entier.
2. **Elle était posée avant la lampe du personnage.** La lampe, ajoutée cent
   lignes plus bas, rallumait exactement la zone assombrie. Une ombre n'est pas
   une couleur, c'est une **occlusion** : elle s'applique après tout ce qui
   éclaire, sources comprises.

Corrigée, elle donne mieux que ce qu'on visait — une flaque de lumière cyan
avec un cœur sombre juste sous le disque, ce qui pose le personnage bien mieux
qu'une tache grise. Mesure de contrôle : une ligne de pixels traversant le
point de contact ne variait pas d'un niveau avant, elle en perd cinquante
maintenant.

### L'aura montait alors qu'on va vers l'avant

Le premier jet était une flamme **verticale** — l'aura de transformation d'un
personnage qui prend racine. Sauf qu'ici personne ne prend racine : on file à
deux cent vingt à l'heure vers l'avant, et une flamme verticale sur un corps
horizontal ne dit pas la puissance, elle dit que l'effet a été pensé sans la
course.

La correction évidente — la coucher vers l'arrière — **ne marche pas**, et
c'est la leçon intéressante. Une caméra de poursuite regarde dans l'axe de la
course : tout ce qui fuit droit vers l'arrière lui arrive **par le bout**, donc
ne mesure plus que sa propre largeur. On peut la coucher de dix ou de quarante
degrés, elle continuera de se lire comme une tache autour du personnage. C'est
un problème de **point de vue**, pas de rotation, et aucune correction d'angle
ne le résout. (Deuxième piège du même ordre : couchée, elle part vers la
caméra, qui n'est qu'à neuf mètres — étirée comme une flamme, elle la
traversait, et tout ce qu'on en voyait était deux langues qui montaient hors du
cadre.)

Ce qui le résout est l'**évasement**. Les langues divergent en s'éloignant au
lieu de converger, le corps devient court le long de l'axe et large en travers,
et l'axe suit le **déplacement réel** — jamais l'assiette du personnage. Vu de
derrière, ce n'est plus une flamme qui monte, c'est une couronne qui s'ouvre
vers l'écran, et qui balaie franchement de côté dès qu'on carve. La lecture
exacte de « ça arrache ».

## 17. OCTOBRE, le monde couvert

Le cinquième monde ne cherche pas à être beau au sens des quatre autres. Ceux-là
sont des mondes de **plein jour** — même Chrome, dont le crépuscule violet est
saturé comme un néon. Octobre est le premier qui ait un **plafond**.

### Trois règles de ciel que les autres n'ont pas

- `night` ne descend **jamais** à zéro : même à son midi le monde garde un tiers
  de nuit, parce que le plafond de nuages ne se lève pas ;
- `power` plafonne à 0,64 contre 1,0 ailleurs, et le remplissage reste haut.
  C'est la définition d'un ciel couvert — peu de directe, beaucoup d'ambiante —
  et c'est ce qui **écrase les ombres** ;
- le seul moment saturé du cycle est le **couchant**, la trouée sous le plafond
  quand le soleil passe dessous et met le ventre des nuages en cuivre. Il dure
  quinze secondes, et tout le reste du monde est fait pour qu'on l'attende.

### Le soleil est un objet, pas une lumière

Baisser `power` n'y touche pas d'un pouce. Le dôme porte son propre soleil — un
cœur brûlant, une couronne, une étoile à douze branches, une traînée
anamorphique — et le premier jet d'Octobre a donc rendu un ciel de plomb avec
une **étoile de cinéma plantée au milieu**.

D'où `uOvercast`, distinct de tout ce qui existait : il éteint le cœur, l'étoile,
la traînée et les étoiles de la nuit, et laisse à leur place une **tache claire**
large et molle, de la couleur du ciel et non du soleil. C'est le seul indice qui
reste de la position du soleil un jour gris, et c'est exactement ce qu'il en
reste dehors.

### L'orange ne va PAS dans le sol

Le premier jet peignait le sol en ocre franc et la lumière du couchant en orange
saturé. Résultat : un paysage **martien**. C'est la faute classique des palettes
d'automne, et elle ne se corrige pas dans le sol — elle se corrige dans la
**lumière**.

Un jour couvert n'envoie aucun faisceau direct sur l'herbe : le sol est éclairé
par le *ciel*, qui est gris-violet. La lumière directe d'Octobre est donc un gris
chaud (`0xc9a888`) et non un orange, la gamme du sol est un gris-olive
désaturé — et **tout l'orange vit ailleurs** : dans le tapis de feuilles, dans
les feuilles qui tombent, dans le liseré cuivre des nuages, dans les fenêtres
allumées des tours. Le contraste chaud/froid en sort renforcé au lieu d'être
noyé.

### Le tapis n'est pas fait de feuilles

Un tapis de feuilles crédible en demande des dizaines de milliers au mètre
carré. Le système de particules en pose quelques centaines dans tout le champ de
vision — assez pour qu'on en voie **tomber**, jamais assez pour qu'on marche
dessus. Le premier jet donnait donc une pluie de confettis au-dessus d'une
prairie vierge.

La bonne division du travail est celle-ci :

- **les particules** font les feuilles qui tombent. Elles culbutent (le quad se
  referme sur sa largeur puis tourne dans le plan de l'écran — c'est le passage
  par la **tranche** qui dit qu'une feuille tournoie), elles se **posent** au
  sol ou flottent sur l'eau, et elles s'allument à contre-jour parce qu'une
  feuille sèche est translucide ;
- **le sol** fait celles qui sont déjà tombées. Deux échelles de bruit, un seuil
  qui laisse de l'herbe entre les tas, et une densité plus forte dans les creux
  — c'est là que le vent les dépose.

Chacune est bonne exactement là où l'autre ne l'est pas, et les deux tirent leurs
couleurs du **même** endroit : on reconnaît dans le tapis la feuille qu'on vient
de voir tomber.

Un détail de calibrage vaut d'être noté : le seuil du tapis était d'abord posé à
vue, sur `[0,44 ; 0,80]`. Or ces champs de bruit ont une moyenne de 0,48 et un
écart-type d'un dixième, et les moyenner réduit encore la variance : trois pour
cent du sol passaient le seuil. **Le tapis existait dans le code et nulle part à
l'écran.** Un seuil se cale sur la statistique du champ, jamais à vue.

### La pluie fait à l'eau l'inverse de ce qu'elle fait au sol

C'est le couple qui rend l'averse lisible :

- le **sol** gagne un miroir. Le film d'eau piège la lumière diffuse, donc le sol
  fonce et se sature ; il rend le ciel à l'incidence rasante au lieu de verdir ;
  son spéculaire s'élargit ; et il retient des **flaques** dans ses creux plats
  — deux conditions et pas une seule, car une flaque sur un versant est le genre
  de faute qu'on repère sans savoir la nommer ;
- l'**eau** le perd. Une surface criblée de gouttes est une surface rugueuse :
  elle diffuse au lieu de réfléchir, ses paillettes s'éteignent, et c'est cette
  perte de brillance qui rend un étang d'octobre si mat.

Les **impacts** sont les mêmes des deux côtés — un semis d'anneaux dont chaque
cellule a son propre rythme et son propre centre, jamais un sinus global qui
ferait respirer toute la pluie à l'unisson. Ce qui tombe sur l'herbe et ce qui
tombe dans l'étang sont la même averse, au mètre près.

### Le quartier, et pourquoi pas la ville de cristal

Les tours de verre à un kilomètre sont une **promesse** : quelque chose de grand
qu'on n'atteindra jamais, posé tout au fond pour donner de l'échelle à la
plaine. C'est juste pour la plaine, et c'est faux pour octobre. Un mois
d'octobre mélancolique ne se joue pas devant une skyline — il se joue **en
bordure de ville**, dans un lotissement, à l'heure où les fenêtres s'allument
une par une et où personne n'est dehors.

Le décor n'est donc plus au fond mais **sur les côtés**, qu'on croise et qu'on
double. Trois éléments, et chacun fait une chose que les autres ne font pas :

1. **Les maisons.** Un pignon à deux pentes tourné vers la route. C'est la
   silhouette qui identifie une maison à cent mètres, jamais la texture : une
   boîte à toit plat lit comme un hangar, quel que soit le soin mis à ses murs.
   Une maison sur deux présente son pignon, l'autre son long pan — toutes
   orientées pareil, elles font une frise identique et l'œil lit un centre
   commercial.
2. **Les fenêtres allumées.** Le sujet émotionnel, et de loin le détail le plus
   rentable du monde entier. Elles **débordent** sur le mur autour d'elles :
   une fenêtre allumée qui s'arrête net au bord de son cadre lit comme un
   autocollant collé sur un mur.
3. **Les lampadaires.** Ils ne se contentent pas d'exister, ils **posent une
   flaque de lumière sur la route mouillée**. Le mât et sa flaque lisent la même
   fonction de placement — deux formules « à peu près pareilles » se
   décaleraient d'un mètre et la flaque serait à côté de la lampe.

Et **des arbres entre les maisons**, parce que vingt maisons alignées à cent
cinquante mètres fusionnent en une bande de fenêtres quelle que soit la variété
de leurs toits. Il faut quelque chose de vertical et de noir pour que l'œil les
sépare ; une silhouette d'arbre coûte six triangles et fait ce travail à elle
seule.

#### Trois rangs, et c'est une contrainte de cadrage

En portrait le champ horizontal ne fait que **trente-sept degrés** : à cinquante
mètres de la route, une maison n'entre dans l'image qu'à partir de cent
cinquante mètres devant. Un seul rang donne donc une frise lointaine, jamais une
rue. Il faut du décor à plusieurs profondeurs pour que les maisons se recouvrent
et fassent un quartier — et des maisons volontairement **plus grandes que
nature**, exactement comme les tours de la ville de cristal font cent mètres de
haut.

#### Trop d'eau ne fait pas un automne, ça fait un marécage

Octobre est parti avec **31 %** d'eau, et ça ne lisait pas comme des champs
mouillés : ça lisait comme un delta. Le coupable n'était pas tant les nappes
que **leurs berges**. Chaque mare traîne un ourlet de boue pâle ; avec une mare
tous les cent mètres, le paysage entier se couvrait de traînées beiges.

Trois corrections, dans cet ordre d'importance :

1. le niveau descend à −6,5 m — **9 %** d'eau, une mare tous les deux cent
   quatre-vingts mètres et vingt-six mètres de large. C'est *moins* que la
   plaine, qui en a dix-sept, et c'est voulu : ici l'humidité se dit par le sol
   mouillé, les flaques et l'averse, pas par des étendues ;
2. les berges se resserrent (0,7 + 1,3 au lieu de 1,1 + 2,2) ;
3. la boue **s'assombrit**. Tirée claire elle lit comme du sable, et du sable au
   bord d'une mare sous un ciel de plomb, c'est une vasière.

Le prix est réel et il faut le dire : la houle et les traversées payaient à
elles seules les deux tiers du score d'octobre. Mesuré à l'autopilote, il passe
de 8,2 M à 2,7 M — le monde reste jouable (600 s, 296 anneaux, 0 % du temps
enlisé) mais il vit désormais sur les anneaux et les vols, comme Bliss.

Et les **berges** ont dû être resserrées deux fois, pour une raison qui ne se
lit pas dans le réglage : le masque de grève ajoute au niveau une **dentelure**
d'amplitude 1,5 m, si bien qu'une largeur nominale d'un mètre couvre en fait
tout ce qui est à moins de deux mètres cinquante au-dessus de l'eau. Sur une
pente douce, ça fait cent mètres de grève — et c'est cette bande **tan** qui
barrait le milieu de chaque capture. Un ourlet est un ourlet : 0,40 + 0,75, et
du sable devenu **boue sombre**, parce que du sable clair au bord d'une mare
sous un ciel de plomb, c'est une vasière.

Corollaire moins évident, appris en même temps : **la rampe de sol doit rester
sombre jusqu'au fond**. Sous un plafond de nuages, le lointain ne s'éclaircit
pas parce qu'il est loin — il s'éclaircit parce que la brume s'interpose, et
c'est le voile d'averse qui s'en charge. Une rampe qui pâlit d'elle-même
donnait, une fois multipliée par la lumière du couchant, une immense étendue
**tan** entre la route et les maisons. On avait remplacé un marécage par un
désert.

#### Ce qui fait qu'une route n'est plus « une bande sombre »

Le premier jet en avait la forme et rien d'autre : un ruban gris uniforme qui
occupait la moitié du cadre. Six termes l'ont sortie de là, et aucun ne coûte
plus de trois lignes :

- **Les passages de roues.** Deux bandes plus sombres et plus lisses à un mètre
  soixante-dix de l'axe — le caoutchouc polit le bitume et le noircit. C'est
  *le* détail qui dit « route utilisée » plutôt que « ruban gris », et il ne
  coûte qu'une gaussienne. Les flaques les évitent, ce qui fait lire des
  ornières plutôt que des taches.
- **Les fissures.** Un **réseau**, pas des rayures : on prend la crête d'un
  bruit — la vallée de `|fbm − 0.5|` — ce qui donne des lignes qui se rejoignent
  et se ferment, comme une faïence. Des traits parallèles auraient lu comme un
  motif.
- **La rive**, posée exactement sur le bord que le masque de route utilise.
  Sans elle, l'œil ne sait pas où la chaussée s'arrête.
- **Les gravillons** rejetés contre ce bord par le balayage.
- **L'accotement** : une bande de gravier mouillé entre l'enrobe et l'herbe.
  Tiré trop clair il lit comme du **sable**, et on voit une plage le long de la
  route — c'est arrivé, et c'était la première chose qu'on remarquait.
- **Les feuilles plaquées** : sur le bitume elles sont plus sombres et collées,
  elles ont perdu leur relief. Sans ce terme le tapis flotte au-dessus de la
  route.

Et la route a **rétréci**, de vingt mètres à treize. À la distance où vit la
caméra, une chaussée de vingt mètres remplit tout le bas du cadre et le paysage
se réduit à un aplat sombre. Il faut que l'herbe et les feuilles **encadrent**
l'asphalte pour qu'on le lise comme une route.

#### Le faisceau du lampadaire n'existe que parce qu'il pleut

Ce qu'on voit d'un cône de lumière, ce n'est jamais la lumière : c'est ce
qu'elle **traverse**. Par temps sec il n'y a rien dans l'air et le faisceau est
invisible ; sous l'averse il se dessine en entier. Il est donc multiplié par la
pluie, sans exception.

Le quad qui le porte ne pend plus centré sur la lanterne mais **sous** elle, et
sa base passe sous le sol : le test de profondeur la coupe pile à la chaussée,
gratuitement, et le faisceau semble s'y poser.

Deux pièges d'additif au passage, tous deux vus à l'image. Le quad ne doit
**jamais** se voir : une valeur infime mais non nulle sur toute sa surface
éclaircit uniformément le ciel derrière lui et on lit un rectangle clair autour
de la lampe. Et le **débordement des fenêtres** doit rester près de sa fenêtre :
dosé trop large il couvre la cellule entière, toutes les cellules d'une rangée
s'allument ensemble, et la façade devient un rectangle lumineux à bords francs —
une enseigne, pas une maison. (Mesure : `max(d2)` vit entre 0,25 et 0,50, donc
une rampe qui commence à 0,40 est allumée sur plus de la moitié de la cellule.
À vingt mètres, ça ne faisait pas des fenêtres, ça faisait une façade entière
en pêche pâle posée sur le ciel.)

#### Le rectangle du halo, et pourquoi un seuil de rejet ne suffisait pas

Le premier remède au quad visible était un seuil : sous 0,004, on rejette. Il
n'a pas tenu, et il fallait trois corrections et pas une.

1. **Le lobe large portait jusqu'aux coins.** Le halo est fait de deux lobes —
   un cœur dur et une nappe longue — et c'est l'**écart entre les deux
   exposants** qui fait une lampe plutôt qu'une pastille. Mais la nappe portait
   jusqu'à `r = 1,9`, c'est-à-dire au-delà du bord du plan : quelques centièmes
   de lumière chaude étalés sur sept mètres carrés, et l'œil lit un
   **rectangle**. Un bord droit se détecte bien avant une luminance, et il n'y a
   rien de droit dans une rue.
2. **Le bulbe était coupé net par le haut du quad.** La lanterne était posée à
   `v = 0,92` alors que le bulbe déborde de trois dixièmes au-dessus d'elle : la
   coupe se lisait comme un trait horizontal en travers du halo. Un demi-mètre
   de marge suffit.
3. **Le seuil se retranche, il ne se teste pas.** Testé, il laisse un bord : le
   pixel juste au-dessus vaut encore deux centièmes, celui d'à côté vaut zéro,
   et l'ellipse du lobe se redessine — on avait remplacé un rectangle par un
   œuf. Retranché (`a = max(a − s, 0)`), la lueur atteint zéro d'elle-même et il
   n'y a plus de bord du tout.

#### Le relief doit connaître la route

La route était **peinte** sur le terrain sans que le terrain en sache rien.
Trois défauts en découlaient, tous les trois signalés par le joueur, et aucun
n'était rattrapable dans un shader. Mesure sur douze kilomètres d'axe :

| | avant | après |
| --- | --- | --- |
| route sous l'eau | **9 %** (une mare tous les 100 m) | **0 %** |
| pente moyenne | 12,0° | 2,7° |
| pente maximale | 30,9° | 5,5° |
| dénivelé par 60 m | **15,6 m** | 5,1 m |

Quinze mètres et demi de dénivelé tous les soixante mètres, ce n'est pas la
mesure d'une rue de lotissement, c'est celle d'une piste de bosses — et des
maisons posées là-dessus se retrouvaient décalées de dix mètres en hauteur
entre deux voisines.

D'où un **couloir** : dans la bande de la rue, le relief oublie ses trois
couches courtes et ne garde que les deux longues (480 m et 190 m), à moitié
amplitude. Deux détails qui décident du résultat :

- **Il sort de l'eau tout seul, sans remblai.** Les deux couches longues ne
  descendent jamais aussi bas que la somme des cinq : lisser suffit à passer
  au-dessus du niveau de l'eau. Pas de constante à régler, pas de route qui
  flotterait au-dessus du paysage.
- **Il est LARGE — quarante-six mètres — et ce n'est pas pour la chaussée**,
  c'est pour les maisons, qui vivent entre vingt-deux et quarante-huit mètres
  de l'axe. Un couloir serré sur le bitume aurait donné une rue plate bordée de
  façades en escalier.

Ce qui reste, et c'est voulu : la route **monte et descend** encore, sur
plusieurs centaines de mètres. Elle traverse le paysage en remblai au-dessus
des creux et en tranchée dans les bosses — exactement ce que fait une vraie
route, et ce qui la fait lire comme un ouvrage plutôt que comme une bande
peinte. Hors du couloir, à quarante mètres, le relief est intact : 30° de pente
et 7,7 % d'eau. Les sauts sont toujours là, il faut aller les chercher.

#### Le vent : un banc qui dit oui et un joueur qui dit non

Le vent d'octobre valait 6,2 m/s, soit la moitié d'un appui à fond. Le banc le
trouvait corrigeable — **zéro pour cent** du temps collé au bord du couloir — et
le joueur le trouvait injouable. Les deux sont vrais, et l'écart dit exactement
ce que le banc ne mesurait pas : **un autopilote qui corrige en permanence ne
se plaint pas.** Ce qui compte n'est pas de *pouvoir* compenser, c'est d'avoir
des instants où l'on n'a **pas** à compenser.

Deux corrections, et la seconde compte plus que la première :

- la force descend à 2,4 m/s (un septième d'un appui à fond) ;
- la poussée reprend une forme **sinusoïdale**. `gustAt` est un smoothstep
  serré : il passe l'essentiel de son temps à saturation, ce qui est parfait
  pour coucher l'herbe et emporter les feuilles — une bourrasque visuelle doit
  être franche — mais poussé tel quel dans la physique, ça ne donne pas un vent,
  ça donne un **créneau**. Le disque était déporté à pleine force en permanence,
  alternant d'un bord à l'autre. Même phase, même direction au même instant, mais
  de vraies accalmies au passage par zéro.

La bourrasque reste franchement visible — l'herbe, les feuilles et la pluie
lisent toujours le signal saturé — elle ne tient simplement plus le volant à la
place du joueur. Le score d'octobre à l'autopilote est passé de 2,7 M à 4,4 M
au passage : ce n'est pas un monde plus facile, c'est un monde où la
trajectoire redevient un choix.

#### Un ciel couvert n'est pas un ciel bleu qu'on a baissé

Le plafond d'octobre était fait des mêmes cumulus que la plaine, repeints en
gris. Ça ne marche pas, et pour une raison de **forme** avant d'être une
raison de valeur : un cumulus de beau temps est une masse **verticale**, haute,
isolée, avec du ciel entre les nuages ; un ciel d'averse est une **couche** —
basse, écrasée, étirée, sans intervalle.

Les mêmes sprites servent donc aux deux, mais sous couverture ils sont écrasés
(deux fois moins hauts, presque deux fois plus larges), descendus, et ils
**défilent** — un plafond immobile est un décor peint. Trois autres termes
suivent la couverture :

- **Le déchirement.** Le contour d'un cumulus est *fermé* : on en fait le tour
  de l'œil, et c'est ce qui le rend beau. Sous l'averse c'est exactement ce
  qu'il ne faut pas — un ciel bas n'a pas de contour, il a des lambeaux. On
  ronge donc l'alpha avec un bruit qui défile, et **seulement là où le nuage est
  mince** : le cœur reste opaque, les bords partent en charpie. Ronger partout
  donnerait un nuage troué, ce qui est une autre chose et une chose laide.
- **Le contraste interne s'effondre.** Plus de source pour sculpter le volume,
  donc plus de faces claires et sombres. Un nuage d'averse est une valeur, pas
  un relief.
- **Le liseré argenté meurt.** C'est un contre-jour, et il n'y a plus rien
  derrière. Le garder est la faute qui trahit un ciel couvert repeint par-dessus
  un ciel de beau temps.

#### L'étalonnage sale, et ce n'est pas « plus sombre »

Un monde couvert étalonné comme un monde ensoleillé reste une image de beau
temps qu'on a baissée. Quatre termes font le grungecore, et aucun n'est un
assombrissement :

1. **La saturation tombe, sauf sur les sources.** Sous un plafond il n'y a plus
   de lumière colorée ; la seule couleur qui reste est celle des choses qui
   *brillent* — les fenêtres, les lampadaires, le personnage. On désature donc
   en préservant ce qui est déjà clair.
2. **Les noirs se lèvent et se refroidissent.** Le noir profond est une image de
   nuit claire ; sous la pluie l'air diffuse et les ombres remontent, en
   bleu-vert. C'est le *lifted black* de la photo argentique poussée, et c'est
   **le** marqueur du genre. Il se dose au millième : à 0,030 il ne relevait pas
   les ombres, il effaçait la route — l'asphalte mouillé, qui est le sujet du
   monde, remontait au gris moyen et l'image entière devenait laiteuse.
3. **Le haut du cadre est plus lourd que le bas.** Un plafond pèse. Une vignette
   symétrique donne un vieux film, pas un ciel bas.
4. **Le grain**, lié à la luminance : plus présent dans les demi-tons que dans
   les hautes lumières, comme une pellicule sous-exposée poussée au
   développement.

Le tout est branché sur la **couverture courante**, fondu compris : l'étalonnage
arrive au rythme du ciel qui se ferme, comme la pluie qu'on entend.

#### Une seule route ne fait pas un quartier, elle fait un couloir

Il n'y avait rien **à mi-distance** : le regard sautait du bitume sous les pieds
à la frise de maisons au fond, et les cent mètres entre les deux restaient une
bande vide. Une rue perpendiculaire tous les cent douze mètres remplit
exactement ce trou. Elle donne au sol une trame lisible, elle passe **sous** le
joueur — donc elle se lit comme de la vitesse, ce qu'une route parallèle ne fait
jamais — et elle justifie les maisons : elles bordent enfin quelque chose des
deux côtés au lieu de s'aligner le long d'un ruban.

Son pas est un **multiple non entier** de celui des rangées, pour qu'une rue ne
tombe jamais deux fois sur la même maison, et il ne s'ancre sur rien : c'est un
modulo de la position monde, donc il ne peut structurellement pas glisser.

#### Un lotissement n'est pas une densité de maisons, c'est un alignement

Et c'est la **vue de dessus** qui l'a dit. Depuis la caméra de course, un semis
de maisons entre trente et cent quatre-vingts mètres de la route passait pour du
désordre ; vu à cent quatre-vingt-dix mètres d'altitude, c'était sans appel — des
boîtes noires éparpillées dans un champ, sans rapport les unes avec les autres
ni avec le bitume. **Ce qui fait la rue, c'est que les façades soient à la même
distance du trottoir.**

D'où trois alignements, et un recul faiblement tiré (deux mètres d'écart entre
voisines, pas dix — le désordre doit se voir sans se lire) :

| rang | où | ce qu'il fait |
| --- | --- | --- |
| **0** | 22 m de l'axe, un de chaque côté | le premier rang, celui qu'on double et le seul dont on lise les fenêtres |
| **1** | 41 m | le fond de parcelle. Il ne borde rien : il sert à ce que le premier rang ait quelque chose derrière lui, sinon la rue est une frise posée sur le vide |
| **2 et 3** | les deux bords de la rue transversale | leur z ne vient plus de la rangée mais de la **rue elle-même**. C'est ce qui fait qu'une rue latérale se lit comme une rue et pas comme une traînée claire dans un pré |

Les lampadaires ont suivi : de quinze mètres à **neuf**. À quinze, la flaque
tombait derrière l'accotement et la chaussée restait noire entre deux mâts. Et
un arbre sur deux est maintenant un **arbre d'alignement**, entre le trottoir et
les façades — sans rien entre l'asphalte et les maisons, la chaussée a l'air
posée sur un pré. (Il est aussi plus étroit et plus haut que l'arbre de plein
champ : taillé, il vit entre un trottoir et une façade, et garder la silhouette
large lui faisait avaler le lampadaire d'à côté.)

#### Un plafond de nuages n'est pas une ombre

C'est la mesure qui a tranché, et elle était brutale. Sur une capture d'octobre,
le premier plan valait **(121, 83, 56)** ; en coupant la seule contribution du
quartier au sol — les flaques de lampadaire et la lumière des fenêtres — il
tombait à **(18, 15, 10)**. Autrement dit ce n'était plus le paysage qu'on
regardait : c'était le beurre des lampadaires posé par-dessus un monde noir.

Deux fautes se cumulaient, et aucune n'était une question de goût.

- **L'ombre des nuages n'a pas de sens sous une couverture totale.** Une tache
  d'ombre suppose une trouée à côté. Quand le plafond est fermé, la lumière est
  diffuse et le sol est uniformément éclairé — garder les taches retirait
  quarante pour cent de la luminance, et par-dessus le voile et le sol mouillé
  il ne restait rien à regarder.
- **`daylight()` bascule vers la couleur de *remplissage*,** qui décrit ce que
  reçoit une face **à l'ombre** : sombre par construction. Un ciel couvert n'est
  pas une ombre, c'est une source de mille mètres de large — plus douce que le
  soleil, pas plus faible. Le sol et le quartier rendent maintenant ce que la
  couverture diffuse vraiment.

Même bascule sur les **faces** du décor, et c'est deux modèles et non un. Par
beau temps la lumière vient d'un point : ce qui sépare deux faces est leur angle
au soleil. Sous une averse il n'y a plus de point : ce qui les sépare est la
**part de ciel qu'elles voient** — un toit la voit toute, un mur vertical la
moitié, une face vers le bas presque rien. Garder le modèle ensoleillé donnait
exactement ce qu'on avait : des boîtes noires dont une face est un peu moins
noire. Le toit est devenu la face la plus **claire** d'une maison, ce qu'il est
sous un plafond, et le quartier a cessé d'être un semis de cubes d'encre.

Le sol mouillé, enfin, fonce moins fort : `c²` compensé par un gain plus élevé.
Sans le gain, un sol trempé ne fonce pas, il **disparaît** — 45 % de luminance
perdue, cumulée avec tout le reste.

#### La route, et les deux leçons qu'elle a coûtées

Des maisons plantées dans un pré ne sont pas un lotissement, ce sont des maisons
dans un pré. Il faut la route pour qu'elles bordent quelque chose — et c'est
elle qui rend les flaques de lampadaire lisibles : sur l'herbe une tache de
lumière chaude se noie, sur du noir mouillé elle brûle.

Première leçon, déjà apprise avec le masque de plage et réapprise ici : le
masque de route ne vivait que dans le shader du sol, et **l'herbe a continué de
pousser au milieu de l'asphalte**. Une route sous un champ de brins n'est plus
une route. Le masque est maintenant une fonction partagée, lue par le sol et par
les touffes. (Le tapis de feuilles, lui, s'éclaircit sur la chaussée sans
disparaître : le vent les pousse vers les bas-côtés.)

Seconde leçon, sur la lumière : le premier réglage poussait la part **diffuse**
des lampadaires et donnait une route **couleur sable** sous un ciel d'orage —
l'asphalte avait perdu exactement ce qu'on venait chercher. Une lampe pose deux
choses très différentes sur du bitume mouillé : un peu de diffus, et surtout un
**reflet étiré**. Le reflet passe par le même terme rasant que le sheen du sol,
donc il s'allonge vers l'horizon et disparaît sous les pieds — ce qui est le
comportement d'un reflet.

### Ce qui sépare une averse d'une pluie, et ce ne sont pas les gouttes

Le premier réglage donnait une pluie honnête : des traits fins, espacés, qu'on
remarquait sans jamais les subir. **Multiplier les gouttes n'aurait pas suffi** —
une pluie torrentielle ne se reconnaît pas au compte des gouttes mais à trois
choses qu'elles ne font pas toutes seules :

1. **La longueur du trait.** Une goutte d'orage tombe à vingt mètres par
   seconde ; pendant le temps de pose de l'œil elle parcourt plusieurs
   décimètres. C'est la strie qui dit la violence, pas le point. Les traits ont
   donc doublé de longueur avant de doubler en nombre.
2. **Le voile.** Au-delà de quelques dizaines de mètres, l'eau qui tombe entre
   l'œil et le paysage fait écran. C'est le terme décisif : sans lui, on peut
   multiplier les gouttes par dix sans jamais rendre la pluie forte, parce que
   **rien ne se perd**. Une averse qui n'enlève rien à la vue n'est qu'un motif
   de traits posé devant un beau temps. Il prend la couleur du remplissage du
   ciel, comme la goutte elle-même.
3. **Le rejaillissement.** Une nappe blanche qui tient à quelques dizaines de
   centimètres du sol — l'eau qui remonte. Une instance sur dix du système de
   pluie lui est réservée, dans le même appel de dessin : deux maillages
   auraient doublé le coût de commande pour deux fois rien. Portée courte, dix
   mètres : au-delà elle ne raconte plus rien et ne coûte que du remplissage.

Et deux réglages qui n'ont l'air de rien et qui font tout le reste :
**l'inclinaison propre à chaque goutte** et **sa densité propre**. Sans elles,
trois mille traits rigoureusement parallèles et de valeur identique ne lisent
plus comme une averse mais comme des **rayures posées sur l'image** — un défaut
d'autant plus voyant que les traits sont longs. Quelques degrés d'écart rendent
son volume au champ.

#### Le son : un lit de bruit ne fera jamais de la pluie

La première version était deux bandes de bruit filtré à gain constant. Ça ne
faisait pas de la pluie, ça faisait de la **neige de télévision** — et pour une
raison qui n'a rien à voir avec le réglage des filtres : une averse n'est pas un
signal stationnaire. Elle est faite de milliers d'événements **discrets**, et
l'oreille, qui passe sa vie à séparer des transitoires d'un fond, les entend un
par un même quand ils se comptent par centaines. Un lit de bruit, aussi bien
filtré soit-il, n'en contient aucun.

Quatre couches, et la dernière fait tout le travail :

1. le **grondement** — tout ce qui tombe trop loin pour qu'on distingue une
   goutte. Un mur grave, sans détail ;
2. la **nappe** — la masse médiane, celle qui donne la densité ;
3. le **crépitement** — les aigus, l'eau qui frappe le dur. En passe-**bande** et
   non en passe-haut : le passe-haut laisse tout passer jusqu'à Nyquist, et
   c'est précisément ce qui sifflait ;
4. **les gouttes** — des centaines de transitoires courts, chacun avec sa
   hauteur, sa durée, son volume et sa place dans le stéréo. La seule couche qui
   fasse entendre de l'**eau** plutôt que du bruit.

Trois détails sans lesquels la quatrième couche retombe dans la machine :
l'**espacement est aléatoire** (des gouttes régulières, même à trente par
seconde, produisent une hauteur — on entend le *taux*), la fréquence est tirée
avec un **biais vers le grave** (une distribution plate donne un carillon), et
l'offset de lecture dans le tampon de bruit est **tiré au sort** — partir
toujours de zéro rejouerait la même forme d'onde des milliers de fois, et
l'oreille reconnaît une répétition bien avant de savoir la nommer.

Les trois nappes **respirent** enfin, sous deux oscillateurs très lents aux
périodes premières entre elles (17 s et 12 s). Une averse à gain constant
s'entend comme une soufflerie au bout de dix secondes ; une averse qui enfle et
retombe se laisse oublier, ce qui est exactement ce qu'on demande à une ambiance.

Leur fondu dure 1,2 s : la pluie ne s'allume pas, elle arrive, sinon on entend
le changement de monde au lieu d'entendre pleuvoir.

### La pluie est ancrée au monde, pas à la caméra

Une pluie collée à l'écran est le réflexe évident et c'est aussi ce qui la
trahit : les traits restent immobiles pendant que le paysage défile, donc ils
lisent comme une texture posée sur l'objectif. Ici chaque goutte a une position
en monde ; à 30 m/s le joueur la **traverse**, et c'est cette parallaxe qui fait
tout.

Et le mélange est **normal, pas additif** — pour une fois. Une pluie additive
disparaît complètement sur un ciel clair et ne se voit que sur le sol sombre :
elle change d'existence selon l'endroit où l'on regarde. Une averse **voile**.
Elle prend enfin sa couleur du remplissage du ciel et jamais un gris fixe, sinon
c'est le reflet de l'eau teinté deux fois qui recommence.

### Ce qui fait lire le vent, c'est l'alignement

L'amplitude ne suffit pas : une prairie qui s'agite dans tous les sens lit comme
une prairie agitée. Ce qui fait le vent, c'est que **tout se couche dans le même
sens**. L'orientation des touffes se rabat donc vers l'axe de la rafale à mesure
qu'il forcit, et c'est ce cisaillement qu'on reconnaît sans savoir le nommer.

Les trois couches — l'herbe, les feuilles, la pluie — obéissent au **même
nombre** que la physique (voir [`02`](02-TECH-ARCHITECTURE.md) §13). La rafale
qu'on voit traverser le champ est celle qui déporte le disque.


## 18. La passe optique : ce qu'une caméra fait et qu'un moteur ne fait pas

Quatre termes ajoutés d'un coup, tous dans la même passe de post-traitement, et
ils se répondent : ils décrivent ensemble un **objectif** posé devant la scène,
là où le rendu précédent décrivait une fenêtre parfaite.

### L'occlusion ambiante, et c'est elle qui pose tout le reste

Le jeu n'avait aucune ombre en dehors de celle du surfeur : chaque objet — une
maison, une touffe, le pied d'une balise — flottait sur le sol avec exactement
la même valeur que lui. C'est le défaut le plus coûteux du rendu et le moins
cher à corriger : là où deux surfaces se rencontrent, la lumière du ciel arrive
moins bien, donc c'est plus sombre. Rien d'autre.

Deux détails décident du résultat :

- **Le rayon est en mètres, converti en pixels par la profondeur.** Un rayon
  fixe en UV donnerait une occlusion large au loin et invisible sous les pieds,
  ce qui est le contraire de ce qu'on veut.
- **Elle assombrit en TEINTANT vers l'ombre du ciel, pas vers le noir.** Une
  occlusion grise sur un monde coloré le désature, et c'est ce qui donne
  l'aspect « sale » des AO posées à la va-vite.

### Les rayons crépusculaires, et l'œuf blanc

On accumule la couleur de l'image le long du rayon qui va du pixel vers le
soleil, et on ne garde que ce qui vient du **ciel** — les pixels de décor sont
rejetés par la profondeur. Ce qui reste, ce sont les traînées de lumière qui
passent *à côté* d'un nuage ou d'une colline : les vrais rayons, pour la vraie
raison physique.

Le premier jet a donné une **ellipse opaque de trois cents pixels** au milieu du
cadre. Tout près du soleil, les dix échantillons tombent au même endroit : on
n'accumule plus une traînée, on recopie dix fois le même pixel brillant. Deux
masques ont réglé ça, et il faut les deux :

- **le cœur ne rayonne pas** (le halo du soleil est déjà dessiné par le ciel,
  avec sa couronne et ses branches ; la passe ajoute ce qui se passe *à côté*) ;
- **les rayons se voient sur ce qu'ils éclairent**, à 30 % seulement sur le ciel,
  où le faisceau ne ferait que doubler la luminosité d'un aplat déjà clair.

### La profondeur de champ hiérarchise

Une image entièrement nette est une image de logiciel de CAO. Le flou de
lointain fait basculer le rendu du côté « photographie », et il fait un second
travail plus important : il **hiérarchise**. Le surfeur et la porte restent
nets, l'horizon fond.

> **En mètres absolus, pas en multiples du plan de netteté.** Le plan est à une
> dizaine de mètres — le surfeur — donc un flou démarrant à « une fois et demie
> le plan » commençait à quinze mètres et noyait tout le paysage dès le premier
> plan. Ce qu'on veut flouter, c'est l'horizon : 120 m à 620 m.

Et **seulement le lointain**. Un flou d'avant-plan demande de savoir ce qu'il y
a *derrière* ce qu'on floute ; bricolé en espace écran, il fait immédiatement du
sale. Le sol qui défile sous les pieds est déjà traité par le flou de mouvement,
qui est le bon outil pour lui.

### La courbe filmique en sortie

Le tonemap neutre des matériaux fait son travail : ramener une plage dynamique
dans l'écran sans rien casser. Ce qu'il ne fait pas, c'est ce qu'une pellicule
fait — un **pied** qui écrase doucement les noirs et une **épaule** qui retient
les hautes lumières au lieu de les couper net. C'est la différence entre une
image *exposée* et une image *étalonnée*, et elle se voit surtout aux deux
extrêmes : le ciel près du soleil cesse d'être un aplat blanc, les ombres du sol
cessent d'être un aplat sombre.

## 19. L'ombre portée du relief : une bonne idée que la géométrie refuse

Le terrain est **analytique**. On peut donc marcher le rayon solaire dessus et
obtenir la vraie ombre — pas une carte d'ombres, pas une profondeur d'écran :
le terrain lui-même, sans biais, sans bord d'écran et sans résolution. Écrit,
testé, **teint en rouge vif** pour le voir : il ne couvrait pas un pixel.

La cause n'est pas dans le code, elle est dans la géométrie. Chaque couche du
relief apporte une pente `amplitude × fréquence` de l'ordre de **0,12 à 0,17**,
et elles ne s'alignent presque jamais : les pentes courantes plafonnent vers
onze degrés. Le soleil, lui, monte à **trente-trois degrés** au zénith de ce
cycle. Un rayon plus redressé que le terrain ne rencontre rien, jamais.

Même en plafonnant artificiellement le rayon à seize degrés — la triche
classique de l'ombre allongée, où la direction reste juste et seule la longueur
est exagérée — la mesure restait blanche. Il aurait fallu descendre vers six
degrés, c'est-à-dire un couchant permanent, et assombrir la moitié de la plaine
pour un effet qu'on n'avait pas demandé.

Six évaluations de terrain par pixel, le poste le plus cher du shader, pour
rien. **Le terme est retiré**, et la leçon vaut d'être écrite : rien dans le
code ne dit qu'un effet ne peut pas marcher — seule la mesure le dit.

Ce budget est parti dans trois termes que la géométrie, elle, supporte :

- **L'éclat de l'herbe.** Un sol qui n'a qu'un albédo et un ombrage diffus est
  une *couleur* posée sur une forme : il ne renvoie rien, donc rien ne dit de
  quoi il est fait. Le spéculaire est large — un brin n'est pas un miroir — et
  **corrélé au micro-relief des brins** : ce sont les touffes exposées qui
  accrochent, jamais les creux. C'est cette corrélation qui le fait lire comme
  de l'herbe et non comme un vernis.
- **La diffusion atmosphérique**, et ce n'est pas la brume. La brume fait fondre
  le lointain vers *une* couleur, la même dans toutes les directions. L'air réel
  renvoie beaucoup plus de lumière du côté du soleil : c'est pour ça qu'un
  paysage à contre-jour a un lointain laiteux et un paysage éclairé de dos un
  lointain net. Sans ce terme, les deux moitiés de l'horizon ont la même valeur
  et la scène perd sa **direction**.
- **Une variation de TEINTE, pas seulement de valeur.** La strie ne mélangeait
  que deux couleurs de la palette : elle faisait varier la luminosité du sol
  sans jamais en changer la couleur, et un pré entier restait une seule teinte
  plus ou moins éclairée. La rotation tourne autour du gris de **même
  luminance** — la teinte bouge, la valeur ne bouge pas — ce qui évite que la
  variation se lise comme des taches sales. Sur une échelle différente de celle
  de la strie (soixante mètres contre seize) : superposées à la même fréquence,
  les deux se confondraient.
