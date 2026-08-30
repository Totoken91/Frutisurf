import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { clamp, Spring } from '../core/Spring';
import { Buddy } from './Buddy';
import { Disc, DISC_RADIUS } from './Disc';

/**
 * Le sujet complet : le buddy pose sur le CD, plus le halo de contact.
 *
 * Hierarchie :
 *   rig   — position monde + lacet (vrille)
 *   tilt  — assiette PARTAGEE (piquer du nez en l'air, se cabrer en plane)
 *   disc  — a son propre roulis et sa propre precession
 *   buddy — a son propre roulis, son ballant et son appui lateral
 *
 * L'ecart vertical n'est pas decoratif : il fixe le roulis maximal du disque.
 * Trop de roulis pour trop peu de vide, et la carre traverse le personnage.
 *
 * Le point important est le dernier. Tant que les deux volumes partageaient
 * exactement la meme rotation, ils ne formaient qu'un seul objet rigide : un
 * bibelot qu'on deplace, pas un personnage qui surfe. C'est le DECALAGE entre
 * les deux — le disque qui mord tout de suite, le buddy qui suit avec un temps
 * de retard et plus d'amplitude — qui donne l'impression que l'un porte
 * l'autre.
 */

/** Ecart vertical entre le CD et la base du buddy, avant mise a l'echelle. */
const GAP = 0.55;
/** Le sujet occupait trop peu de place a l'ecran ; il grandit d'un sixieme. */
const SUBJECT_SCALE = 1.16;

export interface SurferMotion {
  /** Roulis de carve, signe. */
  lean: number;
  /** Direction demandee, -1..1. */
  steer: number;
  /** Vitesse normalisee 0..1. */
  speedN: number;
  airborne: boolean;
  /** Vitesse verticale, m/s. */
  vy: number;
  time: number;
}

export class Surfer {
  readonly rig = new Group();
  readonly tilt = new Group();
  readonly buddy: Buddy;
  readonly disc = new Disc();
  /** Hauteur de vol du disque au-dessus du sol : il ne touche jamais l'herbe. */
  readonly hover = 0.20;

  /**
   * Quatre ressorts de raideurs DIFFERENTES. C'est tout le principe : des
   * raideurs egales redonneraient un bloc rigide, quel que soit le nombre de
   * ressorts qu'on empile.
   */
  private discRoll = new Spring(0, 19, 0.85);
  private bodyRoll = new Spring(0, 7.5, 0.55);
  private bodySlide = new Spring(0, 9, 0.60);
  private bodyBob = new Spring(0, 12, 0.42);

  constructor(parent: Object3D, lowPower = false) {
    this.buddy = new Buddy(lowPower);
    this.disc.mesh.position.y = 0;
    // Le buddy LEVITE au-dessus du disque : sur la reference il y a un vide
    // franc entre la base plate et le CD, et c'est ce vide qui laisse lire
    // a la fois l'arete basse incandescente et l'ellipse complete du disque.
    // Il a ete DOUBLE : a 0,20 les deux volumes se touchaient presque et on ne
    // voyait plus qu'une seule silhouette.
    this.buddy.group.position.y = GAP;

    this.tilt.add(this.disc.group, this.buddy.group);
    this.tilt.scale.setScalar(SUBJECT_SCALE);
    this.rig.add(this.tilt);
    parent.add(this.rig);
    // Le halo vit au sol, hors du groupe incline : il ne doit pas basculer.
    this.disc.halo.scale.setScalar(SUBJECT_SCALE);
    parent.add(this.disc.halo);
  }

  private static readonly PLANE_N = new Vector3(0, 0, 1);
  private haloQ = new Quaternion();

  /**
   * Les deux animations independantes. Appelee AVANT `update`, avec le pas de
   * temps reel : elle doit rester fluide meme quand la simulation est gelee
   * par un hitstop.
   */
  animate(dt: number, m: SurferMotion): void {
    // --- LE DISQUE. Reactif, presque critique : il epouse la trajectoire
    //     sans depassement, comme une carre qui mord.
    // Le disque bascule PLUS que le buddy, pas moins : c'est la carre qui
    // mord, le rider reste relativement droit au-dessus. L'inverse donnait un
    // bonhomme penche sur une planche a plat, ce qui se lit comme une chute.
    // 0,68 et pas davantage : le disque fait 1,1 de rayon, et au-dela de
    // 26 degres son bord haut passe au-dessus du vide qui le separe du buddy
    // et vient le traverser.
    this.discRoll.target = -m.lean * 0.68;
    this.discRoll.step(dt);

    // Precession de piece qui tourne. Deux frequences volontairement
    // incommensurables : a frequences proches le motif se repete a l'oeil au
    // bout de quelques secondes et trahit la boucle.
    const wob = 0.016 + m.speedN * 0.030;
    this.disc.group.rotation.x = Math.sin(m.time * 3.10) * wob;
    this.disc.group.rotation.z = this.discRoll.value + Math.cos(m.time * 2.27) * wob * 0.85;

    // --- LE BUDDY. Deux fois et demie plus mou, et deux fois moins ample :
    //     il part en retard, il penche moins, il se redresse apres. C'est ce
    //     retard-la qu'on lit comme du poids.
    this.bodyRoll.target = -m.lean * 0.62;
    this.bodyRoll.step(dt);
    this.buddy.group.rotation.z = this.bodyRoll.value;

    // Il s'appuie legerement vers l'EXTERIEUR du virage, comme un passager
    // dans une voiture. Vers l'interieur, il aurait l'air de piloter le disque
    // au lieu d'etre porte par lui.
    this.bodySlide.target = m.steer * 0.085;
    this.bodySlide.step(dt);
    this.buddy.group.position.x = this.bodySlide.value;

    // Ballant vertical : il encaisse les chocs un temps APRES le disque, et
    // respire en continu pour que rien ne soit jamais parfaitement immobile.
    this.bodyBob.target = m.airborne ? clamp(m.vy * 0.010, -0.09, 0.11) : 0;
    this.bodyBob.step(dt);
    this.buddy.group.position.y =
      GAP + this.bodyBob.value + Math.sin(m.time * 1.9) * 0.014;

    // Et il regarde un peu dans le virage, avec son propre retard : le lacet
    // du disque est deja pris par la vrille, celui-ci est purement expressif.
    this.buddy.group.rotation.y = -this.bodyRoll.value * 0.30;
  }

  update(
    time: number,
    charge: number,
    speedN: number,
    airHeight: number,
    groundY: number,
    normal: Vector3,
  ): void {
    this.disc.update(time, charge, speedN, airHeight);
    this.disc.halo.position.set(this.rig.position.x, groundY + 0.04, this.rig.position.z);
    // La normale du plan est +Z avant rotation : on l'amene sur celle du sol.
    this.haloQ.setFromUnitVectors(Surfer.PLANE_N, normal);
    this.disc.halo.quaternion.copy(this.haloQ);
  }
}

export { DISC_RADIUS };
