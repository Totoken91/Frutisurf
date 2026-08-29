import { Vector3 } from 'three';
import { Audio } from './audio/Audio';
import { Engine } from './core/Engine';
import { createState } from './core/GameState';
import { Input } from './core/Input';
import { clamp } from './core/Spring';
import { CameraRig } from './fx/CameraRig';
import { PostFX } from './fx/PostFX';
import { Gauges } from './hud/Gauges';
import { ShockRing } from './fx/ShockRing';
import { Controller } from './player/Controller';
import { Spray } from './player/Spray';
import { Surfer } from './player/Surfer';
import { Trail } from './player/Trail';
import { terrainGradient, terrainHeight } from './world/Terrain';
import { World } from './world/World';

const STEP = 1 / 120;

export class Game {
  readonly engine: Engine;
  readonly world: World;
  readonly surfer: Surfer;
  readonly controller: Controller;
  readonly rig: CameraRig;
  readonly input: Input;
  readonly state = createState();
  readonly post: PostFX;
  readonly spray: Spray;
  readonly trail = new Trail();
  readonly rings = new ShockRing();
  readonly audio = new Audio();
  readonly gauges: Gauges;

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

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.world = new World(this.engine.scene, this.engine.renderer, this.engine.quality);
    this.surfer = new Surfer(this.engine.scene);
    this.input = new Input(canvas);

    this.spray = new Spray(this.engine.quality === 'low' ? 380 : 760);
    this.engine.scene.add(this.spray.mesh, this.trail.mesh, this.rings.group);

    this.controller = new Controller({
      onPop: (charge, combo) => {
        this.rig.punch(0.35 * charge, 14 * charge);
        this.state.popFlash = charge;
        this.spray.burst(this.contactPoint(), Math.round(90 * charge), 0.9 + charge, this.time);
        this.rings.spawn(this.contactPoint(), 0.55 + charge * 0.5, this.time, this.controller.groundY);
        this.audio.pop(charge, combo);
      },
      onJump: (timed, wind) => {
        this.audio.jump(timed, wind);
        if (timed > 0.35 || wind > 0.6) {
          // Recompense visible du saut bien time : gerbe, anneau, coup de FOV.
          const force = Math.max(timed, wind * 0.7);
          this.rig.punch(0.18 * force, 9 * force);
          this.spray.burst(this.contactPoint(), Math.round(55 * force), 0.8 + force, this.time);
          this.rings.spawn(this.contactPoint(), 0.45 + force * 0.5, this.time, this.controller.groundY);
          this.state.popFlash = Math.max(this.state.popFlash, timed * 0.8);
        }
      },
      onGlideStart: () => this.audio.glide(),
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
        this.rings.spawn(this.contactPoint(), 0.4 + impact * 0.7, this.time, this.controller.groundY);
        this.audio.land(impact, quality);
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

    this.gauges = new Gauges(document.getElementById('hud')!);

    // Pas d'ecran de depart : l'audio s'arme au premier geste, c'est tout
    // ce qu'imposait la politique autoplay.
    this.input.onFirstGesture = () => {
      this.state.started = true;
      this.audio.start();
    };
  }

  private contactPoint(): Vector3 {
    const c = this.controller;
    return this.contact.set(c.x, c.y + 0.08, c.z);
  }

  /** Normale du terrain sous le surfeur, pour poser tout ce qui touche le sol. */
  private updateGroundNormal(): void {
    const c = this.controller;
    terrainGradient(c.x, c.z, this.grad);
    this.groundNormal.set(-this.grad.dx, 1, -this.grad.dz).normalize();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const real = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.time += real;

    this.fpsAcc += real;
    this.fpsCount++;
    if (this.fpsAcc >= 0.5) {
      this.state.fps = this.fpsCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }

    this.input.update();

    // Pas fixe pour la simulation : les ressorts a omega=14 ont besoin de
    // 120 Hz pour ne pas osciller en escalier sur un ecran 60 Hz.
    this.acc += real;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 8) {
      // Le hitstop gele la SIM, pas le RENDU.
      if (this.controller.hitstop > 0) {
        this.controller.hitstop -= STEP;
      } else {
        this.controller.step(STEP, this.input);
      }
      this.acc -= STEP;
    }

    this.controller.writeState(this.state);
    this.gauges.update(this.state, real);

    // La camera tourne en temps reel : elle doit rester fluide meme si la
    // simulation est gelee.
    this.rig.update(real, this.controller, this.time);

    this.updateGroundNormal();
    this.syncSurfer(real);

    this.origin.set(this.controller.x, 0, this.controller.z);
    this.world.update(
      this.origin,
      this.engine.camera.position,
      this.time,
      this.controller.speedNorm,
    );

    this.updateFx(real);
    this.post.render(real);
    this.engine.sampleFrame(real * 1000);
  };

  private updateFx(dt: number): void {
    const c = this.controller;
    const contact = this.contactPoint();

    this.spray.update(this.time);
    if (!c.airborne) {
      this.spray.emit(contact, c.steer.value, this.state.speed, Math.abs(c.steer.value), dt, this.time);
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
      (x, z) => terrainHeight(x, z),
    );
    this.rings.update(this.time);

    // Le point de fuite, pas le centre de l'ecran : quand on carve, tout
    // l'effet de vitesse pivote avec la trajectoire.
    this.vanish.set(c.x + c.steer.value * 2.3, c.y + 1.15, c.z - 400);
    this.vanish.project(this.engine.camera);
    this.post.surf.set(
      c.speedNorm,
      this.input.boostHeld ? 1 : 0,
      c.carveCharge,
      this.state.popFlash,
      this.vanish.x * 0.5 + 0.5,
      this.vanish.y * 0.5 + 0.5,
    );
    this.post.setCombo(c.combo);

    // Le repere de crete est SONORE : sans interface, c'est lui qui dit quand
    // appuyer. Il monte a l'approche du sommet et retombe apres.
    this.audio.update(
      c.speedNorm,
      Math.abs(c.steer.value),
      // L'elan du saut partage le bourdon de charge avec le carve : deux
      // tensions, un seul son qui monte, ca reste lisible.
      Math.max(c.carveCharge, c.jumpWind * 0.85),
      c.airborne,
      c.airborne ? 0 : c.lipFactor,
      c.gliding,
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

    // Banking : le haut du buddy part DANS le virage.
    s.tilt.rotation.z = -c.lean.value;
    // En l'air le disque pique du nez ; en plane il se cabre pour porter.
    const airPitch = c.gliding ? -0.24 : c.airborne ? 0.18 : 0;
    s.tilt.rotation.x += (airPitch - s.tilt.rotation.x) * Math.min(1, dt * 7);

    // Rotation propre du CD : elle monte avec la vitesse et la charge.
    s.disc.group.rotation.y += (2.2 + c.speedNorm * 5.0 + c.carveCharge * 4.0) * (1 / 60);

    // Squash & stretch. Au sol, l'elan du saut COMPRIME le buddy : c'est le
    // seul retour visuel qui dit qu'on est en train d'armer.
    const squash = c.airborne
      ? clamp(c.vy * 0.018, -0.10, 0.14)
      : -c.jumpWind * 0.26;
    s.buddy.setSquash(squash);

    s.update(this.time, c.carveCharge, c.speedNorm, c.y - c.groundY, c.groundY, this.groundNormal);
  }

}
