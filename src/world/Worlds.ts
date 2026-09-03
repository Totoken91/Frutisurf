import { Color } from 'three';
import { HEX } from '../core/Palette';
import { NO_MODS, type Mods } from '../core/Loadout';
import type { Keyframe } from './Daylight';

/**
 * LES MONDES.
 *
 * ---
 *
 * CE QU'EST UN MONDE ICI, ET CE QU'IL N'EST PAS.
 *
 * Ce n'est pas une scene chargee a la place d'une autre. C'est un JEU DE
 * PARAMETRES applique a la seule et meme scene : cinq amplitudes de relief, un
 * niveau d'eau, une largeur de greve, une vingtaine de couleurs, quatre
 * densites de decor et quatre palettes de ciel.
 *
 * Ce choix n'est pas une economie, c'est ce qui rend le changement de monde
 * INSTANTANE et CONTINU. Rien n'est detruit, rien n'est reconstruit, aucun
 * shader n'est recompile — donc aucun a-coup, aucune fuite, et surtout : on
 * peut FONDRE d'un monde a l'autre. La plaine s'inonde et devient l'archipel
 * sous les yeux du joueur pendant qu'il lit l'ecran de selection. Un monde
 * charge a la place d'un autre n'aurait jamais pu faire ca.
 *
 * La contrainte que ca impose est reelle et assumee : tous les mondes
 * partagent les memes FREQUENCES de relief (cf. Terrain.ts). Deux mondes ne
 * peuvent donc pas differer par la taille de leurs collines, seulement par leur
 * hauteur. En pratique c'est suffisant — une plaine et un archipel se
 * distinguent par ce qui depasse de l'eau, pas par leur spectre.
 *
 * ---
 *
 * REGLE : chaque monde doit rester JOUABLE, et ca se mesure.
 *
 * Le piege d'un monde aquatique est connu et il est mortel : une nappe assez
 * large pour qu'on ne puisse pas la traverser d'un trait. Couler au milieu de
 * trois cents metres d'eau, c'est ressortir au pas trois cents metres plus
 * loin, donc perdre la partie sans avoir rien fait de mal. `check:worlds`
 * mesure la largeur maximale de nappe et la longueur des bandes de terre de
 * chaque monde avant d'accepter ses chiffres.
 */

/** Les couleurs qu'un monde a le droit de redefinir. Le reste est canonique. */
export type WorldColorKey =
  | 'grassHorizon' | 'grassFar' | 'grassMid' | 'grassNear' | 'grassShadow' | 'grassStreak'
  | 'sandDry' | 'sandPale' | 'sandWet' | 'sandShell'
  | 'waterShallow' | 'waterDeep' | 'waterFoam'
  | 'cityFace' | 'cityLit' | 'cityDeep' | 'treeLine'
  | 'warmAccent' | 'cloudCore' | 'cloudShadow' | 'cloudRim'
  | 'leafRust' | 'leafBlood' | 'leafAmber'
  | 'bloomPale' | 'bloomWarm'
  | 'townWall' | 'townRoof' | 'townWindow';

export const WORLD_COLOR_KEYS: WorldColorKey[] = [
  'grassHorizon', 'grassFar', 'grassMid', 'grassNear', 'grassShadow', 'grassStreak',
  'sandDry', 'sandPale', 'sandWet', 'sandShell',
  'waterShallow', 'waterDeep', 'waterFoam',
  'cityFace', 'cityLit', 'cityDeep', 'treeLine',
  'warmAccent', 'cloudCore', 'cloudShadow', 'cloudRim',
  'leafRust', 'leafBlood', 'leafAmber',
  'bloomPale', 'bloomWarm',
  'townWall', 'townRoof', 'townWindow',
];

