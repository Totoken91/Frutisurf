import { Vector3 } from 'three';
import { Engine } from './core/Engine';
import { createState } from './core/GameState';
import { Input } from './core/Input';
import { clamp } from './core/Spring';
import { CameraRig } from './fx/CameraRig';
import { PostFX } from './fx/PostFX';
import { ShockRing } from './fx/ShockRing';
import { Controller } from './player/Controller';
import { Spray } from './player/Spray';
import { Surfer } from './player/Surfer';
import { Trail } from './player/Trail';
import { World } from './world/World';
import type { BubbleHit } from './world/Bubbles';

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

  private acc = 0;
  private last = performance.now();
  private time = 0;
  private origin = new Vector3();
  private hits: BubbleHit[] = [];
  private fpsAcc = 0;
  private fpsCount = 0;
  private contact = new Vector3();
  private vanish = new Vector3();
  private trailPoint = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.world = new World(this.engine.scene, this.engine.renderer, this.engine.quality);
    this.surfer = new Surfer(this.engine.scene);
    this.input = new Input(canvas);

    this.spray = new Spray(this.engine.quality === 'low' ? 380 : 760);
    this.engine.scene.add(this.spray.mesh, this.trail.mesh, this.rings.group);

    this.controller = new Controller({
      onPop: (charge) => {
        this.rig.punch(0.35 * charge, 14 * charge);
        this.state.popFlash = charge;
        this.spray.burst(this.contactPoint(), Math.round(90 * charge), 0.9 + charge, this.time);
        this.rings.spawn(this.contactPoint(), 0.55 + charge * 0.5, this.time);
      },
      onLand: (impact) => {
        this.rig.punch(0.22 * impact, 5 * impact);
        this.spray.burst(this.contactPoint(), Math.round(46 * impact), 0.7 + impact, this.time);
        this.rings.spawn(this.contactPoint(), 0.4 + impact * 0.7, this.time);
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
  }

  private contactPoint(): Vector3 {
    const c = this.controller;
    return this.contact.set(c.x, c.y + 0.08, c.z);
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
        this.collect();
      }
      this.acc -= STEP;
    }

    this.controller.writeState(this.state);

    // La camera tourne en temps reel : elle doit rester fluide meme si la
    // simulation est gelee.
    this.rig.update(real, this.controller, this.time);

    this.syncSurfer();

    this.origin.set(this.controller.x, 0, this.controller.z);
    this.world.update(
      this.origin,
      this.engine.camera.position,
      real,
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
      this.trailPoint.set(c.x, c.airborne ? c.y + this.surfer.hover : 0.07, c.z),
      dt,
      c.speedNorm,
      c.carveCharge,
      c.airborne,
    );
    this.rings.update(this.time);

    // Le point de fuite, pas le centre de l'ecran : quand on carve, tout
    // l'effet de vitesse pivote avec la trajectoire.
    this.vanish.set(c.x + c.steer.value * 3.4, c.y + 1.15, c.z - 400);
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
  }

  private syncSurfer(): void {
    const c = this.controller;
    const s = this.surfer;

    s.rig.position.set(c.x, c.y + s.hover, c.z);

    // Banking : le haut du buddy part DANS le virage. Rotation autour de
    // l'axe d'avance, donc -Z ; d'ou le signe negatif.
    s.tilt.rotation.z = -c.lean.value;
    // En l'air le disque pique legerement du nez.
    s.tilt.rotation.x = c.airborne ? 0.18 : 0;

    // Rotation propre du CD : elle monte avec la vitesse et la charge.
    s.disc.group.rotation.y += (2.2 + c.speedNorm * 5.0 + c.carveCharge * 4.0) * (1 / 60);

    // Squash & stretch.
    const squash = c.airborne
      ? clamp(c.vy * 0.018, -0.10, 0.14)
      : 0;
    s.buddy.setSquash(squash);

    s.update(this.time, c.carveCharge, c.speedNorm, c.y);
  }

  private collect(): void {
    const c = this.controller;
    const center = new Vector3(c.x, c.y + 1.0, c.z);
    this.world.bubbles.query(center, 1.5, this.hits);
    for (const h of this.hits) {
      this.world.bubbles.pop(h.index, this.time);
      c.collectBubble();
    }
  }
}
