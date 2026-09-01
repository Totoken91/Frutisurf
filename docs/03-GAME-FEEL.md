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

## 4 bis. Le relief et le saut timé

Le terrain est procédural : une somme de cinq sinus (`world/Terrain.ts`), donc
reproductible à l'identique côté CPU et GPU, et **dérivable analytiquement** —
on obtient la pente et la courbure sans échantillonner.

Les amplitudes ne sont pas choisies à l'œil mais **calées sur deux grandeurs
physiques** :

| grandeur | formule | ce qu'elle décide |
|---|---|---|
| pente | `a·f` | l'inclinaison ressentie, ~11° typique |
| courbure | `a·f²` | à partir de quand une crête ne peut plus retenir le disque |

Une crête éjecte le surfeur quand `courbure · v² > g · adhérence`. C'est ce
seuil qui fait qu'on **reste au sol en croisière et qu'on décolle en boost**,
sans aucun scénario écrit : la vitesse seule change le comportement.

> `adhérence = 1.8` représente la prise du disque sur l'herbe. À 1.0 (physique
> pure) le relief envoyait en l'air un quart du temps en croisière : on ne
> glissait plus, on rebondissait.

### Armer avant, viser après

Le saut se déclenche au **relâchement**, pas à l'appui. Maintenir au sol charge
un élan (`jumpWind`, plein en 0,5 s) qui comprime visiblement le buddy.

Deux multiplicateurs **indépendants** se composent :

```
  vy = JUMP_V × (0.60 + 0.75·élan) × (1 + 1.15·timing) + vitesse héritée de la montée
                └──── ce qu'on ANTICIPE ────┘   └── ce qu'on EXÉCUTE ──┘
```

Les séparer est délibéré : rater l'un n'annule pas l'autre, donc un débutant qui
arme sans viser progresse quand même, et un joueur qui vise sans armer aussi.
Il faut les deux pour un grand saut.

### La fenêtre de timing

```
                    lipFactor
    montée            ▁▃▅███▅▃▁            descente
  ─────────────────┬───────────┬─────────────────
                   │  fenêtre  │
                   │           │
   appuyer ici → saut mou      saut mou ← appuyer là
                   └─ ici : +115 % d'impulsion ─┘
```

`lipFactor` combine **deux** conditions, jamais une seule : le terrain doit être
bombé (courbure négative) **et** à peu près plat (pente proche de zéro). Avec la
seule convexité, on récompenserait aussi le milieu d'une pente descendante.

Le gabarit mesure la courbure sur ±7 m. Ce n'est pas arbitraire : à cette portée
il capte les collines roulables (84 m et 42 m de longueur d'onde) et **filtre la
texture de 21 m**. On veut timer un sommet, pas chaque caillou.

Le saut hérite en plus de la vitesse verticale que la montée donnait déjà, donc
appuyer *juste avant* le sommet paie aussi : la fenêtre reste indulgente.

### Le repère est SONORE

Le signal qui dit *quand appuyer* est un **tic court**, joué une seule fois à
l'entrée dans la fenêtre, avec hystérésis pour qu'il ne se redéclenche pas sur
le bruit du terrain. Ça n'occupe aucun pixel et ça s'apprend en trois collines.

> La première version était une sinusoïde continue dont le volume suivait la
> proximité de la crête. Sur un terrain vallonné elle enflait et retombait sans
> arrêt : à l'oreille, un « woooo » qui surgit au hasard. **Un événement
> ponctuel informe aussi bien et ne pollue pas le fond sonore** — la règle vaut
> pour tout signal lié à une grandeur qui varie en permanence.

### Le plané

Maintenir le saut **après l'apex** (jamais pendant la montée — ça donnerait un
saut mou au lieu d'un envol suivi d'un vol) :

- une **impulsion de portance** de +2,2 m/s à l'ouverture : sans elle on
  « arrête de tomber », avec elle on **accroche** l'air. Elle ne se prend
  **qu'une fois par vol** — sinon relâcher et re-maintenir la redonne à chaque
  fois, et il suffit de tapoter pour ne jamais redescendre (le contrôle
  automatique a trouvé cet exploit : un pilote restait 89 s en l'air d'un seul
  saut) ;
- gravité à 20 %, puis retour progressif à 100 % en ~3 s ;
- la vitesse est maintenue, ce qui rend la ligne aérienne compétitive face au
  carve au sol ;
- le buddy se cabre, la caméra recule, prend de la hauteur et vise plus bas —
  on veut voir **où on va retomber**.

### Les indulgences d'entrée

Deux fenêtres de quelques centièmes font toute la différence entre un saut qui
« ne répond pas » et un saut qui pardonne :

- **Coyote** (0,13 s) : on peut encore sauter juste après avoir quitté le sol.
  On a roulé par-dessus la crête et appuyé un poil trop tard.
- **Tampon** (0,16 s) : un relâchement juste avant l'atterrissage part dès le
  contact, sans nouvel appui. L'élan monte aussi **en vol**, donc on peut armer
  pendant un plané et repartir à la seconde où l'on touche.

Le contrôle **aérien est plus fort qu'au sol** (0,56 contre 0,42) : en l'air on
n'a que ça pour viser sa réception ou rattraper une colonne.

### La réception

Atterrir dans la pente descendante amortit et relance ; à plat ou en montée, ça
casse. C'est ce qui pousse à choisir *où* retomber, pas seulement *quand* sauter.

## 4 quater. Les colonnes de vitesse

Semées en **slalom** en travers du couloir, à ~65 m d'écart. Les enchaîner
demande de tourner : c'est une récompense d'adresse, pas un ramassage passif.

Elles donnent une impulsion **franche et immédiate** (+11 m/s) en plus de
recharger la jauge. Un bonus qui se contenterait de remplir la jauge ne se
sentirait pas au moment où on le prend, et c'est précisément cet instant qui
doit payer.

