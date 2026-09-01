import { Color, Vector3 } from 'three';
import { Audio } from './audio/Audio';
import { Engine } from './core/Engine';
import { createState } from './core/GameState';
import { Input } from './core/Input';
import { Run } from './core/Run';
import { clamp } from './core/Spring';
import { CameraRig } from './fx/CameraRig';
import { PostFX } from './fx/PostFX';
import { Hud } from './hud/Hud';
import { Select } from './hud/Select';
import { hasChosen, loadChoice, combine, type Loadout } from './core/Loadout';
import { ShockRing } from './fx/ShockRing';
import { Aura } from './fx/Aura';
import { setRiderLight } from './world/RiderLight';
import { Controller, IDLE_INPUT } from './player/Controller';
import { Spray } from './player/Spray';
import { Surfer } from './player/Surfer';
import { Trail } from './player/Trail';
import { SUN_DIR } from './world/Sky';
import { terrainGradient, terrainHeight, waterLevel, waterSurface } from './world/Terrain';
import type { BoosterHit } from './world/Boosters';
import { World } from './world/World';
import { loadWorld } from './world/Worlds';

const STEP = 1 / 120;

/** Cible de blanchiment de la lampe a pleine aura. */
const WHITE = new Color(1, 1, 1);

/** Temps rendu par un anneau. Le haut paie plus : il demande un saut. */
const RING_TIME = 3.0;
const RING_TIME_HIGH = 4.0;
/** Temps rendu par une colonne de vitesse. */
const PAD_TIME = 1.1;
/** Temps rendu par tour complet de vrille. */
const TRICK_TIME = 0.9;
/** Temps rendu par traversee d'eau reussie, par tranche de 10 m glisses. */
/**
 * Temps rendu par une traversee : RACINE de la longueur, pas proportionnel.
 *
 * Le taux lineaire de 0,55 s par 10 m etait cale sur les lacs de la plaine,
 * larges de 46 m. Applique aux 235 m de l'ocean il rendait douze secondes pour
 * sept secondes de traversee — le monde marin devenait immortel, et le banc
 * mesurait un pilote qui ne mourait plus jamais.
 *
 * La racine dit la bonne chose : une traversee deux fois plus longue n'est pas
 * deux fois plus difficile, elle est juste plus longue. Le debut d'une glisse
 * est la partie qui demande quelque chose — entrer assez vite — le reste se
 * tient tout seul.
 *
 *    46 m  -> 3,3 s   (le lac de plaine, une belle affaire)
 *   235 m  -> 5,0 s   (l'ocean, plafonne : legerement deficitaire, et c'est
 *                      la houle qui comble la difference)
 */
function skimTime(meters: number): number {
  return Math.min(SKIM_TIME_MAX, Math.sqrt(Math.max(meters, 0) / 10) * 1.55);
}
const SKIM_TIME_MAX = 5.0;
/** Temps rendu par vague franchie. Petit, mais il y en a beaucoup. */
const WAVE_TIME = 0.26;

/** Ramene un angle dans (-PI, PI]. */
function wrapAngle(a: number): number {
  return a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
}

export class Game {
  readonly engine: Engine;
  readonly world: World;
  readonly surfer: Surfer;
  readonly controller: Controller;
  readonly rig: CameraRig;
  readonly input: Input;
  readonly state = createState();
  readonly run = new Run();
  readonly post: PostFX;
  readonly spray: Spray;
  readonly trail = new Trail();
  readonly shock = new ShockRing();
  readonly aura = new Aura();
  readonly audio = new Audio();
  readonly hud: Hud;
  readonly select: Select;

