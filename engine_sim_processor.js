/**
 * REVVER — Ange Yaghi Engine-Sim Procedural Combustion AudioWorklet Processor
 * Inspired by Ange Yaghi's engine-sim (https://github.com/ange-yaghi/engine-sim).
 *
 * Implements:
 * 1. Physical 4-stroke 720° crankshaft angle accumulator with instantaneous dω/dt dynamics
 * 2. Intra-cycle angular velocity fluctuation (Δω per combustion kick) generating natural warble & lope
 * 3. Cycle-to-cycle thermodynamic variation (inputSampleNoise) for organic flame jitter
 * 4. Pressure derivative shock front (dF_F_mix) for sharp valve opening bite & crack
 * 5. Exhaust collector acoustic transmission line (inverted open-end reflection & X-pipe crossover) for deep throatiness
 * 6. Physical starter motor with TDC compression bogging (authentic whir-RRR-chug cadence)
 * 7. Sequential ignition catch, cold-start bypass flare (~2,200 RPM), and transition to idle
 * 8. Physical shutdown with closed-throttle compression braking, piston recoil, vacuum relief, and dead stop
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
    this.starterTorque = 105.0;  // N*m (high stall torque series DC motor)
    this.flywheelInertia = 0.15; // kg*m^2
    this.angularVelocity = 0;    // rad/s (ω)
    this.flareStartTime = 0;
    this.crankingStartTime = 0;
    this.crankingCycles = 0;

    // Shutdown physics state
    this.stoppingStartTime = 0;
    this.stoppedCrankAngle = 0;
    this.hasRecoiled = false;
    this.vacuumReliefEnergy = 0;

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
      pipeResonance: 165,
      pipeQ: 2.8,
      mufflerCutoff: 1800,
      pulseWidth: 122,
      compressionRatio: 13.3,
      intakeRoarGain: 0.65,
      subBassGain: 0.85
    };

    // Runner acoustic delay lines (max 0.1s at 48kHz ~ 4800 samples)
    this.maxDelay = 4800;
    this.runnerBuffers = [];
    this.runnerWritePtrs = [];

    // Cylinder-by-cylinder state:
    // Cycle-to-cycle thermodynamic variation (inputSampleNoise) & derivative shock wave
    this.lastCylPressure = [];
    this.cylJitter = [];
    this.cylPhaseJitter = [];
    this.cylLastFiredCycle = [];

    this.initCylinderArrays();

    // Exhaust Collector Acoustic Transmission Lines (comb-filter inverted reflection for intense throatiness)
    this.collectorLineLength = 2048;
    this.bank1CollectorLine = new Float32Array(this.collectorLineLength);
    this.bank2CollectorLine = new Float32Array(this.collectorLineLength);
    this.reflWritePtr1 = 0;
    this.reflWritePtr2 = 0;

    // Biquad Resonators for Exhaust Bank 1 & 2
    this.bank1Res = this.createBiquad();
    this.bank2Res = this.createBiquad();
    this.bank1Lpf = this.createBiquad();
    this.bank2Lpf = this.createBiquad();
    this.bank1ThroatHp = this.createBiquad();
    this.bank2ThroatHp = this.createBiquad();
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

    // Backfire / exhaust crackle state
    this.backfireEnergy = 0;
    this.backfireDecay = 0.993;

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
      this.cylPhaseJitter[c] = (Math.random() - 0.5) * 1.8;
      this.cylLastFiredCycle[c] = -1;
    }
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

  setBiquadHighpass(filter, freq, Q = 0.707) {
    const f0 = Math.max(20, Math.min(this.sr * 0.48, freq));
    const w0 = (2 * Math.PI * f0) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw = Math.cos(w0);

    const a0 = 1 + alpha;
    filter.b0 = ((1 + cosw) / 2) / a0;
    filter.b1 = (-(1 + cosw)) / a0;
    filter.b2 = ((1 + cosw) / 2) / a0;
    filter.a1 = (-2 * cosw) / a0;
    filter.a2 = (1 - alpha) / a0;
  }

  setBiquadPeaking(filter, freq, Q = 2.5, gainDb = 6) {
    const f0 = Math.max(30, Math.min(this.sr * 0.45, freq));
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
    // Pipe acoustic chamber resonance (gives body & metallic roar)
    this.setBiquadPeaking(this.bank1Res, p.pipeResonance || 140, p.pipeQ || 2.8, 8.5);
    this.setBiquadPeaking(this.bank2Res, (p.pipeResonance || 140) * 1.03, p.pipeQ || 2.8, 8.5);

    // Highpass rasp for raw header bite
    this.setBiquadHighpass(this.bank1ThroatHp, 85, 0.65);
    this.setBiquadHighpass(this.bank2ThroatHp, 85, 0.65);

    // RPM & Throttle dynamic acoustic opening:
    const effectiveRpm = Math.max(this.currentRpm, this.targetRpm);
    const idleRef = p.idleRpm || 800;
    const redlineRef = p.redlineRpm || 8500;
    const rpmFactor = Math.min(1.0, Math.max(0, (effectiveRpm - idleRef) / (redlineRef - idleRef)));

    // Muffler cutoff opens dynamically from rich guttural ~1,100 Hz to soaring ~5,800 Hz wail
    const dynamicCutoff = Math.min(6200, (p.mufflerCutoff || 1200) + (this.throttle * 1400) + (rpmFactor * 3100));
    this.setBiquadLowpass(this.bank1Lpf, dynamicCutoff, 0.82);
    this.setBiquadLowpass(this.bank2Lpf, dynamicCutoff * 1.02, 0.82);

    // Intake induction roar: deep breathing intake growl
    this.setBiquadLowpass(this.intakeLpf, 480 + (this.throttle * 850) + (rpmFactor * 700), 1.25);

    // Deep sub-chassis throb filter
    this.setBiquadLowpass(this.subLpf, 92 + (rpmFactor * 48), 0.707);
  }

  setProfile(p) {
    this.profile = Object.assign({}, this.profile, p);
    this.initCylinderArrays();
    this.updateAcousticFilters();
  }

  setState(data) {
    let needsFilterUpdate = false;
    if (data.targetRpm !== undefined && Math.abs(data.targetRpm - this.targetRpm) > 30) {
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
    this.angularVelocity = 0;
    this.currentRpm = 0;
    this.crankingStartTime = currentTime;
    this.crankingCycles = 0;
    this.hasRecoiled = false;
    this.vacuumReliefEnergy = 0;
  }

  beginShutdown() {
    this.engineState = 'STOPPING';
    this.starterEngaged = false;
    this.ignition = false;
    this.stoppingStartTime = currentTime;
    this.hasRecoiled = false;
    this.vacuumReliefEnergy = 0.55;
  }

  triggerBackfire(intensity = 0.6) {
    this.backfireEnergy = Math.min(0.9, this.backfireEnergy + (intensity * 0.45));
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
    const speedOfSound = 490.0; // m/s in hot exhaust gas

    // When engine is completely OFF and no starter, emit absolute silence (zero gain)
    if (this.engineState === 'OFF') {
      outL.fill(0);
      outR.fill(0);
      this.currentRpm = 0;
      this.angularVelocity = 0;
      return true;
    }

    // Collector pipe acoustic reflection delay in samples (primary collector ~1.15m: round trip ~4.7ms ~ 225 samples)
    const reflDelaySamples = Math.min(this.collectorLineLength - 1, Math.round((2.0 * 1.15 / speedOfSound) * this.sr));
    const secReflSamples = Math.min(this.collectorLineLength - 1, Math.round(reflDelaySamples * 1.95));
    const crossBleedSamples = Math.min(this.collectorLineLength - 1, Math.round(reflDelaySamples * 0.68));

    for (let s = 0; s < numSamples; s++) {
      // -------------------------------------------------------------
      // 1. PHYSICAL CRANKSHAFT & FLYWHEEL DYNAMICS
      // -------------------------------------------------------------
      let torqueInstantCombustion = 0;
      let torqueCompression = 0;
      let torqueStarter = 0;
      let torqueFriction = 0;
      let torqueGovernor = 0;

      // Current cycle index (integer revolutions completed)
      const currentCycleNum = Math.floor((currentTime * (this.currentRpm / 60)) / 2);

      // A. Starter Motor Torque Curve
      if (this.starterEngaged) {
        // High stall torque DC series motor tapering off at free-run speed (~360 RPM)
        if (this.currentRpm < 380) {
          torqueStarter = this.starterTorque * Math.max(0.15, 1.0 - (this.currentRpm / 380));
        } else {
          this.starterEngaged = false;
        }
      }

      // B. Individual Cylinder Compression & Expansion Counter-Torques
      // Each cylinder on its compression stroke (-180° to 0° before firing) pushes back against the crank!
      for (let c = 0; c < numCyl; c++) {
        const fireAngle = p.firingAngles[c];
        const angleDiff = (this.crankAngle - fireAngle + 720) % 720;

        // Compression stroke: 180° before firing TDC
        // Trapped gas pressure peaks sharply as piston reaches TDC
        const compPhase = (this.crankAngle - (fireAngle - 180 + 720) % 720 + 720) % 720;
        if (compPhase < 180) {
          const compX = compPhase / 180; // 0.0 at BDC, 1.0 at TDC
          // Adiabatic compression curve P ~ (V0/V)^gamma
          const compTorqueShape = Math.sin(compX * Math.PI) * Math.pow(compX, 2.8);
          torqueCompression += compTorqueShape * (p.compressionRatio * 4.6);
        }

        // Cycle-to-Cycle Flame Jitter (inputSampleNoise)
        // Check if cylinder has entered a new firing cycle: refresh jitter
        if (angleDiff < 5 && this.cylLastFiredCycle[c] !== currentCycleNum) {
          this.cylLastFiredCycle[c] = currentCycleNum;
          // Random walk flame speed & pressure variation (±5.5%)
          this.cylJitter[c] = 0.945 + Math.random() * 0.11;
          this.cylPhaseJitter[c] = (Math.random() - 0.5) * 2.2;
        }

        // Physical Combustion Torque Kick:
        // Power stroke occurs from 0° to 180° after firing angle
        // Gas pressure pushes down on piston, generating instantaneous crankshaft torque!
        if (this.ignition && (this.engineState === 'RUNNING' || this.engineState === 'STARTING')) {
          if (angleDiff < 180) {
            const powerX = angleDiff / 180;
            // Connecting rod geometry leverage: torque peaks at ~25°-35° ATDC (powerX ~ 0.15)
            const rodLeverage = Math.sin(powerX * Math.PI);
            const gasExpansion = Math.exp(-2.5 * powerX);
            const instantaneousPulse = Math.pow(rodLeverage, 1.3) * gasExpansion;

            // Combustion power scaled by manifold air charge & throttle
            const manifoldCharge = this.engineState === 'STARTING'
              ? 0.85 // Cold-start high idle air bypass
              : (0.24 + (0.76 * this.throttle));

            const cylTorque = instantaneousPulse * manifoldCharge * 195.0 * this.cylJitter[c];
            torqueInstantCombustion += cylTorque;
          }
        }
      }

      // C. Friction & Manifold Vacuum Pumping Losses
      // At closed throttle, pumping air through restricted throttle plate creates high vacuum resistance
      const vacuumPumpingLoss = (1.0 - this.throttle) * (this.angularVelocity * 0.14 + 6.0);
      torqueFriction = (this.angularVelocity * 0.38) + 8.5 + vacuumPumpingLoss;

      // D. Governor / Drivetrain Load
      if (this.ignition && this.engineState === 'RUNNING') {
        const rpmErr = this.currentRpm - this.targetRpm;
        // Smooth closed-loop virtual load keeps average RPM centered, allowing intra-cycle warble to shine!
        torqueGovernor = (rpmErr * 0.36) + (this.angularVelocity * 0.22);
      }

      // E. Net Instantaneous Flywheel Torque & Angular Velocity Integration (dω/dt)
      let netTorque = torqueStarter + torqueInstantCombustion - torqueCompression - torqueFriction - torqueGovernor;

      // Handle shutdown compression stop & piston backward recoil
      if (this.engineState === 'STOPPING') {
        netTorque = -torqueCompression - torqueFriction * 1.5;

        // When RPM drops below ~60 RPM, the final cylinder cannot crest TDC:
        // The compressed air pocket acts as a pneumatic spring, halting and recoiling backwards by ~10°!
        if (this.currentRpm < 65 && !this.hasRecoiled) {
          this.hasRecoiled = true;
          // Apply a brief backward rebound impulse
          this.angularVelocity = -4.5;
          this.triggerBackfire(0.4);
        } else if (this.hasRecoiled && Math.abs(this.angularVelocity) < 0.8) {
          // Complete dead stop!
          this.engineState = 'OFF';
          this.currentRpm = 0;
          this.angularVelocity = 0;
          this.port.postMessage({ type: 'ENGINE_OFF' });
          outL.fill(0, s);
          outR.fill(0, s);
          return true;
        }
      }

      // Calculate instantaneous angular acceleration: α = τ / I
      const angularAccel = netTorque / this.flywheelInertia;
      this.angularVelocity += angularAccel * dt;

      // Prevent negative rotation unless during shutdown recoil
      if (!this.hasRecoiled && this.angularVelocity < 0) {
        this.angularVelocity = 0;
      }

      // Calculate instantaneous RPM from angular velocity: RPM = ω * (60 / 2π)
      this.currentRpm = Math.abs(this.angularVelocity) * 9.549296;

      // Automatic State Transitions
      if (this.engineState === 'CRANKING') {
        const elapsedCrank = currentTime - this.crankingStartTime;
        // Starter bogs down to ~150 RPM at TDC and surges to ~225 RPM.
        // After ~0.75-0.9s of authentic cranking chugs, the first cylinder catches fire!
        if (elapsedCrank > 0.80 && this.currentRpm > 170 && Math.random() < 0.0006) {
          this.engineState = 'STARTING';
          this.ignition = true;
          this.starterEngaged = false;
          this.flareStartTime = currentTime;
          // First explosive combustion catch bark!
          this.angularVelocity += 35.0; // Sudden +330 RPM kick
          this.triggerBackfire(0.85);
          this.port.postMessage({ type: 'ENGINE_CATCH', rpm: Math.round(this.currentRpm) });
        }
      } else if (this.engineState === 'STARTING') {
        // Cold-start flare up to ~2,150–2,350 RPM with open air bypass, then smooth settling into idle
        const flareElapsed = currentTime - this.flareStartTime;
        if (this.currentRpm >= 2100 || flareElapsed > 0.65) {
          this.engineState = 'RUNNING';
          this.port.postMessage({ type: 'ENGINE_RUNNING', rpm: Math.round(this.currentRpm) });
        }
      }

      // Advance Crankshaft Angle: dθ = ω * dt * (180 / π)
      const degreesAdvance = this.angularVelocity * (180.0 / Math.PI) * dt;
      this.crankAngle = (this.crankAngle + degreesAdvance + 720) % 720;

      // -------------------------------------------------------------
      // 2. PROCEDURAL COMBUSTION PRESSURE PULSE SYNTHESIS
      // -------------------------------------------------------------
      let bank1RunnerSum = 0;
      let bank2RunnerSum = 0;
      let intakeRaw = 0;

      // Manifold pressure & throttle modulation
      const manifoldPressure = this.engineState === 'STARTING'
        ? 0.85
        : (0.24 + (0.76 * this.throttle));

      // Silky shift cut torque ramp
      const targetCut = this.shiftCut ? 0.30 : 1.0;
      this.shiftCutAttenuation += (targetCut - this.shiftCutAttenuation) * 0.008;

      for (let c = 0; c < numCyl; c++) {
        const fireAngle = p.firingAngles[c];
        const bank = p.exhaustBanks[c] || 0;
        const runnerLen = p.runnerLengths[c] || 0.45;
        const pulseWidth = p.pulseWidth || 124;

        // Angle elapsed since cylinder exhaust valve opening (EVO)
        const jitterOffset = this.cylPhaseJitter[c] || 0;
        const deltaAngle = (this.crankAngle - fireAngle + jitterOffset + 720) % 720;

        let cylPressure = 0;

        if (this.ignition && (this.engineState === 'RUNNING' || this.engineState === 'STARTING')) {
          // Active combustion pulse: steep pressure front, exponential blowdown
          if (deltaAngle < pulseWidth) {
            const x = deltaAngle / pulseWidth;
            // Asymmetric pressure wave: sharp leading edge + secondary gas expansion
            const pulseEnvelope = Math.pow(Math.sin(x * Math.PI), 1.45) * Math.exp(-2.6 * x);
            cylPressure = pulseEnvelope * manifoldPressure * 1.95 * this.shiftCutAttenuation * this.cylJitter[c];

            // High-velocity turbulent air noise through valve curtain
            const valveLift = Math.sin(x * Math.PI);
            cylPressure += (Math.random() - 0.5) * 0.045 * valveLift * cylPressure;
          }
        } else if (this.starterEngaged || this.engineState === 'STOPPING') {
          // Unburned air compression puff through exhaust valve during cranking & spindown
          if (deltaAngle < 85) {
            const x = deltaAngle / 85;
            cylPressure = Math.sin(x * Math.PI) * 0.38 * (this.currentRpm / 320);
          }
        }

        // Pressure Derivative Shock Wave (dP/dt):
        // In Ange Yaghi's synthesizer, dF_F_mix creates the crisp, metallic valve opening "crack"
        const dPressure = (cylPressure - this.lastCylPressure[c]) * this.sr;
        this.lastCylPressure[c] = cylPressure;

        // Combine base pressure wave with scaled derivative shock front
        const shockFront = cylPressure + (dPressure * 0.00038);

        // Write cylinder pulse into individual exhaust runner delay buffer
        const buf = this.runnerBuffers[c];
        let ptr = this.runnerWritePtrs[c];
        buf[ptr] = shockFront;

        // Compute runner delay in samples (speed of sound ~490 m/s in hot gas)
        const delaySamples = Math.min(this.maxDelay - 1, Math.round((runnerLen / speedOfSound) * this.sr));
        let readPtr = ptr - delaySamples;
        if (readPtr < 0) readPtr += this.maxDelay;

        const delayedPulse = buf[readPtr];

        // Advance write pointer
        ptr = (ptr + 1) % this.maxDelay;
        this.runnerWritePtrs[c] = ptr;

        // Sum delayed pulses into respective exhaust bank collector
        if (bank === 0) {
          bank1RunnerSum += delayedPulse;
        } else {
          bank2RunnerSum += delayedPulse;
        }

        // Intake manifold roar (occurs during intake stroke, 360° opposite)
        const intakeAngle = (this.crankAngle - ((fireAngle + 360) % 720) + 720) % 720;
        if (intakeAngle < 150 && this.throttle > 0.08) {
          const ix = intakeAngle / 150;
          intakeRaw += Math.sin(ix * Math.PI * 2.0) * Math.exp(-ix * 2.4) * this.throttle;
        }
      }

      // Starter motor electric armature whir & gear commutation ripple:
      // The pitch dynamically sags and groans with the compression dips!
      let starterWhir = 0;
      if (this.starterEngaged) {
        // Armature slot ripple: 16 commutator poles per crank rotation
        const armaturePitch = (this.crankAngle * 16.0 * Math.PI) / 180.0;
        const motorSolenoidHum = Math.sin(this.crankAngle * 4.0 * Math.PI / 180.0) * 0.15;
        starterWhir = (Math.sin(armaturePitch) * 0.26 + motorSolenoidHum) * (this.currentRpm / 220);
        bank1RunnerSum += starterWhir;
        bank2RunnerSum += starterWhir;
      }

      // Exhaust overrun burble & pop
      if (this.backfireEnergy > 0.01) {
        const popPhase = (this.crankAngle * 2.0 * Math.PI) / 180.0;
        const lowThump = Math.sin(popPhase) * 0.45;
        const subtleGas = (Math.random() * 2 - 1) * 0.05;
        const pop = (lowThump + subtleGas) * this.backfireEnergy * 0.70;
        bank1RunnerSum += pop;
        bank2RunnerSum += pop * 0.85;
        this.backfireEnergy *= this.backfireDecay;
      }

      // Shutdown vacuum relief sigh (gentle atmospheric pressure equalization)
      if (this.vacuumReliefEnergy > 0.005) {
        const hiss = (Math.random() * 2 - 1) * this.vacuumReliefEnergy * 0.08;
        bank1RunnerSum += hiss;
        bank2RunnerSum += hiss;
        this.vacuumReliefEnergy *= 0.9985;
      }

      // -------------------------------------------------------------
      // 3. EXHAUST COLLECTOR ACOUSTIC TRANSMISSION LINE (THROATINESS)
      // -------------------------------------------------------------
      // In real exhaust pipes, positive pressure waves reflect off open collector ends
      // as INVERTED negative expansion waves (R ~ -0.46), creating cavernous throatiness!

      // Read reflected waves from transmission line
      let readRefl1 = this.reflWritePtr1 - reflDelaySamples;
      if (readRefl1 < 0) readRefl1 += this.collectorLineLength;
      const primaryRefl1 = this.bank1CollectorLine[readRefl1];

      let readRefl2 = this.reflWritePtr2 - reflDelaySamples;
      if (readRefl2 < 0) readRefl2 += this.collectorLineLength;
      const primaryRefl2 = this.bank2CollectorLine[readRefl2];

      // Secondary diffuse reflection
      let readSec1 = this.reflWritePtr1 - secReflSamples;
      if (readSec1 < 0) readSec1 += this.collectorLineLength;
      const secondaryRefl1 = this.bank1CollectorLine[readSec1];

      let readSec2 = this.reflWritePtr2 - secReflSamples;
      if (readSec2 < 0) readSec2 += this.collectorLineLength;
      const secondaryRefl2 = this.bank2CollectorLine[readSec2];

      // Cross-bank balance pipe bleed (X-pipe / H-pipe scavenging)
      let readCross1 = this.reflWritePtr2 - crossBleedSamples;
      if (readCross1 < 0) readCross1 += this.collectorLineLength;
      const crossBleed1 = this.bank2CollectorLine[readCross1];

      let readCross2 = this.reflWritePtr1 - crossBleedSamples;
      if (readCross2 < 0) readCross2 += this.collectorLineLength;
      const crossBleed2 = this.bank1CollectorLine[readCross2];

      // Inverted reflection combination (-0.46 negative reflection creates comb notches & hollow throat)
      const collectorOut1 = bank1RunnerSum - (primaryRefl1 * 0.46) + (secondaryRefl1 * 0.18) + (crossBleed1 * 0.14);
      const collectorOut2 = bank2RunnerSum - (primaryRefl2 * 0.46) + (secondaryRefl2 * 0.18) + (crossBleed2 * 0.14);

      // Write forward waves into collector transmission lines
      this.bank1CollectorLine[this.reflWritePtr1] = bank1RunnerSum + (primaryRefl1 * 0.22);
      this.bank2CollectorLine[this.reflWritePtr2] = bank2RunnerSum + (primaryRefl2 * 0.22);
      this.reflWritePtr1 = (this.reflWritePtr1 + 1) % this.collectorLineLength;
      this.reflWritePtr2 = (this.reflWritePtr2 + 1) % this.collectorLineLength;

      // -------------------------------------------------------------
      // 4. ACOUSTIC RESONATORS & MUFFLER CAVITY FILTERS
      // -------------------------------------------------------------
      // 1. Pipe column resonance peaking
      const res1 = this.bank1Res.process(collectorOut1);
      const res2 = this.bank2Res.process(collectorOut2);

      // 2. Highpass metallic rasp
      const rasp1 = this.bank1ThroatHp.process(res1);
      const rasp2 = this.bank2ThroatHp.process(res2);

      // 3. Muffler expansion chamber low-pass
      const muf1 = this.bank1Lpf.process(rasp1);
      const muf2 = this.bank2Lpf.process(rasp2);

      // 4. Deep sub-bass crankshaft throb
      const subSig = this.subLpf.process((muf1 + muf2) * 0.5);

      // 5. Intake induction growl
      const intakeSig = this.intakeLpf.process(intakeRaw) * (p.intakeRoarGain || 0.65);

      // 6. Stereo mix with soft saturation
      let finalL = muf1 + (subSig * (p.subBassGain || 0.85)) + (intakeSig * 0.55);
      let finalR = muf2 + (subSig * (p.subBassGain || 0.85)) + (intakeSig * 0.55);

      // Warm analog exhaust saturation (tanh compression)
      outL[s] = Math.tanh(finalL * 1.32);
      outR[s] = Math.tanh(finalR * 1.32);
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
