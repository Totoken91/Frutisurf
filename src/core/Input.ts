import { clamp } from './Spring';

/**
 * Clavier + tactile + gamepad reduits a un axe unique.
 * Le tactile est RELATIF (delta de glissement) : un stick virtuel absolu
 * casse la fluidite du carve (docs/03-GAME-FEEL.md §8).
 */
export class Input {
  /** [-1, 1] */
  steer = 0;
  jumpHeld = false;
  boostHeld = false;

  private jumpEdge = false;
  /** Front montant de N'IMPORTE quelle action. Sert a relancer une partie. */
  private anyEdge = false;
  /** Voir le commentaire dans update() : rattrape les appuis tres brefs. */
  private jumpLatch = false;
  private keys = new Set<string>();
  private touchId: number | null = null;
  private touchX = 0;
  private touchSteer = 0;
  private touchCount = 0;
  private disposers: Array<() => void> = [];

  /** Arme au premier geste — sert a debloquer l'audio. */
  onFirstGesture: (() => void) | null = null;
  private gestured = false;

  constructor(private el: HTMLElement) {
    this.bind();
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }

  private bind(): void {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.anyEdge = true;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.jumpEdge = true;
        this.jumpLatch = true;
        e.preventDefault();
      }
      this.gesture();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);

    const ts = (e: TouchEvent) => {
      this.touchCount = e.touches.length;
      if (this.touchId === null && e.changedTouches.length) {
        const t = e.changedTouches[0];
        this.touchId = t.identifier;
        this.touchX = t.clientX;
        this.jumpLatch = true;
      }
      this.anyEdge = true;
      this.gesture();
      e.preventDefault();
    };
    const tm = (e: TouchEvent) => {
      this.touchCount = e.touches.length;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;

        // --- Manche COLLANT.
        //
        // L'ancienne version demandait 34 % de la largeur d'ecran pour aller
        // en butee, et faisait deriver le point de reference de 6 % par
        // evenement. Deux consequences, toutes deux mauvaises au pouce :
        // maintenir un virage exigeait de glisser SANS ARRET puisque la
        // reference rattrapait le doigt, et inverser demandait de reparcourir
        // toute la course dans l'autre sens.
        //
        // Ici l'ancre ne derive pas, mais elle est POUSSEE des qu'on depasse
        // la course : le doigt reste donc toujours a exactement une course de
        // la butee opposee. Un virage se tient sans bouger, et s'inverse
        // instantanement.
        const range = Math.max(60, window.innerWidth * 0.20);
        let dx = t.clientX - this.touchX;
        if (dx > range) this.touchX = t.clientX - range;
        else if (dx < -range) this.touchX = t.clientX + range;
        dx = clamp(t.clientX - this.touchX, -range, range);
        this.touchSteer = dx / range;
      }
      e.preventDefault();
    };
    const te = (e: TouchEvent) => {
      this.touchCount = e.touches.length;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;
        // Le doigt leve RELACHE le saut ; c'est le Controller qui decide quoi
        // en faire selon l'elan accumule. Plus de detection de tap ici.
        this.touchId = null;
        this.touchSteer = 0;
      }
    };

    const blur = () => {
      this.keys.clear();
      this.touchId = null;
      this.touchSteer = 0;
      this.touchCount = 0;
    };

    addEventListener('keydown', kd, { passive: false });
    addEventListener('keyup', ku);
    addEventListener('blur', blur);
    this.el.addEventListener('touchstart', ts, { passive: false });
    this.el.addEventListener('touchmove', tm, { passive: false });
    this.el.addEventListener('touchend', te);
    this.el.addEventListener('touchcancel', te);
    this.el.addEventListener('pointerdown', () => {
      this.anyEdge = true;
      this.gesture();
    });

    this.disposers.push(
      () => removeEventListener('keydown', kd),
      () => removeEventListener('keyup', ku),
      () => removeEventListener('blur', blur),
      () => this.el.removeEventListener('touchstart', ts),
      () => this.el.removeEventListener('touchmove', tm),
      () => this.el.removeEventListener('touchend', te),
      () => this.el.removeEventListener('touchcancel', te),
    );
  }

  private gamepad(): { steer: number; jump: boolean; boost: boolean } | null {
    // Dans une iframe bac a sable, getGamepads peut lever au lieu de renvoyer
    // une liste vide : sans ce garde, la boucle de rendu meurt a la premiere frame.
    let pads: ReturnType<Navigator['getGamepads']> | null = null;
    try {
      pads = navigator.getGamepads?.() ?? null;
    } catch {
      return null;
    }
    if (!pads) return null;
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      return {
        steer: Math.abs(ax) > 0.14 ? ax : 0,
        jump: !!p.buttons[0]?.pressed,
        boost: (p.buttons[7]?.value ?? 0) > 0.4 || !!p.buttons[5]?.pressed,
      };
    }
    return null;
  }

  update(): void {
    let s = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.keys.has('KeyQ')) s -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) s += 1;

    if (s === 0 && this.touchId !== null) s = this.touchSteer;

    const gp = this.gamepad();
    if (gp) {
      if (s === 0) s = gp.steer;
      if (gp.jump) {
        this.jumpEdge = true;
        this.anyEdge = true;
      }
    }

    // Courbe expo douce : du controle fin autour du centre, la butee reste
    // atteignable. Sans elle le moindre tremblement de pouce fait un virage.
    // Adoucie de 1,35 a 1,20 : combinee au manche collant, la courbe d'avant
    // mangeait trop des petits deplacements, ceux dont on se sert le plus.
    const c = clamp(s, -1, 1);
    this.steer = Math.sign(c) * Math.pow(Math.abs(c), 1.20);

    // Le doigt pose vaut MAINTIEN du saut, exactement comme la barre d'espace.
    // Sans ca le tactile n'arme jamais et ne saute jamais : le saut se
    // declenche au relachement, et `jumpHeld` ne lisait que le clavier.
    // Un meme doigt dirige (glissement lateral) et arme (duree d'appui).
    const rawHeld =
      this.keys.has('Space') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('KeyW') ||
      this.touchId !== null ||
      !!gp?.jump;

    // Un appui tres bref peut commencer ET finir entre deux update() : sans ce
    // verrou il serait purement perdu, et un tap franc ne ferait rien du tout.
    // Le verrou garantit au moins une lecture a `true`, donc au moins un petit saut.
    this.jumpHeld = rawHeld || this.jumpLatch;
    this.jumpLatch = false;
    this.boostHeld =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.touchCount >= 2 ||
      !!gp?.boost;
  }

  /** Consomme le front montant "une action quelconque". */
  consumeAny(): boolean {
    const a = this.anyEdge;
    this.anyEdge = false;
    return a;
  }

  /** Consomme le front montant du saut. */
  consumeJump(): boolean {
    const j = this.jumpEdge;
    this.jumpEdge = false;
    return j;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