  private acc = 0;
  private last = performance.now();
  private time = 0;
  private origin = new Vector3();
  private fpsAcc = 0;
  private fpsCount = 0;
  private contact = new Vector3();
  private vanish = new Vector3();
  private grad = { dx: 0, dz: 0 };
  private groundNormal = new Vector3(0, 1, 0);
  private trailPoint = new Vector3();
  private hits: BoosterHit[] = [];
  private probe = new Vector3();
  private cast = new Vector3();
  /** x, z du surfeur et force du sillage, envoyes au shader d'eau. */
  private wake = new Vector3();
  /** Force du sillage lissee : il enfle et se resorbe, il ne clignote pas. */
  private wakeAmount = 0;
  private screen = new Vector3();
  /** Couleur de travail de la lampe. Reecrite, jamais recreee. */
  private tint = new Color();
  /** Position au pas de simulation precedent : sert au test d'anneau. */
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  /** Lacet visuel du surfeur, decouple de la vrille physique. */
  private yaw = 0;
  private lastTick = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    // Le monde est choisi AVANT la construction du decor : le relief, les
    // couleurs et le ciel sont alors poses d'entree, sans une seule image
    // passee dans la plaine. Un fondu au demarrage se lirait comme un bug de
    // chargement, pas comme une transition.
    const startWorld = loadWorld();
    this.world = new World(this.engine.scene, this.engine.renderer, this.engine.quality, startWorld);
    this.run.setWorld(startWorld.id);
    this.surfer = new Surfer(this.engine.scene, this.engine.quality === 'low');
    this.input = new Input(canvas);

    this.spray = new Spray(this.engine.quality === 'low' ? 380 : 760);
    this.engine.scene.add(this.spray.mesh, this.trail.mesh, this.shock.group, this.aura.mesh);

