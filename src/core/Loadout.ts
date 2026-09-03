/**
 * Personnages et montures.
 *
 * REGLE DE CONCEPTION, et elle vaut plus que le contenu : chaque choix se paie.
 * Aucune option n'est meilleure qu'une autre sur tous les axes — sinon il n'y a
 * pas de choix, il y a une bonne reponse et cinq mauvaises, et le joueur cesse
 * d'ouvrir l'ecran des la deuxieme partie.
 *
 * Chaque entree a donc exactement UN avantage franc et UN cout franc, et la
 * somme des modificateurs est nulle a peu de chose pres. C'est un peu plus
 * severe que ce que font la plupart des jeux, mais c'est ce qui garde les six
 * combinaisons vivantes.
 *
 * ---
 *
 * LES AXES, et ce qu'ils changent vraiment :
 *
 *   cruise   vitesse de croisiere. L'axe le plus lisible, donc le plus cher :
 *            plus de vitesse, c'est plus de distance ET plus de score par
 *            seconde, mais c'est aussi moins de temps pour lire le relief.
 *   grip     autorite laterale. Un fort grip permet de rattraper un anneau mal
 *            aborde ; un grip faible force a anticiper, mais rend les longues
 *            courbes plus douces et les vrilles plus faciles a boucler.
 *   lift     portance au saut et en plane. Change la duree de vol, donc le
 *            nombre de tours qu'on peut boucler et l'acces aux anneaux hauts.
 *   plane    seuil de glisse sur l'eau. Plus il est bas, plus il est facile de
 *            traverser un lac sans couler.
 *   boost    vitesse de recharge de la jauge.
 */

export interface Perk {
  id: string;
  name: string;
  blurb: string;
  /** Multiplicateurs, 1 = neutre. */
  cruise: number;
  grip: number;
  lift: number;
  plane: number;
  boost: number;
}

export const RIDERS: Perk[] = [
  {
    id: 'bleu',
    name: 'BLEU',
    blurb: 'le buddy d’origine, sans excuse',
    cruise: 1, grip: 1, lift: 1, plane: 1, boost: 1,
  },
  {
    id: 'neon',
    name: 'NÉON',
    blurb: 'part plus vite, mord moins — et il éclaire',
    cruise: 1.10, grip: 0.86, lift: 1, plane: 1, boost: 1.15,
  },
  {
    id: 'givre',
    name: 'GIVRE',
    blurb: 'colle au sol, plafonne plus bas',
    cruise: 0.93, grip: 1.24, lift: 0.96, plane: 0.90, boost: 1,
  },
  {
    id: 'braise',
    name: 'BRAISE',
    blurb: 'vite et haut, mais il déteste l’eau',
    cruise: 1.14, grip: 0.94, lift: 1.08, plane: 0.80, boost: 1.02,
  },
  {
    id: 'amethyste',
    name: 'AMÉTHYSTE',
    blurb: 'né pour l’eau, jamais pour le ciel',
    cruise: 0.96, grip: 0.98, lift: 0.88, plane: 1.30, boost: 1.12,
  },
  {
    id: 'prisme',
    name: 'PRISME',
    blurb: 'précis partout, à sec de boost',
    cruise: 0.94, grip: 1.14, lift: 1.14, plane: 1.02, boost: 0.86,
  },
  // --- OR, ET C'EST LA SEULE ENTREE QUI NE PAIE RIEN.
  //
  //     Elle enfreint la regle posee en tete de fichier, sciemment et sur
  //     demande : « un golden skin ultra rapide et puissant ». Autant l'ecrire
  //     ici plutot que de la deguiser en compromis qu'elle n'est pas — une
  //     option secretement dominante est bien pire qu'une option ouvertement
  //     dominante, parce qu'on ne peut plus la reequilibrer sans mentir deux
  //     fois.
  //
  //     Ce qu'elle coute, elle le coute AILLEURS que dans les chiffres : la
  //     course est un contre-la-montre, et une croisiere a +26 % laisse un
  //     quart de seconde de moins pour lire le relief entre deux portes. Le
  //     joueur qui la prend va plus vite ET rate plus de portes. C'est le seul
  //     equilibrage qu'on lui laisse, et il est reel : le ricochet paie la
  //     precision, pas la vitesse.
  {
    id: 'or',
    name: 'OR',
    blurb: 'hors barème : plus vite, plus haut, plus fort',
    cruise: 1.26, grip: 1.16, lift: 1.20, plane: 1.18, boost: 1.35,
  },
];

export const MOUNTS: Perk[] = [
  {
    id: 'cd',
    name: 'CD',
    blurb: 'le disque de base, équilibré',
    cruise: 1, grip: 1, lift: 1, plane: 1, boost: 1,
  },
  {
    id: 'vinyle',
    name: 'VINYLE',
    blurb: 'lourd, rapide, tourne mal',
    cruise: 1.12, grip: 0.82, lift: 0.88, plane: 0.94, boost: 0.94,
  },
  {
    id: 'minidisc',
    name: 'MINIDISC',
    blurb: 'léger : ça vole, ça glisse',
    cruise: 0.95, grip: 1.12, lift: 1.22, plane: 1.10, boost: 1.06,
  },
  {
    id: 'disquette',
    name: 'DISQUETTE',
    blurb: 'les coins mordent, le reste traîne',
    cruise: 0.88, grip: 1.30, lift: 0.94, plane: 1, boost: 1.02,
  },
  {
    id: 'cdr',
    name: 'CD-R',
    blurb: 'ça grave vite, ça décolle mal',
    cruise: 1.02, grip: 0.94, lift: 0.90, plane: 1, boost: 1.28,
  },
  {
    id: 'holo',
    name: 'HOLO',
    blurb: 'sans matière : ça vole, ça ne mord pas',
    cruise: 1.05, grip: 0.72, lift: 1.18, plane: 1.16, boost: 1,
  },
];

