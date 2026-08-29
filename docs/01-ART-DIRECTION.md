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

/* HUD AERO */
--aero-deep       #0C57C9
--aero-blue       #1063D7
--aero-cyan       #26D4EB
--aero-frost      #CBF1F0
--aero-gel-top    rgba(255,255,255,.55)
--aero-gel-bot    rgba(255,255,255,.04)

/* ACCENT — budget total ≤ 2 % de l'écran */
--warm-accent     #9F7B6A
--violet-deep     #233659
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

### Buddy MSN — verre épais
`MeshPhysicalMaterial` :
```
color            #1C9FE4
transmission     0.92     ← il faut voir l'herbe à travers
thickness        1.4      ← épaisseur volumétrique, pas une bulle vide
ior              1.42
roughness        0.06
clearcoat        1.0
clearcoatRoughness 0.02
iridescence      0.35
iridescenceIOR   1.6
attenuationColor #0E7FC9  ← teinte accumulée dans l'épaisseur
attenuationDistance 2.2
envMapIntensity  1.6
```
Plus un **rim shader additif** par-dessus (Fresnel `pow(1 - dot(N,V), 2.4)` → `--buddy-rim`).
Le rim est ce qui détache le buddy du fond vert. Sans lui il disparaît.

### CD — diffraction
Shader custom. La règle : **ce n'est pas un miroir, c'est un réseau de diffraction.**
- Base argent `--disc-silver` en réflexion d'environnement, roughness 0.12.
- Par-dessus, un arc-en-ciel dont la teinte dépend de **l'angle azimutal autour du centre
  ET de l'angle de vue** : `hue = fract(atan(y,x)/TAU * 3.0 + dot(N,V) * 1.7 + time*0.05)`.
- Sillons : anneaux concentriques fins qui modulent la roughness (`sin(r * 900)`).
- Trou central + anneau clair, comme un vrai CD.
- Le dessous n'est pas noir : il capte le vert du sol en additif.

### Plaine
Shader custom sur un plan, pas de géométrie.
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
1. Bloom          seuil 0.62 · intensité 0.85 · rayon 0.72  → le gloss Aero
2. RadialBlur     centré au point de fuite, force ∝ vitesse  → la glisse
3. ChromaticAber  0.0006 au repos → 0.0035 en boost           → le punch
4. Vignette       0.28, douce                                  → recentre
5. SMAA                                                        → bords de HUD nets
```

Tone mapping : **ACES Filmic**, exposure 1.15. Sortie sRGB.
ACES écrase un peu les verts hors-gamut — c'est voulu, sinon ils postérisent.

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