export interface WorldDef {
  id: string;
  name: string;
  /** Une ligne, affichee sous les cartes. Ce qu'on va ressentir, pas un decor. */
  blurb: string;
  /** Amplitude des cinq couches de relief, en metres. */
  amp: readonly [number, number, number, number, number];
  /** Niveau de l'eau. Tres bas = monde sans eau. */
  water: number;
  /** Greve : [base, part variable], en hauteur au-dessus de l'eau. */
  shore: readonly [number, number];
  /**
   * Houle : [amplitude, longueur d'onde, vitesse]. Amplitude nulle = plat.
   *
   * Ce n'est pas de la decoration. Le Controller lit la meme fonction, donc la
   * houle porte une pente et une courbure, et un ocean se SURFE au lieu de se
   * traverser. C'est ce qui separe une etendue d'eau d'un couloir.
   */
  swell: readonly [number, number, number];
  /** Surcharges de palette. Les cles absentes gardent la couleur canonique. */
  colors: Partial<Record<WorldColorKey, number>>;
  /**
   * Densites de decor, 0..1. Zero = absent.
   *
   * `city` et `trees` ont ete SEPARES. Ils ne faisaient qu'un, et c'est
   * devenu faux le jour ou un monde a voulu la ligne d'arbres SANS les tours
   * de verre : eteindre la ville emportait la foret avec elle et l'horizon
   * devenait une decoupe nette entre le sol et le ciel.
   */
  city: number;
  /** Ligne d'arbres a l'horizon. Elle survit a la ville. */
  trees: number;
  /**
   * LE BOSQUET : arbres, rochers et buissons semes entre 20 et 200 m.
   *
   * Il ne remplace ni `trees`, qui est une frise posee a l'horizon, ni `palms`,
   * qui ne pousse que sur le sable. Il occupe la seule bande que les deux
   * laissaient vide — le champ moyen — et c'est elle qui porte l'ECHELLE du
   * monde : sans objet de taille connue entre le premier plan et le fond, un
   * paysage n'a pas de distance, il a deux couleurs.
   */
  grove: number;
  /**
   * Silhouette du bosquet : 0 = couronnes rondes, 1 = cimes en fleche.
   *
   * Une seule forme d'arbre pour cinq mondes les aurait tous rendus parents.
   * Le rond dit le verger et l'ete ; la fleche dit le versant et la saison
   * froide, et c'est exactement la difference entre la plaine et octobre.
   */
  spire: number;
  /**
   * Part de PIERRE dans le semis, 0..1. Le reste est vivant.
   *
   * Elle monte toute seule avec la pente — un eboulis tient sur un flanc ou un
   * arbre ne tient pas — mais son plancher est une propriete du monde : CHROME
   * n'a pas de biologie, son bosquet est un champ de monolithes.
   */
  stone: number;
  /**
   * LES CRETES LOINTAINES, 0..1 sur la hauteur. Zero = horizon nu.
   *
   * C'est le seul reglage de decor qui n'ajoute aucun objet dans le monde
   * jouable : il dit uniquement ce qu'il y a DERRIERE, a un ou deux
   * kilometres. Un monde sans cretes n'est pas moins beau, il est plus PETIT
   * — et parfois c'est le propos (un atoll n'a rien a l'horizon qu'un ocean).
   */
  ridge: number;
  /** 0 = cretes erodees, 1 = aretes vives. CHROME n'a pas d'erosion. */
  ridgeEdge: number;
  /**
   * LES FLEURS, 0..1. Densite des taches fleuries du pre.
   *
   * C'est le seul decor qui ne coute pas un sommet : il vit dans le shader du
   * sol, sur la grille du monde, entre les touffes. Et c'est pourtant celui
   * qu'on voit le plus, parce qu'il occupe le bas du cadre en permanence — la
   * ou le joueur regarde quatre-vingt-dix pour cent du temps.
   */
  bloom: number;
  /**
   * LE QUARTIER : maisons, lampadaires, route mouillee. Zero partout sauf en
   * octobre.
   *
   * Ce n'est pas une variante de `city`, c'est son contraire. La ville de
   * verre est une PROMESSE posee a un kilometre, qu'on ne rejoint jamais ; le
   * quartier est un decor qu'on CROISE, assez pres pour qu'on voie ses
   * fenetres s'allumer.
   */
  town: number;
  turbines: number;
  palms: number;
  blades: number;
  /** Tapis de feuilles mortes, 0..1. Zero partout sauf en octobre. */
  leaves: number;
  /** Averse, 0..1. Elle mouille le sol, crible l'eau, et voile le paysage. */
  rain: number;
  /**
   * VENT LATERAL, en m/s au pic de rafale. Zero = pas de vent.
   *
   * C'est la troisieme mecanique de monde, apres le seuil de glisse d'OKINAWA
   * et la houle : elle ne se contente pas de repeindre le decor, elle change
   * la main du joueur. Le disque est DEPORTE par la meme rafale qui couche
   * l'herbe et emporte les feuilles (cf. Weather.windAt), donc on la voit
   * arriver avant de la sentir — sans quoi ce ne serait qu'un bruit ajoute aux
   * commandes.
   */
  wind: number;
  /** 0 = herbe, 1 = grille Y2K. Bascule la matiere du sol. */
  tech: number;
  /**
   * 0 = ciel degage, 1 = plafond de nuages.
   *
   * Distinct de `power` dans les cles de ciel, et il le faut : `power` regle
   * l'INTENSITE de la lumiere, pas l'aspect du dome. Un monde couvert dont on
   * baisse seulement la puissance garde son soleil a douze branches en plein
   * milieu de son ciel de plomb, ce qui est exactement l'erreur qu'octobre a
   * faite au premier jet.
   */
  overcast: number;
  /**
   * Les regles du monde, multipliees a celles du buddy et de la monture.
   *
   * Elles ne sont pas la pour differencier : elles sont la pour que chaque
   * monde reste JOUABLE avec la meme physique. Un monde a moitie sous l'eau a
   * besoin d'un seuil de dejaugeage bas, sinon on y coule des la premiere
   * seconde ; un monde sans eau perd toute une source de points et doit la
   * recuperer ailleurs. Chaque monde tient son propre record (cf. Run.ts), donc
   * ces ecarts ne mettent aucun monde en concurrence avec un autre.
   */
  mods: Mods;
  /** Les quatre palettes de ciel. Le ciel EST le monde. */
  sky: readonly Keyframe[];
  /** Ou l'on entre dans le cycle en arrivant. */
  dayStart: number;
  /**
   * Vignette de l'ecran de selection : ciel, sol, eau, et la HAUTEUR de la
   * bande d'eau en pourcentage.
   *
   * La hauteur n'est pas un detail : sans elle, la plaine, l'archipel et le
   * monde sans eau donnaient trois vignettes quasi identiques — un ciel bleu,
   * du vert, un liseré turquoise. Or c'est exactement la part d'eau qui les
   * distingue en jeu. La vignette doit montrer ce qui change, pas ce qui est
   * commun.
   */
  swatch: readonly [string, string, string, number];
}

