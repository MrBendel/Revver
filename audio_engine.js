/**
 * REVVER — Audio Synthesis & Ange Yaghi's Engine-Sim Procedural Combustion Model
 * 
 * Architecture:
 * 1. Physical Combustion Pressure Pulse Synthesis (Ange Yaghi engine-sim model):
 *    - 720° four-stroke crankshaft angle accumulator
 *    - Discrete cylinder combustion pressure pulses upon exhaust valve opening (EVO)
 *    - Bank 1 & Bank 2 exhaust collector manifolds with unequal runner delay lines
 *    - Pipe acoustic cavity resonance & muffler expansion chamber low-pass filtering
 * 2. Physical Starter Motor & Flywheel Cranking:
 *    - Electric starter motor torques crankshaft against cylinder TDC compression resistance
 *    - Authentic rhythmic whir-chug cadence
 *    - Sequential ignition catch stumble and flare to ~2,100 RPM settling to idle
 * 3. Physical Shutdown & Compression Braking:
 *    - Fuel/spark cut with rotating assembly spinning down against closed-throttle pumping loss
 *    - Slowing compression thumps settling into 100% complete dead silence
 * 4. Secondary fallback & Custom WAV importer support (TORCS / Speed Dreams loops).
 */

class RevverAudioEngine {
  constructor() {
    this.ctx = null;
    this.isRunning = false;

    // Master bus & Analyser
    this.masterGain = null;
    this.analyser = null;

    // Engine playback modes: 'engine-sim' (Default: Ange Yaghi physical model) or 'torcs' (Sample loop fallback)
    this.soundEngineMode = 'engine-sim';
    this.isWorkletActive = false;
    this.engineSimNode = null;

    // Engine Profiles with Physical Firing Configurations
    this.profiles = {
      v8muscle: {
        id: 'v8muscle',
        name: 'Shelby Beast 5.2L V8',
        desc: 'Deep American V8 thunder • Crossplane 90° crank lope & burble',
        cylinders: 8,
        idleRpm: 700,
        sampleRpm: 3200,
        redlineRpm: 7500,
        pitchScale: 0.50,
        subBassGain: 1.15,
        pipeResonance: 88,    // Hz (deep American V8 crossplane rumble)
        pipeQ: 2.2,
        mufflerCutoff: 650,   // Hz (warm low-pass)
        pulseWidth: 175,      // degrees (broad realistic valve blowdown window)
        compressionRatio: 11.0,
        // Classic American crossplane V8 firing cadence: 1-5-4-8-6-3-7-2
        firingAngles: [0, 90, 270, 360, 450, 540, 630, 720],
        exhaustBanks: [0, 1, 0, 1, 1, 0, 1, 0],
        runnerLengths: [0.42, 0.58, 0.38, 0.54, 0.48, 0.40, 0.56, 0.44],
        intakeRoarGain: 0.70,
        crankAsymmetry: 0.35,
        turbo: false,
        backfireRate: 0.95
      },
      flat6: {
        id: 'flat6',
        name: 'Stuttgart 4.0L High-Rev Flat-6',
        desc: '992 GT3 DNA • 9,000 RPM redline • Razor-sharp boxer howl',
        cylinders: 6,
        idleRpm: 850,
        sampleRpm: 3500,
        redlineRpm: 9000,
        pitchScale: 0.55,
        subBassGain: 1.10,
        pipeResonance: 92,
        pipeQ: 2.3,
        mufflerCutoff: 780,
        pulseWidth: 172,
        compressionRatio: 13.3,
        firingAngles: [0, 120, 240, 360, 480, 600],
        exhaustBanks: [0, 1, 0, 1, 0, 1],
        runnerLengths: [0.45, 0.45, 0.48, 0.48, 0.50, 0.50],
        intakeRoarGain: 0.60,
        crankAsymmetry: 0.05,
        turbo: false,
        backfireRate: 0.75
      },
      aircooled993: {
        id: 'aircooled993',
        name: 'Classic 993 RS 3.8L Flat-6',
        desc: 'Air-Cooled Boxer • 7,800 RPM • Mechanical dry-sump rasp & valve song',
        cylinders: 6,
        idleRpm: 800,
        sampleRpm: 3200,
        redlineRpm: 7800,
        pitchScale: 0.52,
        subBassGain: 1.12,
        pipeResonance: 95,
        pipeQ: 2.4,
        mufflerCutoff: 720,
        pulseWidth: 170,
        compressionRatio: 11.5,
        firingAngles: [0, 120, 240, 360, 480, 600],
        exhaustBanks: [0, 1, 0, 1, 0, 1],
        runnerLengths: [0.42, 0.42, 0.46, 0.46, 0.50, 0.50],
        intakeRoarGain: 0.70,
        crankAsymmetry: 0.08,
        turbo: false,
        backfireRate: 0.85
      },
      v10f1: {
        id: 'v10f1',
        name: 'Carrera GT 5.7L V10',
        desc: 'Le Mans V10 symphony • 8,400 RPM redline • Pure acoustic perfection',
        cylinders: 10,
        idleRpm: 1000,
        sampleRpm: 4000,
        redlineRpm: 8500,
        pitchScale: 0.60,
        subBassGain: 0.95,
        pipeResonance: 105,
        pipeQ: 2.6,
        mufflerCutoff: 950,
        pulseWidth: 168,
        compressionRatio: 12.0,
        firingAngles: [0, 72, 144, 216, 288, 360, 432, 504, 576, 648],
        exhaustBanks: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
        runnerLengths: [0.35, 0.35, 0.38, 0.38, 0.40, 0.40, 0.42, 0.42, 0.45, 0.45],
        intakeRoarGain: 0.55,
        crankAsymmetry: 0.02,
        turbo: false,
        backfireRate: 0.50
      },
      turboV6: {
        id: 'turboV6',
        name: 'Stuttgart 3.7L Twin-Turbo Flat-6',
        desc: '911 Turbo S • Heavy boost whoosh, wastegate chatter & boxer roar',
        cylinders: 6,
        idleRpm: 750,
        sampleRpm: 3000,
        redlineRpm: 7400,
        pitchScale: 0.50,
        subBassGain: 1.15,
        pipeResonance: 86,
        pipeQ: 2.2,
        mufflerCutoff: 680,
        pulseWidth: 172,
        compressionRatio: 9.0,
        firingAngles: [0, 120, 240, 360, 480, 600],
        exhaustBanks: [0, 1, 0, 1, 0, 1],
        runnerLengths: [0.38, 0.42, 0.45, 0.38, 0.42, 0.45],
        intakeRoarGain: 0.65,
        crankAsymmetry: 0.12,
        turbo: true,
        backfireRate: 0.85
      },
      groupB5: {
        id: 'groupB5',
        name: 'Group B 2.2L Turbo Inline-5',
        desc: 'Historic Audi Quattro 5-cylinder warble & turbo wastegate',
        cylinders: 5,
        idleRpm: 900,
        sampleRpm: 3200,
        redlineRpm: 8300,
        pitchScale: 0.52,
        subBassGain: 1.12,
        pipeResonance: 90,
        pipeQ: 2.3,
        mufflerCutoff: 700,
        pulseWidth: 170,
        compressionRatio: 8.5,
        firingAngles: [0, 144, 288, 432, 576],
        exhaustBanks: [0, 0, 0, 0, 0],
        runnerLengths: [0.32, 0.38, 0.44, 0.50, 0.56],
        intakeRoarGain: 0.75,
        crankAsymmetry: 0.28,
        turbo: true,
        backfireRate: 0.90
      }
    };

    // Default to Stuttgart 4.0L High-Rev Flat-6
    this.activeProfile = this.profiles.flat6;

    // Sound tuning parameters
    this.tuning = {
      masterVolume: 0.85,
      exhaustPops: 0.80,
      intakeGrowl: 0.75,
      turboSpool: 0.60,
      bassBoost: 0.85
    };

    // State tracking
    this.currentRpm = 0;
    this.targetRpm = 700;
    this.currentThrottle = 0;
    this.currentBoost = 0;
    this.lastThrottle = 0;
    this.shiftCutActive = false;

    // Engine Lifecycle States: 'OFF', 'CRANKING', 'STARTING', 'RUNNING', 'STOPPING'
    this.engineState = 'OFF';

    // Sample buffers for fallback / custom WAV import
    this.sampleBuffers = {};
    this.sampleNodes = {};

    // Starter, Ignition Catch, and Shutdown Sound Buffers (fallback)
    this.starterBuffer = null;
    this.catchBuffer = null;
    this.shutdownBuffer = null;

    // Tire Acoustics & Lateral G Slip Simulation
    this.tireTuning = {
      enabled: true,
      volume: 0.35,              // Subtle screech volume (0.0 to 1.0)
      compound: 'cup2',          // 'cup2', 'pzero', 'vintage'
      gripThresholdG: 0.45,      // Lateral G threshold where screech begins
      roadHissGain: 0.16         // Speed-dependent pavement rolling noise
    };

    // Tire Audio Nodes & Sample Buffers
    this.tireBus = null;
    this.roadNoiseSource = null;
    this.roadNoiseGain = null;
    this.roadNoiseFilter = null;
    this.tireScrubSource = null;
    this.tireScrubGain = null;
    this.tireScrubFilter = null;

    // Real Sampled Tire Skid & Squeal Loop (TORCS / OpenGameArt high-fidelity PCM loop)
    this.tireSkidBuffer = null;
    this.tireSkidSource = null;
    this.tireSkidGain = null;
    this.tireSkidFilter = null;

    this.onStateChangeCallback = null;
  }

