import { clamp, Decay, lerp, Spring, smoothstep } from '../core/Spring';
import { terrainHeight, WATER_LEVEL } from '../world/Terrain';
import type { GameState } from '../core/GameState';

/**
 * La physique de glisse. C'est le fichier le plus important du projet :
 * si les ressorts d'ici sont mauvais, aucun effet visuel ne sauvera le jeu.
 *
 * Principe (docs/03 §1) : la sensation ne vient pas de la vitesse, elle vient
 * du contraste entre RESISTANCE et LIBERATION. Deux cycles s'entrelacent
 * desormais : le carve (charge laterale) et le relief (montee puis envol).
 */

/** La part de l'Input que la physique lit. Permet de la geler proprement. */
export interface SurfInput {
  steer: number;
  jumpHeld: boolean;
  boostHeld: boolean;
  consumeJump(): boolean;
}

/** Entree neutre : le surfeur finit sa course sans que le joueur la pilote. */
export const IDLE_INPUT: SurfInput = {
  steer: 0,
  jumpHeld: false,
  boostHeld: false,
  consumeJump: () => false,
};

export interface SurfEvents {
  onPop?: (charge: number, combo: number) => void;
  /** @param timed qualite du timing sur la crete  @param wind charge d'elan */
  onJump?: (timed: number, wind: number) => void;
  onLand?: (impact: number, quality: number) => void;
  onCarveFull?: () => void;
  /** Entree dans la fenetre de saut : signale UNE fois, pas en continu. */
  onLipEnter?: () => void;
  onBooster?: (combo: number) => void;
  /** Palier d'elan de saut franchi : 1, 2 ou 3 (arme a fond). */
  onWindStep?: (step: number) => void;
  /** Entree sur l'eau. @param planing vrai si on l'aborde assez vite. */
  onWater?: (planing: boolean) => void;
  /** On s'enfonce : la vitesse etait insuffisante. */
  onSink?: () => void;
  /** Traversee reussie. @param meters longueur glissee sur la surface. */
  onSkim?: (meters: number, points: number) => void;
  /** Anneau franchi. @param high anneau haut, celui qui demande un saut. */
  onRing?: (high: boolean, combo: number, points: number) => void;
  /** Anneau manque : sert au retour sonore, aucune penalite. */
  onRingMiss?: () => void;
  /** Vrille validee a l'atterrissage. */
  onTrick?: (turns: number, points: number) => void;
}

/**
 * Demi-largeur du terrain de jeu.
 *
 * A 14 m on jouait sur une tranche : deux longueurs de disque de chaque cote,
 * et toute la trajectoire tenait dans un couloir plus etroit que l'ecran. Ca se
 * jouait comme un rail. A 34 m la plaine redevient une plaine — on peut couper
 * large, laisser tomber un anneau pour en viser un autre, et revenir.
 */
const CORRIDOR = 34;
const GRAVITY = -22;
const JUMP_V = 7.4;
/** Marge d'adherence du disque avant qu'une crete ne le decolle. */
const GRIP = 1.8;

/**
 * Vitesse verticale minimale d'un decollage NATUREL.
 *
 * Sans ce seuil, le disque quittait le sol pile au sommet — la ou la pente est
 * nulle, donc avec une vitesse verticale quasi nulle. Resultat mesure par le
 * test de partie : 1633 "sauts" en 205 secondes, 66 ms de vol chacun. Le
 * surfeur grelottait sur chaque bosse des que la vitesse montait, et toute
 * vrille en cours repartait de zero avant d'avoir tourne d'un dixieme de tour.
 * Sous ce seuil, le disque reste colle a l'herbe.
 */
const MIN_LAUNCH_VY = 3.0;

/**
 * Delai avant qu'une crete puisse redecoller le disque apres une reception.
 * Le seuil de vitesse verticale seul ne suffisait pas : les bosses se suivent,
 * et le surfeur repartait en l'air a la frame suivant le contact.
 */
const LAUNCH_COOLDOWN = 0.35;