// ---------------------------------------------------------------------------
// LES CIELS
// ---------------------------------------------------------------------------

/** La plaine d'origine : la reference Frutiger Aero, quatre moments. */
const SKY_PLAIN: Keyframe[] = [
  { at: 0.0, zenith: 0x1e4a8c, high: 0x5a7fb8, mid: 0xd99a7a, horizon: 0xffd3a0,
    light: 0xffb373, power: 0.72, fill: 0x6d86bd, night: 0.30, warm: 1.0 },
  { at: 0.25, zenith: 0x0d6fe0, high: 0x1c9ce9, mid: 0x4cc4f2, horizon: 0xc6ecfa,
    light: 0xfff6e2, power: 1.0, fill: 0x8fc4e8, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x24306e, high: 0x6a4f9c, mid: 0xe0673f, horizon: 0xffb072,
    light: 0xff7a3c, power: 0.78, fill: 0x6a5a9e, night: 0.34, warm: 1.0 },
  { at: 0.75, zenith: 0x081436, high: 0x102354, mid: 0x1d3a72, horizon: 0x3b6094,
    light: 0x8aa6e0, power: 0.34, fill: 0x33508c, night: 1.0, warm: 0.15 },
];

/**
 * OKINAWA. Le meme soleil, mais l'air d'un lagon : plus de blanc a l'horizon,
 * un zenith plus pur, et une lumiere legerement SURPUISSANTE a midi. Sous les
 * tropiques la lumiere ne se contente pas d'etre forte, elle est VERTICALE, et
 * ce qu'on lit d'une photo de plage n'est pas la couleur du ciel mais
 * l'ecrasement des ombres.
 */
const SKY_OKINAWA: Keyframe[] = [
  { at: 0.0, zenith: 0x2a5fa8, high: 0x6e93c4, mid: 0xf0b48c, horizon: 0xffe6c8,
    light: 0xffc79a, power: 0.80, fill: 0x8aa8d8, night: 0.24, warm: 1.0 },
  { at: 0.25, zenith: 0x0a86e8, high: 0x22b4ef, mid: 0x6ee0f6, horizon: 0xe8fcff,
    light: 0xfffaf0, power: 1.08, fill: 0xa8ddf2, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x2c2f78, high: 0x7a52a8, mid: 0xf07a48, horizon: 0xffcf96,
    light: 0xff8a4a, power: 0.82, fill: 0x7a68ac, night: 0.30, warm: 1.0 },
  { at: 0.75, zenith: 0x061a44, high: 0x0d2c62, mid: 0x1c4a80, horizon: 0x4f83b0,
    light: 0x9ec0ec, power: 0.38, fill: 0x3f64a0, night: 1.0, warm: 0.15 },
];

/**
 * BLISS. Le ciel le plus SATURE des quatre, et le plus contraste verticalement.
 * C'est la signature du fond d'ecran : un bleu presque violet au zenith qui
 * tombe sur un blanc franc a l'horizon, sans passer par du cyan. Le cyan est
 * partout ailleurs dans ce jeu ; ici il est volontairement absent, et c'est ce
 * qui rend le monde reconnaissable en une image.
 */
const SKY_BLISS: Keyframe[] = [
  { at: 0.0, zenith: 0x1c3f8e, high: 0x5878bc, mid: 0xdda482, horizon: 0xffdcb0,
    light: 0xffbd82, power: 0.74, fill: 0x7089c0, night: 0.28, warm: 1.0 },
  { at: 0.25, zenith: 0x1f5fd8, high: 0x3f8fe8, mid: 0x84c8f2, horizon: 0xf6fdff,
    light: 0xfff8ec, power: 1.02, fill: 0x9ccbec, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x2a2c74, high: 0x6b4b9e, mid: 0xe8804c, horizon: 0xffc98e,
    light: 0xff8f4e, power: 0.80, fill: 0x6f5ea4, night: 0.32, warm: 1.0 },
  { at: 0.75, zenith: 0x0a1740, high: 0x142a60, mid: 0x22427e, horizon: 0x466ca0,
    light: 0x94aee6, power: 0.36, fill: 0x385594, night: 1.0, warm: 0.15 },
];

