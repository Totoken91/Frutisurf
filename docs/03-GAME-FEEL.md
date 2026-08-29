# 03 — Spec de la glisse

> « ça doit être grave jouissif l'effet de glissade »

C'est **la** contrainte du projet. La scène peut être magnifique : si la glisse est molle,
c'est raté. Ce document est plus important que tous les autres.

---

## 1. Le principe directeur

La sensation de glisse ne vient pas de la vitesse. Elle vient du **contraste entre
résistance et libération**.

Un truc qui va vite en ligne droite est ennuyeux au bout de six secondes. Ce qui est
jouissif, c'est : je charge un virage, ça résiste, ça vibre, ça crache de l'herbe,
et **au moment où je relâche, tout se libère d'un coup**. Poussée, la caméra recule,
le champ s'élargit, le son s'ouvre, l'écran se met à trembler.

Toute la boucle est construite autour de ce cycle **charge → tension → décharge**.

## 2. Modèle physique

Repère : `+Z` = avant, `+X` = droite, `+Y` = haut. Le monde défile, le joueur reste
près de l'origine (world-shift pour la précision flottante).

```
speed        m/s, 22 (croisière) → 46 (boost) → 60 (plafond absolu)
steerInput   [-1, 1]  clavier / tactile / gamepad
steer        ressort vers steerInput,  ω=14  ζ=0.72   ← le léger overshoot = le "mordant"
lateralVel   steer · speed · 0.42
lean         ressort vers steer · 0.62 rad,  ω=9  ζ=0.55  ← plus mou que steer : le corps SUIT le disque
carveCharge  [0,1], monte si |steer|>0.55 à +0.55/s, redescend à -1.4/s
```

**Le décalage entre `steer` (ω=14) et `lean` (ω=9) est le cœur du feeling.**
Le disque tourne avant le corps. Le buddy est en retard sur sa propre trajectoire, il
se rattrape. Deux ressorts avec la même raideur = personnage en carton.

## 3. Le carve — la boucle addictive

```
    maintien du virage
           │
           ▼
    carveCharge monte ────────────────┐
           │                          │
    ┌──────┴───────┐            à 100 % :
    │ le disque    │            l'écran pulse en cyan
    │ se met sur   │            le son monte d'une tierce
    │ la tranche   │            le trail devient blanc
    │ le spray     │                  │
    │ s'intensifie │                  │
    └──────┬───────┘                  │
           │                          │
      RELÂCHEMENT ◄───────────────────┘
           │
           ▼
  ┌─────────────────────────────────────────┐
  │  POP                                     │
  │  · speed += 9 · carveCharge              │
  │  · FOV +14° en 90 ms, retour en 700 ms   │
  │  · aberration chromatique ×5             │
  │  · radial blur ×3                        │
  │  · burst de 90 particules d'herbe        │
  │  · shake caméra 0.35 amorti en 400 ms    │
  │  · hitstop 45 ms   ← LE détail qui vend  │
  │  · whoosh + note ascendante              │
  │  · combo ++                              │
  └─────────────────────────────────────────┘
```

Le **hitstop** : on gèle la simulation 45 ms au moment du pop pendant que le rendu
continue. Le cerveau lit ça comme un impact. C'est la technique de Smash Bros et de
Hollow Knight, et ça marche exactement pareil ici.

Enchaîner les carves gauche-droite maintient le combo. Le combo
**sature progressivement l'image** (bloom +, aberration +). À combo 10 l'écran
est presque trop beau. C'est la seule récompense, et elle suffit : il n'y a
aucun compteur à l'écran.

## 4. Caméra

La caméra fait la moitié du travail. Spec :

```
position     ressort critique vers (surfeur + offset),  ω=7.5
offset       (0, 2.9, -7.2) au repos
             → (0, 2.4, -8.9) à vitesse max  ← elle RECULE quand ça accélère
lookAt       surfeur + (steer · 3.4, 1.15, 9.0)  ← elle regarde DANS le virage
fov          62° → 86°, courbe = smoothstep(vitesse) ^ 1.3
roll         -lean · 0.28 rad  ← l'horizon s'incline. Non négociable.
noise        Perlin 0.35° d'amplitude, 1.7 Hz — juste assez pour que ce soit vivant
shake        impulsions amorties (atterrissage, pop de carve)
```