/**
 * Portee du gabarit qui detecte les cretes. A +/-7 m il mesure les collines
 * roulables (80 m et 39 m de longueur d'onde) et filtre la texture de 20 m :
 * on veut timer un sommet, pas chaque caillou.
 */
const LIP_SPAN = 7;
/** Seuil d'entree dans la fenetre de saut, pour le signal sonore. */
const LIP_CUE = 0.55;

/**
 * Indulgences d'entree. Ce sont elles qui font la difference entre un saut qui
 * "ne repond pas" et un saut qui pardonne : le joueur vise un instant, la
 * machine encaisse son erreur de quelques centiemes.
 */
/** On peut encore sauter juste apres avoir quitte le sol. */
const COYOTE = 0.13;
/** Un relachement juste avant l'atterrissage part des le contact. */
const BUFFER = 0.16;

/**
 * Vrille aerienne. Le meme geste sert a se deplacer lateralement et a tourner :
 * c'est volontaire. Viser sa reception et faire un tour deviennent le meme
 * arbitrage, donc une decision au lieu d'une touche de plus.
 */
/** Un tour en 0,65 s a fond de manche : un saut arme normal en vaut un. */
const SPIN_RATE = Math.PI * 2 * 1.55;
/** Seuil de declenchement : un micro-mouvement de pouce ne doit pas vriller. */
const SPIN_LOCK = 0.72;

/** Duree du coup de boost automatique offert par une colonne. */
const BURST = 1.15;

/**
 * L'eau.
 *
 * Une etendue ne se franchit qu'a la VITESSE : au-dela du seuil le disque
 * dechausse et file sur la surface, en dessous il s'enfonce. C'est la seule
 * mecanique du jeu qui punisse le fait d'etre lent, et elle donne enfin une
 * raison de garder sa vitesse au lieu de la depenser en figures.
 *
 * Deux seuils et non un : on decroche a 25 m/s mais on reste en glisse tant
 * qu'on tient 19. Un seuil unique ferait clignoter l'etat a la moindre
 * variation, et le joueur ne comprendrait pas ce qui lui arrive.
 */
const PLANE_ENTER = 25;
const PLANE_KEEP = 19;
/** Enfoncement du disque une fois coule. */
const SINK_DEPTH = 1.0;

/**
 * Economie du boost. Ce n'est plus une touche qu'on tient : c'est une
 * RESSOURCE que les figures remplissent. Sans ca, le boost n'a pas de cout et
 * enchainer des figures ne sert a rien.
 */
const BOOST_DRAIN = 0.40;
/** Fond de recharge : on ne reste jamais bloque sans jamais rien pouvoir faire. */
const BOOST_REGEN = 0.03;
const BOOST_MIN = 0.05;

export class Controller {
  // --- Etat cinematique
  x = 0;
  z = 0;
  y = 0;
  vy = 0;
  airborne = false;

  // --- Relief sous les pieds
  groundY = 0;
  /** Pente le long de l'axe de deplacement. Positif = ca monte devant. */
  slopeTravel = 0;
  /** Courbure le long du deplacement. Negatif = bombe (crete). */
  curvature = 0;
  /** 0..1, maximal pile au sommet d'une crete roulable. */
  lipFactor = 0;

  // --- Eau
  /** Vrai des que le sol sous le surfeur passe sous la ligne de flottaison. */
  onWater = false;
  /** Vrai quand il file SUR la surface. */
  planing = false;
  /** Vrai quand il s'est enfonce, jusqu'a la rive suivante. */
  sunk = false;
  /** Profondeur d'eau sous lui, en metres. */
  depth = 0;
  private skimMeters = 0;

  // --- Vol
  gliding = false;
  glideTime = 0;
  airTime = 0;

