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