/**
 * Les cinq multiplicateurs, nus. Un monde en porte aussi : ce n'est pas une
 * generalisation gratuite, c'est une necessite qu'une mesure a imposee.
 *
 * OKINAWA est a moitie sous l'eau. Avec le seuil de dejaugeage de la plaine —
 * 25 m/s alors qu'on demarre a 18 — le premier lagon coulait le joueur avant
 * qu'il ait accelere, la vitesse tombait a 5 m/s, et il n'y avait plus assez de
 * terre entre deux nappes pour se relancer. Le monde etait injouable, et aucun
 * reglage de relief ne le rattrapait sans le transformer en plaine.
 *
 * La bonne reponse etait dans le theme : un LAGON est peu profond, on y
 * dejauge tout de suite. Le monde porte donc `plane` a 1,55, et le seuil tombe
 * a 16 m/s — on skie sur le lagon des le depart, ce qui est exactement l'image
 * qu'on venait chercher. Le cout est ailleurs : on derive.
 */
export interface Mods {
  cruise: number;
  grip: number;
  lift: number;
  plane: number;
  boost: number;
}

export const NO_MODS: Mods = { cruise: 1, grip: 1, lift: 1, plane: 1, boost: 1 };

/** Produit des trois choix. C'est ce que le Controller lit. */
export interface Loadout {
  rider: Perk;
  mount: Perk;
  cruise: number;
  grip: number;
  lift: number;
  plane: number;
  boost: number;
}

const KEY = 'frutisurf.loadout';

export function combine(rider: Perk, mount: Perk, world: Mods = NO_MODS): Loadout {
  return {
    rider,
    mount,
    cruise: rider.cruise * mount.cruise * world.cruise,
    grip: rider.grip * mount.grip * world.grip,
    lift: rider.lift * mount.lift * world.lift,
    plane: rider.plane * mount.plane * world.plane,
    boost: rider.boost * mount.boost * world.boost,
  };
}

export function loadChoice(): { rider: Perk; mount: Perk } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as { r?: string; m?: string };
      const rider = RIDERS.find((x) => x.id === o.r) ?? RIDERS[0];
      const mount = MOUNTS.find((x) => x.id === o.m) ?? MOUNTS[0];
      return { rider, mount };
    }
  } catch {
    // Stockage refuse (navigation privee, cookies bloques) : on repart sur le
    // choix par defaut plutot que de casser le demarrage.
  }
  return { rider: RIDERS[0], mount: MOUNTS[0] };
}

export function saveChoice(rider: Perk, mount: Perk): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ r: rider.id, m: mount.id }));
  } catch {
    // Sans persistance le jeu reste jouable : on ne fait rien.
  }
}

/** A-t-on deja choisi une fois ? Sert a n'ouvrir l'ecran qu'au premier lancement. */
export function hasChosen(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Les cinq axes, dans l'ordre ou l'ecran les affiche.
 *
 * L'ordre n'est pas cosmetique : il va du plus IMMEDIAT au plus situationnel.
 * La vitesse se sent des la premiere seconde, l'accroche au premier virage, la
 * portance au premier saut ; la glisse ne parle qu'au premier lac et le boost
 * qu'a la premiere jauge pleine. Un joueur qui ne lit que les deux premieres
 * lignes a deja compris l'essentiel du choix.
 */
export const AXES = [
  { key: 'cruise', label: 'VITESSE' },
  { key: 'grip', label: 'ACCROCHE' },
  { key: 'lift', label: 'PORTANCE' },
  { key: 'plane', label: 'GLISSE' },
  { key: 'boost', label: 'BOOST' },
] as const;

export type AxisKey = (typeof AXES)[number]['key'];

/**
 * L'avantage et le cout d'une option, DERIVES des multiplicateurs.
 *
 * Ecrits a la main, ces deux libelles seraient la premiere chose a mentir : on
 * reequilibre un chiffre, on oublie la phrase, et l'ecran promet une vitesse
 * qui n'existe plus. Les lire depuis les nombres rend le mensonge impossible.
 */
export function highlights(p: Perk): { up: string | null; down: string | null } {
  let up: string | null = null;
  let down: string | null = null;
  let hi = 1.02;
  let lo = 0.98;
  for (const a of AXES) {
    const v = p[a.key];
    if (v > hi) { hi = v; up = a.label; }
    if (v < lo) { lo = v; down = a.label; }
  }
  return { up, down };
}

/** Le neutre, pour tout ce qui tourne avant qu'un choix ne soit fait. */
export const NEUTRAL: Loadout = combine(RIDERS[0], MOUNTS[0]);