  /**
   * Elan du saut : monte tant qu'on maintient au sol, se libere au relachement.
   * C'est ce qui permet d'ANTICIPER une crete au lieu de reagir dessus.
   */
  jumpWind = 0;
  /** Dernier palier d'elan franchi, pour n'emettre le tic qu'une fois. */
  private windStep = 0;
  private jumpHeldPrev = false;
  private sinceGrounded = 0;
  private jumpedThisAir = false;
  private bufferTimer = 0;
  private bufferWind = 0;
  /** La portance ne se prend qu'UNE fois par vol (cf. commentaire plus bas). */
  private liftUsed = false;
  private launchLock = 0;

  /** Jauge de boost, 0..1. Remplie par les figures, videe par le boost. */
  boost = 0.5;
  boosting = false;
  /**
   * Coup de boost automatique. Une colonne ramassee POUSSE tout de suite :
   * remplir une jauge qu'il faut ensuite penser a depenser ne se sent pas au
   * moment ou l'on prend le plot, et c'est cet instant-la qui doit payer.
   */
  private burst = 0;

  /** Vrille accumulee en vol, en radians signes. */
  spin = 0;
  /** 0..1 : a quel point la vrille est engagee. Bride le controle lateral. */
  spinLock = 0;
  /** Tours complets valides au dernier atterrissage. */
  lastTurns = 0;

  // --- Les deux ressorts qui font tout le feeling.
  readonly steer = new Spring(0, 14, 0.72);
  readonly lean = new Spring(0, 9, 0.55);

  speed = 18;
  carveCharge = 0;
  combo = 0;
  comboTimer = 0;
  score = 0;
  distance = 0;

  hitstop = 0;
  /**
   * Fin de partie. Le surfeur FINIT sa course au lieu de se figer : couper le
   * mouvement net donnerait l'impression d'un plantage, pas d'une arrivee.
   */
  braking = false;
  private bonus = new Decay(0.45);
  private carveSign = 0;
  private wasCarving = false;
  private peakY = 0;

  constructor(private events: SurfEvents = {}) {
    this.y = terrainHeight(0, 0);
    this.groundY = this.y;
  }

  private cruise(): number {
    if (this.braking) return 0;
    return 22 + Math.min(12, this.distance / 260);
  }

  /** Multiplicateur courant. Une seule formule pour tout le scoring. */
  get mult(): number {
    return 1 + this.combo * 0.35;
  }

  /**
   * Plot de vitesse ramasse. Impulsion FRANCHE et immediate : un plot qui se
   * contenterait de remplir la jauge ne se sentirait pas au moment ou on le
   * prend, et c'est precisement l'instant qui doit payer.
   */
  collectBooster(): void {
    this.bonus.add(11);
    this.reward(0.24);
    this.burst = BURST;
    this.combo += 1;
    this.comboTimer = 2.6;
    this.score += 140 * this.mult;
    this.events.onBooster?.(this.combo);
  }

  /**
   * Anneau franchi. L'anneau haut paie presque le double : il demande de lire
   * le relief, d'armer un saut et de viser, la ou l'anneau au sol ne demande
   * qu'un deplacement lateral.
   */
  collectRing(high: boolean): number {
    this.bonus.add(high ? 15 : 9);
    this.reward(high ? 0.34 : 0.20);
    this.combo += 1;
    this.comboTimer = 3.0;
    const points = Math.round((high ? 400 : 220) * this.mult);
    this.score += points;
    this.hitstop = Math.max(this.hitstop, high ? 0.05 : 0.03);
    this.events.onRing?.(high, this.combo, points);
    return points;
  }

  missRing(): void {
    this.events.onRingMiss?.();
  }

  /** Les figures rechargent le boost. C'est la seule facon d'en gagner vite. */
  private reward(amount: number): void {
    this.boost = clamp(this.boost + amount, 0, 1);
  }

  get speedNorm(): number {
    return smoothstep(20, 52, this.speed);
  }

