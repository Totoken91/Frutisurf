# 🌐 FRUTIGER SURFER

> Un bonhomme MSN en verre qui surfe sur un CD à travers des plaines d'herbe
> électrique, vers une ville de cristal.

Une expérience WebGL temps réel qui reconstruit — et fait vivre — l'esthétique
**Frutiger Aero** : verre, gloss, nature + technologie, bloom, et cette lumière
de fond d'écran Windows Vista qu'on n'a jamais vraiment oubliée.

Aucune interface. Aucun compteur. Juste la plaine, le surfeur et la glisse.

Le cœur du projet, ce n'est pas la scène. C'est **la glisse**.

<p align="center">
  <img src="docs/hero.png" width="360" alt="Le surfeur MSN sur son CD" />
  <img src="docs/hero-boost.png" width="360" alt="Pop de carve, gerbe d'herbe et trace en S" />
</p>

## Lancer

```bash
npm install
npm run dev     # http://localhost:5173
```

## Jouer

| Action | Clavier | Tactile | Manette |
|---|---|---|---|
| Diriger | `←` `→` / `A` `D` | glisser | stick gauche |
| Sauter | `Espace` / `↑` | tap | `A` |
| Boost | `Maj` | deux doigts | `RT` |

**La boucle** : tiens un virage pour charger la carre — le disque se met sur la
tranche, le spray s'intensifie, le son monte d'une tierce. Relâche au bon moment
et tout se libère d'un coup : poussée, FOV qui s'ouvre, hitstop de 45 ms,
combo. Enchaîner gauche-droite est **plus rapide** que la ligne droite.

## Vérifier le rendu

```bash
npm run build     # typecheck + bundle de prod
npm run check     # verifie que le carve est plus rapide que la ligne droite
npm run shot      # capture Playwright, a comparer a docs/reference.jpg
```

`npm run check` simule le contrôleur seul, sans rendu, et vérifie le critère
de recette n°2 du doc 03 : *le carve enchaîné doit battre la ligne droite*.
Actuellement **+33 %** sur 40 s, combo max 17. Si ce chiffre passe sous zéro,
le jeu n'a plus de raison d'exister — c'est le garde-fou le plus important
du dépôt.

`scripts/shot.mjs` accepte `SHOT_DRIVE` pour piloter une pose précise :

```bash
SHOT_DRIVE="wait:500;KeyZ:50;down:ShiftLeft;wait:4000;down:ArrowRight;wait:1500" npm run shot
```

## Le personnage

<p align="center">
  <img src="docs/buddy-vs-reference.png" width="620"
       alt="Comparaison cote a cote : reference a gauche, rendu a droite" />
</p>

Silhouette et dégradé relevés au pixel sur la référence, puis calés par
comparaison côte à côte — c'est ce montage qui a servi de juge, pas l'œil nu.
Le détail du raisonnement est dans [`docs/01`](docs/01-ART-DIRECTION.md) §3.

## Documentation

| Doc | Contenu |
|---|---|
| [`docs/00-REFERENCE-ANALYSIS.md`](docs/00-REFERENCE-ANALYSIS.md) | Analyse forensique de l'image de référence |
| [`docs/01-ART-DIRECTION.md`](docs/01-ART-DIRECTION.md) | Palette, matériaux, lumière, post-process |
| [`docs/02-TECH-ARCHITECTURE.md`](docs/02-TECH-ARCHITECTURE.md) | Stack, modules, pipeline de rendu, budget perf |
| [`docs/03-GAME-FEEL.md`](docs/03-GAME-FEEL.md) | Spec de la glisse — la partie qui doit être jouissive |
| [`docs/04-ROADMAP.md`](docs/04-ROADMAP.md) | Jalons de production |
