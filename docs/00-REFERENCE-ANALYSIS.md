# 00 — Analyse forensique de l'image de référence

Source : capture d'un Reel Instagram (`@..._robots`, légende « Frutiger Surfer … »).
Résolution native analysée : **1080 × 2316**. L'image est conservée dans le dépôt (`docs/reference.jpg`) et `scripts/shot.mjs` sert à comparer le rendu au pixel près.
Le chrome Instagram (barre Reels, compteurs likes/commentaires, bouton Suivre, PiP,
barre de commentaire) **ne fait pas partie du concept** — c'est du contenant, pas du contenu.

Ce qui suit ne décrit que **la scène**.

---

## 1. Lecture globale

L'image est un **Frutiger Aero** de manuel, mais poussé au niveau « fond d'écran
Windows Vista qui aurait pris de la MDMA » :

- Saturation extrême, quasiment hors-gamut sRGB sur les verts.
- Zéro ombre dure. Tout baigne dans une lumière diffuse, blanche, omnidirectionnelle.
- Le ciel et le sol sont des **aplats de couleur pure** séparés par une ligne d'horizon nette.
- Chaque objet est soit **en verre**, soit **en gel**, soit **iridescent**. Rien n'est mat.
- Surréalisme assumé : des poissons tropicaux **volent dans le ciel**. C'est le
  marqueur signature du genre (nature + technologie, sans logique).

## 2. Décomposition par plan

### Plan 0 — Ciel
- Dégradé vertical cyan saturé → cyan plus clair vers l'horizon.
- Nuages **cumulus blancs, bas, plats du dessous, bombés du dessus** — typologie
  « fond d'écran Bliss ». Ils sont concentrés sur la bande d'horizon, pas au zénith.
- Aucune source solaire visible dans le cadre, mais la lumière vient d'en haut-droite
  (les poissons de droite ont leur highlight sur le dessus-droit).
- Bulles de savon translucides, grandes (jusqu'à ~25 % de la largeur d'écran),
  contour irisé, intérieur quasi transparent. Elles flottent devant ET derrière les poissons.

### Plan 1 — Faune volante
Au moins **7 créatures** identifiables, toutes en vol plané dans l'air :
| Position | Type | Note |
|---|---|---|
| Bord gauche, mi-hauteur | Poisson-ange rayé | Bandes horizontales pâles/violettes, corps discoïde |
| Haut-centre | Poisson allongé brun/orange | En piqué, vu de trois-quarts arrière |
| Centre-droit | Grande raie / poisson-lune violet | Le plus gros élément, nageoires longues et translucides |
| Droite, sous les nuages | Créature type baleine bleu-gris | Silhouette lisse, plus loin |
| Centre, petit, loin | Poisson sombre | Échelle atmosphérique |
| Bord droit | Poisson jaune/violet | Coupé par le cadre |

Ils sont **désynchronisés** en taille, profondeur et orientation — jamais alignés.
C'est ce désordre qui donne la sensation d'un écosystème, pas d'un motif.

### Plan 2 — Ville de cristal
- Skyline sur l'horizon, décalée légèrement à droite du centre.
- Tours **fines, verticales, translucides**, bleu-blanc, sans détail de façade.
- Fortement délavée par la brume atmosphérique — c'est une **promesse**, pas une destination.
- Elle est partiellement occultée par les nuages bas : elle est *dans* l'horizon, pas devant.

### Plan 3 — La plaine
- Vert électrique, uniforme, sans relief géométrique (le sol est plat).
- **Détail crucial** : des **stries radiales** partent de l'horizon et s'ouvrent vers
  le bas du cadre, comme un rayonnement en perspective. Ce ne sont pas des lignes de
  vitesse 2D — c'est la texture du sol qui converge au point de fuite.
- Gradient de valeur **inversé par rapport à l'intuition** : le sol est *plus clair et
  plus jaune* à l'horizon, *plus sombre et plus saturé* au premier plan. (Cf. §3.)
- Le sol a un **sheen spéculaire** : il réagit à la lumière comme une surface laquée,
  pas comme de l'herbe réelle.

### Plan 4 — Le sujet
**Le bonhomme MSN.** Icône « buddy » de Windows Live Messenger, reconstruite en 3D :
- Tête = sphère parfaite, légèrement détachée du corps (il y a un vide entre les deux).
- Corps = forme de buste arrondie, épaules tombantes, base plate — la silhouette exacte
  de l'icône de contact MSN.
- Matériau : **verre épais bleu-cyan**, pas du plastique. On voit :
  - une réfraction interne (le corps est plus dense au centre),
  - un highlight spéculaire large et flou sur le haut-gauche de la tête,
  - un **rim light** cyan pâle sur tout le contour,
  - une transmission — le vert du sol traverse et teinte le bas du corps.
- Il est **immobile et droit**. Aucune pose. C'est une icône qui surfe, pas un personnage.