  /** Releve le relief autour du surfeur : hauteur, pente, courbure, crete. */
  private probeTerrain(): void {
    // --- L'eau d'abord : elle REMPLACE le relief quand elle est la.
    const floor = terrainHeight(this.x, this.z);
    this.depth = Math.max(0, WATER_LEVEL - floor);
    const over = this.depth > 0.12;
    const wasPlaning = this.planing;
    const wasSunk = this.sunk;

    if (!over) {
      // Retour sur la terre ferme : on remet tout a plat.
      this.planing = false;
      this.sunk = false;
    } else if (!this.sunk) {
      const eff = this.speed + this.bonus.value;
      this.planing = this.planing ? eff > PLANE_KEEP : eff > PLANE_ENTER;
      if (!this.planing) this.sunk = true;
    }

    if (over && !this.onWater) this.events.onWater?.(this.planing);
    if (this.sunk && !wasSunk) {
      this.combo = 0;
      this.comboTimer = 0;
      this.events.onSink?.();
    }
    // Traversee reussie : elle ne compte qu'a la SORTIE, une fois la rive
    // atteinte. Recompensee a la sortie et pas a l'entree, elle reste une
    // performance et non un bonus qu'on encaisse en touchant l'eau.
    if (wasPlaning && !this.planing && !over && this.skimMeters > 6) {
      const points = Math.round((90 + this.skimMeters * 9) * this.mult);
      this.score += points;
      this.combo += 1;
      this.comboTimer = 3.2;
      this.reward(0.10 + Math.min(0.28, this.skimMeters * 0.006));
      this.bonus.add(4 + Math.min(10, this.skimMeters * 0.18));
      this.events.onSkim?.(this.skimMeters, points);
    }
    if (!over) this.skimMeters = 0;
    this.onWater = over;

    if (this.planing || this.sunk) {
      // Une surface d'eau est PLATE : ni pente, ni courbure, donc ni frein de
      // montee ni decollage naturel. C'est aussi ce qui rend la traversee si
      // douce — on cesse d'un coup de sentir le relief.
      this.groundY = this.planing ? WATER_LEVEL : WATER_LEVEL - SINK_DEPTH;
      this.slopeTravel = 0;
      this.curvature = 0;
      this.lipFactor = 0;
      return;
    }

    // L'avant est en -Z.
    const h0 = terrainHeight(this.x, this.z);
    const hf = terrainHeight(this.x, this.z - LIP_SPAN);
    const hb = terrainHeight(this.x, this.z + LIP_SPAN);

    this.groundY = h0;
    this.slopeTravel = (hf - hb) / (2 * LIP_SPAN);
    this.curvature = (hf - 2 * h0 + hb) / (LIP_SPAN * LIP_SPAN);

    // Une crete, c'est bombe ET a peu pres plat : les deux conditions, sinon
    // on recompenserait aussi le milieu d'une pente.
    const convex = clamp(-this.curvature / 0.012, 0, 1);
    const flat = 1 - smoothstep(0.06, 0.22, Math.abs(this.slopeTravel));
    const before = this.lipFactor;
    this.lipFactor = convex * flat;

    // Front montant seulement, avec hysteresis : sans la sortie a 0.40 le
    // signal se redeclencherait en boucle sur le bruit du terrain.
    if (!this.airborne && before < LIP_CUE && this.lipFactor >= LIP_CUE) {
      this.events.onLipEnter?.();
    }
  }