    this.controller = new Controller({
      onPop: (charge, combo) => {
        this.rig.punch(0.35 * charge, 14 * charge);
        this.state.popFlash = charge;
        this.spray.burst(this.contactPoint(), Math.round(90 * charge), 0.9 + charge, this.time);
        this.shock.spawn(this.contactPoint(), 0.55 + charge * 0.5, this.time, this.controller.groundY);
        this.audio.pop(charge, combo);
        this.buzz(18);
      },
      onJump: (timed, wind) => {
        this.audio.jump(timed, wind);
        this.hud.dismissHint();
        if (timed > 0.35 || wind > 0.6) {
          // Recompense visible du saut bien time : gerbe, anneau, coup de FOV.
          const force = Math.max(timed, wind * 0.7);
          this.rig.punch(0.18 * force, 9 * force);
          this.spray.burst(this.contactPoint(), Math.round(55 * force), 0.8 + force, this.time);
          this.shock.spawn(this.contactPoint(), 0.45 + force * 0.5, this.time, this.controller.groundY);
          this.state.popFlash = Math.max(this.state.popFlash, timed * 0.8);
        }
      },
      onLipEnter: () => this.audio.lip(),
      onWindStep: (step) => this.audio.windStep(step),
      onBooster: (combo) => {
        this.rig.punch(0.20, 11);
        this.state.popFlash = Math.max(this.state.popFlash, 0.85);
        this.spray.burst(this.contactPoint(), 70, 1.3, this.time);
        this.shock.spawn(this.contactPoint(), 0.9, this.time, this.controller.groundY);
        this.audio.booster(combo);
        this.buzz(28);
      },
      onRing: (high, combo, points) => {
        this.rig.punch(high ? 0.24 : 0.14, high ? 13 : 8);
        this.state.popFlash = Math.max(this.state.popFlash, high ? 0.95 : 0.6);
        this.spray.burst(this.contactPoint(), high ? 90 : 50, 1.2, this.time);
        this.shock.spawn(this.contactPoint(), high ? 1.0 : 0.6, this.time, this.controller.groundY);
        this.audio.ring(high, combo);
        this.buzz(high ? 26 : 15);
        if (high) this.hud.banner('ANNEAU HAUT', `+${points}`, 'high');
      },
      onRingMiss: () => this.audio.ringMiss(),
      onTrick: (turns, points) => {
        this.run.addTime(TRICK_TIME * turns);
        this.hud.banner(`${turns * 360}°`, `+${points}`, 'trick');
        this.timeGain(TRICK_TIME * turns);
        this.audio.trick(turns);
        this.rig.punch(0.22, 11);
        this.state.popFlash = Math.max(this.state.popFlash, 0.9);
        this.spray.burst(this.contactPoint(), 80, 1.25, this.time);
        this.buzz(24);
      },
      onWater: (planing) => {
        // La gerbe d'entree part TOUJOURS : c'est elle qui rend le contact
        // avec l'eau physique. Ce qui change, c'est ce qui suit.
        this.spray.foam = 1;
        this.spray.burst(this.contactPoint(), planing ? 110 : 70, planing ? 1.5 : 1.0, this.time);
        this.shock.spawn(this.contactPoint(), planing ? 1.1 : 0.7, this.time, waterLevel());
        this.audio.splash(planing);
        this.rig.punch(planing ? 0.16 : 0.10, planing ? 8 : 4);
        // Pas de banniere a l'ENTREE : le lac suivant arrive neuf secondes
        // plus tard, une banniere a chaque rive occuperait l'ecran en
        // permanence. La recompense se lit a la sortie, quand elle est acquise.
        if (planing) {
          this.state.popFlash = Math.max(this.state.popFlash, 0.7);
          this.buzz(16);
        }
      },
      onWave: (force) => {
        // Retour DISCRET et repete : ca arrive toutes les deux secondes sur
        // l'ocean. Une banniere ou une gerbe a chaque vague saturerait l'ecran
        // en dix secondes — c'est le meme raisonnement que pour la banniere
        // d'entree dans l'eau, qu'on a supprimee pour la meme raison.
        this.run.addTime(WAVE_TIME);
        this.rig.punch(0.05 + force * 0.06, 2 + force * 3);
        this.spray.burst(this.contactPoint(), Math.round(14 + force * 26), 0.7 + force * 0.5, this.time);
        this.audio.lip();
        if (this.controller.waves % 5 === 0) {
          this.timeGain(WAVE_TIME * 5);
          this.buzz(10);
        }
      },
      onSink: () => {
        // Couler ne doit pas se lire comme un accident graphique : gros
        // ralenti visuel, camera qui plonge, son grave. On PERD, ca se voit.
        this.rig.punch(0.30, -12);
        this.spray.foam = 1;
        this.spray.burst(this.contactPoint(), 130, 0.9, this.time);
        this.shock.spawn(this.contactPoint(), 1.3, this.time, waterLevel());
        this.audio.sink();
        this.hud.banner('COULÉ', '', 'sunk');
        this.buzz(45);
      },
      onFlight: (seconds, points) => {
        // Meme courbe que la traversee, meme raison : c'est le DEBUT qui
        // demande quelque chose, la suite se tient toute seule.
        const gain = Math.min(4.0, Math.sqrt(seconds) * 1.9);
        this.run.addTime(gain);
        this.timeGain(gain);
        this.hud.banner(`VOL ${seconds.toFixed(1)}s`, `+${points}`, 'trick');
        this.popAt(this.contactPoint(), `+${points}`, 'big');
        this.audio.trick(1);
        this.rig.punch(0.16, 8);
        this.state.popFlash = Math.max(this.state.popFlash, 0.7);
        this.buzz(18);
      },
      onSkim: (meters, points) => {
        const gain = skimTime(meters);
        this.run.addTime(gain);
        this.timeGain(gain);
        this.hud.banner(`GLISSE ${Math.round(meters)}m`, `+${points}`, 'wet');
        this.popAt(this.contactPoint(), `+${points}`, 'big');
        this.audio.skim(meters);
        this.rig.punch(0.20, 10);
        this.state.popFlash = Math.max(this.state.popFlash, 0.85);
        this.spray.burst(this.contactPoint(), 90, 1.3, this.time);
        this.buzz(24);
      },
      onLand: (impact, quality) => {
        // Une reception propre dans la pente secoue moins et gicle plus :
        // le retour doit dire au joueur qu'il a bien choisi son point de chute.
        this.rig.punch(0.22 * impact * (1 - quality * 0.55), 5 * impact);
        this.spray.burst(
          this.contactPoint(),
          Math.round(46 * impact + 40 * quality),
          0.7 + impact,
          this.time,
        );
        this.shock.spawn(this.contactPoint(), 0.4 + impact * 0.7, this.time, this.controller.groundY);
        this.audio.land(impact, quality);
        if (impact > 0.7) this.buzz(14);
      },
    });

    this.rig = new CameraRig(this.engine.camera);
    this.rig.snap(this.controller);