> Deux erreurs de conception corrigées en cours de route, toutes deux
> invisibles à la lecture du code et évidentes à l'écran :
>
> - **semées au hasard dans une fenêtre**, elles laissaient des trous de plus de
>   100 m. Elles s'accrochent maintenant en **chaîne** à écart contrôlé, ce qui
>   garantit toujours une colonne à portée de vue.
> - **posées à plat sur le relief**, elles n'offraient presque aucune surface
>   depuis une caméra rasante, et celles dans un creux disparaissaient derrière
>   la colline suivante. On ne peut pas viser ce qu'on ne voit pas. Ce sont
>   maintenant des colonnes verticales, visibles par-dessus le terrain.

## 4 ter. L'économie du boost

Le boost n'est plus une touche qu'on tient : c'est une **ressource**. Sans coût,
enchaîner des figures ne servirait à rien.

| Source | Gain |
|---|---|
| Pop de carve (slalom) | `+0.11 × charge` |
| Saut timé | `+0.13 × timing + 0.06 × élan` |
| Plané | `+0.10 / s` |
| Réception propre | `+0.16 × qualité` |
| Recharge passive | `+0.03 / s` |

La dépense est de `0.40/s`, soit 2,5 s de boost continu depuis le plein. La
recharge passive seule ne suit pas : elle sert de plancher pour ne jamais rester
bloqué, pas de source. Mesuré à dépense égale, un pilote qui enchaîne les
figures gagne **plus du double** de boost qu'un pilote qui roule tout droit.

## 4 quinquies. La structure de partie

Le jeu avait de la glisse, des figures et une jauge — mais **aucun objectif**.
On roulait joliment sans jamais avoir de raison de tourner ici plutôt que là,
et sans jamais pouvoir perdre. Or sans enjeu, pas de tension ; sans tension,
aucune raison de relancer.

### Le chrono, seul enjeu

Une partie démarre avec **30 s**, plafonnées à 45 s. On ne meurt jamais d'un
choc — rien ne casse la glisse, c'est le contrat artistique du projet. On meurt
de ne plus avoir de temps.

Le sablier **accélère** : ×1 au départ, ×2,4 au bout de 140 s. Sans cette
montée, le pilote automatique du test tenait cinq minutes et se serait arrêté
de fatigue ; le score cessait d'être une performance pour devenir une mesure de
patience. La maîtrise allonge le run, elle ne le rend pas éternel.

### Les anneaux

Semés en chaîne devant le joueur, comme les colonnes, tous les 64 à 98 m. Deux
hauteurs, et c'est tout le design :

| | Centre | Rend | Vaut | Ce qu'il demande |
|---|---|---|---|---|
| Anneau bas | sol + 3,6 m | 3,0 s | 220 × mult | un déplacement latéral |
| Anneau haut | sol + 9,0 m | 4,0 s | 400 × mult | lire le relief, armer, viser |

L'anneau bas est **planté dans l'herbe** : son bas passe 1,8 m sous la surface.
Posé juste au-dessus du sol, il aurait fallu un petit saut pour l'enfiler, et le
rythme de base ne serait plus la glisse mais le saut. Enterré, on l'enfile en
roulant, avec 3,3 m de marge latérale.

Deux anneaux hauts d'affilée sont interdits : on ne peut pas réarmer un saut
assez vite, et rater le second serait une punition subie et non méritée.

Rater un anneau ne coûte **rien** d'autre que le temps qu'il aurait rendu — pas
de buzzer, pas de combo cassé. Le son du raté est une note sourde, pas une
faute : le chrono est déjà la punition.

### Les vrilles

Tenir la direction **à fond** en l'air fait tourner le disque, un tour en 0,65 s.
Seuls les tours **complets** comptent, et ils paient en carré : un tour vaut 220,
deux tours en valent 880. C'est ce qui pousse à chercher LE grand saut plutôt
qu'à enchaîner des demi-sauts.

Le même geste dirige et vrille. C'est voulu : viser sa réception et faire un
tour deviennent le même arbitrage, une décision au lieu d'une touche de plus.
Et vriller **du côté** de l'anneau suivant fait avancer les deux à la fois —
c'est la ligne de jeu que le mécanisme récompense.

Mais une vrille engagée **étouffe le contrôle latéral** (×0,28) : le disque
présente sa tranche, il ne mord plus l'air. Sans ce frein, tenir la direction à
fond expédiait le surfeur hors du couloir en une seconde et vriller devenait
incompatible avec viser. Avec lui, tourner c'est renoncer à corriger.

Chiffres mesurés par `npm run check:run`, quatre pilotes sur le même terrain :

| Pilote | Survie | Anneaux | Tours | Score |
|---|---|---|---|---|
| passif (ne fait rien) | 27 s | 0 | 0 | 632 |
| chasseur (vise les anneaux) | 170 s | 77 | 2 | 345 000 |
| sauteur (même profil de saut, sans vrille) | 122 s | 45 | 4 | 98 000 |
| vrilleur | 120 s | 27 | 63 | 295 000 |

Le sauteur est le **témoin** : comparer le vrilleur au chasseur mélangerait
deux différences (il saute plus ET il vrille) et ne dirait rien sur la valeur de
la figure elle-même. À saut égal, vriller triple le score — au prix de 39
anneaux ratés. C'est l'arbitrage qu'on voulait.

### Le grelottement, corrigé au passage

Le test de partie a mis au jour un défaut invisible à l'œil mais mortel pour les
figures : **1633 « sauts » en 205 s, 66 ms de vol chacun**. Le décollage naturel
se déclenchait pile au sommet, là où la pente est nulle, donc avec une vitesse
verticale quasi nulle. Le surfeur grelottait sur chaque bosse dès que la vitesse
montait, et toute vrille en cours repartait de zéro avant d'avoir tourné d'un
dixième de tour.

Deux verrous : une vitesse verticale minimale de 3 m/s pour qu'un décollage
naturel compte, et 0,35 s d'interdiction après chaque réception. Résultat : 85
décollages au lieu de 1633, et des vols d'une seconde où une figure tient.