  step(dt: number, input: SurfInput, boostAllowed = true): void {
    this.probeTerrain();

    // --- Direction
    this.steer.target = input.steer;
    this.steer.step(dt);
    const st = clamp(this.steer.value, -1.4, 1.4);

    this.lean.target = st * (this.airborne ? 0.26 : 0.62);
    this.lean.step(dt);

    // --- Charge de carve : uniquement au sol
    const carving = !this.airborne && Math.abs(st) > 0.55;
    if (carving) {
      const sign = Math.sign(st);
      if (this.carveSign !== 0 && sign !== this.carveSign) this.carveCharge *= 0.35;
      this.carveSign = sign;
      const before = this.carveCharge;
      this.carveCharge = Math.min(1, this.carveCharge + dt * 0.55);
      if (before < 1 && this.carveCharge >= 1) this.events.onCarveFull?.();
    } else {
      this.carveCharge = Math.max(0, this.carveCharge - dt * 1.4);
    }

    if (this.wasCarving && !carving && this.carveCharge > 0.18) this.pop();
    this.wasCarving = carving;

    // --- Vitesse. Le boost consomme la jauge ; a sec, la touche ne fait rien.
    // Le coup de boost d'une colonne est GRATUIT : il ne vide pas la jauge,
    // sinon ramasser un plot couterait la ressource qu'il vient d'offrir.
    if (this.burst > 0) this.burst -= dt;
    const forced = this.burst > 0;
    this.boosting = forced || (boostAllowed && input.boostHeld && this.boost > BOOST_MIN);
    if (this.boosting && !forced) this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
    else if (!this.boosting) this.boost = Math.min(1, this.boost + BOOST_REGEN * dt);
    const target = this.cruise() + (this.boosting ? 13 : 0);
    if (this.sunk) {
      // Coule : l'eau freine BRUTALEMENT. C'est le cout de l'erreur, et il doit
      // se sentir tout de suite — sinon "couler" n'est qu'un changement de
      // decor. On ressort de l'autre rive au pas.
      this.speed += (5 - this.speed) * (1 - Math.exp(-3.4 * dt));
    } else {
      this.speed += (target - this.speed) * (1 - Math.exp(-2.4 * dt));
    }

    // La pente tire ou retient. Coefficient sous la gravite reelle : on veut
    // que le relief se SENTE, pas qu'il dicte la course.
    if (!this.airborne) {
      // Le plancher de vitesse ne s'applique PAS quand on est coule : c'est
      // precisement la que le jeu doit pouvoir descendre a rien.
      const floorSpeed = this.sunk || this.braking ? 0 : 9;
      this.speed = Math.max(floorSpeed, this.speed - this.slopeTravel * 16 * dt);
    }

    this.bonus.step(dt);
    const effective = Math.min(60, this.speed + this.bonus.value);

    // --- Saut, envol, plane
    // On ne declenche plus sur l'APPUI mais sur le RELACHEMENT : maintenir
    // charge l'elan, relacher le libere. C'est ce qui permet de voir une crete
    // arriver, d'armer le saut, et de lacher pile au sommet.
    input.consumeJump();
    const held = input.jumpHeld;
    const released = this.jumpHeldPrev && !held;
    this.jumpHeldPrev = held;

    // L'elan monte aussi EN VOL : on peut armer pendant un plane et relacher
    // juste avant de toucher, pour repartir des le contact.
    if (held) {
      this.jumpWind = Math.min(1, this.jumpWind + dt * 2.0);
      // Trois PALIERS, pas une rampe continue. Un ressenti d'armement doit
      // etre rythme : trois tics espaces disent la meme chose qu'une note qui
      // monte, mais on peut les compter — donc lacher au bon moment devient
      // une decision et non une estimation. Et surtout ils s'arretent, alors
      // qu'une nappe tenue devient un aspirateur au bout de deux secondes.
      const step = this.jumpWind >= 0.99 ? 3 : this.jumpWind >= 0.66 ? 2 : this.jumpWind >= 0.33 ? 1 : 0;
      if (step > this.windStep) {
        this.windStep = step;
        this.events.onWindStep?.(step);
      }
    } else {
      this.windStep = 0;
    }
    this.sinceGrounded = this.airborne ? this.sinceGrounded + dt : 0;
    if (this.launchLock > 0) this.launchLock -= dt;
    if (this.bufferTimer > 0) this.bufferTimer -= dt;

    if (released) {
      if (!this.airborne) {
        this.launch(effective, this.lipFactor, this.jumpWind);
        this.jumpWind = 0;
        this.windStep = 0;
      } else if (this.sinceGrounded < COYOTE && !this.jumpedThisAir) {
        // Coyote : on a roule par-dessus la crete et appuye un poil trop tard.
        this.launch(effective, this.lipFactor, this.jumpWind);
        this.jumpWind = 0;
        this.windStep = 0;
      } else {
        // Trop tot : on garde l'intention pour l'appliquer au contact.
        this.bufferTimer = BUFFER;
        this.bufferWind = this.jumpWind;
        this.jumpWind = 0;
        this.windStep = 0;
      }
    }

    if (!this.airborne) {
      if (!held) {
        // Decollage naturel : au-dela d'une certaine vitesse, une crete bombee
        // ne peut plus retenir le disque. C'est de la physique, pas un scenario.
        //
        // Le facteur d'adherence represente la prise du disque sur l'herbe.
        // A 1.0 (physique pure) le boost envoyait en l'air 46 % du temps : on
        // ne glissait plus, on rebondissait.
        const needed = -this.curvature * effective * effective;
        const rise = this.slopeTravel * effective;
        if (needed > -GRAVITY * GRIP && rise > MIN_LAUNCH_VY && this.launchLock <= 0) {
          this.airborne = true;
          this.jumpedThisAir = false;
          this.vy = rise;
          this.airTime = 0;
          this.peakY = this.y;
          this.liftUsed = false;
          this.events.onJump?.(0, 0);
        }
      }
    }

    if (this.airborne) {
      this.airTime += dt;

      // Vrille. Elle ne part qu'a direction franchement tenue, et sa vitesse
      // monte avec l'appui : on peut donc corriger sa trajectoire en l'air
      // sans declencher un tour qu'on n'a pas demande.
      const lock = clamp((Math.abs(st) - SPIN_LOCK) / (1 - SPIN_LOCK), 0, 1);
      this.spinLock = lock;
      if (lock > 0) this.spin += Math.sign(st) * SPIN_RATE * lock * dt;

      // Plane : uniquement a partir de l'apex. Declenche des la montee, ca
      // donnerait un saut mou au lieu d'un envol suivi d'un vol.
      const wantGlide = held && this.vy < 1.2;
      if (wantGlide && !this.gliding && !this.liftUsed) {
        // Coup de portance a l'ouverture : sans lui on "arrete de tomber",
        // avec lui on ACCROCHE l'air. C'est ce qui fait la sensation de vol.
        //
        // UNE SEULE FOIS par vol. Sinon relacher et re-maintenir redonne la
        // poussee a chaque fois : il suffit de tapoter pour ne jamais redescendre.
        this.vy += 2.2;
        this.liftUsed = true;
      }
      this.gliding = wantGlide;
      this.glideTime = wantGlide ? this.glideTime + dt : Math.max(0, this.glideTime - dt * 2);

      // Le plane s'essouffle, mais lentement : la gravite ne revient a pleine
      // valeur qu'au bout de ~3 s de vol.
      const g = this.gliding ? lerp(0.20, 1.0, smoothstep(1.6, 3.0, this.glideTime)) : 1;
      this.vy += GRAVITY * g * dt;
      this.y += this.vy * dt;
      this.peakY = Math.max(this.peakY, this.y);

      if (this.gliding) {
        this.bonus.add(3.0 * dt);
        this.reward(0.10 * dt);
      }

      if (this.y <= this.groundY) {
        this.y = this.groundY;
        this.airborne = false;
        this.gliding = false;
        this.glideTime = 0;
        this.jumpHeldPrev = held;
        this.liftUsed = false;
        this.launchLock = LAUNCH_COOLDOWN;
        this.land(effective);

        // Relachement anticipe : il part des le contact, sans nouvel appui.
        if (this.bufferTimer > 0) {
          this.launch(effective, this.lipFactor, this.bufferWind);
          this.bufferTimer = 0;
        } else {
          this.jumpWind = held ? this.jumpWind : 0;
        }
      }
    } else {
      this.y = this.groundY;
      this.vy = 0;
      this.glideTime = 0;
      this.spinLock = 0;
    }

    // --- Deplacement. Le controle aerien est PLUS fort qu'au sol : en l'air
    // on n'a que ca pour viser sa reception ou rattraper une colonne.
    //
    // Mais une vrille engagee l'ETOUFFE : le disque presente sa tranche, il ne
    // mord plus l'air. C'est l'arbitrage central des figures — tourner, c'est
    // renoncer a corriger sa trajectoire. Sans ce frein, tenir la direction a
    // fond pour vriller expediait le surfeur hors du couloir en une seconde et
    // vriller devenait incompatible avec viser un anneau.
    // Autorite laterale relevee avec l'elargissement du couloir : il faut
    // pouvoir traverser la nouvelle largeur entre deux anneaux, sinon un
    // terrain plus large n'est qu'un terrain ou l'on rate davantage.
    let grip = this.airborne ? 0.64 * (1 - 0.72 * this.spinLock) : 0.52;
    // En glisse sur l'eau le disque ne mord plus : il DERIVE. Le virage
    // devient long et doux, et c'est ce qui rend la traversee si agreable.
    if (this.planing) grip *= 0.62;
    // Coule, on ne dirige presque plus.
    if (this.sunk) grip *= 0.35;
    const lateral = st * effective * grip;
    this.x += lateral * dt;
    this.z -= effective * dt;
    this.distance += effective * dt;
    if (this.planing) this.skimMeters += effective * dt;

    if (Math.abs(this.x) > CORRIDOR) {
      const over = Math.abs(this.x) - CORRIDOR;
      this.x -= Math.sign(this.x) * Math.min(over, over * dt * 6);
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.score += effective * dt * (1 + this.combo * 0.35);
  }

  /**
   * Saut. Deux multiplicateurs INDEPENDANTS se composent :
   *  - l'elan (combien de temps on a arme) : ce qu'on anticipe ;
   *  - le timing sur la crete : ce qu'on execute.
   * Il faut les deux pour un grand saut, et rater l'un n'annule pas l'autre.
   */
  private launch(speed: number, timed: number, wind: number): void {
    this.airborne = true;
    this.jumpedThisAir = true;
    this.airTime = 0;
    this.peakY = this.y;
    this.liftUsed = false;
    // On herite de la vitesse verticale que la montee donnait deja : sauter
    // juste avant le sommet paie donc aussi, la fenetre reste indulgente.
    const inherited = Math.max(0, this.slopeTravel * speed);
    this.vy = JUMP_V * (0.60 + 0.75 * wind) * (1 + 1.15 * timed) + inherited;
    if (timed > 0.55) {
      this.combo += 1;
      this.comboTimer = 2.6;
      this.bonus.add(5 * timed);
      this.hitstop = Math.max(this.hitstop, 0.035);
      this.score += 90 * timed;
      this.reward(0.13 * timed + 0.06 * wind);
    }
    this.events.onJump?.(timed, wind);
  }

  private land(speed: number): void {
    const impact = clamp(-this.vy / 14, 0, 1.6);

    // --- Figures. On ne compte que les tours COMPLETS : une vrille a moitie
    // faite ne rapporte rien, mais elle ne coute rien non plus. Punir un
    // atterrissage de travers rendrait la vrille effrayante alors qu'on veut
    // qu'elle devienne un reflexe.
    const turns = Math.floor(Math.abs(this.spin) / (Math.PI * 2));
    this.lastTurns = turns;
    if (turns > 0) {
      // Quadratique : deux tours valent quatre fois un tour. C'est ce qui
      // pousse a chercher LE grand saut plutot qu'a enchainer des demi-sauts.
      const points = Math.round(220 * turns * turns * this.mult);
      this.combo += turns;
      this.comboTimer = 3.2;
      this.score += points;
      this.bonus.add(6 * turns);
      this.reward(0.16 * turns);
      this.hitstop = Math.max(this.hitstop, 0.05);
      this.events.onTrick?.(turns, points);
    }
    this.spin = 0;

    // Atterrir dans la pente descendante amortit et relance ; a plat ou en
    // montee, ca casse. C'est ce qui pousse a choisir OU retomber.
    const downhill = clamp(-this.slopeTravel * 4.5, 0, 1);
    const quality = downhill * (1 - clamp(impact - 1, 0, 1) * 0.5);

    this.bonus.add(downhill * 7 - impact * 2.5 * (1 - downhill));
    if (quality > 0.55) {
      this.combo += 1;
      this.comboTimer = 2.6;
      this.score += 110 * quality;
      this.reward(0.16 * quality);
    }
    if (this.peakY - this.groundY > 1.8) {
      this.hitstop = Math.max(this.hitstop, 0.03);
    }
    this.vy = 0;
    void speed;
    this.events.onLand?.(impact, quality);
  }

  private pop(): void {
    const c = this.carveCharge;
    this.combo += 1;
    this.comboTimer = 2.6;
    this.bonus.add(9 * c);
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.score += 120 * c * this.mult;
    // Le slalom est la figure la plus accessible : c'est elle qui doit
    // alimenter le boost au quotidien.
    this.reward(0.11 * c);
    this.carveCharge = 0;
    this.carveSign = 0;
    this.events.onPop?.(c, this.combo);
  }

  /** @param dt temps REEL de l'image, pas le pas de simulation. */
  writeState(s: GameState, dt = 1 / 60): void {
    s.speed = Math.min(60, this.speed + this.bonus.value);
    s.steer = this.steer.value;
    s.lean = this.lean.value;
    s.carveCharge = this.carveCharge;
    s.combo = this.combo;
    s.comboTimer = this.comboTimer;
    s.score = this.score;
    s.distance = this.distance;
    s.airborne = this.airborne;
    s.boost = this.boost;
    s.boosting = this.boosting;
    s.jumpWind = this.jumpWind;
    s.gliding = this.gliding;
    s.lipFactor = this.airborne ? 0 : this.lipFactor;
    s.spinTurns = Math.abs(this.spin) / (Math.PI * 2);
    s.onWater = this.onWater;
    s.planing = this.planing;
    s.sunk = this.sunk;
    s.mult = this.mult;
    // Decroissance exponentielle en TEMPS, pas par image. Le facteur fixe de
    // 0,12 par image liait la duree du flash a la cadence d'affichage : deux
    // fois plus court sur un telephone a 120 Hz, deux fois plus long a 30. Un
    // retour visuel dont la duree depend de l'ecran ne se regle pas.
    // 7.7 = -ln(1 - 0.12) * 60, soit exactement l'ancienne vitesse a 60 Hz.
    s.popFlash *= Math.exp(-7.7 * dt);
    if (s.popFlash < 1e-3) s.popFlash = 0;
  }

  /** Remise a zero pour une nouvelle partie. Aucun etat ne doit survivre. */
  reset(): void {
    this.x = 0;
    this.z = 0;
    this.y = terrainHeight(0, 0);
    this.groundY = this.y;
    this.vy = 0;
    this.airborne = false;
    this.gliding = false;
    this.glideTime = 0;
    this.airTime = 0;
    this.jumpWind = 0;
    this.jumpHeldPrev = false;
    this.sinceGrounded = 0;
    this.jumpedThisAir = false;
    this.bufferTimer = 0;
    this.bufferWind = 0;
    this.liftUsed = false;
    this.launchLock = 0;
    this.boost = 0.5;
    this.boosting = false;
    this.burst = 0;
    this.spin = 0;
    this.spinLock = 0;
    this.lastTurns = 0;
    this.onWater = false;
    this.planing = false;
    this.sunk = false;
    this.depth = 0;
    this.skimMeters = 0;
    this.steer.snap(0);
    this.lean.snap(0);
    this.speed = 18;
    this.carveCharge = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.score = 0;
    this.distance = 0;
    this.hitstop = 0;
    this.braking = false;
    this.bonus.value = 0;
    this.carveSign = 0;
    this.wasCarving = false;
    this.peakY = this.y;
    this.lipFactor = 0;
  }
}