    this.post = new PostFX(
      this.engine.renderer,
      this.engine.scene,
      this.engine.camera,
      this.engine.quality,
    );
    this.engine.onResize = (w, h) => this.post.resize(w, h);
    this.trail.reset(this.contactPoint());

    this.hud = new Hud(document.getElementById('hud')!);

    // --- L'equipement.
    //
    // Le choix precedent est applique AVANT le premier pas de simulation :
    // charger le monde avec une monture neutre puis la remplacer une frame
    // plus tard ferait sauter la vitesse de croisiere sous les yeux du joueur.
    const saved = loadChoice();
    this.applyLoadout(combine(saved.rider, saved.mount, startWorld.mods));

    this.select = new Select(document.getElementById('pick')!);
    this.select.onToggle = (open) => document.body.classList.toggle('picking', open);
    // Le monde s'applique DES LE SURVOL, pas a la validation : c'est le decor
    // derriere le panneau qui sert de vignette.
    this.select.onWorld = (w) => this.world.setWorld(w);
    this.select.onConfirm = (l, w) => {
      this.applyLoadout(l);
      this.world.setWorld(w);
      this.run.setWorld(w.id);
      // Valider vaut geste utilisateur : l'audio peut s'armer ici, sans
      // attendre que le joueur touche la zone de jeu.
      this.state.started = true;
      this.audio.start();
      this.restart();
    };

    // Pas d'ecran de depart pour un habitue : seule la toute premiere visite
    // ouvre l'equipement. Un menu impose a chaque lancement est exactement ce
    // qui tue le « encore une » d'un jeu de quarante secondes.
    if (!hasChosen()) this.select.open();