/**
 * OCTOBRE. Le seul monde qui ne cherche pas a etre beau au sens des autres.
 *
 * Les quatre premiers sont des mondes de PLEIN JOUR — meme Chrome, dont le
 * crepuscule violet est sature comme un neon. Octobre est un monde COUVERT :
 * sa lumiere ne vient jamais d'un point, elle vient de tout le ciel a la fois,
 * et c'est ce qui lui donne son affect. Une lumiere sans direction est une
 * lumiere sans heure ; on ne sait plus s'il est onze heures du matin ou cinq
 * heures du soir, et c'est exactement la sensation d'un jour de pluie.
 *
 * D'ou trois choix que les autres ciels ne font pas :
 *
 *   - `night` ne descend JAMAIS a zero. Meme a son midi le monde garde un tiers
 *     de nuit : le plafond de nuages ne se leve pas.
 *   - `power` plafonne a 0,66 contre 1,0 ailleurs, et le remplissage (`fill`)
 *     reste haut. C'est la definition d'un ciel couvert — peu de directe,
 *     beaucoup d'ambiante — et c'est ce qui ecrase les ombres.
 *   - le seul moment SATURE du cycle est le couchant, et il l'est violemment :
 *     la trouee sous le plafond, quand le soleil passe dessous et met le
 *     dessous des nuages en feu. C'est le seul instant ou ce monde est
 *     spectaculaire, il dure quinze secondes, et tout le reste est fait pour
 *     qu'on l'attende.
 */
const SKY_OCTOBRE: Keyframe[] = [
  { at: 0.0, zenith: 0x2f3547, high: 0x4c5162, mid: 0x767074, horizon: 0xa5907a,
    light: 0xb8a48f, power: 0.46, fill: 0x565d70, night: 0.52, warm: 0.60 },
  { at: 0.25, zenith: 0x4a5468, high: 0x6b7384, mid: 0x929399, horizon: 0xc2b9a8,
    light: 0xd8d3c6, power: 0.64, fill: 0x7a828e, night: 0.30, warm: 0.14 },
  // LE moment du monde : la trouee sous le plafond. Le soleil passe DESSOUS,
  // met le ventre des nuages en cuivre, et tout le reste reste violet.
  //
  // La lumiere directe est volontairement retenue a 0xdd9464 et non a l'orange
  // franc des autres crepuscules : elle multiplie un sol deja ocre, et un
  // orange sature sur de l'ocre ne donne pas un couchant, il donne du ROUGE.
  // Le premier jet sortait un paysage martien — la faute classique des palettes
  // d'automne, et elle se corrige dans la LUMIERE, pas dans le sol.
  { at: 0.5, zenith: 0x281f3c, high: 0x4a3350, mid: 0x8a5642, horizon: 0xd08a58,
    light: 0xc9a888, power: 0.50, fill: 0x54415e, night: 0.50, warm: 0.55 },
  { at: 0.75, zenith: 0x080a16, high: 0x11142a, mid: 0x1e2038, horizon: 0x3c3448,
    light: 0x8c93b4, power: 0.24, fill: 0x2a2c40, night: 1.0, warm: 0.20 },
];

/**
 * CHROME. Le monde Y2K, et le seul qui ne connaisse pas le plein jour.
 *
 * Son « midi » est un crepuscule violet : c'est deliberé. Toute l'imagerie de
 * l'epoque — visualiseurs de lecteur multimedia, ecrans de veille en fil de
 * fer, chrome liquide sur fond noir — repose sur des NEONS, et un neon a
 * besoin de nuit. Un Chrome en plein soleil serait juste une plaine violette.
 *
 * Le cycle continue de tourner : il donne ici une aube magenta et un
 * crepuscule rose vif, deux moments que les trois autres mondes n'ont pas.
 */
const SKY_CHROME: Keyframe[] = [
  { at: 0.0, zenith: 0x180d3c, high: 0x481e72, mid: 0xc23a7e, horizon: 0xffa8d4,
    light: 0xff86c0, power: 0.62, fill: 0x5a3080, night: 0.52, warm: 0.9 },
  { at: 0.25, zenith: 0x140d40, high: 0x2a2478, mid: 0x4f52c8, horizon: 0xa894ff,
    light: 0xcfd8ff, power: 0.74, fill: 0x4a4aa0, night: 0.40, warm: 0.0 },
  { at: 0.5, zenith: 0x1a0838, high: 0x5c1a6e, mid: 0xf02f7a, horizon: 0xffbe70,
    light: 0xff5aa0, power: 0.68, fill: 0x66287e, night: 0.54, warm: 1.0 },
  { at: 0.75, zenith: 0x03040f, high: 0x0a0a26, mid: 0x1a1048, horizon: 0x4a2078,
    light: 0xb890ff, power: 0.30, fill: 0x2a1a5c, night: 1.0, warm: 0.2 },
];

// ---------------------------------------------------------------------------
// LES MONDES
// ---------------------------------------------------------------------------

