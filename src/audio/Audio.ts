/**
 * Synthese temps reel, zero asset (docs/03 §7).
 *
 * Le son le plus important n'est pas le "pop" : c'est le VENT. C'est lui qui
 * porte la sensation de vitesse en continu ; les impacts ne font que ponctuer.
 *
 * Tout demarre au premier geste utilisateur (politique autoplay des navigateurs).
 */

/** Gamme pentatonique : les notes du pop ne peuvent pas sonner faux. */
const PENTA = [0, 2, 4, 7, 9];

function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (!pink) {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  // Approximation de Voss-McCartney : plus doux qu'un bruit blanc pour le crissement.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57555 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
  return buf;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private slideGain!: GainNode;
  private chargeOsc!: OscillatorNode;
  private chargeGain!: GainNode;
  private glideGain!: GainNode;
  private glideFilter!: BiquadFilterNode;
  private white!: AudioBuffer;
  private started = false;
  muted = false;

  /** A appeler depuis un geste utilisateur. */
  start(): void {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);
    // Fondu d'entree : demarrer a plein volume fait sursauter.
    this.master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.2);

    this.white = noiseBuffer(ctx, 2, false);
    const pink = noiseBuffer(ctx, 2, true);

    // --- Vent
    const wind = ctx.createBufferSource();
    wind.buffer = this.white;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // --- Crissement de carre
    const slide = ctx.createBufferSource();
    slide.buffer = pink;
    slide.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 1.4;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slide.connect(band).connect(this.slideGain).connect(this.master);
    slide.start();

    // --- Bourdon de charge
    this.chargeOsc = ctx.createOscillator();
    this.chargeOsc.type = 'triangle';
    this.chargeOsc.frequency.value = 220;
    this.chargeGain = ctx.createGain();
    this.chargeGain.gain.value = 0;
    this.chargeOsc.connect(this.chargeGain).connect(this.master);
    this.chargeOsc.start();

    // --- Nappe de plane : souffle aigu et calme, l'oppose du vent au sol.
    const glide = ctx.createBufferSource();
    glide.buffer = pink;
    glide.loop = true;
    this.glideFilter = ctx.createBiquadFilter();
    this.glideFilter.type = 'bandpass';
    this.glideFilter.frequency.value = 2400;
    this.glideFilter.Q.value = 0.8;
    this.glideGain = ctx.createGain();
    this.glideGain.gain.value = 0;
    glide.connect(this.glideFilter).connect(this.glideGain).connect(this.master);
    glide.start();

    if (ctx.state === 'suspended') void ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Etat continu, appele chaque frame. */
  update(
    speedNorm: number,
    steerAbs: number,
    charge: number,
    airborne: boolean,
    gliding = false,
  ): void {
    if (!this.ctx) return;
    const t = this.now();
    const air = airborne ? 0.55 : 1;

    // 400 Hz au repos -> 3.2 kHz a fond : c'est cette ouverture qui se lit
    // comme de la vitesse, bien plus que le volume.
    this.windFilter.frequency.setTargetAtTime(400 + speedNorm * 2800, t, 0.12);
    this.windGain.gain.setTargetAtTime(0.05 + speedNorm * 0.30, t, 0.15);

    this.slideGain.gain.setTargetAtTime(steerAbs * 0.16 * air, t, 0.06);

    // La charge monte d'une tierce mineure (x 2^(3/12)).
    this.chargeOsc.frequency.setTargetAtTime(220 * Math.pow(2, (charge * 3) / 12), t, 0.05);
    this.chargeGain.gain.setTargetAtTime(charge * charge * 0.055, t, 0.08);

    this.glideGain.gain.setTargetAtTime(gliding ? 0.11 : 0, t, 0.18);
    this.glideFilter.frequency.setTargetAtTime(gliding ? 2400 + speedNorm * 1600 : 2400, t, 0.2);
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    sweepTo?: number,
  ): void {
    if (!this.ctx) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }


  pop(charge: number, combo: number): void {
    // Pas de rafale de bruit ici : elle partait a chaque pop et a chaque
    // reception, donc en permanence sur un terrain vallonne, et s'entendait
    // comme un "woooo" surgissant au hasard. Les notes suffisent a marquer
    // le coup, et elles restent musicales quand elles s'enchainent.
    // Quinte juste, transposee par le combo dans la pentatonique.
    const semi = PENTA[combo % PENTA.length] + 12 * Math.min(2, Math.floor(combo / PENTA.length));
    const base = 330 * Math.pow(2, semi / 12);
    // La charge se lit maintenant dans l'intensite des notes, plus dans une
    // rafale de bruit : un pop mou reste discret, un pop plein claque.
    const gain = 0.09 + 0.09 * charge;
    this.blip(base, 0.26 + charge * 0.10, 'triangle', gain);
    this.blip(base * 1.5, 0.30 + charge * 0.10, 'sine', gain * 0.7);
  }

  /**
   * Entree dans la fenetre de saut. Un tic court et sec, joue UNE fois.
   *
   * La version precedente etait un sinus continu dont le volume suivait la
   * proximite de la crete : sur un terrain vallonne il enflait et retombait
   * sans arret, et s'entendait comme un "woooo" surgissant au hasard. Un
   * evenement ponctuel informe aussi bien et ne pollue pas le fond sonore.
   */
  lip(): void {
    this.blip(1180, 0.055, 'sine', 0.05);
  }

  /** Plot de vitesse : accord montant, transpose par le combo. */
  booster(combo: number): void {
    const semi = PENTA[combo % PENTA.length] + 12;
    const f = 440 * Math.pow(2, semi / 12);
    this.blip(f, 0.20, 'triangle', 0.13, f * 1.5);
    this.blip(f * 2, 0.26, 'sine', 0.07, f * 3);
  }

  jump(timed = 0, wind = 0): void {
    // Un saut bien time sonne plus haut et plus clair : le retour audio doit
    // confirmer le timing avant meme qu'on voie la hauteur atteinte.
    // Plus l'elan est arme, plus le depart sonne grave et plein ; plus le
    // timing est bon, plus il monte haut.
    const base = 300 + timed * 180 - wind * 70;
    this.blip(base, 0.16 + timed * 0.1 + wind * 0.08, 'sine', 0.10 + timed * 0.07 + wind * 0.04, 620 + timed * 520);
    if (timed > 0.75) this.blip(880, 0.28, 'triangle', 0.09, 1320);
  }


  land(impact: number, quality = 0): void {
    // Une reception propre claque moins fort et ouvre sur une note haute.
    this.blip(70, 0.18, 'sine', 0.20 * Math.min(1, 0.5 + impact) * (1 - quality * 0.4));
    if (quality > 0.55) this.blip(660, 0.26, 'sine', 0.09, 990);
  }


  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.now(), 0.1);
  }
}
