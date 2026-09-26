/**
 * REVVER — Ange Yaghi Engine-Sim Procedural Combustion AudioWorklet Processor
 * Modeled after Ange Yaghi's engine-sim (https://github.com/ange-yaghi/engine-sim).
 *
 * Key Physical Principles from Ange Yaghi's Synthesizer:
 * 1. DC Blocking Filter at 10.0 Hz (Preserves full 25-60 Hz combustion fundamentals)
 * 2. Antialiasing / Muffler Filter capped at 1,850 Hz (Eliminates high-frequency synthesizer buzz)
 * 3. Derivative Shock Front scaled to dF_F_mix = 0.012 (Sharp metallic crack without high-pitch screech)
 * 4. Broad 170° Exhaust Valve Opening (EVO) gas blowdown envelope with real acoustic air displacement
 * 5. Exhaust Collector Acoustic Transmission Line (inverted open-pipe negative reflection) for hollow throatiness
 * 6. High-mass idle combustion: engine NEVER cuts out or dies at zero throttle; idles with heavy concussive thumping
 * 7. Physical starter motor cranking cadence (~180 RPM) & cold-start flare settling into idle lope
 * 8. Physical shutdown with closed-throttle compression thuds and complete silence
 */

class EngineSimProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Sample rate
    this.sr = 48000;

    // Simulation state
    this.crankAngle = 0;        // 0 to 720 degrees
    this.currentRpm = 0;         // Instantaneous crankshaft RPM
    this.targetRpm = 850;
    this.throttle = 0;           // 0.0 to 1.0
    this.ignition = false;       // Spark & fuel active
    this.starterEngaged = false; // Starter motor active
    this.engineState = 'OFF';    // 'OFF', 'CRANKING', 'STARTING', 'RUNNING', 'STOPPING'

    // Starter motor & flywheel physical constants
    this.starterTorque = 110.0;
    this.flywheelInertia = 0.16; // kg*m^2
    this.angularVelocity = 0;    // rad/s (ω)
    this.audioTime = 0;
    this.crankingStartTime = 0;
    this.flareStartTime = 0;

    // Active Engine Profile (Defaults to Stuttgart 4.0L High-Rev Flat-6)
    this.profile = {
      id: 'flat6',
      name: 'Stuttgart 4.0L High-Rev Flat-6',
      cylinders: 6,
      idleRpm: 850,
      redlineRpm: 9000,
      // Firing angles across 720° 4-stroke cycle
      firingAngles: [0, 120, 240, 360, 480, 600],
      exhaustBanks: [0, 1, 0, 1, 0, 1],
      runnerLengths: [0.45, 0.45, 0.48, 0.48, 0.50, 0.50],
      pipeResonance: 85,    // Hz (deep acoustic column resonance)
      pipeQ: 2.4,
      mufflerCutoff: 480,   // Hz (idle muffler warmth)
      pulseWidth: 175,      // degrees (broad realistic valve blowdown window)
      compressionRatio: 13.3,
      intakeRoarGain: 0.60,
      subBassGain: 1.10
    };

    // Runner acoustic delay lines (max 0.1s at 48kHz ~ 4800 samples)
    this.maxDelay = 4800;
    this.runnerBuffers = [];
    this.runnerWritePtrs = [];

    // Cylinder arrays: cycle-to-cycle thermodynamic variation & derivative state
    this.lastCylPressure = [];
    this.cylJitter = [];
    this.cylPhaseJitter = [];
    this.cylLastFiredCycle = [];

    this.initCylinderArrays();

    // Exhaust Collector Acoustic Transmission Lines (hollow straight-pipe throatiness)
    this.collectorLineLength = 2048;
    this.bank1CollectorLine = new Float32Array(this.collectorLineLength);
    this.bank2CollectorLine = new Float32Array(this.collectorLineLength);
    this.reflWritePtr1 = 0;
    this.reflWritePtr2 = 0;

    // Filters (Matching Ange Yaghi's 10 Hz DC filter and steep muffler lowpass)
    this.dcFilter1 = this.createDcBlocker(10.0);
    this.dcFilter2 = this.createDcBlocker(10.0);

    this.bank1Res = this.createBiquad();
    this.bank2Res = this.createBiquad();

    this.bank1Lpf = this.createBiquad();
    this.bank2Lpf = this.createBiquad();
    this.bank1Lpf2 = this.createBiquad(); // 2nd stage steep lowpass for warmth
    this.bank2Lpf2 = this.createBiquad();

    this.intakeLpf = this.createBiquad();
    this.subLpf = this.createBiquad();

    // Update filter coefficients
    this.updateAcousticFilters();

    // Communication with main thread
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'SET_PROFILE') {
        this.setProfile(data.profile);
      } else if (data.type === 'SET_STATE') {
        this.setState(data);
      } else if (data.type === 'START_ENGINE') {
        this.beginStarterCranking();
      } else if (data.type === 'STOP_ENGINE') {
        this.beginShutdown();
      } else if (data.type === 'TRIGGER_POP') {
        this.triggerBackfire(data.intensity || 1.0);
      }
    };

    // Backfire state
    this.backfireEnergy = 0;
    this.backfireDecay = 0.991;

    // Shift cut torque dip
    this.shiftCut = false;
    this.shiftCutAttenuation = 1.0;
  }

  initCylinderArrays() {
    const count = this.profile.cylinders || 6;
    this.runnerBuffers = [];
    this.runnerWritePtrs = [];
    this.lastCylPressure = new Float32Array(count);
    this.cylJitter = new Float32Array(count);
    this.cylPhaseJitter = new Float32Array(count);
    this.cylLastFiredCycle = new Int32Array(count);

    for (let c = 0; c < count; c++) {
      this.runnerBuffers.push(new Float32Array(this.maxDelay));
      this.runnerWritePtrs.push(0);
      this.cylJitter[c] = 0.96 + Math.random() * 0.08;
      this.cylPhaseJitter[c] = (Math.random() - 0.5) * 1.5;
      this.cylLastFiredCycle[c] = -1;
    }
  }

  createDcBlocker(cutoffHz = 10.0) {
    const r = 1.0 - (2.0 * Math.PI * cutoffHz / this.sr);
    return {
      r: r,
      x1: 0,
      y1: 0,
      process: function(x) {
        const y = x - this.x1 + this.r * this.y1;
        this.x1 = x;
        this.y1 = y;
        return isNaN(y) ? 0 : y;
      }
    };
  }

  createBiquad() {
    return {
      b0: 1, b1: 0, b2: 0,
      a1: 0, a2: 0,
      x1: 0, x2: 0,
      y1: 0, y2: 0,
      process: function(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return isNaN(y) ? 0 : y;
      }
    };
  }

  setBiquadLowpass(filter, freq, Q = 0.707) {
    const f0 = Math.max(20, Math.min(this.sr * 0.48, freq));
    const w0 = (2 * Math.PI * f0) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw = Math.cos(w0);

    const a0 = 1 + alpha;
    filter.b0 = ((1 - cosw) / 2) / a0;
    filter.b1 = (1 - cosw) / a0;
    filter.b2 = ((1 - cosw) / 2) / a0;
    filter.a1 = (-2 * cosw) / a0;
    filter.a2 = (1 - alpha) / a0;
  }

  setBiquadPeaking(filter, freq, Q = 2.0, gainDb = 6) {
    const f0 = Math.max(25, Math.min(this.sr * 0.45, freq));
    const w0 = (2 * Math.PI * f0) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const A = Math.pow(10, gainDb / 40);
    const cosw = Math.cos(w0);

    const a0 = 1 + alpha / A;
    filter.b0 = (1 + alpha * A) / a0;
    filter.b1 = (-2 * cosw) / a0;
    filter.b2 = (1 - alpha * A) / a0;
    filter.a1 = (-2 * cosw) / a0;
    filter.a2 = (1 - alpha / A) / a0;
  }

  updateAcousticFilters() {
    const p = this.profile;
    // Pipe acoustic cavity resonance (deep hollow body)
    this.setBiquadPeaking(this.bank1Res, p.pipeResonance || 85, p.pipeQ || 2.4, 6.5);
    this.setBiquadPeaking(this.bank2Res, (p.pipeResonance || 85) * 1.04, p.pipeQ || 2.4, 6.5);

    // RPM & Throttle dynamic acoustic opening:
    const effectiveRpm = Math.max(this.currentRpm, this.targetRpm);
    const idleRef = p.idleRpm || 800;
    const redlineRef = p.redlineRpm || 8500;
    const rpmFactor = Math.min(1.0, Math.max(0, (effectiveRpm - idleRef) / (redlineRef - idleRef)));

    // Lowpass cutoff: 420 Hz (deep idle throb) opening up to 1,850 Hz (Ange Yaghi redline wail)
    // NEVER allow higher than 1,950 Hz to prevent synthetic buzzy screech!
    const dynamicCutoff = Math.min(1850, 420 + (this.throttle * 450) + (rpmFactor * 980));
    this.setBiquadLowpass(this.bank1Lpf, dynamicCutoff, 0.707);
    this.setBiquadLowpass(this.bank2Lpf, dynamicCutoff * 1.02, 0.707);
    this.setBiquadLowpass(this.bank1Lpf2, dynamicCutoff * 1.25, 0.707);
    this.setBiquadLowpass(this.bank2Lpf2, dynamicCutoff * 1.28, 0.707);

    // Intake manifold rumble
    this.setBiquadLowpass(this.intakeLpf, 280 + (this.throttle * 400) + (rpmFactor * 350), 1.1);

    // Sub-chassis chest thud filter (35 Hz - 75 Hz)
    this.setBiquadLowpass(this.subLpf, 68 + (rpmFactor * 32), 0.85);
  }

  setProfile(p) {
    this.profile = Object.assign({}, this.profile, p);
    this.initCylinderArrays();
    this.updateAcousticFilters();
  }

  setState(data) {
    let needsFilterUpdate = false;
    if (data.targetRpm !== undefined && Math.abs(data.targetRpm - this.targetRpm) > 25) {
      this.targetRpm = data.targetRpm;
      needsFilterUpdate = true;
    }
    if (data.throttle !== undefined && Math.abs(data.throttle - this.throttle) > 0.02) {
      this.throttle = Math.max(0, Math.min(1, data.throttle));
      needsFilterUpdate = true;
    }
    if (needsFilterUpdate) {
      this.updateAcousticFilters();
    }
    if (data.shiftCut !== undefined) this.shiftCut = !!data.shiftCut;
    if (data.engineState !== undefined) this.engineState = data.engineState;
    if (data.ignition !== undefined) this.ignition = !!data.ignition;
    if (data.sr !== undefined) this.sr = data.sr;
  }

  beginStarterCranking() {
    this.engineState = 'CRANKING';
    this.starterEngaged = true;
    this.ignition = false;
    this.currentRpm = 0;
    this.angularVelocity = 0;
    this.crankingStartTime = this.audioTime;
    this.flareStartTime = 0;
  }

  beginShutdown() {
    this.engineState = 'STOPPING';
    this.starterEngaged = false;
    this.ignition = false;
  }

  triggerBackfire(intensity = 0.6) {
    this.backfireEnergy = Math.min(0.85, this.backfireEnergy + (intensity * 0.40));
  }

  /**
   * Main real-time audio block synthesis (128 samples per block)
   */
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const outL = output[0];
    const outR = output[1];
    const numSamples = outL.length;
    const dt = 1.0 / this.sr;
    const p = this.profile;
    const numCyl = p.cylinders;
    const speedOfSound = 480.0; // m/s in hot exhaust gas

    // Completely off: dead silence
    if (this.engineState === 'OFF') {
      outL.fill(0);
      outR.fill(0);
      this.currentRpm = 0;
      this.angularVelocity = 0;
      return true;
    }

    // Collector pipe acoustic reflection delay in samples (primary collector ~1.2m: round trip ~5ms ~ 240 samples)
    const reflDelaySamples = Math.min(this.collectorLineLength - 1, Math.round((2.0 * 1.20 / speedOfSound) * this.sr));
    const secReflSamples = Math.min(this.collectorLineLength - 1, Math.round(reflDelaySamples * 1.85));
    const crossBleedSamples = Math.min(this.collectorLineLength - 1, Math.round(reflDelaySamples * 0.72));

    for (let s = 0; s < numSamples; s++) {
      this.audioTime += dt;

      // -------------------------------------------------------------
      // 1. ENGINE ROTATION & RPM INTEGRATION
      // -------------------------------------------------------------
      if (this.engineState === 'CRANKING') {
        const elapsedCrank = this.audioTime - this.crankingStartTime;
        // Starter bogs down to ~145 RPM at TDC and surges to ~210 RPM (groaning cadence)
        const crankAngleRad = (this.crankAngle * (numCyl / 2.0) * Math.PI) / 180.0;
        const compressionBog = Math.sin(crankAngleRad) * 35.0;
        this.currentRpm = Math.max(120, 185.0 + compressionBog);
        this.angularVelocity = this.currentRpm * 0.1047197;

        // Catch ignition after ~0.85s of cranking
        if (elapsedCrank > 0.85) {
          this.engineState = 'STARTING';
          this.ignition = true;
          this.starterEngaged = false;
          this.flareStartTime = this.audioTime;
          this.currentRpm = 1800;
          this.triggerBackfire(0.8);
          this.port.postMessage({ type: 'ENGINE_CATCH', rpm: Math.round(this.currentRpm) });
        }
      } else if (this.engineState === 'STARTING') {
        // Cold-start flare up to ~2,200 RPM, then smooth taper to idle
        const flareElapsed = this.audioTime - this.flareStartTime;
        if (flareElapsed < 0.25) {
          this.currentRpm = 1800 + (flareElapsed / 0.25) * 450; // Surge to 2,250 RPM
        } else if (flareElapsed < 0.95) {
          const taper = (flareElapsed - 0.25) / 0.70;
          this.currentRpm = 2250 - (2250 - p.idleRpm) * Math.pow(taper, 0.75);
        } else {
          this.engineState = 'RUNNING';
          this.currentRpm = p.idleRpm;
          this.port.postMessage({ type: 'ENGINE_RUNNING', rpm: Math.round(this.currentRpm) });
        }
        this.angularVelocity = this.currentRpm * 0.1047197;
      } else if (this.engineState === 'RUNNING') {
        // Active Running: smoothly track target RPM with flywheel inertia
        // At idle (throttle = 0), stay solidly at idleRpm with natural combustion warble!
        const baseTarget = Math.max(p.idleRpm, this.targetRpm);
        // Flywheel inertia response (smoother, heavy rotating assembly feel)
        const accelRate = (baseTarget > this.currentRpm) ? 0.0035 : 0.0022;
        this.currentRpm += (baseTarget - this.currentRpm) * accelRate;

        // Instantaneous intra-cycle combustion warble (speed surges on every firing stroke!)
        const firingPhase = (this.crankAngle * (numCyl / 2.0) * Math.PI) / 180.0;
        const warbleDelta = Math.sin(firingPhase) * (18.0 + (1.0 - this.throttle) * 16.0);
        const instantRpm = Math.max(200, this.currentRpm + warbleDelta);
        this.angularVelocity = instantRpm * 0.1047197;
      } else if (this.engineState === 'STOPPING') {
        // Shutdown: closed throttle spindown with 3 distinct compression thuds
        this.currentRpm *= 0.99965;
        this.angularVelocity = this.currentRpm * 0.1047197;

        if (this.currentRpm < 55) {
          // Final piston recoil stop
          this.engineState = 'OFF';
          this.currentRpm = 0;
          this.angularVelocity = 0;
          this.port.postMessage({ type: 'ENGINE_OFF' });
          outL.fill(0, s);
          outR.fill(0, s);
          return true;
        }
      }

      // Advance crankshaft angle: degrees per second = RPM * 6
      const degreesAdvance = this.currentRpm * 6.0 * dt;
      this.crankAngle = (this.crankAngle + degreesAdvance) % 720;

      // -------------------------------------------------------------
      // 2. PROCEDURAL COMBUSTION PRESSURE PULSE GENERATION
      // -------------------------------------------------------------
      let bank1Raw = 0;
      let bank2Raw = 0;
      let intakeRaw = 0;

      // Manifold air charge: at idle (throttle 0), idle air bypass provides 0.62 mass
      // so the engine is NEVER silent or thin at idle!
      const manifoldPressure = (this.engineState === 'STARTING')
        ? 0.95
        : (0.62 + (0.38 * this.throttle));

      // Shift cut torque dip
      const targetCut = this.shiftCut ? 0.35 : 1.0;
      this.shiftCutAttenuation += (targetCut - this.shiftCutAttenuation) * 0.01;

      const currentCycleNum = Math.floor(this.crankAngle / 720);

      for (let c = 0; c < numCyl; c++) {
        const fireAngle = p.firingAngles[c];
        const bank = p.exhaustBanks[c] || 0;
        const runnerLen = p.runnerLengths[c] || 0.45;
        const pulseWidth = p.pulseWidth || 170;

        // Angle elapsed since cylinder exhaust valve opened
        const deltaAngle = (this.crankAngle - fireAngle + 720) % 720;

        // Cycle-to-cycle thermodynamic variation (inputSampleNoise)
        if (deltaAngle < 6 && this.cylLastFiredCycle[c] !== currentCycleNum) {
          this.cylLastFiredCycle[c] = currentCycleNum;
          this.cylJitter[c] = 0.95 + Math.random() * 0.10;
        }

        let cylPressure = 0;

        if (this.ignition && (this.engineState === 'RUNNING' || this.engineState === 'STARTING')) {
          if (deltaAngle < pulseWidth) {
            const x = deltaAngle / pulseWidth; // 0.0 to 1.0
            // Broad, deep acoustic monopole pressure pulse (Ange Yaghi blowdown shape)
            const pulseEnvelope = Math.pow(Math.sin(x * Math.PI), 1.25) * Math.exp(-1.6 * x);
            // High acoustic mass with deep low-frequency displacement
            cylPressure = pulseEnvelope * manifoldPressure * 2.2 * this.shiftCutAttenuation * this.cylJitter[c];

            // Soft valve gas rush noise
            const valveLift = Math.sin(x * Math.PI);
            cylPressure += (Math.random() - 0.5) * 0.025 * valveLift * cylPressure;
          }
        } else if (this.starterEngaged || this.engineState === 'STOPPING') {
          // Cranking & Spindown: unburned air compression puff through exhaust valve
          if (deltaAngle < 110) {
            const x = deltaAngle / 110;
            cylPressure = Math.sin(x * Math.PI) * 0.45 * Math.min(1.0, this.currentRpm / 250);
          }
        }

        // Pressure Derivative Shock Wave (dF_F_mix):
        // Scaled to exactly 0.012 (matching Ange Yaghi's 0.01 ratio) - NO HARSH BUZZ!
        const dP = (cylPressure - this.lastCylPressure[c]);
        this.lastCylPressure[c] = cylPressure;
        const shockPulse = cylPressure + (dP * 0.012 * this.sr * 0.001);

        // Write cylinder pulse into individual exhaust runner delay buffer
        const buf = this.runnerBuffers[c];
        let ptr = this.runnerWritePtrs[c];
        buf[ptr] = shockPulse;

        // Compute delay in samples
        const delaySamples = Math.min(this.maxDelay - 1, Math.round((runnerLen / speedOfSound) * this.sr));
        let readPtr = ptr - delaySamples;
        if (readPtr < 0) readPtr += this.maxDelay;

        const delayedPulse = buf[readPtr];

        ptr = (ptr + 1) % this.maxDelay;
        this.runnerWritePtrs[c] = ptr;

        // Sum into respective exhaust collector
        if (bank === 0) {
          bank1Raw += delayedPulse;
        } else {
          bank2Raw += delayedPulse;
        }

        // Intake manifold roar (intake stroke 360° opposite)
        const intakeAngle = (this.crankAngle - ((fireAngle + 360) % 720) + 720) % 720;
        if (intakeAngle < 160 && this.throttle > 0.05) {
          const ix = intakeAngle / 160;
          intakeRaw += Math.sin(ix * Math.PI) * Math.exp(-ix * 1.8) * this.throttle;
        }
      }

      // Starter motor electric DC armature whine during cranking
      if (this.starterEngaged) {
        const armaturePitch = (this.crankAngle * 12.0 * Math.PI) / 180.0;
        const starterArmature = Math.sin(armaturePitch) * 0.18 * (this.currentRpm / 180);
        bank1Raw += starterArmature;
        bank2Raw += starterArmature;
      }

      // Overrun burble & exhaust pop
      if (this.backfireEnergy > 0.01) {
        const popPhase = (this.crankAngle * 2.0 * Math.PI) / 180.0;
        const lowThump = Math.sin(popPhase) * 0.55;
        const pop = lowThump * this.backfireEnergy * 0.75;
        bank1Raw += pop;
        bank2Raw += pop * 0.85;
        this.backfireEnergy *= this.backfireDecay;
      }

      // -------------------------------------------------------------
      // 3. EXHAUST COLLECTOR ACOUSTIC TRANSMISSION LINE (THROATINESS)
      // -------------------------------------------------------------
      // Inverted negative reflection (-0.38) creates authentic hollow throatiness
      let readRefl1 = this.reflWritePtr1 - reflDelaySamples;
      if (readRefl1 < 0) readRefl1 += this.collectorLineLength;
      const primaryRefl1 = this.bank1CollectorLine[readRefl1];

      let readRefl2 = this.reflWritePtr2 - reflDelaySamples;
      if (readRefl2 < 0) readRefl2 += this.collectorLineLength;
      const primaryRefl2 = this.bank2CollectorLine[readRefl2];

      let readSec1 = this.reflWritePtr1 - secReflSamples;
      if (readSec1 < 0) readSec1 += this.collectorLineLength;
      const secondaryRefl1 = this.bank1CollectorLine[readSec1];

      let readSec2 = this.reflWritePtr2 - secReflSamples;
      if (readSec2 < 0) readSec2 += this.collectorLineLength;
      const secondaryRefl2 = this.bank2CollectorLine[readSec2];

      let readCross1 = this.reflWritePtr2 - crossBleedSamples;
      if (readCross1 < 0) readCross1 += this.collectorLineLength;
      const crossBleed1 = this.bank2CollectorLine[readCross1];

      let readCross2 = this.reflWritePtr1 - crossBleedSamples;
      if (readCross2 < 0) readCross2 += this.collectorLineLength;
      const crossBleed2 = this.bank1CollectorLine[readCross2];

      const collectorOut1 = bank1Raw - (primaryRefl1 * 0.38) + (secondaryRefl1 * 0.15) + (crossBleed1 * 0.12);
      const collectorOut2 = bank2Raw - (primaryRefl2 * 0.38) + (secondaryRefl2 * 0.15) + (crossBleed2 * 0.12);

      this.bank1CollectorLine[this.reflWritePtr1] = bank1Raw + (primaryRefl1 * 0.20);
      this.bank2CollectorLine[this.reflWritePtr2] = bank2Raw + (primaryRefl2 * 0.20);
      this.reflWritePtr1 = (this.reflWritePtr1 + 1) % this.collectorLineLength;
      this.reflWritePtr2 = (this.reflWritePtr2 + 1) % this.collectorLineLength;

      // -------------------------------------------------------------
      // 4. ACOUSTIC FILTERING (10Hz DC BLOCKER & WARM LOWPASS)
      // -------------------------------------------------------------
      // 1. DC Blocker at 10.0 Hz (Ange Yaghi standard: preserves 100% of 25-60Hz combustion bass!)
      const dc1 = this.dcFilter1.process(collectorOut1);
      const dc2 = this.dcFilter2.process(collectorOut2);

      // 2. Pipe column resonance peaking
      const res1 = this.bank1Res.process(dc1);
      const res2 = this.bank2Res.process(dc2);

      // 3. Muffler lowpass filtering (Warm low-mid emphasis, capped at 1,850 Hz)
      const muf1 = this.bank1Lpf2.process(this.bank1Lpf.process(res1));
      const muf2 = this.bank2Lpf2.process(this.bank2Lpf.process(res2));

      // 4. Sub-bass concussive throb (35 Hz - 75 Hz chest thump)
      const subSig = this.subLpf.process((muf1 + muf2) * 0.5);

      // 5. Intake induction growl
      const intakeSig = this.intakeLpf.process(intakeRaw) * (p.intakeRoarGain || 0.60);

      // 6. Stereo mix with soft analog exhaust saturation
      let finalL = muf1 + (subSig * (p.subBassGain || 1.10)) + (intakeSig * 0.45);
      let finalR = muf2 + (subSig * (p.subBassGain || 1.10)) + (intakeSig * 0.45);

      // Warm analog non-linear saturation
      outL[s] = Math.tanh(finalL * 1.15);
      outR[s] = Math.tanh(finalR * 1.15);
    }

    // Periodically report simulated physical RPM back to UI
    if (Math.random() < 0.08) {
      this.port.postMessage({
        type: 'RPM_UPDATE',
        rpm: Math.round(this.currentRpm),
        engineState: this.engineState
      });
    }

    return true;
  }
}

registerProcessor('engine-sim-processor', EngineSimProcessor);