## 4 sexies. La largeur du terrain, et le pouce

### « Ça se joue sur une fine tranche, comme sur des rails »

Le couloir faisait ±14 m : deux longueurs de disque de chaque côté, et toute la
trajectoire tenait dans une bande plus étroite que l'écran. Il fait **±34 m**.
La plaine redevient une plaine — on peut couper large, laisser tomber un anneau
pour en viser un autre, et revenir.

Trois réglages suivent, sinon un terrain plus large n'est qu'un terrain où l'on
rate davantage :

- semis des anneaux élargi de ±8,5 à **±18 m**, celui des colonnes de ±12 à ±24 ;
- autorité latérale relevée (0,42 → **0,52** au sol, 0,56 → 0,64 en l'air) : il
  faut pouvoir traverser la nouvelle largeur entre deux anneaux ;
- un anneau sur quatre revient **près du centre**. Une alternance stricte
  gauche-droite-gauche finit par se jouer toute seule, et c'est exactement la
  sensation de rail qu'on voulait supprimer.

Le pilote automatique du test enfile toujours 110 anneaux en 217 s sur ce
terrain élargi : la liberté n'a pas coûté la lisibilité.

### « Les déplacements latéraux sont difficiles au téléphone »

Le manche tactile demandait **34 % de la largeur d'écran** pour aller en butée,
et faisait dériver son point de référence de 6 % à chaque événement. Deux
conséquences, toutes deux mauvaises au pouce :

1. maintenir un virage exigeait de glisser **sans arrêt**, puisque la référence
   rattrapait le doigt ;
2. inverser demandait de reparcourir toute la course dans l'autre sens.

Le manche est maintenant **collant** : l'ancre ne dérive pas, mais elle est
poussée dès qu'on dépasse la course. Le doigt reste donc toujours à exactement
une course de la butée opposée. Un virage se tient sans bouger le pouce, et
s'inverse instantanément. Course ramenée à **20 %** de la largeur, courbe expo
adoucie de 1,35 à 1,20 — combinée au manche collant, l'ancienne mangeait trop
des petits déplacements, ceux dont on se sert le plus.

## 4 septies. Deux corps, deux animations

Tant que le buddy et le disque partageaient exactement la même rotation, ils ne
formaient qu'un seul objet rigide : un bibelot qu'on déplace, pas un personnage
qui surfe. Ils ont désormais chacun leurs ressorts, et ce sont les **écarts de
raideur** qui font tout — des raideurs égales redonneraient un bloc, quel que
soit le nombre de ressorts empilés.

| | Raideur ω | Amplitude | Rôle |
|---|---|---|---|
| roulis du disque | 19 | ×0,68 | la carre mord, tout de suite |
| roulis du buddy | 7,5 | ×0,62 | il part en retard et se redresse après |
| appui latéral | 9 | 0,085 | il s'appuie vers l'**extérieur** du virage |
| ballant vertical | 12 | ±0,10 | il encaisse les chocs un temps après le disque |

Le disque bascule **plus** que le buddy, pas moins : c'est la carre qui mord, le
rider reste relativement droit au-dessus. L'inverse donnait un bonhomme penché
sur une planche à plat, ce qui se lit comme une chute.

L'appui latéral va vers l'extérieur, comme un passager en voiture. Vers
l'intérieur, il aurait l'air de piloter le disque au lieu d'être porté par lui.

S'y ajoute une **précession** sur le disque, deux sinusoïdes de fréquences
volontairement incommensurables (3,10 et 2,27) : à fréquences proches, le motif
se répète à l'œil au bout de quelques secondes et trahit la boucle.

L'écart vertical entre les deux volumes n'est pas décoratif — il **fixe le
roulis maximal du disque**. À 1,1 de rayon et 26° de bascule, le bord haut
atteint 0,48 : au-delà, la carre traverse le personnage. C'est ce calcul qui a
fixé l'écart à 0,55 et le roulis à 0,68.

L'ensemble est agrandi d'un sixième : le sujet occupait trop peu de place à
l'écran pour qu'on lise ces décalages.

## 4 octies. L'eau : glisser ou couler

C'est le premier obstacle du jeu qui **teste la vitesse** au lieu de tester la
visée. Anneaux, colonnes et crêtes demandent tous de mettre le disque au bon
endroit ; l'eau demande d'y arriver assez vite. Un jeu de vitesse a besoin d'au
moins une porte qui n'admet que la vitesse, sinon rien ne pousse jamais à
accélérer au-delà du confortable.

### Aucun lac n'est placé

Il y a une constante, `WATER_LEVEL = -5.5`, et l'eau remplit tout ce que le
relief laisse en dessous. Les rives sont donc les **courbes de niveau** du
terrain : organiques, toutes différentes, gratuites. Le même chiffre sert au
CPU (`isWater`) et au GPU (`terrainGLSL()`), donc la rive vue à l'écran est
exactement celle où la physique bascule.

Le niveau a été choisi sur des mesures, pas à l'œil (`npm run check:water`) :

| Mesure | Valeur |
|---|---|
| Part du parcours sous l'eau | 17,6 % |
| Lacs rencontrés | 35 pour 6 km, soit un toutes les ~9 s |
| Largeur moyenne dans le couloir | 47 m, ~1,5 s de traversée |

Assez fréquent pour être une mécanique, assez court pour que rater ne
condamne pas la partie.

### Le seuil, et pourquoi il y en a deux

| | Vitesse effective | Effet |
|---|---|---|
| Entrer en glisse | > 25 m/s | le disque porte, on reste à la surface |
| Rester en glisse | > 19 m/s | hystérésis |
| Sinon | — | on s'enfonce d'un mètre, la vitesse tombe vers 5 m/s |

Un seuil unique ferait **clignoter** la glisse au milieu d'une nappe : la
vitesse oscille naturellement autour de sa cible, et le joueur verrait le disque
plonger et ressortir sans avoir rien fait. L'écart de 6 m/s entre entrée et
maintien est ce qui rend la traversée lisible. `check:water` compte les
bascules et échoue au-delà de six sur douze secondes.

Une fois enfoncé, on ne remonte pas : la traversée est **jouée à l'entrée**.
Pouvoir se rattraper en cours de nappe supprimerait la décision.

### Ce que la glisse change au pilotage

Sur l'eau la surface est plate : ni pente, ni courbure, donc ni frein de montée
ni décollage naturel. On cesse d'un coup de sentir le relief, et c'est
précisément la sensation recherchée. L'adhérence tombe à ×0,62 — le disque
**dérive**, le virage devient long et doux. Coulé, elle tombe à ×0,35 : on ne
dirige presque plus.

Le plancher de vitesse de 9 m/s est levé quand on est coulé. C'est le seul
endroit du jeu où le surfeur peut descendre à rien, et il faut qu'il le puisse :
sans cela, « couler » ne serait qu'un changement de décor.

### La récompense est payée à la SORTIE

Elle ne compte qu'une fois la rive atteinte : `90 + 9 × mètres`, un combo, du
boost, un bonus de vitesse et jusqu'à 4,5 s au chrono. Payée à l'entrée, elle
serait un bonus qu'on encaisse en touchant l'eau ; payée à la sortie, elle est
une **performance**.

### Les retours

| Signal | Glisse | Coulé |
|---|---|---|
| Son | plouf clair + nappe de clapot continue | note qui **tombe**, nappe étouffée à 280 Hz |
| Caméra | coup de FOV +8 | coup de FOV **−12** |
| Silhouette | le disque se cabre (−0,15) | il pique (+0,10), le buddy immergé jusqu'au cou |
| Surface | sillage en V et écume centrale | remous, pas de sillage |
| HUD | `GLISSE 47m +512` à la sortie | `COULÉ`, le seul retour éteint du jeu |

Le sillage en V n'est pas un ornement : c'est le **seul** retour qui reste
visible quand la caméra est basse et que le disque disparaît derrière le buddy.
Sans lui, glisser et flotter se ressemblent. Il est mélangé à l'eau *avant* les
paillettes — posé après, il les effaçait et devenait une bande de peinture
blanche mate au milieu d'une surface qui scintille partout ailleurs.

Rien à l'**entrée** côté HUD : le lac suivant arrive neuf secondes plus tard,
une bannière à chaque rive occuperait l'écran en permanence.

## 4 nonies. La secousse de caméra, et le « ça clignote »

Deux plaintes du joueur, un seul défaut : « la caméra bouge brutalement quand on
clique » et « ça clignote ».

La secousse déplaçait la **position** de la caméra de `shake` mètres — jusqu'à
35 cm sur un pop chargé, davantage en cumulant — à partir d'un bruit
échantillonné à **26×** le temps.

Les deux moitiés sont fausses, et il fallait corriger les deux.

### Le bruit était du bruit blanc

À 60 images par seconde, un argument qui avance de 0,43 par image dépasse la
taille des motifs du bruit : deux images consécutives tirent des valeurs
**indépendantes**. Mesuré à 0,19 d'écart moyen par image et jusqu'à 0,85 sur une
plage de 2 — exactement ce que le commentaire d'origine prétendait éviter.

| Vitesse du bruit | Écart moyen / image | Pire |
|---|---|---|
| 1,7× (tenue en main) | 0,020 | 0,101 |
| 6× | 0,066 | 0,316 |
| 26× (l'ancienne secousse) | **0,190** | **0,851** |

Une image entière qui vibre au rythme de l'affichage, l'œil ne l'appelle pas
« secousse ». Il l'appelle **« ça clignote »**.

### Ralentir le bruit ne suffisait pas

L'enveloppe retombe en trois dixièmes de seconde ; pendant ce temps, un bruit
lent n'a pas le temps de bouger. On obtenait une pichenette statique qui
s'efface — mesurée à 0,18° d'amplitude, invisible.

Ce qu'il faut est une **oscillation amortie** : trois sinusoïdes à 7,9 / 6,3 /
5,1 Hz (incommensurables, pour que les axes ne se remettent jamais en phase),
sous l'enveloppe qui les tue en 0,3 s. Une dizaine d'images par cycle : assez
rapide pour claquer, assez lent pour rester continu.

### Et elle porte sur l'orientation, pas sur le trépied

À dix mètres du sujet, 35 cm de translation donnent le bon nombre de pixels —
mais déplacent le **point de vue** : toute la parallaxe se réorganise d'une image
à l'autre, l'herbe du premier plan balaie l'écran. Le cinéma secoue
l'orientation, pas le trépied.

### Ce que ça donne

`npm run check:shake` pilote le rig à 60 Hz exacts, sans rendu, et le compare à
un second rig identique **sans secousse** — c'est cette différence qui isole ce
que la secousse ajoute.

| | Ampleur | Inversions de sens | Retour au calme | Point de vue |
|---|---|---|---|---|
| repos | 0,00° | 11 % | — | 0,27 cm/img |
| pop chargé | 0,81° | 15 % | 0,35 s | 0,27 cm/img |
| anneau + plot + pop | 1,20° | 18 % | 0,27 s | 0,27 cm/img |

Le critère central n'est pas la vitesse — une secousse d'impact **doit** bouger
vite, la brider revient à la supprimer. C'est la **cohérence** : une oscillation
garde son sens plusieurs images d'affilée, un bruit blanc en change une image sur
deux. Au-delà de 35 % d'inversions, ce n'est plus un mouvement, c'est du grain.

Le cumul est aussi plafonné (`SHAKE_MAX`, `FOV_PUNCH_MAX`) : `Decay.add`
additionne sans borne, et un anneau, un plot et un pop peuvent tomber dans la
même seconde. Sans plafond, c'est précisément au moment où le joueur réussit
quelque chose que la caméra devenait illisible.

### Au passage : le flash ne dépend plus de l'écran

`popFlash` décroissait de 12 % **par image**, donc deux fois plus vite sur un
téléphone à 120 Hz et deux fois plus lentement à 30. Un retour visuel dont la
durée dépend de l'écran ne se règle pas. C'est désormais une exponentielle en
temps, calée pour valoir exactement l'ancienne vitesse à 60 Hz.

## 4 decies. L'armement ne fait plus d'aspirateur

Maintenir pour armer nourrissait le bourdon de charge : une note tenue dont la
hauteur suivait l'élan. Au bout de deux secondes de maintien, ça s'entend comme
un **aspirateur**.

La règle qui manquait : un son **continu** ne convient qu'à un état qu'on
**subit** — le vent, la vitesse, la glisse sur l'eau. Une action volontaire et
brève se **ponctue**.

L'armement a donc trois **paliers** — 33 %, 66 %, 100 % — marqués par un tic
court. Trois tics espacés disent la même chose qu'une note qui monte, mais on
peut les **compter** : lâcher au bon moment devient une décision au lieu d'une
estimation. Et surtout ils s'arrêtent.

Le troisième sonne une quinte au-dessus avec une harmonique : c'est le seul dont
le joueur a vraiment besoin, puisqu'il dit « c'est plein, lâche ».

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

Deux familles, et la distinction compte : des **nappes continues** qui suivent
un état (vent, crissement, plané, charge), et des **événements ponctuels** liés
à une action du joueur. Rien entre les deux — un son qui surgit sans cause
identifiable s'entend comme un bug, même quand il est déclenché par une vraie
grandeur du jeu.

- **Vent** : bruit blanc → filtre passe-bas dont la fréquence de coupure suit la vitesse
  (400 Hz au repos → 3.2 kHz à fond). Le son le plus important du jeu.
- **Glisse** : bruit rose filtré en bande, gain ∝ `|steer|`. C'est le crissement de la carre.
- **Charge de carve** : sinus dont la hauteur monte d'une tierce mineure sur la charge.
- **Pop** : quinte juste, dont l'intensité suit la charge.
- **Atterrissage** : sinus grave 70 Hz, decay 180 ms.
- **Glisse sur l'eau** : bruit blanc en bande large (900 Hz → 2.6 kHz avec la
  vitesse) modulé par un LFO à 5,5 Hz. Sans le LFO c'est une soufflerie ; avec
  lui, c'est de l'eau qui passe sous la planche.
- **Plouf** : bruit filtré dont la bande **monte** (2.6 → 5.2 kHz) si l'on
  rebondit, et **tombe** (900 → 260 Hz) si l'on s'enfonce. Le joueur sait à
  l'oreille avant de le voir.

Tout démarre au premier geste utilisateur (politique autoplay).

## 8. Contrôles

| Action | Clavier | Tactile | Gamepad |
|---|---|---|---|
| Diriger | `←` `→` / `A` `D` | glisser à l'écran | stick gauche |
| Sauter | `Espace` / `↑` | tap (maintenir = armer) | `A` |
| Vriller | direction à fond en l'air | glisser à fond en l'air | stick à fond |
| Boost | `Maj` | deux doigts | `RT` |
| Rejouer | n'importe quelle touche | tap | `A` |

Le tactile est **relatif** (delta de glissement), pas absolu — un joystick virtuel
absolu casse la fluidité du carve.

## 9. Critères de recette

Six vérifications automatiques tiennent ces critères (`npm run check`,
`check:air`, `check:input`, `check:run`, `check:water`, `check:shake`). Toutes sauf
`check:input` simulent le contrôleur **sans rendu** : si le feeling dépend d'un
effet visuel, c'est que les ressorts sont ratés.

`check:water` traverse une vraie nappe à cinq vitesses, de part et d'autre des
deux seuils, et exige que les deux issues restent atteignables et clairement
séparées — plus une vitesse de sortie au moins deux fois plus haute en glissant
qu'en coulant, sans quoi l'erreur ne coûte rien.

`check:air` fait rouler quatre pilotes sur le même terrain — un qui ne saute
jamais, un qui saute au hasard, un qui saute sur la crête, un qui plane — et
compare le **vol par saut**, pas le vol total : un bon planeur croise moins de
crêtes, donc son total peut baisser alors que chaque saut est meilleur.

Le pilote qui ne saute jamais est le garde-fou anti-trampoline : si le terrain
seul envoie en l'air plus de 30 % du temps en croisière, ce n'est plus un jeu
de glisse.

La glisse est validée quand :

1. On peut jouer 60 s sans toucher au saut et **s'amuser quand même**.
2. Le carve enchaîné gauche-droite est **plus rapide** que la ligne droite.
   (Sinon personne ne carve, et tout ce doc ne sert à rien.)
3. Couper le bloom, le trail et le spray, et la glisse reste bonne.
   **Si elle ne l'est pas, le problème est dans les ressorts, pas dans les effets.**
4. Un joueur qui lâche les touches ne meurt pas et ne s'ennuie pas.
5. Le pop de carve donne envie de le refaire immédiatement.
6. Sauter sur la crête bat nettement sauter au hasard (**+63 %** de vol par saut).
7. Planer allonge encore le vol (**+42 %**) sans rendre le sol inutile.

---

## 10. L'équipement : trois buddies, trois montures

### La règle, et elle vaut plus que le contenu

**Chaque choix se paie.** Aucune option n'est meilleure qu'une autre sur tous les
axes — sinon il n'y a pas de choix, il y a une bonne réponse et cinq mauvaises,
et le joueur cesse d'ouvrir l'écran dès la deuxième partie.

Chaque entrée a donc exactement **un avantage franc et un coût franc**, et la
somme des modificateurs est nulle à peu de chose près. C'est un peu plus sévère
que ce que font la plupart des jeux, et c'est ce qui garde les six combinaisons
vivantes.

### Les cinq axes

| Axe | Ce qu'il change vraiment | Où il atterrit |
|---|---|---|
| `cruise` | Vitesse de croisière. **L'axe le plus lisible, donc le plus cher** : plus de distance et plus de score par seconde, mais moins de temps pour lire le relief. | `Controller.cruise()` |
| `grip` | Autorité latérale. Fort, il rattrape un anneau mal abordé ; faible, il force à anticiper mais rend les longues courbes plus douces et les vrilles plus faciles à boucler. | le facteur `grip` du déplacement |
| `lift` | Portance au saut et à l'ouverture du plané. Change la durée de vol, donc le nombre de tours et l'accès aux anneaux hauts. | `JUMP_V`, et le coup de portance |
| `plane` | Seuil de glisse sur l'eau. Plus il est haut, plus le seuil est **bas** — on déjauge plus tôt. | `PLANE_ENTER / plane` |
| `boost` | Vitesse de recharge de la jauge, fond de régénération compris. | `reward()`, `BOOST_REGEN` |

### Les six options

| Buddy | Avantage | Coût |
|---|---|---|
| **BLEU** | — | — (le neutre assumé) |
| **NÉON** | boost ×1,15 · cruise ×1,10 | grip ×0,86 |
| **GIVRE** | grip ×1,24 | cruise ×0,93 · plane ×0,90 · lift ×0,96 |

| Monture | Avantage | Coût |
|---|---|---|
| **CD** | — | — |
| **VINYLE** | cruise ×1,12 | grip ×0,82 · lift ×0,88 · plane ×0,94 · boost ×0,94 |
| **MINIDISC** | lift ×1,22 · grip ×1,12 · plane ×1,10 | cruise ×0,95 |

Les extrêmes se composent sans jamais sortir du jouable : NÉON+VINYLE plafonne à
`cruise` 1,23 et descend à `grip` 0,71 ; GIVRE+MINIDISC monte à `grip` 1,39. Les
seuils bougent, les bornes du Controller ne bougent pas.

### Ce que l'écran affiche, et pourquoi

**Chaque carte porte son coût**, sur la carte et pas dans une infobulle. Une
option sans étiquette ambre est explicitement marquée *équilibré* : l'absence de
coût est une information, pas un blanc.

**Les étiquettes sont calculées, jamais écrites.** `Loadout.highlights()` lit le
plus gros multiplicateur au-dessus de 1 et le plus gros en dessous. Un libellé
rédigé à la main survit toujours à l'équilibrage qui le rend faux, et l'écran se
met alors à mentir sans que rien ne le signale.

**Le profil est affiché pour la combinaison, pas par carte.** Le joueur ne joue
pas un buddy et une monture, il joue leur **produit**. Cinq jauges signées,
tracées depuis le centre : la grandeur intéressante est un **écart au neutre**,
et une barre remplie depuis la gauche cacherait le signe, qui est tout le sujet.
Le coût est **ambre et non rouge** — le rouge dit l'erreur, or aucun choix n'est
une erreur ici ; l'ambre dit le prix.

Les jauges s'animent en `scaleX` et **jamais** en largeur. Ce n'est pas une
optimisation de confort : une transition CSS sur `width` part d'un `auto` que le
navigateur ne sait pas interpoler, et la barre reste **à zéro**. C'est
exactement ce qui est arrivé, et c'est la capture qui l'a montré — pas le
raisonnement.

### Le choix se voit en jeu

Un écran de sélection qui ne change rien à l'écran suivant est un écran qui ment.
Le buddy change de verre (quatre teintes portées par un terme **additif** du
shader : toucher `material.color` n'aurait rien changé, le lobe diffus ne sert
qu'à la réponse à la lumière), et le disque change de matière **et de taille**.

L'échelle n'est pas cosmétique, elle **dit la statistique** : le vinyle est plus
grand parce qu'il est lourd et rapide, le MiniDisc plus petit parce qu'il vole.
Un joueur qui n'a pas lu l'écran voit quand même qu'il ne pilote pas la même
chose.

### Quand il s'ouvre

Au **premier lancement uniquement**, et depuis le panneau de fin. Un menu imposé
à chaque lancement est exactement ce qui tue le « encore une » d'un jeu de
quarante secondes.

---

## 11. Quatre mondes, quatre façons de jouer

### Un monde change le jeu, pas le décor

| Monde | Eau | Ce qu'on y joue |
|---|---|---|
| **PLAINE** | 17 % | l'équilibre de référence : on lit le relief, on enfile les anneaux, un lac toutes les neuf secondes. |
| **OKINAWA** | 50 % | **la glisse**. On passe la moitié du temps sur l'eau ; l'autopilote y compte 108 traversées contre 45 sur la plaine. |
| **BLISS** | 0 % | **les figures**. Pas une goutte d'eau, donc pas un seul point de traversée : on n'a plus que le relief et l'air. |
| **CHROME** | 28 % | **la vitesse**. Relief anguleux, mercure glissant, on saute beaucoup et on lit peu. |

### Les mondes portent des multiplicateurs, et ils y sont obligés

J'ai d'abord décidé que les mondes seraient purement cosmétiques : le terrain
change déjà énormément, et des modificateurs de stats ouvraient un gouffre
d'équilibrage. **La mesure a tranché contre moi.**

Okinawa, à moitié sous l'eau, coulait le joueur dans le premier lagon : départ à
18 m/s, seuil de déjaugeage à 25, vitesse qui tombe à 5, et plus assez de terre
entre deux nappes pour se relancer. Le monde n'existait pas, et aucun réglage de
relief ne le rattrapait sans le transformer en plaine.

La bonne réponse était **dans le thème** : un lagon est peu profond, on y déjauge
tout de suite. Okinawa porte donc `plane` à **1,55** — le seuil tombe à 16 m/s,
on skie sur le lagon dès le départ, et c'est exactement l'image qu'on venait
chercher. Le coût est ailleurs : on **dérive**.

| Monde | Avantage | Coût |
|---|---|---|
| **PLAINE** | — | — |
| **OKINAWA** | `plane` ×1,55 — on déjauge à 16 m/s | `grip` ×0,92 |
| **BLISS** | `lift` ×1,08 · `boost` ×1,10 | `grip` ×0,94 |
| **CHROME** | `cruise` ×1,08 · `plane` ×1,15 | `grip` ×0,94 · `lift` ×0,96 |

Bliss n'a pas d'eau, donc pas de traversées : c'est **toute une source de score
et de secondes** qui disparaît. Le monde la rend en portance et en boost — on y
joue les figures, faute de lacs. Ça se voit dans les chiffres : 971 000 points
contre 2,4 millions sur la plaine, pour une durée de vie comparable. Bliss est
le monde **calme**, et il l'assume.

### Un record par monde

Un record unique aurait mis les quatre mondes en concurrence, et la seule
stratégie gagnante serait de toujours jouer le plus généreux : les trois autres
seraient devenus du décor qu'on visite une fois. Une clé de stockage par monde,
et chacun devient son propre défi. C'est aussi ce qui rend le choix
**réversible** — y revenir ne coûte pas son record.

### Le monde est le troisième perk

L'écran d'équipement a donc trois rangées, et les cinq jauges du bas donnent le
profil du **produit des trois** : monde × buddy × monture. C'est ce qui rend
lisible pourquoi Okinawa se joue autrement — la jauge GLISSE part à fond, la
jauge ACCROCHE recule, et on n'a rien eu à expliquer.

### Le décor reste vivant pendant qu'on choisit — mais pas la course

Toucher une carte de monde applique le monde **immédiatement**, avant toute
validation : le fondu dure 1,15 s et se joue derrière le panneau. On ne lit pas
la description d'un lagon, **on le voit apparaître**. La vignette de la carte ne
sert plus qu'à reconnaître un monde déjà vu.

Le surfeur, lui, **attend**. Il ne parcourt pas un mètre, ne marque pas un
point, ne franchit pas une vague. Sa vitesse est conservée telle quelle, pour
qu'annuler soit une vraie pause et non une punition — on repart exactement où
l'on s'était arrêté.

Ce n'est pas un simple `if` autour du pas de simulation, et c'est ce qui rend la
chose intéressante : pendant qu'on survole les mondes, **le relief se transforme
sous le disque**. La plaine s'inonde, l'archipel émerge. Un surfeur simplement
figé garderait la hauteur de l'ancien monde et finirait enterré dans la colline
ou suspendu au milieu du lagon. Il faut donc continuer à lire le sol et
seulement cesser d'avancer — et il **flotte** au lieu de couler, puisqu'il n'y
a pas de partie en cours à perdre.

### Revenir au menu ne doit pas coûter la course

L'écran n'avait qu'une issue, « c'est parti », qui relance. On y accède
maintenant à tout moment — un bouton dans la bande haute, ou Échap — et on en
sort par une croix qui **annule** : le monde survolé revient à celui qu'on
avait, le chrono reprend là où il s'était arrêté, la distance n'est pas remise
à zéro.

Deux détails de placement qui ne sont pas cosmétiques :

- le bouton vit dans la **bande haute**. Sur téléphone on saute en touchant
  n'importe où : un bouton posé dans l'aire de jeu volerait un saut sur deux.
  Le HUD avale le contact avant qu'il n'atteigne le canvas, donc appuyer dessus
  n'arme rien au passage ;
- il est sur la ligne de la **jauge** et non sur celle du compteur. La jauge est
  une proportion, elle se laisse raccourcir de trente pixels sans rien perdre ;
  la ligne du haut, elle, aurait poussé la colonne de gauche par-dessus sa part
  de grille et rogné le score. Mesuré : le bord droit d'un score à sept chiffres
  passait de 382 à 399 px sur un écran qui en fait 390.

La bascule clavier vit dans **un seul endroit**. La tentation était d'ajouter
Échap au clavier de l'écran de sélection, qui en a déjà un ; les deux écouteurs
reçoivent le même événement, le panneau se fermerait puis l'autre le verrait
fermé et le rouvrirait aussitôt. Une bascule n'a qu'un seul propriétaire.

---

## 12. Surfer la houle, et l'aura des 200 km/h

### La houle porte une pente, donc elle se joue

Sur l'océan on passe les deux tiers du temps sur l'eau. Une étendue **plate**
n'a ni pente ni courbure : elle est douce, et elle est vide — trois cents mètres
où la seule action est de tenir la direction.

La surface est donc échantillonnée **exactement comme le sol** — trois points à
±7 m — et toute la machinerie de crête fonctionne telle quelle : la vague a une
pente qui freine ou qui relance, une courbure qui peut décoller le disque, et un
sommet que le signal sonore annonce. On ne traverse plus l'eau, on la **surfe**.

Le Controller et le shader lisent la **même fonction, au même instant** : le
surfeur plane à la hauteur que calcule le processeur, la vague est dessinée à la
hauteur que calcule la carte graphique. Un écart de signe le ferait surfer dans
les creux.

**Chaque crête franchie paie** — un peu de temps, un peu de boost, des points.
Mais **jamais de combo** : une vague passe toutes les deux secondes et le combo
expire en 2,2 s, donc le nourrir donnait un multiplicateur qui ne redescendait
jamais. Mesure du premier jet : dix millions de points sur Chrome contre trois
sur la plaine, uniquement par emballement. Le combo récompense des gestes rares
et adroits ; une houle qu'on subit n'en est pas un.

### Le vol long paie, comme la traversée

Mesure au banc : sur la plaine, les traversées d'eau rapportent à elles seules
**quatre cents secondes** par partie — de très loin la première source de temps
du jeu. Un monde sans eau n'avait donc aucun revenu récurrent, et Bliss tenait
172 s là où la plaine tenait 600. Pas parce qu'il était plus dur : parce qu'il
était **pauvre**.

Un monde de collines a pourtant sa ressource propre, et c'est l'air. Un vol de
plus de 0,9 s paie désormais sur la même courbe en **racine** que la traversée —
un vol deux fois plus long n'est pas deux fois plus dur, c'est le **début** qui
demande quelque chose.

### L'aura, au-delà de 200 km/h

Elle s'allume à 200 km/h et atteint son plein régime à 216, qui est le plafond
absolu du jeu. C'est donc un état **rare et mérité** : il faut du boost, des
colonnes et de la vitesse accumulée pour y arriver.

Trois choses séparent une aura d'un halo :

1. **elle monte** — le bruit qui la déforme défile vers le haut, toujours. Une
   aura qui ondule sur place respire, une aura qui défile brûle ;
2. **elle a des pointes** — ce sont les langues qui dépassent en haut, plus
   fines et plus rapides que le corps, qui font la flamme ;
3. **elle reste verticale** — le surfeur pique du nez, se cabre, vrille ; son
   aura monte droit. Une flamme collée à l'assiette du personnage se lit comme
   une cape.

Elle n'est pas décorative : à pleine puissance elle **double le rayon et la
force de la lampe** du personnage. Ce n'est plus lui qui brille, c'est la plaine
qui change de couleur autour de lui — et ça, on ne peut pas le rater sans
regarder le compteur.

### Six buddies, six montures

L'écran passe de trois à six options par rangée. Les étiquettes « + » et « − »
quittent les cartes pour rejoindre le bloc de lecture : à six, chaque carte fait
cinquante pixels de large et deux lignes de texte s'y écrasent en bouillie. Le
principe ne change pas, il se resserre — **les cartes montrent, le bloc
explique**, et il n'explique que ce qui est sélectionné.

| Buddy | Avantage | Coût |
|---|---|---|
| **BLEU** | — | — |
| **NÉON** | boost ×1,15 · cruise ×1,10 — et il éclaire | grip ×0,86 |
| **GIVRE** | grip ×1,24 | cruise ×0,93 · plane ×0,90 |
| **BRAISE** | cruise ×1,14 · lift ×1,08 | plane ×0,80 — il déteste l'eau |
| **AMÉTHYSTE** | plane ×1,30 · boost ×1,12 | lift ×0,88 |
| **PRISME** | grip ×1,14 · lift ×1,14 | boost ×0,86 |

| Monture | Avantage | Coût |
|---|---|---|
| **CD** | — | — |
| **VINYLE** | cruise ×1,12 | grip ×0,82 · lift ×0,88 |
| **MINIDISC** | lift ×1,22 · grip ×1,12 · plane ×1,10 | cruise ×0,95 |
| **DISQUETTE** | grip ×1,30 — les coins mordent | cruise ×0,88 |
| **CD-R** | boost ×1,28 | lift ×0,90 |
| **HOLO** | lift ×1,18 · plane ×1,16 | grip ×0,72 — sans matière, ça ne mord pas |


## Le vent d'Octobre

Chaque monde qui change le décor sans changer la main n'est qu'une peau. Il y en
a maintenant trois qui changent la main, et chacun le fait avec un moyen
différent :

| Monde | Ce qui change la main |
|---|---|
| **OKINAWA** | on ne coule plus (`plane` 2,3, seuil de sortie à 8,3 m/s sous le plancher de 9) — et on **dérive** ; le risque a déménagé dans la houle, les îles et le chrono. |
| **BLISS** | pas une goutte d'eau, donc pas un point de traversée. Tout le revenu vient des figures : le monde rend en portance et en boost ce qu'il enlève en lacs. |
| **OCTOBRE** | le sol est détrempé (`grip` ×0,88) et **le vent pousse**. |

### Une force qu'on voit arriver

Une force latérale non annoncée n'est pas une mécanique, c'est un bug qui se
répète. Celle-ci est la **même fonction** que la rafale qui couche l'herbe,
emporte les feuilles et incline la pluie (voir
[`02`](02-TECH-ARCHITECTURE.md) §13) : on la voit traverser le champ avant de la
sentir dans les commandes.

Elle est **centrée** : le disque part à droite quand la crête de rafale passe, il
revient à gauche dans le creux. Une poussée à sens unique se contrerait une fois
pour toutes et cesserait d'exister au bout de dix secondes ; celle-ci demande une
correction continue, comme on tient un cap en mer.

### Les chiffres

6,2 m/s au pic, contre environ 13 m/s d'autorité latérale à vitesse de croisière
avec le `grip` du monde : la rafale vaut **la moitié d'un appui à fond**. Assez
pour qu'on ne puisse jamais lâcher la direction, pas assez pour qu'on ne puisse
pas la corriger.

Et elle mord plus quand le disque tient moins : ×0,8 à plat, ×1,15 en glisse sur
l'eau, ×1,35 en l'air. Un vol long dans Octobre se pilote — on ne se contente
plus d'attendre l'atterrissage.

Mesure à l'autopilote sur dix minutes : poussée moyenne 5,2 m/s, **0 %** du temps
plaqué contre la paroi du couloir, 273 anneaux contre 317 sur la plaine. Le vent
coûte à peu près un anneau sur huit — un prix, pas une punition.

### Ce que le monde rend

Le sol glissant et le vent prennent ; le monde rend ailleurs. La rafale porte
(`lift` ×1,10), l'eau est partout donc on y déjauge un peu mieux
(`plane` ×1,06), et le vent de dos recharge (`boost` ×1,08). Le solde mesuré est
volontairement légèrement négatif — 8,2 M de points contre 9,0 sur la plaine.
Octobre est le monde le plus **exigeant** des cinq, et il le dit dans sa ligne de
sélection avant qu'on y entre.

### La noyade y reste possible, et c'est délibéré

Okinawa est insubmersible parce qu'on y passe les deux tiers du temps sur l'eau
et que la noyade y coûtait la partie sans faute du joueur. Octobre a 31 % d'eau
en **367 mares distinctes** de 47 m de large en moyenne : couler y est une erreur
qu'on a eu le temps de voir venir. Un monde mélancolique sans aucun risque serait
une carte postale.