  /**
   * Initializes Web Audio Context on user gesture
   */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });

    // Master Analyser and Gain
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.8;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.tuning.masterVolume, this.ctx.currentTime);

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Engine Master Bus (for engine-sim audio output)
    this.engineBus = this.ctx.createGain();
    this.engineBus.gain.setValueAtTime(0, this.ctx.currentTime); // Off initially
    this.engineBus.connect(this.masterGain);

    // Deep Subwoofer Bass Enhancer Bus
    this.subBassFilter = this.ctx.createBiquadFilter();
    this.subBassFilter.type = 'lowpass';
    this.subBassFilter.frequency.setValueAtTime(110, this.ctx.currentTime);
    this.subBassGain = this.ctx.createGain();
    this.subBassGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.subBassGain.connect(this.subBassFilter);
    this.subBassFilter.connect(this.masterGain);

    // 1. Initialize Engine-Sim Procedural Combustion AudioWorklet
    await this.setupEngineSimWorklet();

    // 2. Setup secondary nodes (Turbo, fallback oscillators)
    this.setupTurboNodes();

    // 2b. Setup procedural tire simulation (pavement roll, scrub, subtle lateral screech)
    this.setupTireAcoustics();

    // 3. Generate secondary sample buffers for custom WAV loading
    this.generateEngineSampleBuffers();
    this.generateStarterBuffers();

    this.isRunning = true;
  }

  /**
   * Loads and attaches the Ange Yaghi engine-sim AudioWorklet Processor
   */
  async setupEngineSimWorklet() {
    try {
      if (this.ctx.audioWorklet) {
        await this.ctx.audioWorklet.addModule('engine_sim_processor.js');

        this.engineSimNode = new AudioWorkletNode(this.ctx, 'engine-sim-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });

        // Handle physical events from the simulation thread
        this.engineSimNode.port.onmessage = (e) => {
          const msg = e.data;
          if (msg.type === 'RPM_UPDATE') {
            if (this.engineState === 'CRANKING' || this.engineState === 'STARTING' || this.engineState === 'STOPPING') {
              this.currentRpm = msg.rpm;
            }
          } else if (msg.type === 'ENGINE_CATCH') {
            this.engineState = 'STARTING';
            if (this.onStateChangeCallback) this.onStateChangeCallback('STARTING', msg.rpm);
          } else if (msg.type === 'ENGINE_RUNNING') {
            this.engineState = 'RUNNING';
            if (this.onStateChangeCallback) this.onStateChangeCallback('RUNNING', msg.rpm);
          } else if (msg.type === 'ENGINE_OFF') {
            this.engineState = 'OFF';
            this.currentRpm = 0;
            if (this.onStateChangeCallback) this.onStateChangeCallback('OFF', 0);
          }
        };

        // Connect engine-sim output into master engine bus
        this.engineSimNode.connect(this.engineBus);

        // Send active profile
        this.engineSimNode.port.postMessage({
          type: 'SET_PROFILE',
          profile: this.activeProfile
        });

        this.isWorkletActive = true;
        console.log('✓ Ange Yaghi Engine-Sim Procedural Combustion Core Activated.');
        return;
      }
    } catch (err) {
      console.warn('AudioWorklet initialization fallback to loop model:', err);
    }

    this.isWorkletActive = false;
    this.setupAudioGraph();
  }

  /**
   * Turbo Spool & Blow-Off Valve
   */
  setupTurboNodes() {
    if (!this.ctx || this.turboGain) return;
    const t = this.ctx.currentTime;
    this.turboOsc = this.ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboFilter = this.ctx.createBiquadFilter();
    this.turboFilter.type = 'bandpass';
    this.turboFilter.frequency.setValueAtTime(2400, t);
    this.turboFilter.Q.setValueAtTime(7.0, t);
    this.turboGain = this.ctx.createGain();
    this.turboGain.gain.setValueAtTime(0, t);

    this.turboOsc.connect(this.turboFilter);
    this.turboFilter.connect(this.turboGain);
    this.turboGain.connect(this.engineBus);
    this.turboOsc.start(t);
  }

  /**
   * Authentic Racing Simulator Tire Acoustics (TORCS / Speed Dreams / OpenGameArt Architecture)
   * Physical Layers:
   * 1. Road Noise (Speed-dependent rolling roar: multi-pole pink friction noise)
   * 2. Tire Scrub (Textured asphalt aggregate friction when lateral load builds)
   * 3. Sampled Tire Skid & Squeal (Real recorded 48kHz rubber-on-asphalt skid PCM loop - zero oscillators!)
   */
  setupTireAcoustics() {
    if (!this.ctx || this.tireBus) return;
    const t = this.ctx.currentTime;

    // Master Tire Bus connected to masterGain
    this.tireBus = this.ctx.createGain();
    this.tireBus.gain.setValueAtTime(this.tireTuning.enabled ? 1.0 : 0.0, t);
    this.tireBus.connect(this.masterGain);

    // 1. Road Noise (Pavement tread roll: pink/brown noise through low-mid bandpass)
    const noiseLen = this.ctx.sampleRate * 2.5;
    const roadBuf = this.ctx.createBuffer(2, noiseLen, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = roadBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < noiseLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
      }
    }

    this.roadNoiseSource = this.ctx.createBufferSource();
    this.roadNoiseSource.buffer = roadBuf;
    this.roadNoiseSource.loop = true;

    this.roadNoiseFilter = this.ctx.createBiquadFilter();
    this.roadNoiseFilter.type = 'bandpass';
    this.roadNoiseFilter.frequency.setValueAtTime(480, t);
    this.roadNoiseFilter.Q.setValueAtTime(1.0, t);

    this.roadNoiseGain = this.ctx.createGain();
    this.roadNoiseGain.gain.setValueAtTime(0, t);

    this.roadNoiseSource.connect(this.roadNoiseFilter);
    this.roadNoiseFilter.connect(this.roadNoiseGain);
    this.roadNoiseGain.connect(this.tireBus);
    this.roadNoiseSource.start(t);

    // 2. Tire Friction Scrub (Textured asphalt aggregate shear)
    const scrubBuf = this.ctx.createBuffer(2, noiseLen, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = scrubBuf.getChannelData(ch);
      for (let i = 0; i < noiseLen; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.12;
      }
    }

    this.tireScrubSource = this.ctx.createBufferSource();
    this.tireScrubSource.buffer = scrubBuf;
    this.tireScrubSource.loop = true;

    this.tireScrubFilter = this.ctx.createBiquadFilter();
    this.tireScrubFilter.type = 'bandpass';
    this.tireScrubFilter.frequency.setValueAtTime(850, t);
    this.tireScrubFilter.Q.setValueAtTime(2.2, t);

    this.tireScrubGain = this.ctx.createGain();
    this.tireScrubGain.gain.setValueAtTime(0, t);

    this.tireScrubSource.connect(this.tireScrubFilter);
    this.tireScrubFilter.connect(this.tireScrubGain);
    this.tireScrubGain.connect(this.tireBus);
    this.tireScrubSource.start(t);

    // 3. Real Sampled Tire Skid & Squeal (TORCS / OpenGameArt authentic loop)
    // Zero oscillators! Real recorded rubber-on-asphalt friction audio
    this.tireSkidFilter = this.ctx.createBiquadFilter();
    this.tireSkidFilter.type = 'lowpass';
    this.tireSkidFilter.frequency.setValueAtTime(1600, t);
    this.tireSkidFilter.Q.setValueAtTime(1.1, t);

    this.tireSkidGain = this.ctx.createGain();
    this.tireSkidGain.gain.setValueAtTime(0, t);

    this.tireSkidFilter.connect(this.tireSkidGain);
    this.tireSkidGain.connect(this.tireBus);

    // Initial procedural friction buffer fallback, then load the real 48kHz WAV
    this.tireSkidBuffer = this.generateProceduralSkidBuffer();
    this.startTireSkidSource();
    this.loadTireSkidSample();
  }

  /**
   * Generates a realistic stochastic tire friction buffer as instant fallback
   */
  generateProceduralSkidBuffer() {
    const sr = this.ctx.sampleRate;
    const len = sr * 2.5;
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let filterY = 0;

    for (let i = 0; i < len; i++) {
      // High frequency friction noise with non-linear saturation
      const white = (Math.random() * 2 - 1);
      // Fast stochastic chatter
      const mod = Math.sin(i * 0.12) * 0.35 + Math.sin(i * 0.28) * 0.25;
      const raw = (white + mod) * 0.6;
      const clipped = Math.tanh(raw * 1.6);
      filterY += (clipped - filterY) * 0.45;
      data[i] = filterY * 0.3;
    }
    return buf;
  }

  /**
   * Loads the real 48kHz TORCS / OpenGameArt tire skid WAV loop
   */
  async loadTireSkidSample() {
    try {
      const resp = await fetch('sounds/tire_skid_loop.wav');
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        this.tireSkidBuffer = await this.ctx.decodeAudioData(ab);
        this.startTireSkidSource();
        console.log('Real 48kHz tire skid sample loaded successfully.');
      }
    } catch (err) {
      console.warn('Using procedural friction skid buffer (WAV fetch deferred):', err);
    }
  }

  /**
   * Starts or restarts the looping tire skid buffer source
   */
  startTireSkidSource() {
    if (!this.ctx || !this.tireSkidBuffer || !this.tireSkidFilter) return;
    try {
      if (this.tireSkidSource) {
        this.tireSkidSource.stop();
        this.tireSkidSource.disconnect();
      }
    } catch (e) {}

    const t = this.ctx.currentTime;
    this.tireSkidSource = this.ctx.createBufferSource();
    this.tireSkidSource.buffer = this.tireSkidBuffer;
    this.tireSkidSource.loop = true;
    this.tireSkidSource.connect(this.tireSkidFilter);
    this.tireSkidSource.start(t);
  }

  /**
   * Custom Skid WAV Loader: allows user to import any game's skid.wav
   */
  async loadCustomSkidWav(file) {
    if (!this.ctx) await this.init();
    const ab = await file.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(ab);
    this.tireSkidBuffer = decoded;
    this.startTireSkidSource();
    return decoded;
  }

  /**
   * Real-time Tire Acoustic Update Loop
   * Modulates road roar, asphalt scrub, and authentic sampled skid loop
   */
  updateTireAcoustics(speedMps, lateralG, longitudinalG, throttle, brake) {
    if (!this.ctx || !this.tireBus) return;
    const t = this.ctx.currentTime;

    if (!this.tireTuning.enabled || this.engineState === 'OFF') {
      this.tireBus.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    this.tireBus.gain.setTargetAtTime(1.0, t, 0.05);

    const speedMph = speedMps * 2.23694;
    const absLatG = Math.abs(lateralG);

    // 1. Road Noise (Speed dependent rolling roar)
    if (this.roadNoiseGain) {
      const speedNorm = Math.min(1.0, speedMph / 85);
      const targetRoadGain = Math.pow(speedNorm, 1.25) * this.tireTuning.roadHissGain;
      this.roadNoiseGain.gain.setTargetAtTime(targetRoadGain, t, 0.08);

      const targetFreq = 400 + speedNorm * 320;
      this.roadNoiseFilter.frequency.setTargetAtTime(targetFreq, t, 0.1);
    }

    // 2. Tire Scrub & High-G Screech Calculation
    const threshold = this.tireTuning.gripThresholdG;
    const compound = this.tireTuning.compound;

    let compoundSens = 1.0;
    if (compound === 'cup2') {
      compoundSens = 1.15;
    } else if (compound === 'pzero') {
      compoundSens = 1.0;
    } else if (compound === 'vintage') {
      compoundSens = 1.25;
    }

    // A. Textured Scrub Gain (kicks in before full skid: 0.18G to threshold)
    let scrubGain = 0;
    if (speedMps > 1.5 && absLatG > 0.18) {
      const scrubFactor = Math.min(1.0, (absLatG - 0.18) / (threshold - 0.12));
      scrubGain = Math.pow(scrubFactor, 1.4) * 0.24 * this.tireTuning.volume;
    }
    if (brake > 0.65 && speedMps > 3.0) {
      const brakeScrub = ((brake - 0.65) / 0.35) * 0.22 * this.tireTuning.volume;
      scrubGain = Math.max(scrubGain, brakeScrub);
    }
    if (this.tireScrubGain) {
      this.tireScrubGain.gain.setTargetAtTime(scrubGain, t, 0.04);
    }

    // B. Authentic Sampled Tire Skid Gain (Real recorded rubber skid loop)
    let skidGain = 0;
    let slipMagnitude = 0;

    if (speedMps > 2.0 && absLatG > threshold) {
      slipMagnitude = Math.min(1.0, (absLatG - threshold) / 0.45);
      // Smooth natural onset: subtle, authentic presence
      skidGain = Math.pow(slipMagnitude, 1.35) * this.tireTuning.volume * compoundSens * 0.50;
    }

    // Also skid during emergency threshold braking or launch burnout
    if (brake > 0.82 && speedMps > 3.5) {
      const lockupSlip = ((brake - 0.82) / 0.18) * 0.42 * this.tireTuning.volume;
      skidGain = Math.max(skidGain, lockupSlip);
      slipMagnitude = Math.max(slipMagnitude, lockupSlip);
    } else if (throttle > 0.90 && speedMps < 5.0 && this.currentRpm > 4500) {
      const launchSlip = 0.35 * this.tireTuning.volume;
      skidGain = Math.max(skidGain, launchSlip);
      slipMagnitude = Math.max(slipMagnitude, launchSlip);
    }

    if (this.tireSkidGain) {
      this.tireSkidGain.gain.setTargetAtTime(skidGain, t, 0.035);

      if (skidGain > 0.001) {
        // Dynamic low-pass filter: starts deep/muffled and opens up to crisp skid as slip increases
        const dynamicCutoff = 1500 + (slipMagnitude * 3200);
        this.tireSkidFilter.frequency.setTargetAtTime(dynamicCutoff, t, 0.04);

        // Natural playback rate: subtle modulation (+/- 6%) based on speed and slip - NO WHISTLE!
        if (this.tireSkidSource) {
          const playbackRate = 0.95 + Math.min(0.12, (speedMph / 120) * 0.08 + (slipMagnitude * 0.04));
          this.tireSkidSource.playbackRate.setTargetAtTime(playbackRate, t, 0.04);
        }
      }
    }
  }

  setTireAcousticsEnabled(enabled) {
    this.tireTuning.enabled = !!enabled;
    if (this.tireBus && this.ctx) {
      this.tireBus.gain.setTargetAtTime(this.tireTuning.enabled ? 1.0 : 0.0, this.ctx.currentTime, 0.05);
    }
  }

  setTireScreechVolume(pct) {
    this.tireTuning.volume = Math.max(0, Math.min(1.0, pct / 100));
  }

  setTireGripThreshold(thresholdG) {
    this.tireTuning.gripThresholdG = Math.max(0.20, Math.min(0.90, thresholdG));
  }

  setTireCompound(compound) {
    if (['cup2', 'pzero', 'vintage'].includes(compound)) {
      this.tireTuning.compound = compound;
    }
  }

  /**
   * Switches engine profile and updates both engine-sim and sample models
   */
  applyProfile(profile) {
    this.activeProfile = profile;
    if (!this.ctx || !this.isRunning) return;

    const t = this.ctx.currentTime;

    // Update physical engine-sim worklet
    if (this.isWorkletActive && this.engineSimNode) {
      this.engineSimNode.port.postMessage({
        type: 'SET_PROFILE',
        profile: profile
      });
    }

    // Update fallback buffers if active
    const bufs = this.sampleBuffers[profile.id];
    if (bufs && this.accelGain && this.decelGain && this.idleGain) {
      try {
        if (this.accelSource) { this.accelSource.stop(); this.accelSource.disconnect(); }
        if (this.decelSource) { this.decelSource.stop(); this.decelSource.disconnect(); }
        if (this.idleSource) { this.idleSource.stop(); this.idleSource.disconnect(); }
      } catch (e) {}

      this.accelSource = this.ctx.createBufferSource();
      this.accelSource.buffer = bufs.accel;
      this.accelSource.loop = true;

      this.decelSource = this.ctx.createBufferSource();
      this.decelSource.buffer = bufs.decel;
      this.decelSource.loop = true;

      this.idleSource = this.ctx.createBufferSource();
      this.idleSource.buffer = bufs.idle;
      this.idleSource.loop = true;

      this.accelSource.connect(this.accelGain);
      this.decelSource.connect(this.decelGain);
      this.idleSource.connect(this.idleGain);

      if (this.engineState !== 'OFF') {
        this.accelSource.start(t);
        this.decelSource.start(t);
        this.idleSource.start(t);
      }
    }

    if (this.subBassGain) {
      const targetSubBass = this.engineState === 'OFF' ? 0 : (profile.subBassGain || 0.85) * this.tuning.bassBoost;
      this.subBassGain.gain.setTargetAtTime(targetSubBass, t, 0.08);
    }
  }

  /**
   * Helper to trigger a one-shot audio buffer
   */
  playOneShot(buffer, volume = 0.8) {
    if (!this.ctx || !buffer) return;
    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume * this.tuning.masterVolume, t);
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start(t);
  }

  /**
   * Physical Starter Motor Cranking & Ignition Flare Sequence
   * Powered by engine-sim compression physics:
   * Starter motor cranks against cylinder TDC compression -> ignition catches -> flares -> settles to idle
   */
  startEngineSequence(callbacks = {}) {
    if (this.engineState !== 'OFF') return;
    this.engineState = 'CRANKING';

    const p = this.activeProfile;
    const t0 = performance.now();
    const t = this.ctx.currentTime;

    // Fade in engine bus
    this.engineBus.gain.setTargetAtTime(0.78, t, 0.04);

    // Always play high-fidelity mechanical starter motor cranking sound (compression struggles & DC motor hum)
    this.playOneShot(this.starterBuffer, 0.90);

    let catchTriggered = false;
    const triggerCatchSound = () => {
      if (catchTriggered) return;
      catchTriggered = true;
      this.playOneShot(this.catchBuffer, 1.0);
    };

    if (this.isWorkletActive && this.engineSimNode) {
      // Engage physical starter in worklet
      this.engineSimNode.port.postMessage({ type: 'START_ENGINE' });

      // Track starter cadence and catch state
      const crankPoll = setInterval(() => {
        if (this.engineState === 'CRANKING') {
          if (callbacks.onProgress) callbacks.onProgress({ state: 'CRANKING', rpm: this.currentRpm || 195 });
        } else if (this.engineState === 'STARTING') {
          triggerCatchSound();
          if (callbacks.onProgress) callbacks.onProgress({ state: 'STARTING', rpm: this.currentRpm || 2150 });
        } else if (this.engineState === 'RUNNING') {
          clearInterval(crankPoll);
          if (callbacks.onComplete) callbacks.onComplete();
        }
      }, 25);

      // Failsafe timeout: ensure ignition catch transition happens even if worklet message is delayed
      setTimeout(() => {
        if (this.engineState === 'CRANKING') {
          triggerCatchSound();
          this.engineSimNode.port.postMessage({
            type: 'SET_STATE',
            ignition: true,
            engineState: 'STARTING',
            targetRpm: 2150
          });
          setTimeout(() => {
            if (this.engineState !== 'OFF') {
              this.engineState = 'RUNNING';
              this.engineSimNode.port.postMessage({
                type: 'SET_STATE',
                engineState: 'RUNNING',
                targetRpm: p.idleRpm
              });
              clearInterval(crankPoll);
              if (callbacks.onComplete) callbacks.onComplete();
            }
          }, 850);
        }
      }, 950);

      return;
    }

    // Fallback if worklet not supported
    const crankInterval = setInterval(() => {
      if (this.engineState !== 'CRANKING') {
        clearInterval(crankInterval);
        return;
      }
      const elapsed = performance.now() - t0;
      if (elapsed < 950) {
        const crankRpm = 210 + Math.sin(elapsed * 0.035) * 45;
        this.currentRpm = crankRpm;
        if (callbacks.onProgress) callbacks.onProgress({ state: 'CRANKING', rpm: crankRpm });
      }
    }, 25);

    setTimeout(() => {
      clearInterval(crankInterval);
      if (this.engineState !== 'CRANKING') return;
      this.engineState = 'STARTING';

      triggerCatchSound();
      this.applyProfile(this.activeProfile);

      const tNow = this.ctx.currentTime;
      this.engineBus.gain.setTargetAtTime(0.68, tNow, 0.04);
      if (this.idleGain) this.idleGain.gain.setTargetAtTime(0.72, tNow, 0.04);

      if (callbacks.onProgress) callbacks.onProgress({ state: 'STARTING', rpm: 2150 });

      const flareStart = performance.now();
      const flareInterval = setInterval(() => {
        const flareElapsed = performance.now() - flareStart;
        const progress = Math.min(1.0, flareElapsed / 850);
        const currentFlareRpm = 2150 - (2150 - p.idleRpm) * Math.pow(progress, 0.65);
        this.currentRpm = currentFlareRpm;

        if (callbacks.onProgress) callbacks.onProgress({ state: 'STARTING', rpm: currentFlareRpm });

        if (progress >= 1.0) {
          clearInterval(flareInterval);
          this.engineState = 'RUNNING';
          this.currentRpm = p.idleRpm;
          if (callbacks.onComplete) callbacks.onComplete();
        }
      }, 25);
    }, 950);
  }

  /**
   * Physical Engine Shutdown Sequence
   * Fuel cut -> closed-throttle compression thuds -> piston recoil -> complete dead silence (0.000 gain)
   */
  stopEngineSequence(callbacks = {}) {
    if (this.engineState === 'OFF' || this.engineState === 'STOPPING') return;
    this.engineState = 'STOPPING';

    const p = this.activeProfile;
    const startRpm = this.currentRpm || p.idleRpm;

    // Always play physical shutdown spin-down sound (closed throttle compression thuds & vacuum sigh)
    this.playOneShot(this.shutdownBuffer, 0.95);

    if (this.isWorkletActive && this.engineSimNode) {
      // Signal physical shutdown to engine-sim worklet
      this.engineSimNode.port.postMessage({ type: 'STOP_ENGINE' });

      // Poll spindown progress until worklet reports ENGINE_OFF
      const stopPoll = setInterval(() => {
        if (this.engineState === 'STOPPING') {
          if (callbacks.onProgress) callbacks.onProgress({ state: 'STOPPING', rpm: this.currentRpm });
        } else if (this.engineState === 'OFF') {
          clearInterval(stopPoll);
          this.engineBus.gain.setValueAtTime(0, this.ctx.currentTime);
          if (this.tireBus) this.tireBus.gain.setValueAtTime(0, this.ctx.currentTime);
          this.currentRpm = 0;
          if (callbacks.onComplete) callbacks.onComplete();
        }
      }, 25);

      // Failsafe: force complete stop after 1.1s
      setTimeout(() => {
        clearInterval(stopPoll);
        this.engineState = 'OFF';
        this.currentRpm = 0;
        this.engineBus.gain.setValueAtTime(0, this.ctx.currentTime);
        if (this.tireBus) this.tireBus.gain.setValueAtTime(0, this.ctx.currentTime);
        if (callbacks.onComplete) callbacks.onComplete();
      }, 1100);

      return;
    }

    // Fallback shutdown with layered buffer
    this.playOneShot(this.shutdownBuffer, 0.90);
    const t = this.ctx.currentTime;
    if (this.accelGain) this.accelGain.gain.setValueAtTime(0, t);
    if (this.decelGain) this.decelGain.gain.setValueAtTime(0, t);
    this.engineBus.gain.setTargetAtTime(0, t, 0.35);

    const stopStart = performance.now();
    const stopInterval = setInterval(() => {
      const elapsed = performance.now() - stopStart;
      const progress = Math.min(1.0, elapsed / 850);
      const rpm = Math.max(0, startRpm * (1.0 - Math.pow(progress, 0.8)));
      this.currentRpm = rpm;

      if (callbacks.onProgress) callbacks.onProgress({ state: 'STOPPING', rpm: rpm });

      if (progress >= 1.0) {
        clearInterval(stopInterval);
        this.engineState = 'OFF';
        this.currentRpm = 0;

        try {
          if (this.accelSource) { this.accelSource.stop(); this.accelSource.disconnect(); }
          if (this.decelSource) { this.decelSource.stop(); this.decelSource.disconnect(); }
          if (this.idleSource) { this.idleSource.stop(); this.idleSource.disconnect(); }
        } catch (e) {}

        const tEnd = this.ctx.currentTime;
        this.engineBus.gain.setValueAtTime(0, tEnd);
        if (callbacks.onComplete) callbacks.onComplete();
      }
    }, 25);
  }

  /**
   * Main Real-time Audio Update Loop (Runs every animation frame)
   * Sends physics target RPM and throttle load to engine-sim procedural core
   */
  update(rpm, throttle, isShiftCut = false) {
    if (!this.ctx || !this.isRunning) return;

    // TOTAL SILENCE WHEN ENGINE IS OFF
    if (this.engineState === 'OFF') {
      const t = this.ctx.currentTime;
      this.engineBus.gain.setValueAtTime(0, t);
      if (this.subBassGain) this.subBassGain.gain.setValueAtTime(0, t);
      if (this.tireBus) this.tireBus.gain.setValueAtTime(0, t);
      return;
    }

    if (this.engineState === 'RUNNING') {
      this.currentRpm = Math.max(200, rpm);
    }
    this.currentThrottle = Math.max(0, Math.min(1, throttle));
    this.shiftCutActive = isShiftCut;

    const t = this.ctx.currentTime;
    const p = this.activeProfile;

    // -------------------------------------------------------------------
    // 1. ENGINE-SIM PROCEDURAL COMBUSTION SYNTHESIS UPDATE
    // -------------------------------------------------------------------
    if (this.isWorkletActive && this.engineSimNode) {
      this.engineSimNode.port.postMessage({
        type: 'SET_STATE',
        targetRpm: this.currentRpm,
        throttle: isShiftCut ? (this.currentThrottle * 0.25) : this.currentThrottle,
        shiftCut: isShiftCut,
        ignition: this.engineState === 'RUNNING' || this.engineState === 'STARTING',
        sr: this.ctx.sampleRate
      });

      // Turbo Spool
      if (p.turbo) {
        const targetBoost = Math.max(0, (this.currentRpm / p.redlineRpm) * this.currentThrottle * 1.4);
        this.currentBoost += (targetBoost - this.currentBoost) * 0.06;

        const turboFreq = 1400 + (this.currentBoost * 2200);
        this.turboOsc.frequency.setTargetAtTime(turboFreq, t, 0.03);
        this.turboFilter.frequency.setTargetAtTime(turboFreq, t, 0.03);

        const turboGain = Math.pow(this.currentBoost, 1.6) * 0.20 * this.tuning.turboSpool;
        this.turboGain.gain.setTargetAtTime(turboGain, t, 0.04);

        if (this.lastThrottle > 0.65 && this.currentThrottle < 0.25 && this.currentBoost > 0.30) {
          this.triggerBlowOffValve();
        }
      } else {
        this.currentBoost = 0;
        this.turboGain.gain.setTargetAtTime(0, t, 0.05);
      }

      // Overrun burble pops
      if (this.lastThrottle > 0.40 && this.currentThrottle < 0.15 && this.currentRpm > 2800) {
        if (Math.random() < p.backfireRate * (this.tuning.exhaustPops / 100)) {
          this.triggerExhaustPop();
        }
      }

      this.lastThrottle = this.currentThrottle;
      return;
    }

    // -------------------------------------------------------------------
    // 2. FALLBACK LOOP PLAYBACK (When worklet not loaded)
    // -------------------------------------------------------------------
    const sampleRpm = p.sampleRpm || 3200;
    const torcsPitch = Math.max(0.25, Math.min(3.2, this.currentRpm / sampleRpm));

    if (this.accelSource && this.decelSource && this.idleSource) {
      this.accelSource.playbackRate.setTargetAtTime(torcsPitch, t, 0.03);
      this.decelSource.playbackRate.setTargetAtTime(torcsPitch, t, 0.03);

      const idlePitch = Math.max(0.6, Math.min(2.0, this.currentRpm / p.idleRpm));
      this.idleSource.playbackRate.setTargetAtTime(idlePitch, t, 0.03);

      let idleGainTarget = 0;
      let accelGainTarget = 0;
      let decelGainTarget = 0;

      if (this.currentThrottle < 0.03 && this.currentRpm <= p.idleRpm + 120) {
        idleGainTarget = 0.70;
      } else {
        const rpmAboveIdle = Math.max(0, this.currentRpm - p.idleRpm);
        const idleFade = Math.max(0, 1.0 - (rpmAboveIdle / 600));
        idleGainTarget = idleFade * 0.65;
        accelGainTarget = (1.0 - idleFade) * this.currentThrottle * 0.75;
        decelGainTarget = (1.0 - idleFade) * (1.0 - this.currentThrottle) * 0.45;
      }

      this.idleGain.gain.setTargetAtTime(idleGainTarget, t, 0.02);
      this.accelGain.gain.setTargetAtTime(accelGainTarget, t, 0.02);
      this.decelGain.gain.setTargetAtTime(decelGainTarget, t, 0.02);
    }

    this.lastThrottle = this.currentThrottle;
  }

  /**
   * Generates a deep, punchy exhaust backfire pop
   */
  triggerExhaustPop() {
    if (!this.ctx || !this.isRunning) return;

    if (this.isWorkletActive && this.engineSimNode) {
      this.engineSimNode.port.postMessage({ type: 'TRIGGER_POP', intensity: 0.75 });
      return;
    }

    const t = this.ctx.currentTime;
    const dur = 0.12;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const env = Math.exp(-i / (bufferSize * 0.15));
      const lowThump = Math.sin((i / this.ctx.sampleRate) * 65 * Math.PI * 2);
      output[i] = ((Math.random() * 2 - 1) * 0.12 + lowThump * 0.88) * env;
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const popFilter = this.ctx.createBiquadFilter();
    popFilter.type = 'lowpass';
    popFilter.frequency.setValueAtTime(240, t);
    popFilter.Q.setValueAtTime(1.0, t);

    const popGain = this.ctx.createGain();
    const volume = 0.35 * (this.tuning.exhaustPops / 100);
    popGain.gain.setValueAtTime(volume, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noiseSource.connect(popFilter);
    popFilter.connect(popGain);
    popGain.connect(this.masterGain);

    noiseSource.start(t);
    noiseSource.stop(t + dur);
  }

  /**
   * Generates Turbo Blow-Off Valve (BOV) whoosh & wastegate chatter
   */
  triggerBlowOffValve() {
    if (!this.ctx || !this.isRunning) return;

    const t = this.ctx.currentTime;
    const dur = 0.35;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const flutter = Math.sin((i / this.ctx.sampleRate) * 45 * Math.PI * 2) * 0.4 + 0.6;
      output[i] = (Math.random() * 2 - 1) * flutter * Math.exp(-i / (bufferSize * 0.35));
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const bovFilter = this.ctx.createBiquadFilter();
    bovFilter.type = 'bandpass';
    bovFilter.frequency.setValueAtTime(2200, t);
    bovFilter.Q.setValueAtTime(2.5, t);

    const bovGain = this.ctx.createGain();
    bovGain.gain.setValueAtTime(0.35 * (this.tuning.turboSpool / 100), t);
    bovGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noiseSource.connect(bovFilter);
    bovFilter.connect(bovGain);
    bovGain.connect(this.masterGain);

    noiseSource.start(t);
    noiseSource.stop(t + dur);
  }

  /**
   * Generates fallback engine sample buffers
   */
  generateEngineSampleBuffers() {
    const sr = this.ctx.sampleRate;

    Object.values(this.profiles).forEach(p => {
      const createCycleLockedBuffer = (rpmRef, isIdle, isDecel) => {
        const cyclePeriod = 120 / rpmRef;
        const K = Math.max(1, Math.round(2.0 / cyclePeriod));
        const dur = K * cyclePeriod;
        const N = Math.round(dur * sr);
        const L = 2048;

        const totalSamples = N + L;
        const rawL = new Float32Array(totalSamples);
        const rawR = new Float32Array(totalSamples);
        const firingEventsPerCycle = p.cylinders;

        for (let i = 0; i < totalSamples; i++) {
          const cycleProgress = (i / N) * K;
          const cyclePhase = cycleProgress % 1.0;
          let sig = 0;

          if (isIdle) {
            for (let c = 0; c < firingEventsPerCycle; c++) {
              const lope = (c % 2 === 0) ? (p.crankAsymmetry || 0.2) * 0.12 : 0;
              const cylOffset = (c / firingEventsPerCycle) + lope;
              const cylPhase = (cyclePhase + 1.0 - (cylOffset % 1.0)) % 1.0;
              sig += Math.exp(-cylPhase * 16.0) * Math.sin(cylPhase * Math.PI * 2.0);
            }
            sig = sig * 0.7 + Math.sin(cyclePhase * 2.0 * Math.PI * 2.0) * 0.45;
          } else {
            for (let c = 0; c < firingEventsPerCycle; c++) {
              const lope = (c % 2 === 0) ? (p.crankAsymmetry || 0.2) * 0.08 : 0;
              const cylOffset = (c / firingEventsPerCycle) + lope;
              const cylPhase = (cyclePhase + 1.0 - (cylOffset % 1.0)) % 1.0;
              sig += Math.exp(-cylPhase * 8.0) * Math.sin(cylPhase * Math.PI * 3.0);
            }
          }

          rawL[i] = Math.tanh(sig * 1.3);
          rawR[i] = Math.tanh(sig * 1.25);
        }

        const finalBuffer = this.ctx.createBuffer(2, N, sr);
        const chanL = finalBuffer.getChannelData(0);
        const chanR = finalBuffer.getChannelData(1);

        for (let i = 0; i < N; i++) {
          if (i < L) {
            const w = 0.5 * (1.0 - Math.cos((i / L) * Math.PI));
            chanL[i] = rawL[i] * w + rawL[N + i] * (1.0 - w);
            chanR[i] = rawR[i] * w + rawR[N + i] * (1.0 - w);
          } else {
            chanL[i] = rawL[i];
            chanR[i] = rawR[i];
          }
        }
        return finalBuffer;
      };

      this.sampleBuffers[p.id] = {
        accel: createCycleLockedBuffer(p.sampleRpm, false, false),
        decel: createCycleLockedBuffer(p.sampleRpm, false, true),
        idle: createCycleLockedBuffer(p.idleRpm, true, false)
      };
    });
  }

  /**
   * Generates fallback Starter Motor, Flare, and Shutdown Buffers
   */
  generateStarterBuffers() {
    const sr = this.ctx.sampleRate;

    // 1. Starter Cranking Buffer (1.05s of compression chuffs & DC motor pitch sag)
    const crankDur = 1.05;
    const crankLen = Math.floor(sr * crankDur);
    this.starterBuffer = this.ctx.createBuffer(2, crankLen, sr);
    const stL = this.starterBuffer.getChannelData(0);
    const stR = this.starterBuffer.getChannelData(1);

    for (let i = 0; i < crankLen; i++) {
      const t = i / sr;
      // 4 compression struggles per second: speed drops from ~220 RPM to ~145 RPM
      const compCycle = (t * 4.2) % 1.0;
      // Instantaneous starter RPM sags heavily as piston crests TDC (compCycle ~ 0.5)
      const rpmSag = 1.0 - (0.42 * Math.exp(-Math.pow((compCycle - 0.5) / 0.16, 2.0)));
      const motorPitch = (320 + compCycle * 80) * rpmSag;

      // Armature teeth commutation ripple + solenoid hum
      const armatureWhine = Math.sin(2 * Math.PI * motorPitch * t) * 0.22;
      const solenoidHum = Math.sin(2 * Math.PI * 120 * t) * 0.12 * rpmSag;

      // Compressed air chuff through valve opening right after TDC
      const chuffEnv = Math.exp(-compCycle * 14.0);
      const chuff = Math.sin(2 * Math.PI * 68 * t) * chuffEnv * 0.65;
      const airHiss = (Math.random() * 2 - 1) * 0.08 * chuffEnv;

      const env = Math.min(1.0, t * 14.0) * Math.min(1.0, (crankDur - t) * 6.0);
      const val = (armatureWhine + solenoidHum + chuff + airHiss) * env * 0.90;
      stL[i] = Math.tanh(val * 1.2);
      stR[i] = Math.tanh(val * 1.15);
    }

    // 2. Combustion Catch & Flare Buffer (0.45s)
    const catchDur = 0.45;
    const catchLen = Math.floor(sr * catchDur);
    this.catchBuffer = this.ctx.createBuffer(2, catchLen, sr);
    const ctL = this.catchBuffer.getChannelData(0);
    const ctR = this.catchBuffer.getChannelData(1);

    for (let i = 0; i < catchLen; i++) {
      const t = i / sr;
      // Explosive initial cylinder catch report + secondary cylinder fire at t = 0.08s
      const bang1 = Math.sin(2 * Math.PI * 82 * t) * Math.exp(-t * 18.0) * 1.2;
      const crack1 = (Math.random() * 2 - 1) * Math.exp(-t * 45.0) * 0.75;

      const t2 = Math.max(0, t - 0.08);
      const bang2 = Math.sin(2 * Math.PI * 96 * t2) * Math.exp(-t2 * 20.0) * 0.95;

      // Cold-start intake manifold bypass roar
      const flareRoar = Math.sin(2 * Math.PI * 165 * t) * Math.min(1.0, t * 8.0) * Math.exp(-t * 3.5) * 0.45;

      const totalCatch = (bang1 + crack1 + bang2 + flareRoar);
      ctL[i] = Math.tanh(totalCatch * 1.25);
      ctR[i] = Math.tanh((bang1 * 0.95 + crack1 * 0.7 + bang2 * 1.05 + flareRoar) * 1.25);
    }

    // 3. Engine Shutdown Spin-down Buffer (0.95s)
    // Closed-throttle deceleration -> 3 discrete compression thuds -> piston recoil bounce -> vacuum relief
    const stopDur = 0.95;
    const stopLen = Math.floor(sr * stopDur);
    this.shutdownBuffer = this.ctx.createBuffer(2, stopLen, sr);
    const spL = this.shutdownBuffer.getChannelData(0);
    const spR = this.shutdownBuffer.getChannelData(1);

    for (let i = 0; i < stopLen; i++) {
      const t = i / sr;
      const progress = t / stopDur;

      // Slowing frequency from ~55 Hz down to 0 Hz
      const slowingFreq = Math.max(0, 52 * Math.pow(1.0 - progress, 1.4));
      const rotationThump = Math.sin(2 * Math.PI * slowingFreq * t) * Math.pow(1.0 - progress, 0.9) * 0.35;

      // Discrete compression strokes at t ~ 0.25s, 0.52s, and final halt at 0.76s
      const comp1 = Math.exp(-Math.pow((t - 0.25) / 0.04, 2.0)) * Math.sin(2 * Math.PI * 62 * t) * 0.45;
      const comp2 = Math.exp(-Math.pow((t - 0.52) / 0.05, 2.0)) * Math.sin(2 * Math.PI * 48 * t) * 0.60;
      // Final stroke: piston halts and recoils backwards
      const compFinal = Math.exp(-Math.pow((t - 0.76) / 0.06, 2.0)) * Math.sin(2 * Math.PI * 38 * t) * 0.75;
      const recoilClick = (t > 0.78 && t < 0.82) ? Math.sin(2 * Math.PI * 180 * (t - 0.78)) * Math.exp(-(t - 0.78) * 60) * 0.45 : 0;

      // Intake vacuum relief sigh as manifold pressure equalizes (t > 0.82s)
      const vacuumSigh = (t > 0.82) ? (Math.random() * 2 - 1) * 0.08 * Math.exp(-(t - 0.82) * 12.0) : 0;

      const totalStop = rotationThump + comp1 + comp2 + compFinal + recoilClick + vacuumSigh;
      spL[i] = Math.tanh(totalStop * 1.15);
      spR[i] = Math.tanh((totalStop * 0.95 + recoilClick * 0.3) * 1.15);
    }
  }

  /**
   * Audio Graph for fallback playback
   */
  setupAudioGraph() {
    const t = this.ctx.currentTime;
    const p = this.activeProfile;
    const bufs = this.sampleBuffers[p.id];
    if (!bufs) return;

    this.accelSource = this.ctx.createBufferSource();
    this.accelSource.buffer = bufs.accel;
    this.accelSource.loop = true;

    this.decelSource = this.ctx.createBufferSource();
    this.decelSource.buffer = bufs.decel;
    this.decelSource.loop = true;

    this.idleSource = this.ctx.createBufferSource();
    this.idleSource.buffer = bufs.idle;
    this.idleSource.loop = true;

    this.accelGain = this.ctx.createGain();
    this.decelGain = this.ctx.createGain();
    this.idleGain = this.ctx.createGain();

    this.accelGain.gain.setValueAtTime(0, t);
    this.decelGain.gain.setValueAtTime(0, t);
    this.idleGain.gain.setValueAtTime(0, t);

    this.accelSource.connect(this.accelGain);
    this.decelSource.connect(this.decelGain);
    this.idleSource.connect(this.idleGain);

    this.accelGain.connect(this.engineBus);
    this.decelGain.connect(this.engineBus);
    this.idleGain.connect(this.engineBus);

    this.accelSource.start(t);
    this.decelSource.start(t);
    this.idleSource.start(t);
  }

  /**
   * Loads custom user WAV file
   */
  async loadCustomWav(file, sampleRpm = 3500) {
    if (!this.ctx) await this.init();

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    const customId = 'custom_' + Date.now();
    const customProfile = {
      id: customId,
      name: file.name.replace(/\.[^/.]+$/, '').toUpperCase(),
      desc: 'Custom Game Sample Loop (' + Math.round(sampleRpm) + ' RPM reference)',
      cylinders: 8,
      idleRpm: 750,
      sampleRpm: sampleRpm,
      redlineRpm: 8000,
      pitchScale: 0.50,
      subBassGain: 0.85,
      pipeResonance: 140,
      pipeQ: 2.5,
      mufflerCutoff: 1400,
      pulseWidth: 125,
      compressionRatio: 10.5,
      firingAngles: [0, 90, 180, 270, 360, 450, 540, 630],
      exhaustBanks: [0, 1, 0, 1, 0, 1, 0, 1],
      runnerLengths: [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45],
      turbo: false,
      backfireRate: 0.8
    };

    this.profiles[customId] = customProfile;
    this.sampleBuffers[customId] = {
      accel: audioBuffer,
      decel: audioBuffer,
      idle: audioBuffer
    };

    this.applyProfile(customProfile);
    return customProfile;
  }

  setMasterVolume(val) {
    this.tuning.masterVolume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.tuning.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  setBassBoost(val) {
    this.tuning.bassBoost = Math.max(0, Math.min(1.5, val));
    if (this.subBassGain && this.ctx) {
      this.subBassGain.gain.setTargetAtTime((this.activeProfile.subBassGain || 0.85) * this.tuning.bassBoost, this.ctx.currentTime, 0.05);
    }
  }

  getSpectrumData(array) {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array);
    }
  }
}

window.RevverAudioEngine = RevverAudioEngine;