**Le CD.** Disque optique sous ses pieds :
- Vu en perspective très écrasée (on est presque à sa hauteur).
- Trou central visible, anneau intérieur clair.
- Surface **iridescente** : le blanc argenté domine, mais on lit des dérives
  vert/cyan sur les bords — c'est de la diffraction, pas un reflet miroir.
- Il ne touche pas le sol : il y a un **espace + un halo vert** dessous. Il lévite.

### Plan 5 — HUD Frutiger Aero
Superposition d'interface en **verre bleu roi**, style Windows Aero / Aqua :
- **Haut-gauche** — panneau joueur : pastille avatar (le buddy), libellé `AERO PLAYER`,
  badge de niveau `12`, jauge `XP 3,450 / 5,000`, puis une seconde jauge verte `750 / 1,000`
  en dessous, plus fine et détachée.
- **Haut-droite** — widget météo/horloge : icône soleil, `12:45 PM`, `SATURDAY, MAY 24`, `24°C`.
- **Bas-droite** — dock d'icônes en pilule : contact, enveloppe, globe, power.
- **Bas-droite, sous le dock** — icône orange type « Poste de travail » Windows XP.

Vocabulaire visuel du HUD :
- Pilules très arrondies (rayon ≈ moitié de la hauteur).
- Dégradé vertical : bleu clair en haut → bleu profond en bas.
- **Bandeau de highlight blanc sur la moitié supérieure** (le « gel » Aqua).
- Liseré blanc translucide de 1–2 px sur tout le contour.
- Ombre portée diffuse bleue.
- Typo bâton, blanche, avec ombre portée légère. Petites capitales pour les libellés.

## 3. Palette mesurée (k-means sur la zone scène uniquement)

| Poids | Hex | Rôle |
|---:|---|---|
| 27.2 % | `#15CEE8` | Cyan ciel — la couleur dominante de l'image |
| 20.6 % | `#48FD76` | Vert plaine médian |
| 15.4 % | `#1AF164` | Vert plaine saturé (proche) |
| 12.4 % | `#75FC85` | Vert plaine clair (lointain) |
|  6.7 % | `#74D0E6` | Brume d'horizon / cristal |
|  5.5 % | `#D1EBF1` | Blanc nuage / highlight verre |
|  4.7 % | `#2073C4` | Bleu HUD |
|  3.9 % | `#30D269` | Vert d'ombre |
|  1.9 % | `#233659` | Violet sombre (poissons) |
|  1.6 % | `#9F7B6A` | Brun chaud (poisson orange) — **seul accent chaud de l'image** |

Relevés ciblés :

```
ciel zénith        #14E3F0      buddy noyau       #1C9FE4
ciel médian        #13C8E7      buddy verre       #35E4F9
nuage              #B2D2EB      buddy highlight   #74F3F7 → #BDF1F7
herbe horizon      #89FF7F      CD argent         #DAECF4
herbe médiane      #48FD76      CD dérive cyan    #1A94BA
herbe proche       #19E25F      ville cristal     #75CEDC / #C8E4EC / #2DA7C3
HUD bleu profond   #0C57C9      HUD verre cyan    #26D4EB
HUD liseré froid   #CBF1F0      HUD bleu vif      #1063D7
```

## 4. Les cinq règles à ne pas casser

Si on rate un de ces cinq points, l'image ne ressemblera pas à la référence,
même si tout le reste est parfait.

1. **Le sol s'assombrit vers la caméra.** L'horizon est le point le plus clair et le
   plus jaune du sol. C'est contre-intuitif (l'atmosphère devrait délaver le lointain
   vers le *bleu*) mais c'est exactement ce que fait l'image, et ça crée ce halo
   lumineux sur la ligne d'horizon qui fait 80 % de la magie.
2. **Les stries radiales convergent au point de fuite.** Pas de damier, pas de grille
   perpendiculaire. Des rayons.
3. **Ligne d'horizon nette, jamais floue.** Cyan / vert au contact, sans transition brumeuse.
4. **Aucun matériau mat.** Verre, gel, laque, iridescence. Le moindre plastique diffus
   tue l'esthétique.
5. **Un seul accent chaud.** 1,6 % de l'image. Le reste est cyan et vert. Toute
   couleur chaude ajoutée doit être payée sur ce budget.

## 5. Ce que l'image ne montre pas (et qu'il faut inventer)

L'image est fixe. Le concept demandé est **la glisse**. Il faut donc créer de zéro,
sans référence :

- Comment le CD réagit à un virage (inclinaison, carre, morsure du sol).
- Ce qui gicle quand on carve (brins d'herbe ? gouttes ? pixels ?).
- La traînée derrière le disque.
- Le comportement de la caméra à haute vitesse.
- Le son.

Ces cinq points sont spécifiés dans [`03-GAME-FEEL.md`](03-GAME-FEEL.md).
