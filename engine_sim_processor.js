import createEngineSim from './engine_sim.js';

/**
 * REVVER — Genuine Ange Yaghi C++ Engine-Sim AudioWorklet Processor
 * Runs the authentic compiled WebAssembly simulation core on the real-time audio thread.
 */
class EngineSimProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.Module = null;
    this.init_simulation = null;
    this.destroy_simulation = null;
    this.set_throttle = null;
    this.set_starter = null;
    this.set_ignition = null;
    this.set_clutch = null;
    this.set_gear = null;
    this.get_rpm = null;
    this.get_speed_kmh = null;
    this.render_audio_frames = null;
    this.set_target_rpm = null;

    this.outLPtr = 0;
    this.outRPtr = 0;
    this.frames = 128;
    this.isReady = false;
    this.engineState = 'OFF';
    this.currentRpm = 0;
    this.activeProfileId = 0;
    this.currentThrottle = 0.0;
    this.sampleRate = 44100;

    // Cranking timing
    this.crankStartTime = 0;

    this.port.onmessage = async (e) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'INIT_WASM') {
        await this.initWasm(data.wasmBinary, data.profileId || 0, data.sampleRate || 44100);
      } else if (data.type === 'SET_PROFILE') {
        const id = (typeof data.profileId === 'number') ? data.profileId : this.mapProfileToId(data.profile);
        this.switchProfile(id);
      } else if (data.type === 'START_ENGINE') {
        this.startEngine();
      } else if (data.type === 'STOP_ENGINE') {
        this.stopEngine();
      } else if (data.type === 'SET_STATE') {
        if (data.targetRpm !== undefined && this.set_target_rpm) {
          const strength = (this.engineState === 'RUNNING') ? 0.22 : (this.engineState === 'STARTING' ? 0.30 : 0.0);
          this.set_target_rpm(data.targetRpm, strength);
        }
        if (data.throttle !== undefined) {
          this.setThrottle(data.throttle);
        }
        if (data.gear !== undefined && this.set_gear) {
          this.set_gear(data.gear);
        }
        if (data.clutch !== undefined && this.set_clutch) {
          this.set_clutch(data.clutch);
        }
        if (data.engineState === 'STOPPING' && this.engineState !== 'STOPPING') {
          this.stopEngine();
        }
      }
    };
  }

  mapProfileToId(profile) {
    if (!profile) return 0;
    const id = (typeof profile === 'string') ? profile : (profile.id || '');
    if (id.includes('turbo') || id.includes('turboV6') || id.includes('groupB') || id.includes('turboFlat6')) return 1;
    if (id.includes('v8')) return 2;
    if (id.includes('v10')) return 3;
    return 0; // default flat6 GT3
  }

  async initWasm(wasmBinary, profileId = 0, sampleRate = 44100) {
    try {
      this.sampleRate = sampleRate;
      this.Module = await createEngineSim({ wasmBinary });
      this.init_simulation = this.Module.cwrap('init_simulation', 'number', ['number', 'number']);
      this.destroy_simulation = this.Module.cwrap('destroy_simulation', 'void', []);
      this.set_throttle = this.Module.cwrap('set_throttle', 'void', ['number']);
      this.set_starter = this.Module.cwrap('set_starter', 'void', ['number']);
      this.set_ignition = this.Module.cwrap('set_ignition', 'void', ['number']);
      this.set_clutch = this.Module.cwrap('set_clutch', 'void', ['number']);
      this.set_gear = this.Module.cwrap('set_gear', 'void', ['number']);
      this.get_rpm = this.Module.cwrap('get_rpm', 'number', []);
      this.get_speed_kmh = this.Module.cwrap('get_speed_kmh', 'number', []);
      this.render_audio_frames = this.Module.cwrap('render_audio_frames', 'number', ['number', 'number', 'number']);
      this.set_target_rpm = this.Module.cwrap('set_target_rpm', 'void', ['number', 'number']);

      const bytes = this.frames * 4;
      this.outLPtr = this.Module._malloc(bytes);
      this.outRPtr = this.Module._malloc(bytes);

      this.activeProfileId = profileId;
      this.init_simulation(profileId, sampleRate);

      // Start in OFF state
      this.set_ignition(0);
      this.set_starter(0);
      this.set_throttle(0.0);
      this.set_target_rpm(0, 0.0);

      this.isReady = true;
      this.port.postMessage({ type: 'WASM_READY' });
    } catch (err) {
      console.error('Failed to initialize engine-sim WASM in AudioWorklet:', err);
      this.port.postMessage({ type: 'WASM_ERROR', error: String(err) });
    }
  }

  switchProfile(profileId) {
    if (!this.isReady || !this.init_simulation) return;
    this.activeProfileId = profileId;
    this.init_simulation(profileId, this.sampleRate);
    if (this.engineState === 'RUNNING') {
      this.set_ignition(1);
      this.set_starter(0);
      this.setThrottle(this.currentThrottle);
    } else {
      this.set_ignition(0);
      this.set_starter(0);
      this.set_throttle(0.0);
      this.set_target_rpm(0, 0.0);
    }
  }

  startEngine() {
    if (!this.isReady) return;
    this.engineState = 'CRANKING';
    this.crankStartTime = currentTime;

    this.set_ignition(1);
    this.set_starter(1);
    this.set_throttle(0.25);
    if (this.set_target_rpm) this.set_target_rpm(280, 0.18);
    this.port.postMessage({ type: 'ENGINE_CATCH' });
  }

  stopEngine() {
    if (!this.isReady) return;
    this.engineState = 'STOPPING';
    this.set_starter(0);
    this.set_ignition(0);
    this.set_throttle(0.0);
    if (this.set_target_rpm) this.set_target_rpm(0, 0.0);
  }

  setThrottle(t) {
    this.currentThrottle = Math.max(0.0, Math.min(1.0, t));
    if (this.isReady && this.set_throttle) {
      if (this.engineState === 'RUNNING') {
        const activeThrottle = 0.05 + this.currentThrottle * 0.95;
        this.set_throttle(activeThrottle);
      } else if (this.engineState === 'CRANKING') {
        this.set_throttle(0.25);
      } else {
        this.set_throttle(0.0);
      }
    }
  }

  process(inputs, outputs, parameters) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    if (!outL) return true;

    if (!this.isReady || this.engineState === 'OFF') {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const nFrames = outL.length;

    // Physical Starter Catch Logic
    if (this.engineState === 'CRANKING') {
      const rpm = this.get_rpm();
      if (rpm > 350 && (currentTime - this.crankStartTime) > 0.35) {
        this.set_starter(0);
        this.engineState = 'RUNNING';
        this.port.postMessage({ type: 'ENGINE_RUNNING', rpm: Math.round(rpm) });
      }
    } else if (this.engineState === 'STOPPING') {
      const rpm = this.get_rpm();
      if (rpm < 40) {
        this.engineState = 'OFF';
        this.currentRpm = 0;
        this.port.postMessage({ type: 'ENGINE_OFF' });
        outL.fill(0);
        if (outR) outR.fill(0);
        return true;
      }
    }

    // Render authentic C++ acoustic frames
    this.render_audio_frames(this.outLPtr, this.outRPtr, nFrames);

    const heapF32 = this.Module.HEAPF32;
    const lOffset = this.outLPtr >> 2;
    const rOffset = this.outRPtr >> 2;

    for (let i = 0; i < nFrames; ++i) {
      outL[i] = heapF32[lOffset + i];
      if (outR) outR[i] = heapF32[rOffset + i];
    }

    // Periodic RPM notification to UI
    this.currentRpm = this.get_rpm();
    if (Math.random() < 0.12) {
      this.port.postMessage({
        type: 'RPM_UPDATE',
        rpm: Math.round(this.currentRpm),
        speedKmh: this.get_speed_kmh ? this.get_speed_kmh() : 0,
        engineState: this.engineState
      });
    }

    return true;
  }
}

registerProcessor('engine-sim-processor', EngineSimProcessor);