Le `roll` est le paramètre le plus sous-estimé du jeu vidéo. Sans lui, un virage à
grande vitesse ne se *ressent* pas. Avec 0.28 rad, ça devient physique.

`fov` qui monte compresse les bords de l'écran vers l'extérieur : c'est le
« speed warp ». Combiné au radial blur, c'est ce qui fait qu'on sent le vent.

## 5. Le saut

```
impulsion    +7.4 m/s vertical, gravité -22 m/s²
en l'air     · steer plus mou (ω=8), on ne carve pas
             · le disque s'incline vers l'avant de 0.18 rad
             · squash & stretch : Y ×1.14 / XZ ×0.93 à la montée
             · le monde perd 30 % de son bruit de caméra → sensation de flottement
atterrissage · squash Y ×0.78 / XZ ×1.16, retour élastique en 320 ms
             · anneau de choc au sol, 0 → 6 m en 500 ms, alpha en fondu
             · burst d'herbe radial
             · shake 0.22
             · hitstop 30 ms si chute > 1.8 m
             · thunk grave
```

Squash & stretch sur une icône MSN en verre : c'est absurde, et c'est exactement
pour ça que c'est bon.

## 6. Retours visuels continus

| Effet | Piloté par | Détail |
|---|---|---|
| **Spray d'herbe** | `\|steer\| · speed` | 0→160 particules/s, éjectées perpendiculairement au disque, gravité, teinte `--grass-mid`→`--grass-horizon`, durée 0.7 s |
| **Trail** | position du disque | Ruban de 64 segments, largeur ∝ vitesse, additif, teinte irisée, fondu sur 1.1 s |
| **Speed lines** | vitesse | Streaks radiaux en espace écran depuis le point de fuite, alpha ∝ `smoothstep(28,52,speed)` |
| **Halo de contact** | permanent | Disque additif vert sous le CD, taille pulsée par la vitesse |
| **Ondulation du sol** | vitesse | Le shader de plaine augmente son scroll et la netteté de ses stries |
| **Sillage dans l'herbe** | passage | Les brins instanciés se couchent sur le passage du disque et se relèvent en 0.8 s |

## 7. Audio (procédural, WebAudio, zéro asset)

- **Vent** : bruit blanc → filtre passe-bas dont la fréquence de coupure suit la vitesse
  (400 Hz au repos → 3.2 kHz à fond). Le son le plus important du jeu.
- **Glisse** : bruit rose filtré en bande, gain ∝ `|steer|`. C'est le crissement de la carre.
- **Charge de carve** : sinus dont la hauteur monte d'une tierce mineure sur la charge.
- **Pop** : whoosh (bruit + enveloppe rapide + sweep de filtre) + quinte juste.
- **Atterrissage** : sinus grave 70 Hz, decay 180 ms.

Tout démarre au premier geste utilisateur (politique autoplay).

## 8. Contrôles

| Action | Clavier | Tactile | Gamepad |
|---|---|---|---|
| Diriger | `←` `→` / `A` `D` | glisser à l'écran | stick gauche |
| Sauter | `Espace` / `↑` | tap | `A` |
| Boost | `Maj` | deux doigts | `RT` |

Le tactile est **relatif** (delta de glissement), pas absolu — un joystick virtuel
absolu casse la fluidité du carve.

## 9. Critères de recette

La glisse est validée quand :

1. On peut jouer 60 s sans toucher au saut et **s'amuser quand même**.
2. Le carve enchaîné gauche-droite est **plus rapide** que la ligne droite.
   (Sinon personne ne carve, et tout ce doc ne sert à rien.)
3. Couper le bloom, le trail et le spray, et la glisse reste bonne.
   **Si elle ne l'est pas, le problème est dans les ressorts, pas dans les effets.**
4. Un joueur qui lâche les touches ne meurt pas et ne s'ennuie pas.
5. Le pop de carve donne envie de le refaire immédiatement.
