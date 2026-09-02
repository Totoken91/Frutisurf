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
  private skimGain!: GainNode;
  private skimFilter!: BiquadFilterNode;
  private skimLfo!: OscillatorNode;
  private rainHissGain!: GainNode;
  private rainBodyGain!: GainNode;
  private rainDeepGain!: GainNode;
  private rainHissFilter!: BiquadFilterNode;
  /** Instant de la prochaine goutte, sur l'HORLOGE AUDIO. */
  private dropAt = 0;
  private rainNow = 0;
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

    // --- Nappe de glisse sur l'eau. Un passe-bande LARGE et bas, module par
    // un LFO lent : c'est le clapot sous la planche. Il doit etre reconnaissable
    // en une demi-seconde, sinon la traversee ne se distingue pas du sol.
    const skim = ctx.createBufferSource();
    skim.buffer = this.white;
    skim.loop = true;
    this.skimFilter = ctx.createBiquadFilter();
    this.skimFilter.type = 'bandpass';
    this.skimFilter.frequency.value = 900;
    this.skimFilter.Q.value = 0.5;
    this.skimGain = ctx.createGain();
    this.skimGain.gain.value = 0;
    skim.connect(this.skimFilter).connect(this.skimGain).connect(this.master);
    skim.start();
    // Le LFO ouvre et referme le filtre : sans lui le bruit est une soufflerie,
    // avec lui c'est de l'eau qui passe.
    this.skimLfo = ctx.createOscillator();
    this.skimLfo.frequency.value = 5.5;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 520;
    this.skimLfo.connect(lfoAmt).connect(this.skimFilter.frequency);
    this.skimLfo.start();

    // --- L'AVERSE.
    //
    // PREMIERE VERSION, ET POURQUOI ELLE ETAIT MAUVAISE. Deux bandes de bruit
    // filtre, a gain constant. Ca ne fait pas de la pluie, ca fait de la NEIGE
    // DE TELEVISION — et pour une raison qui n'a rien a voir avec le reglage
    // des filtres : une averse n'est pas un signal stationnaire. Elle est faite
    // de milliers d'evenements DISCRETS, et l'oreille, qui passe sa vie a
    // separer des transitoires d'un fond, les entend un par un meme quand ils
    // se comptent par centaines. Un lit de bruit, aussi bien filtre soit-il,
    // n'en contient aucun.
    //
    // Il en faut donc QUATRE couches, et la derniere fait tout le travail :
    //
    //   1. le GRONDEMENT — tout ce qui tombe trop loin pour qu'on distingue
    //      une goutte. Un mur grave, sans detail ;
    //   2. la NAPPE — la masse mediane, celle qui donne la densite ;
    //   3. le CREPITEMENT — les aigus, l'eau qui frappe le dur ;
    //   4. LES GOUTTES — des centaines de transitoires courts, chacun a sa
    //      hauteur, sa duree, son volume et sa place dans le stereo. C'est la
    //      seule couche qui fasse entendre de l'EAU plutot que du bruit.
    //
    // Et les trois nappes RESPIRENT : deux oscillateurs lents aux periodes
    // premieres entre elles (17 s et 12 s) ouvrent et referment le filtre aigu
    // et poussent les gains. Une averse a gain constant s'entend comme une
    // soufflerie au bout de dix secondes ; une averse qui enfle et retombe se
    // laisse oublier, ce qui est exactement ce qu'on demande a une ambiance.
    const deep = ctx.createBufferSource();
    deep.buffer = pink;
    deep.loop = true;
    const deepLp = ctx.createBiquadFilter();
    deepLp.type = 'lowpass';
    deepLp.frequency.value = 190;
    deepLp.Q.value = 0.4;
    this.rainDeepGain = ctx.createGain();
    this.rainDeepGain.gain.value = 0;
    deep.connect(deepLp).connect(this.rainDeepGain).connect(this.master);
    deep.start();

    const body = ctx.createBufferSource();
    body.buffer = pink;
    body.loop = true;
    const bodyLp = ctx.createBiquadFilter();
    bodyLp.type = 'lowpass';
    bodyLp.frequency.value = 1500;
    bodyLp.Q.value = 0.35;
    this.rainBodyGain = ctx.createGain();
    this.rainBodyGain.gain.value = 0;
    body.connect(bodyLp).connect(this.rainBodyGain).connect(this.master);
    body.start();

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.white;
    hiss.loop = true;
    this.rainHissFilter = ctx.createBiquadFilter();
    // Un PASSE-BANDE et non un passe-haut : le passe-haut laisse passer tout
    // le spectre jusqu'a Nyquist et c'est precisement ce qui siffle. La pluie
    // n'a presque plus d'energie au-dessus de six kilohertz.
    this.rainHissFilter.type = 'bandpass';
    this.rainHissFilter.frequency.value = 3000;
    this.rainHissFilter.Q.value = 0.55;
    this.rainHissGain = ctx.createGain();
    this.rainHissGain.gain.value = 0;
    hiss.connect(this.rainHissFilter).connect(this.rainHissGain).connect(this.master);
    hiss.start();

    // Les deux respirations. Elles ne se rattrapent jamais : 17 s et 12 s.
    const breatheA = ctx.createOscillator();
    breatheA.frequency.value = 1 / 17;
    const breatheAmt = ctx.createGain();
    breatheAmt.gain.value = 1100;
    breatheA.connect(breatheAmt).connect(this.rainHissFilter.frequency);
    breatheA.start();

    const breatheB = ctx.createOscillator();
    breatheB.frequency.value = 1 / 12;
    const breatheGain = ctx.createGain();
    breatheGain.gain.value = 0.30;
    // Il module le GAIN de la nappe, en relatif : un LFO branche sur un gain
    // deja pilote par `setTargetAtTime` s'y AJOUTE, il ne l'ecrase pas.
    breatheB.connect(breatheGain).connect(this.rainBodyGain.gain);
    breatheB.start();

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
    planing = false,
    sunk = false,
    rain = 0,
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

    // Glisse sur l'eau : un lit sonore continu, plus fort et plus haut que le
    // crissement d'herbe. Coule, il s'etouffe — on est SOUS la surface.
    const wet = planing ? 0.19 + speedNorm * 0.10 : sunk ? 0.05 : 0;
    this.skimGain.gain.setTargetAtTime(wet, t, planing ? 0.05 : 0.22);
    this.skimFilter.frequency.setTargetAtTime(
      sunk ? 280 : 900 + speedNorm * 1700,
      t,
      0.12,
    );

    // L'averse. Constante de temps LONGUE (1,2 s) : la pluie ne s'allume pas,
    // elle arrive. Un fondu court sur un fondu de monde d'une seconde donnerait
    // un interrupteur, et on entendrait le changement de monde au lieu de
    // l'entendre pleuvoir.
    //
    // Les nappes sont DISCRETES — c'est le semis de gouttes qui porte le son.
    // Un lit de bruit assez fort pour s'entendre tout seul couvre les gouttes
    // et on retombe sur la neige de television.
    this.rainNow = rain;
    this.rainDeepGain.gain.setTargetAtTime(rain * 0.055, t, 1.2);
    this.rainBodyGain.gain.setTargetAtTime(rain * 0.042, t, 1.2);
    this.rainHissGain.gain.setTargetAtTime(rain * 0.030, t, 1.2);
    this.scheduleDrops(t);
  }

  /**
   * LE SEMIS DE GOUTTES.
   *
   * On planifie a l'AVANCE sur l'horloge audio, jamais a l'image : le rendu
   * hoquete, et une goutte posee au moment ou la frame arrive s'entendrait
   * pulser au rythme des chutes de cadence. On garde un quart de seconde
   * d'avance, ce qui absorbe n'importe quel a-coup d'affichage.
   *
   * L'ESPACEMENT EST ALEATOIRE, et pas seulement le contenu. Des gouttes
   * regulierement espacees, meme a trente par seconde, produisent une hauteur
   * — on entend le TAUX au lieu d'entendre la pluie. C'est le meme piege que
   * les anneaux d'impact synchronises dans le shader.
   */
  private scheduleDrops(t: number): void {
    if (!this.ctx) return;
    if (this.rainNow < 0.02) {
      this.dropAt = t;
      return;
    }
    const horizon = t + 0.25;
    if (this.dropAt < t) this.dropAt = t;
    const rate = 8 + this.rainNow * 30;
    let guard = 0;
    while (this.dropAt < horizon && guard++ < 24) {
      this.dropAt += (0.25 + Math.random() * 1.5) / rate;
      this.drop(this.dropAt);
    }
  }

  /**
   * Une goutte : une bouffee de bruit TRES courte, filtree serre.
   *
   * Le detail qui compte est l'offset de lecture tire au sort dans le tampon.
   * Partir toujours de zero rejouerait la MEME forme d'onde des milliers de
   * fois, et l'oreille reconnait une repetition bien avant de savoir la
   * nommer : on entendrait une machine.
   */
  private drop(when: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.55 + Math.random() * 1.7;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    // Distribution BIAISEE VERS LE GRAVE (le carre d'un tirage uniforme) :
    // les gouttes aigues sont les plus proches, donc les plus rares. Une
    // distribution plate donne un carillon.
    const r = Math.random();
    bp.frequency.value = 700 + r * r * 4600;
    bp.Q.value = 2.5 + Math.random() * 8;

    const g = ctx.createGain();
    const dur = 0.018 + Math.random() * 0.05;
    const peak = (0.014 + Math.random() * 0.05) * this.rainNow;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.0018);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    src.connect(bp).connect(g);
    // Le stereo est ce qui fait la PROFONDEUR d'une averse : sans lui les
    // gouttes tombent toutes au meme endroit, c'est-a-dire nulle part.
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.7 - 0.85;
      g.connect(pan).connect(this.master);
    } else {
      g.connect(this.master);
    }

    src.start(when, Math.random() * 1.9, dur + 0.04);
    src.stop(when + dur + 0.05);
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    sweepTo?: number,
    /** Retard en secondes, planifie sur l'HORLOGE AUDIO. Un setTimeout
     *  deriverait de plusieurs dizaines de millisecondes et casserait
     *  l'arpege des vrilles. */
    delay = 0,
  ): void {
    if (!this.ctx) return;
    const t = this.now() + delay;
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


  /**
   * PORTE FRANCHIE, ET LA NOTE MONTE AVEC LA CHAINE.
   *
   * C'est le seul retour qui dit l'escalade sans qu'on ait a lire un chiffre :
   * la gamme pentatonique tourne, mais l'OCTAVE monte tous les cinq maillons.
   * Une chaine de quinze sonne donc trois octaves au-dessus d'une chaine de un,
   * et on entend qu'on est loin avant de le voir. C'est aussi ce qui rend la
   * rupture audible : on retombe d'un coup en bas de la gamme.
   */
  ring(high: boolean, chain: number): void {
    const oct = Math.min(3, Math.floor(chain / 5)) * 12;
    const semi = PENTA[chain % PENTA.length] + oct + (high ? 12 : 7);
    const f = 392 * Math.pow(2, semi / 12);
    this.blip(f, 0.18, 'triangle', 0.12);
    this.blip(f * 1.5, 0.24, 'sine', 0.08);
    if (high) this.blip(f * 2, 0.34, 'sine', 0.07, f * 3);
  }

  /**
   * Anneau manque. Une note sourde et courte, jamais un buzzer : on n'a rien
   * perdu, on a seulement laisse passer du temps. Un son de faute rendrait le
   * jeu punitif alors qu'il ne l'est pas.
   */
  ringMiss(): void {
    this.blip(165, 0.13, 'sine', 0.05, 110);
  }

  /** Vrille validee : une note par tour, qui monte. */
  trick(turns: number): void {
    for (let i = 0; i < Math.min(4, turns); i++) {
      this.blip(523 * Math.pow(2, (i * 4) / 12), 0.16, 'triangle', 0.11, undefined, i * 0.07);
    }
  }

  /**
   * Entree dans l'eau. Deux sons distincts pour deux issues distinctes : la
   * gerbe claire de celui qui rebondit sur la surface, le "plouf" grave de
   * celui qui s'enfonce. Le joueur doit savoir a l'oreille, avant de le voir.
   */
  splash(planing: boolean): void {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(planing ? 2600 : 900, t);
    f.frequency.exponentialRampToValueAtTime(planing ? 5200 : 260, t + 0.3);
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(planing ? 0.20 : 0.26, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (planing ? 0.32 : 0.5));
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.6);
    if (planing) this.blip(880, 0.20, 'sine', 0.07, 1480);
  }

  /** On coule. Une note qui TOMBE : c'est l'echec, il doit s'entendre chuter. */
  sink(): void {
    this.blip(220, 0.55, 'sine', 0.14, 62);
    this.blip(147, 0.7, 'triangle', 0.08, 55, 0.06);
  }

  /** Traversee reussie : arpege montant, plus long si la nappe etait large. */
  skim(meters: number): void {
    const n = Math.min(4, 2 + Math.floor(meters / 26));
    for (let i = 0; i < n; i++) {
      this.blip(587 * Math.pow(2, (i * 5) / 12), 0.20, 'triangle', 0.11, undefined, i * 0.06);
      this.blip(587 * Math.pow(2, (i * 5) / 12 + 1), 0.26, 'sine', 0.05, undefined, i * 0.06);
    }
  }

  /**
   * Palier d'elan de saut. Trois tics courts et montants, jamais une nappe.
   *
   * L'armement produisait auparavant une note TENUE dont la hauteur suivait
   * l'elan : au bout de deux secondes de maintien, ca s'entendait comme un
   * aspirateur. Un son continu ne convient qu'a un etat qu'on subit — le vent,
   * la vitesse ; une action volontaire et breve se PONCTUE.
   *
   * Le troisieme tic, celui du plein elan, sonne une quinte au-dessus et
   * s'accompagne d'une harmonique : c'est le seul dont le joueur a vraiment
   * besoin, puisqu'il dit « c'est plein, lache ».
   */
  windStep(step: number): void {
    const full = step >= 3;
    this.blip(520 * Math.pow(2, (step - 1) / 12 * 3.5), full ? 0.09 : 0.045,
              'triangle', full ? 0.075 : 0.038);
    if (full) this.blip(1560, 0.13, 'sine', 0.035, 2080);
  }

  /** Compte a rebours des dernieres secondes. */
  tick(urgent: boolean): void {
    this.blip(urgent ? 1560 : 1040, 0.05, 'square', urgent ? 0.055 : 0.035);
  }

  /** Fin de partie : deux notes qui tombent, et le paysage sonore se referme. */
  over(): void {
    this.blip(392, 0.45, 'triangle', 0.13, 196);
    this.blip(262, 0.8, 'sine', 0.10, 131, 0.14);
    if (!this.ctx) return;
    const t = this.now();
    this.windGain.gain.setTargetAtTime(0.01, t, 0.4);
    this.slideGain.gain.setTargetAtTime(0, t, 0.3);
    this.chargeGain.gain.setTargetAtTime(0, t, 0.2);
    this.glideGain.gain.setTargetAtTime(0, t, 0.3);
    this.skimGain.gain.setTargetAtTime(0, t, 0.3);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.now(), 0.1);
  }
}