    // L'audio s'arme au premier geste, c'est tout ce qu'imposait la
    // politique autoplay.
    this.input.onFirstGesture = () => {
      this.state.started = true;
      this.audio.start();
    };
    this.hud.onEquip = () => this.select.open();
  }

  /** Un seul point d'entree pour l'equipement : la physique ET la livree. */
  private applyLoadout(l: Loadout): void {
    this.controller.loadout = l;
    this.surfer.setLoadout(l.rider.id, l.mount.id);
  }

  private contactPoint(): Vector3 {
    const c = this.controller;
    return this.contact.set(c.x, c.y + 0.08, c.z);
  }

  /** Vibration courte sur mobile. Ignoree partout ou l'API n'existe pas. */
  private buzz(ms: number): void {
    navigator.vibrate?.(ms);
  }

  /**
   * Point du monde -> pixels CSS. Les popups doivent naitre LA ou l'action a
   * eu lieu ; un gain affiche dans un coin ne se relie pas au geste.
   */
  private popAt(world: Vector3, text: string, kind = ''): void {
    this.screen.copy(world).project(this.engine.camera);
    const behind = this.screen.z > 1 || !Number.isFinite(this.screen.x);
    const x = behind ? innerWidth * 0.5 : (this.screen.x * 0.5 + 0.5) * innerWidth;
    const y = behind ? innerHeight * 0.55 : (-this.screen.y * 0.5 + 0.5) * innerHeight;
    this.hud.pop(text, clamp(x, 40, innerWidth - 40), clamp(y, 90, innerHeight - 80), kind);
  }

  /** Le temps gagne s'affiche AU CHRONO : c'est la qu'on le cherche des yeux. */
  private timeGain(seconds: number): void {
    this.hud.pop(`+${seconds.toFixed(1)}s`, innerWidth * 0.5, innerHeight * 0.11, 'time');
  }

  private collectBoosters(): void {
    const c = this.controller;
    this.probe.set(c.x, c.y, c.z);
    this.world.boosters.query(this.probe, 1.6, this.hits);
    for (const h of this.hits) {
      this.world.boosters.take(h.index, this.time);
      c.collectBooster();
      this.run.addTime(PAD_TIME);
      this.popAt(h.position, `+${Math.round(140 * c.mult)}`);
    }
  }

  /**
   * Franchissement d'anneau. Teste sur le PLAN traverse pendant le pas, pas sur
   * une proximite : a 45 m/s le surfeur avance de 0,4 m par pas et un test de
   * sphere en laisserait passer un sur deux.
   */
  private checkRings(): void {
    const c = this.controller;
    const hit = this.world.rings.cross(this.prevX, this.prevY, this.prevZ, c.x, c.y, c.z);
    if (!hit) return;
    if (!hit.pass) {
      c.missRing();
      return;
    }
    this.popAt(hit.point, `+${Math.round((hit.high ? 400 : 220) * c.mult)}`, hit.high ? 'big' : '');
    this.world.rings.take(hit.index);
    c.collectRing(hit.high);
    const gain = hit.high ? RING_TIME_HIGH : RING_TIME;
    this.run.addTime(gain);
    this.timeGain(gain);
    this.run.rings += 1;
  }

  /** Normale du terrain sous le surfeur, pour poser tout ce qui touche le sol. */
  private updateGroundNormal(): void {
    const c = this.controller;
    terrainGradient(c.x, c.z, this.grad);
    this.groundNormal.set(-this.grad.dx, 1, -this.grad.dz).normalize();
  }

  /** Nouvelle partie. Doit etre INSTANTANEE : c'est ce qui donne le "encore une". */
  restart(): void {
    this.controller.reset();
    this.run.reset();
    this.world.reset(this.controller.z);
    this.rig.snap(this.controller);
    this.trail.reset(this.contactPoint());
    this.hud.hideOver();
    this.state.popFlash = 0;
    this.state.score = 0;
    this.prevX = this.controller.x;
    this.prevY = this.controller.y;
    this.prevZ = this.controller.z;
    this.yaw = 0;
    this.lastTick = -1;
    this.acc = 0;
    this.wakeAmount = 0;
    this.spray.foam = 0;
  }

  private endRun(): void {
    this.run.finalDistance = this.controller.distance;
    this.controller.braking = true;
    this.audio.over();
    this.hud.showOver(this.run, this.controller.distance);
    this.buzz(40);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    // EN TETE, avant tout le reste : un redimensionnement realloue le tampon de
    // dessin, et un tampon realloue est noir tant que rien ne l'a repeint. Il
    // doit donc toujours etre suivi d'un rendu DANS LA MEME FRAME (cf.
    // Engine.flushResize).
    this.engine.flushResize();
    // DEUX durees, et il faut les deux.
    //
    // `raw` est le temps reellement ecoule ; `real` est ce temps BORNE a 100 ms,
    // et c'est lui que la simulation consomme — sans borne, un onglet revenu au
    // premier plan apres dix secondes rattraperait dix secondes de jeu d'un
    // coup.
    //
    // Les confondre faisait mentir le compteur d'images des que la machine
    // descendait sous dix images par seconde : `real` plafonnait a 100 ms, donc
    // le compteur affichait 10 img/s quoi qu'il arrive. Mesure sur rendu
    // logiciel : 1,2 image reelle par seconde annoncee comme 12,7. Le chiffre
    // qu'on regarde pour savoir si le jeu rame etait precisement celui qui ne
    // pouvait pas le dire — et le declencheur de baisse de qualite lisait la
    // meme valeur bornee.
    const raw = (now - this.last) / 1000;
    const real = Math.min(raw, 0.1);
    this.last = now;
    this.time += real;

    this.fpsAcc += raw;
    this.fpsCount++;
    if (this.fpsAcc >= 0.5) {
      this.state.fps = this.fpsCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }

    this.input.update();
    // Toujours consommer, meme en jeu : sinon un front garde en reserve
    // relancerait la partie a la seconde ou elle se termine.
    const acted = this.input.consumeAny();
    const picking = this.select.isOpen;
    if (acted && this.run.canRestart && !picking) this.restart();

    const playing = this.run.phase === 'running' && !picking;

    // Pas fixe pour la simulation : les ressorts a omega=14 ont besoin de
    // 120 Hz pour ne pas osciller en escalier sur un ecran 60 Hz.
    this.acc += real;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 16) {
      // Le hitstop gele la SIM, pas le RENDU.
      if (this.controller.hitstop > 0) {
        this.controller.hitstop -= STEP;
      } else {
        this.prevX = this.controller.x;
        this.prevY = this.controller.y;
        this.prevZ = this.controller.z;
        this.controller.step(STEP, playing ? this.input : IDLE_INPUT);
        if (playing) {
          this.collectBoosters();
          this.checkRings();
        }
      }
      this.acc -= STEP;
    }
    // On JETTE le retard qui n'a pas pu etre rattrape. Sans ca l'accumulateur
    // grossit sans fin quand la machine ne suit pas, et la simulation part en
    // ralenti : le jeu ne repond plus au temps reel mais a son propre retard.
    if (this.acc > STEP * 2) this.acc = STEP * 2;

    // Le chrono est GELE pendant le choix — et lui seul. Le monde continue de
    // defiler derriere le panneau, le cycle jour/nuit continue de tourner :
    // c'est ce qui fait la difference entre un menu pose sur une capture et un
    // jeu qui attend. Mais faire couler le temps pendant qu'on lit des
    // libelles reviendrait a punir la lecture.
    if (!picking) {
      if (this.run.step(real, this.controller.score, this.controller.combo)) this.endRun();
      this.countdown();
    }

    this.controller.writeState(this.state, real);
    this.hud.update(this.state, this.run, real);

    // La camera tourne en temps reel : elle doit rester fluide meme si la
    // simulation est gelee.
    this.rig.update(real, this.controller, this.time);

    this.updateGroundNormal();
    this.syncSurfer(real);

    this.origin.set(this.controller.x, 0, this.controller.z);
    // Ombre portee : on projette le disque au sol LE LONG DES RAYONS du
    // soleil. Une ombre posee a la verticale trahirait immediatement l'absence
    // de calcul d'eclairage — c'est le decalage qui la rend credible, et c'est
    // aussi lui qui dit au joueur a quelle hauteur il se trouve.
    {
      const c = this.controller;
      const h = Math.max(0, c.y - c.groundY);
      const k = h / Math.max(0.25, SUN_DIR.y);
      this.cast.set(c.x - SUN_DIR.x * k, h, c.z - SUN_DIR.z * k);
    }
    // Le sillage enfle et se resorbe : coupe net, il claquerait a chaque
    // entree et sortie de rive.
    {
      const c = this.controller;
      const target = c.planing ? 1 : c.sunk ? 0.45 : 0;
      this.wakeAmount += (target - this.wakeAmount) * Math.min(1, real * 7);
      this.wake.set(c.x, c.z, this.wakeAmount);
    }
    this.world.update(
      this.origin,
      this.engine.camera.position,
      this.time,
      this.controller.speedNorm,
      real,
      this.cast,
      this.wake,
    );

    this.updateGlow(real);
    this.updateFx(real);
    // Rendre sur un contexte perdu ne produit rien et laisse le compositeur
    // afficher un canvas vide : on saute la frame, le fond CSS prend le relais.
    if (!this.engine.contextLost) this.post.render(real);
    this.engine.sampleFrame(raw * 1000);
  };

  /** Tic sec par seconde sur la fin du chrono. Il presse sans klaxonner. */
  private countdown(): void {
    if (this.run.phase !== 'running' || this.run.timeLeft >= 6) {
      this.lastTick = -1;
      return;
    }
    const s = Math.ceil(this.run.timeLeft);
    if (s === this.lastTick) return;
    this.lastTick = s;
    this.audio.tick(s <= 3);
  }

  /**
   * L'AURA ET LA LAMPE.
   *
   * Les deux ne font qu'une seule chose : dire au joueur, SANS qu'il regarde le
   * compteur, a quel point il va vite et qui il pilote. La lampe existe en
   * permanence — c'est la livree du personnage — et l'aura vient s'y ajouter
   * au-dela de 200 km/h.
   *
   * Le couplage est volontaire et c'est lui qui vend l'effet : quand l'aura
   * s'allume, la flaque de lumiere DOUBLE de rayon et de puissance. Ce n'est
   * plus le personnage qui brille, c'est la plaine qui change de couleur autour
   * de lui — et ca, on ne peut pas le rater.
   */
  private updateGlow(dt: number): void {
    const c = this.controller;
    const look = this.surfer.look;
    const kmh = this.state.speed * 3.6;
    this.aura.update(this.time, kmh, look.lamp, dt);

    const a = this.aura.power;
    this.aura.place(this.surfer.rig.position);

    // La lampe monte avec la vitesse, puis explose avec l'aura — mais elle est
    // BORNEE.
    //
    // Sans plafond, l'aura poussait la puissance a plus du double de ce que le
    // rendu peut encaisser : sur le sol sombre de CHROME, la flaque saturait a
    // blanc pur sur un tiers de l'ecran. Une lampe qui deborde ne rend pas la
    // scene plus lumineuse, elle l'efface — et le personnage qu'on voulait
    // mettre en valeur disparaissait dans sa propre lueur.
    const power = Math.min(1.45, look.power * (0.5 + 0.5 * c.speedNorm) + a * 0.95);
    // 15 m au repos, 26 a pleine aura. Le premier reglage a 9 m tenait dans un
    // quart de l'ecran : une flaque qu'on ne voit qu'en baissant les yeux ne
    // change rien a l'image, et c'est l'IMAGE qu'on veut changer.
    // 11 m au repos, 22 a pleine aura. A 15 m la flaque debordait du cadre :
    // sans bord visible, une lueur cesse d'etre une SOURCE et devient un
    // filtre de couleur pose sur l'image.
    const radius = 11 + a * 11;
    this.tint.setHex(look.lamp);
    // A pleine aura la couleur blanchit : un coeur de flamme n'a pas de teinte,
    // et une lueur qui reste verte a fond de compteur lit comme un filtre pose
    // sur l'image plutot que comme une source qui sature.
    this.tint.lerp(WHITE, a * 0.45);
    setRiderLight(
      c.x, c.y + 0.7, c.z,
      this.tint.r, this.tint.g, this.tint.b,
      power, radius,
    );
  }

  private updateFx(dt: number): void {
    const c = this.controller;
    const contact = this.contactPoint();

    this.spray.update(this.time);
    // Ecume ou herbe : decide a la SOURCE, chaque particule garde sa nature.
    this.spray.foam = c.onWater ? 1 : 0;
    if (!c.airborne) {
      // En glisse la carre brasse en permanence, meme droit devant : c'est ce
      // debit continu qui fait sentir la portance.
      const spread = c.planing
        ? Math.max(0.45, Math.abs(c.steer.value))
        : Math.abs(c.steer.value);
      this.spray.emit(contact, c.steer.value, this.state.speed, spread, dt, this.time);
    }

    this.trail.update(
      this.trailPoint.set(
        c.x,
        c.airborne ? c.y + this.surfer.hover : c.groundY + 0.07,
        c.z,
      ),
      dt,
      c.speedNorm,
      c.carveCharge,
      c.airborne,
      // La trace se pose sur la SURFACE : sur l'eau elle doit flotter, pas
      // suivre le fond du lac.
      // La trace flotte sur la SURFACE, houle comprise : posee au niveau moyen
      // elle traverserait les vagues une fois sur deux.
      (x, z) => Math.max(terrainHeight(x, z), waterSurface(x, z, this.controller.clock)),
    );
    this.shock.update(this.time);

    // Le point de fuite, pas le centre de l'ecran : quand on carve, tout
    // l'effet de vitesse pivote avec la trajectoire.
    this.vanish.set(c.x + c.steer.value * 2.3, c.y + 1.15, c.z - 400);
    this.vanish.project(this.engine.camera);
    this.post.surf.set(
      c.speedNorm,
      c.boosting ? 1 : 0,
      c.carveCharge,
      this.state.popFlash,
      this.vanish.x * 0.5 + 0.5,
      this.vanish.y * 0.5 + 0.5,
    );
    this.post.setCombo(c.combo);
    // L'aura pousse aussi le POST-TRAITEMENT : au-dela de 200 km/h le flou
    // radial et l'aberration doivent depasser ce que la vitesse seule donne,
    // sinon l'aura est un objet pose devant une image calme.
    if (this.aura.power > 0.01) {
      this.post.surf.set(
        Math.min(1, c.speedNorm + this.aura.power * 0.35),
        c.boosting ? 1 : 0,
        Math.max(c.carveCharge, this.aura.power * 0.5),
        Math.max(this.state.popFlash, this.aura.power * 0.28),
        this.vanish.x * 0.5 + 0.5,
        this.vanish.y * 0.5 + 0.5,
      );
    }

    // Le repere de crete est SONORE : sans interface, c'est lui qui dit quand
    // appuyer. Il monte a l'approche du sommet et retombe apres.
    this.audio.update(
      c.speedNorm,
      Math.abs(c.steer.value),
      // L'elan du saut partage le bourdon de charge avec le carve : deux
      // tensions, un seul son qui monte, ca reste lisible.
      // L'ELAN DE SAUT NE NOURRIT PLUS LE BOURDON.
      //
      // Maintenir pour armer produisait une note tenue de plusieurs secondes,
      // qui montait puis restait — un aspirateur. Un son continu ne convient
      // qu'a un etat qu'on SUBIT (le vent, la vitesse) ; l'armement est une
      // action volontaire et breve, il se marque, il ne se joue pas en nappe.
      // Il a desormais son tic de palier (voir Controller.onWindStep).
      c.carveCharge,
      c.airborne,
      c.gliding,
      c.planing,
      c.sunk,
    );
  }

  private syncSurfer(dt: number): void {
    const c = this.controller;
    const s = this.surfer;

    s.rig.position.set(c.x, c.y + s.hover, c.z);

    // Le rig epouse le terrain, le tilt porte le carve : les separer evite que
    // l'inclinaison de pente ne se melange a celle du virage.
    const slopePitch = c.airborne ? 0 : c.slopeTravel;
    const slopeRoll = c.airborne ? 0 : this.grad.dx;
    s.rig.rotation.x += (slopePitch - s.rig.rotation.x) * Math.min(1, dt * 9);
    s.rig.rotation.z += (slopeRoll - s.rig.rotation.z) * Math.min(1, dt * 9);

    // Vrille. A l'atterrissage on replie l'angle dans (-PI, PI] AVANT de
    // revenir a zero : sans ce repliement, un 720 se devisserait a l'envers
    // sur deux tours entiers, ce qui se lit comme un bug.
    if (!c.airborne) this.yaw = wrapAngle(this.yaw);
    const targetYaw = c.airborne ? c.spin : 0;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * (c.airborne ? 22 : 9));
    s.rig.rotation.y = this.yaw;

    // Le roulis n'est plus porte par le groupe commun : le disque et le buddy
    // ont chacun le leur, avec des raideurs differentes (cf. Surfer.animate).
    s.animate(dt, {
      lean: c.lean.value,
      steer: c.steer.value,
      speedN: c.speedNorm,
      airborne: c.airborne,
      vy: c.vy,
      time: this.time,
    });

    // En l'air le disque pique du nez ; en plane il se cabre pour porter.
    // Sur l'eau il se cabre AUSSI, comme une coque qui dechausse : c'est la
    // silhouette qui dit qu'on porte au lieu de labourer.
    const airPitch = c.gliding
      ? -0.24
      : c.airborne
        ? 0.18
        : c.planing
          ? -0.15
          : c.sunk
            ? 0.10
            : 0;
    s.tilt.rotation.x += (airPitch - s.tilt.rotation.x) * Math.min(1, dt * 7);

    // Rotation propre du CD : elle monte avec la vitesse et la charge. Ecrite
    // APRES animate(), qui ne touche qu'aux axes x et z du disque.
    // Multipliee par dt et non par 1/60 : la vitesse de rotation ne doit pas
    // dependre de la cadence d'affichage.
    s.disc.group.rotation.y += (2.2 + c.speedNorm * 5.0 + c.carveCharge * 4.0) * dt;

    // Squash & stretch. Au sol, l'elan du saut COMPRIME le buddy : c'est le
    // seul retour visuel qui dit qu'on est en train d'armer.
    const squash = c.airborne
      ? clamp(c.vy * 0.018, -0.10, 0.14)
      : -c.jumpWind * 0.26;
    s.buddy.setSquash(squash);

    s.update(this.time, c.carveCharge, c.speedNorm, c.y - c.groundY, c.groundY, this.groundNormal);
  }
}