export const WORLDS: WorldDef[] = [
  {
    id: 'plaine',
    name: 'PLAINE',
    blurb: 'collines, lacs, ville de cristal',
    // Mesure : 17 % d'eau, une nappe tous les 214 m, 44 m de large en moyenne.
    amp: [6.0, 3.6, 2.3, 1.05, 0.16],
    water: -5.5,
    shore: [1.55, 3.2],
    // Un lac de plaine n'a pas de houle : il fait 46 m de large, aucune vague
    // n'a la place de se former dessus.
    swell: [0, 60, 1],
    colors: {},
    mods: NO_MODS,
    city: 1,
    trees: 1,
    grove: 1,
    spire: 0.12,
    stone: 0.22,
    ridge: 0.85,
    ridgeEdge: 0.15,
    bloom: 1,
    town: 0,
    turbines: 1,
    palms: 1,
    blades: 1,
    leaves: 0,
    rain: 0,
    wind: 0,
    tech: 0,
    overcast: 0,
    sky: SKY_PLAIN,
    dayStart: 0.16,
    swatch: ['#1c9ce9', '#9ed93e', '#6fe8e0', 26],
  },
  {
    id: 'okinawa',
    name: 'OKINAWA',
    blurb: 'lagon turquoise, îles à palmiers',
    // UN OCEAN, PAS UN MARECAGE.
    //
    // Le premier jet visait l'archipel : couche de fond ecrasee, couches
    // moyennes relevees, 50 % d'eau. Mesure a posteriori : des nappes de 42 m
    // en moyenne, separees par 42 m de terre. Sur le papier c'est un archipel ;
    // a l'ecran c'est un MARECAGE — des flaques partout, aucune etendue, aucun
    // horizon marin. Le joueur l'a vu tout de suite et il avait raison.
    //
    // L'inverse, donc : la houle de fond domine largement (11 m sur 480 m de
    // long) et les couches courtes ne servent plus qu'a donner du relief LA OU
    // la terre emerge. Mesure : 62 % d'eau, des traversees de 235 m en moyenne
    // — sept secondes d'ocean a pleine vitesse — et des iles de 144 m qui ont
    // de quoi carver et sauter.
    amp: [11.0, 2.5, 2.0, 0.9, 0.12],
    water: 4.0,
    // Greve large : sur un atoll, la plage EST l'ile. La resserrer donnerait
    // des rochers verts au milieu de l'eau.
    // Greve large — sur un atoll la plage EST l'ile — mais pas au point de
    // manger le premier plan : a [2.6, 5.0] le sable occupait la moitie de
    // l'ecran et le lagon devenait un liseré au fond.
    shore: [2.0, 3.8],
    // 1,25 m d'amplitude sur 62 m de long. La longueur d'onde est ce qui compte :
    // a 62 m une vague se VOIT arriver depuis la crete precedente, donc elle se
    // lit et s'anticipe. A 20 m elle serait un tremblement, a 200 m une pente.
    swell: [1.25, 62, 1.15],
    colors: {
      // Le lagon : turquoise franc en eau basse, bleu profond mais toujours
      // cyan au large. Jamais d'ardoise — c'est ce qui separe un lagon d'un lac.
      // Un lagon des Ryukyu ne vire pas au bleu marine quand il devient
      // profond : le fond est corallien et clair, il renvoie de la lumiere
      // jusqu'au large. Le « profond » d'Okinawa est donc encore franchement
      // turquoise, la ou celui de la plaine plonge vers le bleu.
      waterShallow: 0x9dfae8,
      waterDeep: 0x11b6d6,
      waterFoam: 0xffffff,
      // Le sable des Ryukyu est un sable CORALLIEN : presque blanc, tres
      // legerement rose. Il monte donc nettement plus haut que celui de la
      // plaine, qui est cale sur la luminance de l'herbe.
      sandDry: 0xe8d8b4,
      sandPale: 0xf6ead0,
      sandWet: 0xb09a74,
      sandShell: 0xfffaf0,
      // La vegetation d'ile est plus SOMBRE et plus bleue que la prairie : ce
      // sont des feuillages epais, pas de l'herbe rase au soleil.
      grassNear: 0x4fa83c,
      grassMid: 0x6dbd44,
      grassFar: 0x92d059,
      grassHorizon: 0xbde48c,
      grassShadow: 0x2f7028,
      grassStreak: 0x9fdc68,
      warmAccent: 0x8a6a52,
    },
    // On DEJAUGE a 16 m/s au lieu de 25 : le lagon est peu profond, on y skie
    // des le depart. Sans ca le monde n'existe pas (cf. Loadout.Mods). Le prix
    // est la derive : sur l'eau le disque ne mord pas.
    // ON NE COULE PLUS, ET C'EST VOLONTAIRE.
    //
    // Avec `plane` a 2.3 le seuil de sortie de glisse tombe a 8,3 m/s, sous le
    // plancher de vitesse au sol qui est de 9 : une fois dejauge, on ne peut
    // plus retomber. Sur un ocean ou l'on passe les deux tiers du temps, c'est
    // la seule valeur defendable — couler au milieu de deux cents metres d'eau
    // coutait la partie sans qu'on ait rien fait de mal.
    //
    // Le risque ne disparait pas, il DEMENAGE : il est dans la houle qu'il faut
    // lire, dans les iles qu'il faut viser, et dans le chrono. Et le prix se
    // paie a chaque virage — sur l'eau le disque derive deja de 38 %, et le
    // monde en retire encore un peu.
    mods: { cruise: 1, grip: 0.88, lift: 1, plane: 2.3, boost: 1 },
    city: 0,
    trees: 0,
    grove: 0.5,
    spire: 0,
    stone: 0.40,
    ridge: 0.34,
    ridgeEdge: 0.1,
    bloom: 0.55,
    town: 0,
    turbines: 0.35,
    palms: 1,
    blades: 0.7,
    leaves: 0,
    rain: 0,
    wind: 0,
    tech: 0,
    overcast: 0,
    sky: SKY_OKINAWA,
    dayStart: 0.22,
    swatch: ['#22b4ef', '#e8d8b4', '#8bf5e4', 56],
  },
  {
    id: 'bliss',
    name: 'BLISS',
    blurb: 'que des collines, et le ciel',
    // Zero eau, et c'est la moitie du propos : le seul monde ou l'on ne peut
    // pas couler, donc le seul ou la vitesse ne se paie jamais. Mesure :
    // pente moyenne 7,2 deg, maximum 24 deg — le plus DOUX des quatre.
    // Les couches moyennes relevees (1.5 -> 2.6 et 0.5 -> 1.35) par rapport au
    // premier jet. Bliss n'a NI eau NI ville : ni traversee a marquer, ni
    // colonne a enfiler entre deux reliefs. Tout son revenu doit venir des
    // figures, donc il lui faut de quoi sauter — un monde lisse etait un monde
    // pauvre, et le banc le disait : 186 s contre 378 sur la plaine.
    amp: [7.5, 4.2, 2.1, 1.05, 0.09],
    water: -60,
    shore: [1.0, 1.0],
    swell: [0, 60, 1],
    colors: {
      // Le vert de Bliss n'est pas le chartreuse de la plaine : il est plus
      // franc, plus dense, et il tire au bleu dans l'ombre. C'est de l'herbe
      // grasse de printemps, pas de la prairie seche.
      grassNear: 0x63bd28,
      grassMid: 0x8ad438,
      grassFar: 0xb2e556,
      grassHorizon: 0xd6f28e,
      grassShadow: 0x3d7c1c,
      grassStreak: 0xbfe968,
      // Les cumulus les plus blancs et les plus contrastes du jeu : ici ils
      // sont le seul sujet, il n'y a rien d'autre a regarder.
      cloudCore: 0xffffff,
      cloudShadow: 0x88b8e4,
      cloudRim: 0xf4fbff,
    },
    // Pas une goutte d'eau, donc pas un seul point de traversee : c'est toute
    // une source de score et de secondes qui disparait. Le monde la rend en
    // portance et en boost — on y joue les figures, faute de lacs.
    mods: { cruise: 1, grip: 0.94, lift: 1.12, plane: 1, boost: 1.18 },
    city: 0,
    trees: 0,
    grove: 0.42,
    spire: 0,
    stone: 0.30,
    ridge: 0.8,
    ridgeEdge: 0.05,
    bloom: 0.8,
    town: 0,
    turbines: 0,
    palms: 0,
    blades: 1,
    leaves: 0,
    rain: 0,
    wind: 0,
    tech: 0,
    overcast: 0,
    sky: SKY_BLISS,
    dayStart: 0.19,
    swatch: ['#1f5fd8', '#8ad438', '#b2e556', 0],
  },
  {
    id: 'chrome',
    name: 'CHROME',
    blurb: 'grille néon, mercure, tours',
    // Relief anguleux et RAPIDE : la couche de 190 m domine, celle de 42 m est
    // relevee. On saute beaucoup, on lit peu — c'est le monde nerveux.
    amp: [4.2, 5.0, 1.4, 1.6, 0.10],
    water: -3.0,
    // PAS DE PLAGE DANS UN MONDE DE NEON. A 0,9 + 1,6, la greve barrait le
    // milieu du cadre d'une bande claire a bord dentele, et c'etait la seule
    // chose organique de tout le monde : la grille s'arretait dessus au lieu
    // de courir jusqu'a la flaque de mercure. Un ourlet suffit — le sujet est
    // que le neon touche le liquide.
    shore: [0.30, 0.55],
    // Le mercure a une houle courte et lente : c'est un liquide LOURD, il
    // n'ondule pas comme de l'eau.
    swell: [0.55, 34, 0.6],
    colors: {
      // Le « sol » n'est plus de l'herbe mais une dalle sombre : la grille
      // lumineuse par-dessus fait tout le travail (cf. uTech dans Ground).
      grassNear: 0x1b1846,
      grassMid: 0x241f5c,
      grassFar: 0x312a78,
      grassHorizon: 0x4a3f9c,
      grassShadow: 0x0e0c28,
      grassStreak: 0x7a5cff,
      // Le mercure : presque noir en profondeur, violet electrique en surface.
      waterShallow: 0x9a7cff,
      waterDeep: 0x120a38,
      waterFoam: 0xe8dcff,
      sandDry: 0x3a2f70,
      sandPale: 0x5a4a9e,
      sandWet: 0x1e1848,
      sandShell: 0xc8b0ff,
      // Les tours passent au neon : c'est la seule source chaude du monde.
      cityFace: 0x5a3fd0,
      cityLit: 0xff6cd0,
      cityDeep: 0x1a1050,
      treeLine: 0x150e3c,
      cloudCore: 0xc6b4ff,
      cloudShadow: 0x3a2a78,
      cloudRim: 0xffb0e8,
      warmAccent: 0x4a3a80,
    },
    // Le monde nerveux : plus vite, et le mercure est glissant. On y lit moins
    // le relief, donc on y mord moins.
    mods: { cruise: 1.08, grip: 0.94, lift: 0.96, plane: 1.15, boost: 1 },
    city: 1,
    trees: 1,
    grove: 0.62,
    spire: 1,
    stone: 1,
    ridge: 0.8,
    ridgeEdge: 1,
    bloom: 0,
    town: 0,
    turbines: 0.6,
    palms: 0,
    blades: 0,
    leaves: 0,
    rain: 0,
    wind: 0,
    tech: 1,
    overcast: 0,
    sky: SKY_CHROME,
    dayStart: 0.62,
    swatch: ['#2a2478', '#241f5c', '#9a7cff', 30],
  },
  {
    id: 'octobre',
    name: 'OCTOBRE',
    blurb: 'champs noyés, vent de travers, feuilles',
    // DES CHAMPS INONDES, PAS UN LAGON.
    //
    // Mesure sur quatre trajectoires : 31 % d'eau, 367 nappes distinctes de
    // 47 m en moyenne, 130 m au plus large, 105 m de terre entre deux. C'est
    // le CONTRAIRE d'Okinawa a part egale d'eau — la, une etendue continue
    // qu'on traverse ; ici, un semis de mares dans lesquelles on tombe. La
    // difference tient a la couche de fond, ecrasee de 6,0 a 4,6 : c'est elle
    // qui fait les grandes cuvettes, et sans elle l'eau ne se rassemble plus.
    //
    // Consequence voulue : ON PEUT ENCORE COULER ICI. Okinawa est
    // insubmersible parce qu'on y passe les deux tiers du temps sur l'eau et
    // que la noyade y coutait la partie sans faute du joueur. Sur une mare de
    // 47 m, couler est une erreur qu'on a eu le temps de voir venir — et un
    // monde melancolique sans aucun risque serait une carte postale.
    amp: [4.6, 3.4, 2.8, 1.35, 0.14],
    // -6,5 m et non -2,5 : NEUF POUR CENT d'eau au lieu de trente et un.
    //
    // A un tiers d'eau, octobre ne lisait pas comme des champs mouilles, il
    // lisait comme un MARECAGE — et pas seulement a cause des nappes. Ce sont
    // leurs BERGES qui faisaient le mal : chaque mare traine un ourlet de boue
    // pale, et avec une mare tous les cent metres le paysage entier se
    // couvrait de trainees beiges. On voyait un delta, pas une campagne.
    //
    // A 9 % il reste une mare tous les deux cent quatre-vingts metres, de
    // vingt-six metres de large : de l'eau qu'on remarque et qu'on traverse,
    // jamais de l'eau qui definit le monde. C'est MOINS que la plaine, qui en
    // a dix-sept — et c'est voulu : ici l'humidite se dit par le sol mouille,
    // les flaques et l'averse, pas par des etendues.
    water: -6.5,
    // Berges ETROITES, et resserrees deux fois depuis. Une plage large est une
    // image d'ete ; en octobre la terre descend dans l'eau sans transition,
    // avec juste un ourlet de boue. A 1,1 + 2,2 l'ourlet faisait encore des
    // bancs clairs de plusieurs metres autour de chaque mare, et c'est de la
    // que venait l'essentiel de l'effet marecage.
    //
    // A 0,7 + 1,3 il restait un defaut plus sournois, et il vient de la
    // DENTELURE : shoreMask ajoute au niveau un bruit d'amplitude 1,5 m, si
    // bien qu'une largeur nominale d'un metre couvre en fait tout ce qui est
    // a moins de deux metres cinquante au-dessus de l'eau. Sur une pente
    // douce, ca fait cent metres de greve — et c'est cette bande TAN qui
    // barrait le milieu de chaque capture. Un ourlet est un ourlet.
    shore: [0.40, 0.75],
    // Un clapot, pas une houle : 34 m de long, rapide, faible. C'est ce que
    // le vent fait a une mare — une eau nerveuse et sans rythme, l'inverse
    // exact des longues vagues lisibles d'Okinawa.
    swell: [0.35, 34, 1.9],
    colors: {
      // La gamme entiere bascule dans l'ocre. Le point delicat n'est pas de
      // trouver les bruns, c'est de garder un ECART DE VALEUR du premier plan
      // a l'horizon : sans lui un paysage brun devient une soupe, et c'est le
      // defaut classique des palettes d'automne.
      // La rampe reste SOMBRE jusqu'au fond. Sous un plafond de nuages, le
      // lointain ne s'eclaircit pas parce qu'il est loin — il s'eclaircit
      // parce que la brume s'interpose, et c'est le voile d'averse qui s'en
      // charge. Une rampe qui pale d'elle-meme donnait, une fois multipliee
      // par la lumiere du couchant, une immense etendue TAN entre la route et
      // les maisons : un desert, pas une campagne trempee.
      grassNear: 0x4a4b3f,
      grassMid: 0x5b5a49,
      grassFar: 0x676552,
      grassHorizon: 0x807b68,
      grassShadow: 0x2b2b22,
      // La strie est franchement ROUILLE et non ocre : c'est elle qui porte
      // les nappes de lumiere et les touffes, donc c'est elle qui met de
      // l'orange dans le champ. Une strie assortie au sol n'aurait rien dit.
      grassStreak: 0xa5732f,
      // Plus de sable : de la BOUE. Meme mecanique de greve, autre matiere.
      // De la BOUE, et sombre. Tiree claire elle lit comme du sable, et du
      // sable au bord d'une mare sous un ciel de plomb, c'est une vasiere.
      sandDry: 0x483c2a,
      sandPale: 0x5a4e39,
      sandWet: 0x2e281c,
      sandShell: 0x6b675a,
      // L'eau d'un champ inonde ne renvoie rien : elle est vert-de-gris en
      // surface et noire au fond. Aucun cyan nulle part — c'est le seul monde
      // du jeu qui n'en contient pas une trace, et c'est ce qui le rend
      // reconnaissable en une image.
      waterShallow: 0x5d6450,
      waterDeep: 0x1d242c,
      waterFoam: 0xc4c0ac,
      // La ville passe au BETON, et ses fenetres sont la seule source chaude
      // du monde. Un immeuble gris avec des carreaux allumes a la tombee du
      // jour est l'image la plus melancolique que ce jeu puisse produire, et
      // elle ne coute qu'une couleur.
      cityFace: 0x4a4d55,
      cityLit: 0xb8905c,
      cityDeep: 0x2b2d34,
      treeLine: 0x3a2e1e,
      warmAccent: 0x6a4a30,
      // Le plafond : gris mauve, avec un liseré rouille sur les bords. C'est
      // le lisere qui fait tout — un nuage gris borde de gris est une masse,
      // borde de cuivre c'est un ciel de fin de journee.
      cloudCore: 0x8b8492,
      cloudShadow: 0x474252,
      cloudRim: 0xd9a06a,
    },
    // La physique d'un jour de pluie. `grip` a 0,88 est le chiffre qui compte :
    // le sol est detrempe, le disque chasse, et le vent en profite. Le monde
    // rend ailleurs ce qu'il prend la — la rafale porte (`lift`), l'eau est
    // partout donc on y dejauge un peu mieux, et le vent de dos recharge.
    mods: { cruise: 0.97, grip: 0.88, lift: 1.10, plane: 1.06, boost: 1.08 },
    city: 0,
    trees: 0.95,
    grove: 0.9,
    spire: 0.72,
    stone: 0.20,
    ridge: 0.62,
    ridgeEdge: 0.35,
    bloom: 0.3,
    town: 1,
    // Les eoliennes ne sont plus un decor mais une INFORMATION : ce sont elles
    // qui disent, depuis l'horizon, qu'il y a du vent dans ce monde.
    turbines: 0.75,
    palms: 0,
    blades: 0.9,
    leaves: 1,
    rain: 1,
    // 6,2 m/s au pic, contre 13 m/s d'autorite laterale a vitesse de croisiere :
    // la rafale valait donc environ la moitie d'un appui a fond. Le banc le
    // trouvait corrigeable (zero pour cent du temps colle au bord) et le
    // joueur le trouvait INJOUABLE — les deux sont vrais, et l'ecart dit ce
    // que le banc ne mesurait pas.
    //
    // Un autopilote qui corrige en permanence ne se plaint pas ; un humain qui
    // vise un anneau, si. Ce qui compte n'est pas de pouvoir compenser, c'est
    // d'avoir des instants ou l'on n'a PAS a compenser. Deux corrections, et
    // la seconde compte plus que la premiere :
    //
    //   - la force descend a 2,4 m/s (un septieme d'un appui a fond) ;
    //   - la poussee reprend une forme sinusoidale (cf. Weather.windAt) au
    //     lieu du creneau sature qui sert aux visuels, ce qui rend au monde
    //     ses accalmies.
    //
    // La bourrasque reste franchement visible — l'herbe, les feuilles et la
    // pluie lisent toujours le signal sature — mais elle ne tient plus le
    // volant a la place du joueur.
    wind: 2.4,
    tech: 0,
    // Le plafond. C'est lui qui eteint le soleil du dome : sans ca, un ciel de
    // plomb avec une etoile de cinema plantee dedans.
    overcast: 0.92,
    sky: SKY_OCTOBRE,
    // On arrive juste avant le couchant : la partie entiere bascule dedans.
    dayStart: 0.42,
    swatch: ['#6a4258', '#8a6f34', '#4f5648', 30],
  },
];

const KEY = 'frutisurf.world';

export function worldById(id: string | null | undefined): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export function loadWorld(): WorldDef {
  try {
    return worldById(localStorage.getItem(KEY));
  } catch {
    return WORLDS[0];
  }
}

export function saveWorld(w: WorldDef): void {
  try {
    localStorage.setItem(KEY, w.id);
  } catch {
    // Sans persistance le jeu reste jouable : on repartira sur la plaine.
  }
}

/**
 * Palette resolue d'un monde : la palette canonique, ecrasee par ses
 * surcharges. Calculee une fois et memoisee — c'est la source du fondu.
 */
const resolved = new Map<string, Map<WorldColorKey, Color>>();

export function worldPalette(w: WorldDef): Map<WorldColorKey, Color> {
  let m = resolved.get(w.id);
  if (m) return m;
  m = new Map();
  for (const k of WORLD_COLOR_KEYS) m.set(k, new Color(w.colors[k] ?? HEX[k]));
  resolved.set(w.id, m);
  return m;
}
