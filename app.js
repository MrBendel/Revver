/**
 * REVVER — Main Application Controller & UI Renderer
 * Manages instrument cluster canvas rendering, shift lights, UI controls,
 * scenario automation, audio spectrum visualization, and CarPlay HUD mode.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Instances
  const audio = new RevverAudioEngine();
  const drivetrain = new RevverDrivetrain(audio);
  const sensors = new RevverSensorManager();

  // Engine state
  let isEngineRunning = false;
  let useMph = true;
  let activeTab = 'simulation'; // 'simulation' or 'sensors'
  let currentScenario = null;
  let scenarioTimer = 0;
  let scenarioStartTime = 0;

  // Keyboard driving state
  const keys = { gas: false, brake: false, steerLeft: false, steerRight: false };

  // DOM Elements
  const startEngineBtn = document.getElementById('start-engine-btn');
  const ignitionLabel = document.getElementById('ignition-label');
  const carplayToggleBtn = document.getElementById('carplay-toggle-btn');
  const carplayModal = document.getElementById('carplay-modal');
  const hudCloseBtn = document.getElementById('hud-close-btn');

  // Gauges & HUD
  const tachoCanvas = document.getElementById('tachometer-canvas');
  const tachoCtx = tachoCanvas.getContext('2d');
  const chronoCanvas = document.getElementById('chrono-canvas');
  const chronoCtx = chronoCanvas ? chronoCanvas.getContext('2d') : null;
  const spectrumCanvas = document.getElementById('spectrum-canvas');
  const spectrumCtx = spectrumCanvas.getContext('2d');

  // Porsche Auxiliary Telemetry State
  let engineOilTemp = 20.0;    // °C (rises smoothly to ~92°C when running)
  let engineOilPressure = 0.0; // BAR (1.5 idle to 4.8 high-rpm)
  let odometerMiles = 91193.4; // Classic Porsche 911/993 homage
  let isChronoRunning = false;
  let chronoElapsedSec = 0;

  const sportChronoHousing = document.getElementById('sport-chrono-housing');
  if (sportChronoHousing) {
    sportChronoHousing.addEventListener('click', () => {
      isChronoRunning = !isChronoRunning;
    });
  }

  const hudGear = document.getElementById('hud-gear');
  const hudShiftMode = document.getElementById('hud-shift-mode');
  const hudSpeed = document.getElementById('hud-speed');
  const hudRpmVal = document.getElementById('hud-rpm-val');
  const speedUnitBtn = document.getElementById('speed-unit-btn');
  const revLimiterBadge = document.getElementById('rev-limiter-badge');
  const shiftCutBadge = document.getElementById('shift-cut-badge');

  // Cluster Display Mode: 'pure' (Tachometer & Digital Speedometer) vs 'heritage' (5-Pod Classic)
  let clusterDisplayMode = 'pure';
  const toggleClusterModeBtn = document.getElementById('toggle-cluster-mode-btn');
  const clusterModeLabel = document.getElementById('cluster-mode-label');
  const clusterContainer = document.querySelector('.cluster-gauge-container');
  const clusterLcdMatrix = document.getElementById('cluster-lcd-matrix');

  function setClusterDisplayMode(mode) {
    clusterDisplayMode = mode;
    if (toggleClusterModeBtn) {
      toggleClusterModeBtn.classList.toggle('active', mode === 'pure');
    }
    if (clusterModeLabel) {
      clusterModeLabel.textContent = mode === 'pure' ? 'PURE TACH & DIGITAL SPEED' : '5-GAUGE HERITAGE';
    }
    if (clusterContainer) {
      clusterContainer.classList.toggle('pure-mode', mode === 'pure');
    }
    if (clusterLcdMatrix) {
      clusterLcdMatrix.classList.toggle('pure-display-hud', mode === 'pure');
    }
  }

  if (toggleClusterModeBtn) {
    toggleClusterModeBtn.addEventListener('click', () => {
      setClusterDisplayMode(clusterDisplayMode === 'pure' ? 'heritage' : 'pure');
    });
  }

  // Telemetry indicators
  const gMeterFill = document.getElementById('g-meter-fill');
  const gForceVal = document.getElementById('g-force-val');
  const throttleBarFill = document.getElementById('throttle-bar-fill');
  const throttlePctText = document.getElementById('throttle-pct-text');
  const boostValText = document.getElementById('boost-val-text');
  const shiftLights = document.querySelectorAll('.shift-light');

  // Status pills
  const audioDot = document.getElementById('audio-dot');
  const audioStatusText = document.getElementById('audio-status-text');
  const sensorDot = document.getElementById('sensor-dot');
  const sensorStatusText = document.getElementById('sensor-status-text');
  const gpsDot = document.getElementById('gps-dot');
  const gpsStatusText = document.getElementById('gps-status-text');

  // Sidebar Controls
  const engineSelect = document.getElementById('engine-select');
  const chipCylinders = document.getElementById('chip-cylinders');
  const chipRedline = document.getElementById('chip-redline');
  const chipAspiration = document.getElementById('chip-aspiration');
  const engineCountBadge = document.getElementById('engine-count-badge');
  const sportModeSlider = document.getElementById('sport-mode-slider');
  const sportCurveVal = document.getElementById('sport-curve-val');
  const engineSelectorContainer = document.getElementById('engine-selector-container');
  const gearboxBtns = document.querySelectorAll('.gearbox-btn');
  const driveModeBtns = document.querySelectorAll('.drive-mode-btn');
  const masterVolumeSlider = document.getElementById('master-volume');
  const bassBoostSlider = document.getElementById('bass-boost');
  const pitchScaleSlider = document.getElementById('pitch-scale');
  const exhaustPopsSlider = document.getElementById('exhaust-pops');
  const turboSpoolSlider = document.getElementById('turbo-spool');
  const customWavInput = document.getElementById('custom-wav-input');

  // Virtual Rig Controls
  const simPedalSlider = document.getElementById('sim-pedal-slider');
  const pedalFacePlate = document.getElementById('pedal-face-plate');
  const simGasBtn = document.getElementById('sim-gas-btn');
  const simBrakeBtn = document.getElementById('sim-brake-btn');
  const paddleUpBtn = document.getElementById('paddle-up-btn');
  const paddleDownBtn = document.getElementById('paddle-down-btn');
  const toggleManualModeBtn = document.getElementById('toggle-manual-mode-btn');
  const shifterModeIndicator = document.getElementById('shifter-mode-indicator');
  const scenarioBtns = document.querySelectorAll('.scenario-btn');

  // Sensor controls
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const enableSensorsBtn = document.getElementById('enable-sensors-btn');
  const calibrateMountBtn = document.getElementById('calibrate-mount-btn');
  const sensorAxVal = document.getElementById('sensor-ax-val');
  const sensorAyVal = document.getElementById('sensor-ay-val');
  const sensorGpsSpeed = document.getElementById('sensor-gps-speed');
  const sensorGpsAcc = document.getElementById('sensor-gps-acc');
  const accelSensitivity = document.getElementById('accel-sensitivity');
  const regenBrakeThreshold = document.getElementById('regen-brake-threshold');

  // Tire Acoustics & Lateral Scrub DOM Elements
  const tireAudioToggle = document.getElementById('tire-audio-toggle');
  const tireToggleText = document.getElementById('tire-toggle-text');
  const tireStatusBadge = document.getElementById('tire-status-badge');
  const tireCompoundBtns = document.querySelectorAll('.compound-btn');
  const tireScreechVolSlider = document.getElementById('tire-screech-vol');
  const tireScreechValText = document.getElementById('tire-screech-val');
  const tireGripThresholdSlider = document.getElementById('tire-grip-threshold');
  const tireThresholdValText = document.getElementById('tire-threshold-val');
  const customSkidInput = document.getElementById('custom-skid-input');

  // G-Force 2-Axis Friction Radar & Telemetry
  const gRadarCanvas = document.getElementById('g-radar-canvas');
  const gRadarCtx = gRadarCanvas ? gRadarCanvas.getContext('2d') : null;
  const gLateralVal = document.getElementById('g-lateral-val');
  const tireStateVal = document.getElementById('tire-state-val');

  // Steering Rig Controls
  const simSteeringSlider = document.getElementById('sim-steering-slider');
  const steeringAngleText = document.getElementById('steering-angle-text');
  const steeringGPreview = document.getElementById('steering-g-preview');
  const steerLeftBtn = document.getElementById('steer-left-btn');
  const steerRightBtn = document.getElementById('steer-right-btn');
  const steerCenterBtn = document.getElementById('steer-center-btn');

  // CarPlay HUD elements
  const hudModalGear = document.getElementById('hud-modal-gear');
  const hudModalSpeed = document.getElementById('hud-modal-speed');
  const hudModalUnit = document.getElementById('hud-modal-unit');
  const hudModalRpmBar = document.getElementById('hud-modal-rpm-bar');
  const hudModalRpmText = document.getElementById('hud-modal-rpm-text');
  const hudModalLoadBar = document.getElementById('hud-modal-load-bar');
  const hudModalLoadPct = document.getElementById('hud-modal-load-pct');
  const hudModalEngineName = document.getElementById('hud-modal-engine-name');
  const hudModalSoundInfo = document.getElementById('hud-modal-sound-info');
  const hudModalTransmissionText = document.getElementById('hud-modal-transmission-text');
  const hudPaddleDown = document.getElementById('hud-paddle-down');
  const hudPaddleUp = document.getElementById('hud-paddle-up');

  // Spectrum data buffer
  const spectrumArray = new Uint8Array(64);

  /* -------------------------------------------------------------
     1. Populate Engine Models List
     ------------------------------------------------------------- */
  function renderEngineList() {
    if (engineSelect) {
      engineSelect.innerHTML = '';
      Object.values(audio.profiles).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.redlineRpm.toLocaleString()} RPM)`;
        if (p.id === audio.activeProfile.id) opt.selected = true;
        engineSelect.appendChild(opt);
      });

      engineSelect.onchange = () => {
        const p = audio.profiles[engineSelect.value];
        if (p) {
          audio.applyProfile(p);
          drivetrain.setEngineLimits(p.idleRpm, p.redlineRpm);
          updateEngineChips(p);
          updateHudEngineInfo(p);
        }
      };
      updateEngineChips(audio.activeProfile);
    }

    if (engineSelectorContainer) {
      engineSelectorContainer.innerHTML = '';
      Object.values(audio.profiles).forEach(p => {
        const card = document.createElement('div');
        card.className = `engine-card ${p.id === audio.activeProfile.id ? 'active' : ''}`;
        card.dataset.id = p.id;
        card.innerHTML = `
          <div class="engine-card-left">
            <span class="engine-card-name">${p.name}</span>
            <span class="engine-card-spec">${p.cylinders} Cyl • ${p.redlineRpm.toLocaleString()} RPM Redline</span>
          </div>
          <span class="engine-card-tag">${p.turbo ? 'TURBO' : 'N/A'}</span>
        `;
        card.addEventListener('click', () => {
          document.querySelectorAll('.engine-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          audio.applyProfile(p);
          drivetrain.setEngineLimits(p.idleRpm, p.redlineRpm);
          if (engineSelect) engineSelect.value = p.id;
          updateEngineChips(p);
          updateHudEngineInfo(p);
        });
        engineSelectorContainer.appendChild(card);
      });
    }

    drivetrain.setEngineLimits(audio.activeProfile.idleRpm, audio.activeProfile.redlineRpm);
    updateHudEngineInfo(audio.activeProfile);
  }

  function updateEngineChips(p) {
    if (chipCylinders) chipCylinders.textContent = `${p.cylinders}-Cyl ${p.cylinders === 6 ? 'Boxer' : (p.cylinders === 8 ? 'V8' : (p.cylinders === 10 ? 'V10' : 'Inline-5'))}`;
    if (chipRedline) chipRedline.textContent = `${p.redlineRpm.toLocaleString()} RPM Redline`;
    if (chipAspiration) chipAspiration.textContent = p.turbo ? 'Twin-Turbocharged' : 'Naturally Aspirated';
    if (engineCountBadge) engineCountBadge.textContent = `${p.cylinders} CYL`;
  }

  function updateHudEngineInfo(p) {
    hudModalEngineName.textContent = p.name;
    hudModalSoundInfo.textContent = `${p.cylinders} Cylinders • Redline: ${p.redlineRpm.toLocaleString()} RPM • ${p.desc}`;
  }

  /* -------------------------------------------------------------
     2. Ignition & Engine Start Sequence
     ------------------------------------------------------------- */
  let isIgnitionTransitioning = false;

  async function toggleEngine() {
    if (isIgnitionTransitioning) return;

    if (!isEngineRunning) {
      isIgnitionTransitioning = true;
      await audio.init();

      ignitionLabel.textContent = 'CRANKING...';
      startEngineBtn.classList.add('active');
      audioDot.className = 'status-dot warning';
      audioStatusText.textContent = 'Starter Cranking';

      audio.startEngineSequence({
        onProgress: (info) => {
          drivetrain.currentRpm = info.rpm;
          if (info.state === 'STARTING') {
            ignitionLabel.textContent = 'CATCH & FLARE!';
            audioDot.className = 'status-dot active';
            audioStatusText.textContent = 'Ignition Catching';
          }
        },
        onComplete: () => {
          isEngineRunning = true;
          isIgnitionTransitioning = false;
          ignitionLabel.textContent = 'STOP ENGINE';
          audioDot.className = 'status-dot active';
          audioStatusText.textContent = 'Audio: Active';
          drivetrain.currentRpm = drivetrain.idleRpm;
        }
      });
    } else {
      isIgnitionTransitioning = true;
      ignitionLabel.textContent = 'SHUTTING DOWN...';
      audioDot.className = 'status-dot warning';
      audioStatusText.textContent = 'Engine Shutdown';

      audio.stopEngineSequence({
        onProgress: (info) => {
          drivetrain.currentRpm = info.rpm;
        },
        onComplete: () => {
          isEngineRunning = false;
          isIgnitionTransitioning = false;
          startEngineBtn.classList.remove('active');
          ignitionLabel.textContent = 'START ENGINE';
          audioDot.className = 'status-dot warning';
          audioStatusText.textContent = 'Audio: Off';
          drivetrain.currentRpm = 0;
          drivetrain.speedMps = 0;
          drivetrain.speedMph = 0;
          drivetrain.speedKmh = 0;
          drivetrain.throttle = 0;
          drivetrain.gForceLongitudinal = 0;
        }
      });
    }
  }

  startEngineBtn.addEventListener('click', toggleEngine);

  /* -------------------------------------------------------------
     3. Transmission & Sport Mode Redline Shift Curve
     ------------------------------------------------------------- */
  if (sportModeSlider) {
    sportModeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      drivetrain.setSportModeAggression(val);
      let label = 'Sport (60%)';
      if (val < 0.35) {
        label = `Comfort (${Math.round(val * 100)}%)`;
      } else if (val < 0.75) {
        label = `Sport Dynamic (${Math.round(val * 100)}%)`;
      } else {
        label = `Redline Screamer (${Math.round(val * 100)}%)`;
      }
      if (sportCurveVal) sportCurveVal.textContent = label;
      updateShiftModeLabel();
    });
  }

  if (gearboxBtns) {
    gearboxBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        gearboxBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const gbId = btn.dataset.gearbox;
        drivetrain.setGearbox(gbId);
        if (hudModalTransmissionText) hudModalTransmissionText.textContent = drivetrain.activeGearbox.name.toUpperCase();
      });
    });
  }

  if (driveModeBtns) {
    driveModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        driveModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        drivetrain.setDriveMode(mode);
        if (sportModeSlider) sportModeSlider.value = Math.round(drivetrain.sportModeAggression * 100);
        updateShiftModeLabel();
      });
    });
  }

  function updateShiftModeLabel() {
    if (drivetrain.isManualMode) {
      if (hudShiftMode) hudShiftMode.textContent = 'MANUAL 6-SPEED';
      if (shifterModeIndicator) shifterModeIndicator.textContent = 'MANUAL PADDLES (6-SPD)';
    } else {
      const pct = Math.round(drivetrain.sportModeAggression * 100);
      let modeStr = 'SPORT';
      if (pct < 35) modeStr = 'COMFORT';
      else if (pct >= 75) modeStr = 'REDLINE';
      if (hudShiftMode) hudShiftMode.textContent = `PDK 6-SPD • ${modeStr} (${pct}%)`;
      if (shifterModeIndicator) shifterModeIndicator.textContent = `AUTO 6-SPD (${modeStr})`;
    }
  }

  /* -------------------------------------------------------------
     4. Sound Tuning Sliders
     ------------------------------------------------------------- */
  if (masterVolumeSlider) {
    masterVolumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const el = document.getElementById('volume-val');
      if (el) el.textContent = `${val}%`;
      audio.setMasterVolume(val / 100);
    });
  }

  if (bassBoostSlider) {
    bassBoostSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const el = document.getElementById('bass-val');
      if (el) el.textContent = val > 100 ? 'Extreme Thump' : val > 60 ? `Thumping (${val}%)` : `Subtle (${val}%)`;
      audio.setBassBoost(val / 100);
    });
  }

  if (pitchScaleSlider) {
    pitchScaleSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      const el = document.getElementById('pitch-val');
      if (el) el.textContent = val < 0.8 ? `Ultra Deep (${val.toFixed(2)}x)` : val <= 1.0 ? `Deep (${val.toFixed(2)}x)` : `Higher (${val.toFixed(2)}x)`;
      audio.activeProfile.sampleRpm = (audio.activeProfile.sampleRpm || 3200) * (1 / val);
      audio.activeProfile.pitchScale = 0.50 * val;
    });
  }

  if (exhaustPopsSlider) {
    exhaustPopsSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const el = document.getElementById('pops-val');
      if (el) el.textContent = val > 65 ? 'High' : val > 30 ? 'Medium' : 'Subtle';
      audio.tuning.exhaustPops = val;
    });
  }

  if (turboSpoolSlider) {
    turboSpoolSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const el = document.getElementById('turbo-val');
      if (el) el.textContent = `${val}%`;
      audio.tuning.turboSpool = val / 100;
    });
  }

  // Custom Game WAV loader (TORCS / Speed Dreams / Assetto Corsa format)
  if (customWavInput) {
    customWavInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const profile = await audio.loadCustomWav(file, 3500);
      drivetrain.setEngineLimits(profile.idleRpm, profile.redlineRpm);
      renderEngineList();
      alert(`Game audio sample "${file.name}" loaded successfully!\nUsing Speed Dreams / TORCS pitch-shift engine.`);
    } catch (err) {
      console.error('Error loading custom audio file:', err);
      alert('Could not decode audio file. Please ensure it is a valid .wav or .ogg loop.');
    }
  });
  }

  // Tire Acoustics Controls Event Listeners
  if (tireAudioToggle) {
    tireAudioToggle.addEventListener('change', (e) => {
      const active = e.target.checked;
      audio.setTireAcousticsEnabled(active);
      drivetrain.tireAcousticsEnabled = active;
      tireToggleText.textContent = `Tire Screech Simulation: ${active ? 'ON' : 'OFF'}`;
      tireStatusBadge.textContent = active ? 'ACTIVE' : 'MUTED';
      tireStatusBadge.style.color = active ? 'var(--porsche-gold)' : '#727988';
    });
  }

  tireCompoundBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tireCompoundBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const comp = btn.dataset.compound;
      audio.setTireCompound(comp);
      drivetrain.tireCompound = comp;
    });
  });

  if (tireScreechVolSlider) {
    tireScreechVolSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      audio.setTireScreechVolume(val);
      drivetrain.tireScreechVolume = val / 100;
      tireScreechValText.textContent = val === 0 ? 'Silent (0%)' : val > 65 ? `Loud (${val}%)` : `Subtle (${val}%)`;
    });
  }

  if (tireGripThresholdSlider) {
    tireGripThresholdSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      audio.setTireGripThreshold(val);
      drivetrain.tireGripThreshold = val;
      tireThresholdValText.textContent = `${val.toFixed(2)} G`;
    });
  }

  // Custom Tire Skid WAV loader (TORCS / VDrift / Speed Dreams sample format)
  if (customSkidInput) {
    customSkidInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await audio.loadCustomSkidWav(file);
        alert(`Custom tire skid sample "${file.name}" loaded successfully!\nUsing authentic recorded tire acoustic loop.`);
      } catch (err) {
        console.error('Error loading custom tire skid file:', err);
        alert('Could not decode audio file. Please ensure it is a valid .wav, .ogg, or .mp3 tire skid audio file.');
      }
    });
  }

  // Steering Controls
  function updateSteeringUI(valPct) {
    // valPct: -1.0 to +1.0
    const deg = Math.round(valPct * 35);
    if (simSteeringSlider) simSteeringSlider.value = Math.round(valPct * 100);
    if (steeringAngleText) {
      if (Math.abs(deg) < 2) {
        steeringAngleText.textContent = 'CENTER 0°';
      } else {
        steeringAngleText.textContent = `${Math.abs(deg)}° ${deg < 0 ? 'LEFT' : 'RIGHT'}`;
      }
    }
    if (steeringGPreview) {
      const estG = (Math.pow(Math.min(50, drivetrain.speedMps || 20), 1.25) * valPct * 0.24) / 9.81;
      steeringGPreview.textContent = `${estG >= 0 ? '+' : ''}${estG.toFixed(2)} G LAT`;
    }
  }

  if (simSteeringSlider) {
    simSteeringSlider.addEventListener('input', (e) => {
      currentScenario = null;
      updateSteeringUI(parseInt(e.target.value) / 100);
    });
  }

  if (steerLeftBtn) {
    steerLeftBtn.addEventListener('mousedown', () => { keys.steerLeft = true; currentScenario = null; updateSteeringUI(-0.75); });
    steerLeftBtn.addEventListener('mouseup', () => { keys.steerLeft = false; updateSteeringUI(0); });
    steerLeftBtn.addEventListener('mouseleave', () => { keys.steerLeft = false; updateSteeringUI(0); });
  }

  if (steerRightBtn) {
    steerRightBtn.addEventListener('mousedown', () => { keys.steerRight = true; currentScenario = null; updateSteeringUI(0.75); });
    steerRightBtn.addEventListener('mouseup', () => { keys.steerRight = false; updateSteeringUI(0); });
    steerRightBtn.addEventListener('mouseleave', () => { keys.steerRight = false; updateSteeringUI(0); });
  }

  if (steerCenterBtn) {
    steerCenterBtn.addEventListener('click', () => {
      keys.steerLeft = false;
      keys.steerRight = false;
      if (simSteeringSlider) simSteeringSlider.value = 0;
      updateSteeringUI(0);
    });
  }

  /* -------------------------------------------------------------
     5. Tabs & Sensor Controls
     ------------------------------------------------------------- */
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(`content-${tabId}`).classList.add('active');
      activeTab = tabId;
    });
  });

  if (enableSensorsBtn) {
    enableSensorsBtn.addEventListener('click', async () => {
      await sensors.requestSensors();
      if (sensorDot) sensorDot.className = 'status-dot active';
      if (sensorStatusText) sensorStatusText.textContent = 'IMU: Connected (60Hz)';
      if (gpsDot) gpsDot.className = 'status-dot active';
      if (gpsStatusText) gpsStatusText.textContent = 'GPS: Active';
      enableSensorsBtn.innerHTML = `<span>✓ SENSORS CONNECTED</span>`;
    });
  }

  if (calibrateMountBtn) {
    calibrateMountBtn.addEventListener('click', () => {
      const cal = sensors.calibrateMountOrientation();
      alert(`Mount orientation calibrated!\nGravity offsets: X=${cal.x}, Y=${cal.y}, Z=${cal.z}\nReady for drive acceleration.`);
    });
  }

  if (accelSensitivity) {
    accelSensitivity.addEventListener('input', (e) => {
      const factor = parseInt(e.target.value) / 100;
      sensors.sensitivity = factor;
      const el = document.getElementById('sens-val');
      if (el) el.textContent = `${factor.toFixed(1)}x`;
    });
  }

  if (regenBrakeThreshold) {
    regenBrakeThreshold.addEventListener('input', (e) => {
      const g = -parseInt(e.target.value) / 100;
      sensors.regenThresholdG = g;
      const el = document.getElementById('regen-val');
      if (el) el.textContent = `${g.toFixed(2)} G`;
    });
  }

  /* -------------------------------------------------------------
     6. Driving Inputs: Virtual Pedal & Keyboard
     ------------------------------------------------------------- */
  if (simPedalSlider) {
    simPedalSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      updatePedalPosition(val);
    });
  }

  function updatePedalPosition(pct) {
    if (simPedalSlider) simPedalSlider.value = pct;
    if (pedalFacePlate) pedalFacePlate.style.transform = `translateY(${-pct * 0.75}px)`;
    if (simGasBtn) {
      if (pct > 5) simGasBtn.classList.add('pressed');
      else simGasBtn.classList.remove('pressed');
    }
  }

  // Keyboard W/S or Arrow Up/Down
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp' || e.key === ' ') {
      keys.gas = true;
      currentScenario = null;
      if (simGasBtn) simGasBtn.classList.add('pressed');
      if (!isEngineRunning) toggleEngine();
    }
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      keys.brake = true;
      currentScenario = null;
      if (simBrakeBtn) simBrakeBtn.classList.add('pressed');
    }
    if (e.key === 'a' || e.key === 'A') {
      keys.steerLeft = true;
      currentScenario = null;
      updateSteeringUI(-0.75);
      if (steerLeftBtn) steerLeftBtn.classList.add('active');
    }
    if (e.key === 'd' || e.key === 'D') {
      keys.steerRight = true;
      currentScenario = null;
      updateSteeringUI(0.75);
      if (steerRightBtn) steerRightBtn.classList.add('active');
    }
    if (e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') {
      drivetrain.manualShiftUp();
    }
    if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
      drivetrain.manualShiftDown();
    }
    if (e.key === ' ') {
      // Space for exhaust crackle / blip
      audio.triggerExhaustPop();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp' || e.key === ' ') {
      keys.gas = false;
      if (simGasBtn) simGasBtn.classList.remove('pressed');
    }
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      keys.brake = false;
      if (simBrakeBtn) simBrakeBtn.classList.remove('pressed');
    }
    if (e.key === 'a' || e.key === 'A') {
      keys.steerLeft = false;
      updateSteeringUI(keys.steerRight ? 0.75 : 0);
      if (steerLeftBtn) steerLeftBtn.classList.remove('active');
    }
    if (e.key === 'd' || e.key === 'D') {
      keys.steerRight = false;
      updateSteeringUI(keys.steerLeft ? -0.75 : 0);
      if (steerRightBtn) steerRightBtn.classList.remove('active');
    }
  });

  // Driver Controls: Tactile Gas Pedal Button & Brake Button
  if (simGasBtn) {
    const pressGas = (e) => {
      if (e && e.cancelable) e.preventDefault();
      keys.gas = true;
      simGasBtn.classList.add('pressed');
      if (!isEngineRunning) toggleEngine();
    };
    const releaseGas = (e) => {
      if (e && e.cancelable) e.preventDefault();
      keys.gas = false;
      simGasBtn.classList.remove('pressed');
    };

    simGasBtn.addEventListener('mousedown', pressGas);
    simGasBtn.addEventListener('mouseup', releaseGas);
    simGasBtn.addEventListener('mouseleave', releaseGas);
    simGasBtn.addEventListener('touchstart', pressGas, { passive: false });
    simGasBtn.addEventListener('touchend', releaseGas, { passive: false });
    simGasBtn.addEventListener('touchcancel', releaseGas);
  }

  if (simBrakeBtn) {
    const pressBrake = (e) => {
      if (e && e.cancelable) e.preventDefault();
      keys.brake = true;
      simBrakeBtn.classList.add('pressed');
    };
    const releaseBrake = (e) => {
      if (e && e.cancelable) e.preventDefault();
      keys.brake = false;
      simBrakeBtn.classList.remove('pressed');
    };

    simBrakeBtn.addEventListener('mousedown', pressBrake);
    simBrakeBtn.addEventListener('mouseup', releaseBrake);
    simBrakeBtn.addEventListener('mouseleave', releaseBrake);
    simBrakeBtn.addEventListener('touchstart', pressBrake, { passive: false });
    simBrakeBtn.addEventListener('touchend', releaseBrake, { passive: false });
    simBrakeBtn.addEventListener('touchcancel', releaseBrake);
  }

  // Paddle shifters
  if (paddleUpBtn) paddleUpBtn.addEventListener('click', () => drivetrain.manualShiftUp());
  if (paddleDownBtn) paddleDownBtn.addEventListener('click', () => drivetrain.manualShiftDown());
  if (hudPaddleUp) hudPaddleUp.addEventListener('click', () => drivetrain.manualShiftUp());
  if (hudPaddleDown) hudPaddleDown.addEventListener('click', () => drivetrain.manualShiftDown());

  if (toggleManualModeBtn) {
    toggleManualModeBtn.addEventListener('click', () => {
      drivetrain.toggleManualMode();
      updateShiftModeLabel();
      toggleManualModeBtn.textContent = drivetrain.isManualMode ? 'Switch to Auto' : 'Switch to Manual';
    });
  }

  // MPH / KMH toggle
  if (speedUnitBtn) {
    speedUnitBtn.addEventListener('click', () => {
      useMph = !useMph;
      speedUnitBtn.textContent = useMph ? 'MPH' : 'KM/H';
      if (hudModalUnit) hudModalUnit.textContent = useMph ? 'MPH' : 'KM/H';
    });
  }

  /* -------------------------------------------------------------
     7. Automated Drive Scenarios
     ------------------------------------------------------------- */
  scenarioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      scenarioBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sc = btn.dataset.scenario;
      startScenario(sc);
    });
  });

  function startScenario(name) {
    if (!isEngineRunning) toggleEngine();
    currentScenario = name;
    scenarioStartTime = performance.now();

    // Auto-align drive mode with scenario intention
    if (name === 'drag') {
      drivetrain.setDriveMode('track');
      driveModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'track'));
      updateShiftModeLabel();
    } else if (name === 'canyon') {
      drivetrain.setDriveMode('sport');
      driveModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'sport'));
      updateShiftModeLabel();
    } else if (name === 'city') {
      drivetrain.setDriveMode('city');
      driveModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'city'));
      updateShiftModeLabel();
    }
  }

  function handleScenarioUpdate(now) {
    if (!currentScenario) return { gas: 0, brake: 0 };

    const elapsed = (now - scenarioStartTime) / 1000; // seconds

    if (currentScenario === 'city') {
      // Realistic Around-Town City Driving (0 to 45 MPH)
      // Gentle pedal (20-26% throttle) shifting realistically at low RPM:
      // 1st -> 2nd at ~12 mph (~2,150 RPM)
      // 2nd -> 3rd at ~20 mph (~2,250 RPM)
      // 3rd -> 4th at ~30 mph (~2,350 RPM)
      // 4th -> 5th at ~40 mph (~2,400 RPM)
      // Cruises in 5th gear at 45 mph (~2,200 RPM), then smoothly decelerates to a stop
      if (elapsed < 2.0) {
        return { gas: 0.22, brake: 0 };
      } else if (elapsed < 5.0) {
        return { gas: 0.24, brake: 0 };
      } else if (elapsed < 8.5) {
        return { gas: 0.25, brake: 0 };
      } else if (elapsed < 12.0) {
        return { gas: 0.26, brake: 0 };
      } else if (elapsed < 15.5) {
        // Cruising through town
        return { gas: 0.12, brake: 0 };
      } else if (elapsed < 19.5) {
        // Approaching stoplight: gentle smooth deceleration
        return { gas: 0, brake: 0.35 };
      } else {
        currentScenario = null;
        document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
        return { gas: 0, brake: 0 };
      }
    } else if (currentScenario === 'drag') {
      // 0-60 MPH launch
      if (elapsed < 0.8) {
        // Build revs at launch line
        return { gas: 0.8, brake: 1.0 };
      } else if (elapsed < 6.5) {
        // Full throttle pull through gears
        return { gas: 1.0, brake: 0 };
      } else if (elapsed < 9.0) {
        // Off throttle overrun burble
        return { gas: 0, brake: 0 };
      } else if (elapsed < 12.0) {
        // Smooth stop
        return { gas: 0, brake: 0.6 };
      } else {
        currentScenario = null;
        document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
        return { gas: 0, brake: 0 };
      }
    } else if (currentScenario === 'highway') {
      // Highway Cruise & Pass:
      // Accelerates to 60 mph (in 6th/7th gear!), then kicks down 2 gears to pass!
      if (elapsed < 3.5) {
        return { gas: 0.35, brake: 0 };
      } else if (elapsed < 6.5) {
        // Steady 60 MPH cruise in 7th gear at quiet ~2,060 RPM
        return { gas: 0.15, brake: 0 };
      } else if (elapsed < 9.5) {
        // Kick-down passing burst!
        return { gas: 0.85, brake: 0 };
      } else if (elapsed < 12.5) {
        return { gas: 0.12, brake: 0 };
      } else {
        currentScenario = null;
        document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
        return { gas: 0, brake: 0 };
      }
    } else if (currentScenario === 'canyon') {
      // Black Forest Canyon Carving: Spirited acceleration, sweeping hairpins & subtle tire screech
      const cycle = elapsed % 11;
      if (cycle < 3.2) {
        // Full throttle blast up to ~65 mph
        return { gas: 0.95, brake: 0, steer: 0 };
      } else if (cycle < 4.8) {
        // Trail braking on entry to left hairpin
        return { gas: 0, brake: 0.75, steer: -0.35 };
      } else if (cycle < 7.2) {
        // Hard left hairpin carve: ~0.78G lateral G & authentic tire screech!
        return { gas: 0.48, brake: 0, steer: -0.85 };
      } else if (cycle < 8.6) {
        // Transition flick into right curve: opposite tire scrub!
        return { gas: 0.65, brake: 0, steer: 0.75 };
      } else {
        // Straightening out and preparing next mountain switchback
        return { gas: 0.85, brake: 0, steer: 0.15 };
      }
    } else if (currentScenario === 'idle') {
      // Neutral revs
      drivetrain.speedMps = 0;
      const blip = Math.sin(elapsed * 3.5);
      const gas = blip > 0.3 ? 0.75 : 0;
      if (elapsed > 8.0) {
        currentScenario = null;
        document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
      }
      return { gas, brake: 0 };
    }

    return { gas: 0, brake: 0 };
  }

  /* -------------------------------------------------------------
     8. CarPlay / Fullscreen Car Display Modal
     ------------------------------------------------------------- */
  carplayToggleBtn.addEventListener('click', () => {
    carplayModal.classList.add('active');
  });

  hudCloseBtn.addEventListener('click', () => {
    carplayModal.classList.remove('active');
  });

  /* -------------------------------------------------------------
     9. Shift Indicators & Callbacks
     ------------------------------------------------------------- */
  drivetrain.onShiftCallback = (gear, isDownshift) => {
    hudGear.style.transform = 'scale(1.35)';
    hudModalGear.style.transform = 'scale(1.25)';
    setTimeout(() => {
      hudGear.style.transform = 'scale(1.0)';
      hudModalGear.style.transform = 'scale(1.0)';
    }, 150);

    shiftCutBadge.classList.add('active');
    setTimeout(() => {
      shiftCutBadge.classList.remove('active');
    }, drivetrain.activeGearbox.shiftTimeMs);
  };

  drivetrain.onRevLimitCallback = () => {
    revLimiterBadge.classList.add('active');
    setTimeout(() => {
      revLimiterBadge.classList.remove('active');
    }, 80);
  };

  /* -------------------------------------------------------------
     10. Main Animation & Physics Frame Loop
     ------------------------------------------------------------- */
  let lastFrameTime = performance.now();

  function loop(now) {
    requestAnimationFrame(loop);

    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    // Determine Throttle, Brake, and Steering from active input source
    let throttleIn = 0;
    let brakeIn = 0;
    let steerIn = 0;
    let gpsSpeedIn = null;
    let externalLateralG = null;

    if (activeTab === 'sensors' && sensors.isActive) {
      throttleIn = sensors.estimatedThrottle;
      brakeIn = sensors.estimatedBrake;
      externalLateralG = sensors.lateralG;
      if (sensors.hasGpsAccess && sensors.gpsSpeedMps > 0.5) {
        gpsSpeedIn = sensors.gpsSpeedMps;
      }
      // Update sensor telemetry UI
      sensorAxVal.textContent = `${sensors.longitudinalAccelMps2.toFixed(2)} m/s²`;
      sensorAyVal.textContent = `${sensors.rawAy.toFixed(2)} m/s²`;
      sensorGpsSpeed.textContent = `${(sensors.gpsSpeedMps * 2.23694).toFixed(1)} mph`;
      sensorGpsAcc.textContent = `±${sensors.gpsAccuracyMeters.toFixed(1)} m`;
    } else {
      // Virtual Rig or Scenarios
      const scInputs = handleScenarioUpdate(now);
      if (currentScenario) {
        throttleIn = scInputs.gas;
        brakeIn = scInputs.brake;
        steerIn = scInputs.steer || 0;
        updatePedalPosition(Math.round(throttleIn * 100));
        updateSteeringUI(steerIn);
      } else {
        if (keys.gas) throttleIn = 1.0;
        else if (simPedalSlider) throttleIn = parseInt(simPedalSlider.value) / 100;
        else throttleIn = 0.0;
        if (keys.brake) brakeIn = 1.0;

        if (keys.steerLeft) steerIn = -0.75;
        else if (keys.steerRight) steerIn = 0.75;
        else steerIn = parseInt(simSteeringSlider.value) / 100;
      }
    }

    // Step Drivetrain Simulation
    if (isEngineRunning && audio.engineState === 'RUNNING') {
      drivetrain.update(dt, throttleIn, brakeIn, gpsSpeedIn, steerIn, externalLateralG);
      audio.update(drivetrain.currentRpm, drivetrain.throttle, drivetrain.shiftCutActive);
      audio.updateTireAcoustics(drivetrain.speedMps, drivetrain.gForceLateral, drivetrain.gForceLongitudinal, drivetrain.throttle, drivetrain.brake);
    } else if (audio.engineState === 'CRANKING' || audio.engineState === 'STARTING' || audio.engineState === 'STOPPING') {
      // RPM during starter cranking or shutdown is driven by the engine sequence
      drivetrain.speedMps = 0;
      drivetrain.speedMph = 0;
      drivetrain.speedKmh = 0;
      drivetrain.throttle = 0;
      drivetrain.gForceLongitudinal = 0;
      drivetrain.gForceLateral = 0;
      audio.update(drivetrain.currentRpm, 0, false);
      audio.updateTireAcoustics(0, 0, 0, 0, 0);
    } else {
      // Engine is completely OFF: absolute zero and complete silence
      drivetrain.currentRpm = 0;
      drivetrain.speedMps = 0;
      drivetrain.speedMph = 0;
      drivetrain.speedKmh = 0;
      drivetrain.throttle = 0;
      drivetrain.gForceLongitudinal = 0;
      drivetrain.gForceLateral = 0;
      audio.update(0, 0, false);
      audio.updateTireAcoustics(0, 0, 0, 0, 0);
    }

    // Update HUD Values
    const displaySpeed = useMph ? Math.round(drivetrain.speedMph) : Math.round(drivetrain.speedKmh);
    hudSpeed.textContent = displaySpeed;
    hudModalSpeed.textContent = displaySpeed;

    hudGear.textContent = drivetrain.currentGear;
    hudModalGear.textContent = drivetrain.currentGear;

    hudRpmVal.textContent = Math.round(drivetrain.currentRpm).toLocaleString();
    hudModalRpmText.textContent = `${Math.round(drivetrain.currentRpm).toLocaleString()} RPM`;

    // Throttle / Boost Bar
    const throttlePct = Math.round(drivetrain.throttle * 100);
    throttleBarFill.style.width = `${throttlePct}%`;
    throttlePctText.textContent = `${throttlePct}%`;
    hudModalLoadBar.style.height = `${throttlePct}%`;
    hudModalLoadPct.textContent = `${throttlePct}%`;

    const boostPsi = (audio.currentBoost * 14.7).toFixed(1);
    boostValText.textContent = `${boostPsi} PSI`;

    // G-meter & Porsche 2-Axis Friction Radar
    const gLong = drivetrain.gForceLongitudinal;
    const gLat = drivetrain.gForceLateral;
    gForceVal.textContent = `${gLong >= 0 ? '+' : ''}${gLong.toFixed(2)} G`;

    if (gLateralVal) {
      const latDir = Math.abs(gLat) < 0.05 ? 'CTR' : gLat > 0 ? 'R' : 'L';
      gLateralVal.textContent = `${gLat >= 0 ? '+' : ''}${gLat.toFixed(2)} G (${latDir})`;
    }

    if (tireStateVal) {
      if (drivetrain.tireScreechIntensity > 0.15) {
        tireStateVal.textContent = 'SLIP SCREECH!';
        tireStateVal.style.color = '#d5001c';
      } else if (drivetrain.tireScrubIntensity > 0.20) {
        tireStateVal.textContent = 'LATERAL SCRUB';
        tireStateVal.style.color = '#f2a900';
      } else {
        tireStateVal.textContent = 'TRACTION 100%';
        tireStateVal.style.color = '#6ed392';
      }
    }

    drawPorscheGRadar(gLong, gLat, drivetrain.tireScrubIntensity, drivetrain.tireScreechIntensity);

    // Shift Light Array (F1 Style)
    updateShiftLights(drivetrain.currentRpm, drivetrain.redlineRpm);

    // RPM progress for CarPlay HUD
    const rpmFrac = Math.min(1, drivetrain.currentRpm / drivetrain.redlineRpm);
    hudModalRpmBar.style.width = `${Math.round(rpmFrac * 100)}%`;

    // Update auxiliary physics
    if (isEngineRunning && audio.engineState === 'RUNNING') {
      engineOilTemp += (92.0 - engineOilTemp) * (dt * 0.04);
      const rpmLoad = Math.min(1, drivetrain.currentRpm / drivetrain.redlineRpm);
      const targetOilPress = 1.5 + (rpmLoad * 3.1) + (drivetrain.throttle * 0.4);
      engineOilPressure += (targetOilPress - engineOilPressure) * (dt * 4.0);
      odometerMiles += (drivetrain.speedMps * dt * 0.000621371);
    } else {
      engineOilTemp += (20.0 - engineOilTemp) * (dt * 0.02);
      engineOilPressure += (0.0 - engineOilPressure) * (dt * 3.0);
    }

    if (isChronoRunning) {
      chronoElapsedSec += dt;
    }

    // Draw Canvases
    drawPorscheCluster(drivetrain, audio, now, dt);
    drawSportChrono(now, dt);
    drawSpectrum();
  }

  /* -------------------------------------------------------------
     11. Shift Lights Array Update
     ------------------------------------------------------------- */
  function updateShiftLights(rpm, redline) {
    const fraction = rpm / redline;
    const thresholds = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.89, 0.93, 0.96];

    shiftLights.forEach((light, i) => {
      if (fraction >= thresholds[i]) {
        light.classList.add('active');
      } else {
        light.classList.remove('active');
      }
    });
  }

  /* -------------------------------------------------------------
     12. PORSCHE SPORT CHRONO STOPWATCH (Top Dashboard Brow)
     ------------------------------------------------------------- */
  function drawSportChrono(now, dt) {
    if (!chronoCtx || !chronoCanvas) return;
    const w = chronoCanvas.width;
    const h = chronoCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = 48;

    chronoCtx.clearRect(0, 0, w, h);

    // 1. Brushed Aluminum Bezel
    const bezelGrad = chronoCtx.createLinearGradient(0, 0, w, h);
    bezelGrad.addColorStop(0, '#f2f4f8');
    bezelGrad.addColorStop(0.45, '#9aa0af');
    bezelGrad.addColorStop(0.55, '#565b67');
    bezelGrad.addColorStop(1, '#c5cbd6');

    chronoCtx.beginPath();
    chronoCtx.arc(cx, cy, r, 0, Math.PI * 2);
    chronoCtx.fillStyle = bezelGrad;
    chronoCtx.fill();

    // 2. Dial Face (Matte German Slate)
    chronoCtx.beginPath();
    chronoCtx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    chronoCtx.fillStyle = '#0f1116';
    chronoCtx.fill();
    chronoCtx.lineWidth = 1;
    chronoCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    chronoCtx.stroke();

    // 3. 60-Second Outer Scale (Ticks & Numerals)
    chronoCtx.font = '600 7px "Barlow Condensed", sans-serif';
    chronoCtx.textAlign = 'center';
    chronoCtx.textBaseline = 'middle';

    for (let s = 0; s < 60; s++) {
      const angle = (s / 60) * Math.PI * 2 - Math.PI / 2;
      const isMajor = s % 5 === 0;
      const len = isMajor ? 5 : 2.5;

      const x1 = cx + Math.cos(angle) * (r - 7);
      const y1 = cy + Math.sin(angle) * (r - 7);
      const x2 = cx + Math.cos(angle) * (r - 7 - len);
      const y2 = cy + Math.sin(angle) * (r - 7 - len);

      chronoCtx.beginPath();
      chronoCtx.moveTo(x1, y1);
      chronoCtx.lineTo(x2, y2);
      chronoCtx.lineWidth = isMajor ? 1.2 : 0.8;
      chronoCtx.strokeStyle = isMajor ? '#f5f2ea' : 'rgba(245, 242, 234, 0.35)';
      chronoCtx.stroke();

      if (isMajor && s > 0 && s % 15 === 0) {
        const tx = cx + Math.cos(angle) * (r - 16);
        const ty = cy + Math.sin(angle) * (r - 16);
        chronoCtx.fillStyle = '#c4a159';
        chronoCtx.fillText(s.toString(), tx, ty);
      }
    }

    // 4. Inscription
    chronoCtx.font = '700 5.5px "Rajdhani", sans-serif';
    chronoCtx.fillStyle = '#c4a159';
    chronoCtx.fillText('PORSCHE', cx, cy + 14);

    // 5. Sweeping Chrono Second Hand
    const secHandTime = isChronoRunning ? chronoElapsedSec : (now / 1000);
    const secAngle = ((secHandTime % 60) / 60) * Math.PI * 2 - Math.PI / 2;

    chronoCtx.save();
    chronoCtx.translate(cx, cy);
    chronoCtx.rotate(secAngle);

    chronoCtx.beginPath();
    chronoCtx.moveTo(-7, 0);
    chronoCtx.lineTo(r - 10, 0);
    chronoCtx.lineWidth = 1.2;
    chronoCtx.strokeStyle = isChronoRunning ? '#d5001c' : '#f2a900';
    chronoCtx.stroke();

    // Arrow tip
    chronoCtx.beginPath();
    chronoCtx.arc(r - 10, 0, 1.8, 0, Math.PI * 2);
    chronoCtx.fillStyle = '#d5001c';
    chronoCtx.fill();

    // Center Hub Cap
    chronoCtx.beginPath();
    chronoCtx.arc(0, 0, 3.5, 0, Math.PI * 2);
    chronoCtx.fillStyle = '#1a1d24';
    chronoCtx.fill();
    chronoCtx.lineWidth = 0.8;
    chronoCtx.strokeStyle = '#c4a159';
    chronoCtx.stroke();

    chronoCtx.restore();
  }

  /* -------------------------------------------------------------
     13. PORSCHE 911 FIVE-POD INSTRUMENT BINNACLE RENDERING
     Classic 90s (964/993) to Modern (991/992) 5-Gauge Cluster
     ------------------------------------------------------------- */
  function drawPorscheCluster(drivetrain, audio, now, dt) {
    const w = tachoCanvas.width;
    const h = tachoCanvas.height;

    tachoCtx.clearRect(0, 0, w, h);

    if (clusterDisplayMode === 'pure') {
      // PURE MINIMALIST RACING COCKPIT: Single dominant Hero Tachometer + Digital Speedometer
      drawPureTachometer(tachoCtx, 520, 205, 194, drivetrain.currentRpm, drivetrain.redlineRpm, drivetrain.isRevLimiting);
    } else {
      // 5-POD HERITAGE CLUSTER
      // Depth Layer 1: Outermost Flanks (Pod 1 & Pod 5)
      drawPod1FuelSoC(tachoCtx, 120, 230, 76);
      drawPod5TurboBoost(tachoCtx, 920, 230, 76, audio, drivetrain);

      // Depth Layer 2: Mid Flanks (Pod 2 & Pod 4)
      drawPod2OilTempPressure(tachoCtx, 285, 195, 100, engineOilTemp, engineOilPressure);
      drawPod4Speedometer(tachoCtx, 755, 195, 100, drivetrain.speedMph, drivetrain.speedKmh, useMph, odometerMiles);

      // Depth Layer 3: Dominant Hero Center Tachometer (Pod 3)
      drawPod3Tachometer(tachoCtx, 520, 165, 146, drivetrain.currentRpm, drivetrain.redlineRpm, drivetrain.isRevLimiting);
    }
  }

  // --- HELPER: Brushed Aluminum Bezel & Faceplate ---
  function drawGaugeBase(ctx, x, y, radius, outerWidth = 7) {
    // 1. Specular Brushed Aluminum Ring
    const grad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    grad.addColorStop(0, '#f2f5f9');
    grad.addColorStop(0.25, '#c5cbd6');
    grad.addColorStop(0.50, '#565b68');
    grad.addColorStop(0.75, '#2f343e');
    grad.addColorStop(1, '#d8dee8');

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 2. Recessed Dark Bevel Step
    ctx.beginPath();
    ctx.arc(x, y, radius - outerWidth, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0c10';
    ctx.fill();

    // 3. Satin Matte Faceplate (Fine Lathe Concentric Grooves)
    ctx.beginPath();
    ctx.arc(x, y, radius - outerWidth - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111317';
    ctx.fill();

    // Subtle concentric lathe ring
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.65, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.stroke();

    // 4. Subtle Glass Reflection (Top-Right Crescent Highlight)
    const glassGrad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y);
    glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    glassGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.01)');
    glassGrad.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(x, y, radius - outerWidth - 2, -Math.PI * 0.6, Math.PI * 0.2);
    ctx.strokeStyle = glassGrad;
    ctx.lineWidth = radius * 0.28;
    ctx.stroke();
  }

  // --- HELPER: Porsche Guards Red Sweeping Needle ---
  function drawPorscheNeedle(ctx, x, y, angle, length, hubR = 14, tailLen = 16) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // 3D Drop Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    // Needle Tapered Body (Guards Red)
    ctx.beginPath();
    ctx.moveTo(-tailLen, -2);
    ctx.lineTo(-tailLen, 2);
    ctx.lineTo(-hubR, 3);
    ctx.lineTo(length, 0.5);
    ctx.lineTo(length, -0.5);
    ctx.lineTo(-hubR, -3);
    ctx.closePath();
    ctx.fillStyle = '#d5001c';
    ctx.fill();

    // Orange/white spine highlight
    ctx.beginPath();
    ctx.moveTo(-hubR + 4, 0);
    ctx.lineTo(length - 4, 0);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = '#ff6854';
    ctx.stroke();

    // Reset shadow for hub
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Matte Black Needle Hub
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#14171d';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#2d3340';
    ctx.stroke();

    // Polished Silver Center Rivet Dot
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d2d6df';
    ctx.fill();

    ctx.restore();
  }

  // =============================================================
  // POD 1: FUEL LEVEL & EV BATTERY SOC (Far Left)
  // =============================================================
  function drawPod1FuelSoC(ctx, cx, cy, r) {
    drawGaugeBase(ctx, cx, cy, r, 6);

    ctx.font = '700 8.5px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Top Arc: Fuel (Classic German 4/4 format)
    ctx.fillStyle = '#f5f2ea';
    ctx.fillText('0', cx - 42, cy - 22);
    ctx.fillText('1/2', cx, cy - 46);
    ctx.fillText('4/4', cx + 42, cy - 22);

    // Pump icon
    ctx.font = '600 7.5px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('FUEL', cx, cy - 28);

    // Bottom Arc: EV Battery SoC
    ctx.font = '700 8px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#838c9d';
    ctx.fillText('0%', cx - 38, cy + 24);
    ctx.fillText('BATTERY', cx, cy + 42);
    ctx.fillText('100%', cx + 38, cy + 24);

    // Fuel Needle (Pointing to 88% full: angle ~ -30 deg)
    const fuelAngle = -Math.PI * 0.55 + 0.88 * (Math.PI * 0.65);
    drawPorscheNeedle(ctx, cx, cy - 8, fuelAngle, r - 26, 9, 10);
  }

  // =============================================================
  // POD 2: OIL TEMPERATURE & OIL PRESSURE (Mid Left - VDO Dual)
  // =============================================================
  function drawPod2OilTempPressure(ctx, cx, cy, r, oilTemp, oilPress) {
    drawGaugeBase(ctx, cx, cy, r, 7);

    // Divider Line between Top & Bottom Half
    ctx.beginPath();
    ctx.moveTo(cx - r + 14, cy);
    ctx.lineTo(cx + r - 14, cy);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    // 1. TOP ARC: ÖLTEMPERATUR °C (60 to 150)
    ctx.font = '700 8.5px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('ÖLTEMPERATUR °C', cx, cy - 20);

    ctx.font = '700 9.5px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#f5f2ea';
    ctx.fillText('60', cx - 58, cy - 42);
    ctx.fillText('90', cx - 22, cy - 65);
    ctx.fillText('120', cx + 22, cy - 65);
    ctx.fillStyle = '#d5001c';
    ctx.fillText('150', cx + 58, cy - 42);

    // Upper needle: Oil Temp (Sweeps from -150° to -30°)
    const tempFrac = Math.max(0, Math.min(1, (oilTemp - 60) / 90));
    const tempAngle = (-150 + tempFrac * 120) * (Math.PI / 180);
    drawPorscheNeedle(ctx, cx, cy - 22, tempAngle, r - 32, 10, 10);

    // 2. BOTTOM ARC: ÖLDRUCK BAR (0 to 5)
    ctx.font = '700 8.5px "Rajdhani", sans-serif';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('ÖLDRUCK BAR', cx, cy + 20);

    ctx.font = '700 9.5px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#f5f2ea';
    ctx.fillText('0', cx - 56, cy + 42);
    ctx.fillText('1', cx - 36, cy + 62);
    ctx.fillText('2', cx - 14, cy + 74);
    ctx.fillText('3', cx + 14, cy + 74);
    ctx.fillText('4', cx + 36, cy + 62);
    ctx.fillText('5', cx + 56, cy + 42);

    // Lower needle: Oil Pressure (Sweeps from 150° to 30°)
    const pressFrac = Math.max(0, Math.min(1, oilPress / 5.0));
    const pressAngle = (150 - pressFrac * 120) * (Math.PI / 180);
    drawPorscheNeedle(ctx, cx, cy + 22, pressAngle, r - 32, 10, 10);
  }

  // =============================================================
  // POD 3: CENTER HERO — THE QUINTESSENTIAL 911 TACHOMETER
  // =============================================================
  function drawPod3Tachometer(ctx, cx, cy, r, rpm, redline, isLimiting) {
    drawGaugeBase(ctx, cx, cy, r, 9);

    const startAngle = 135 * (Math.PI / 180);
    const endAngle = 405 * (Math.PI / 180);
    const totalSweep = endAngle - startAngle;

    // 1. Redline diagonal hash band (7,600 to 9,000 RPM)
    const redlineFrac = 7600 / redline;
    const rlStart = startAngle + (totalSweep * redlineFrac);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 14, rlStart, endAngle);
    ctx.arc(cx, cy, r - 32, endAngle, rlStart, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(213, 0, 28, 0.45)';
    ctx.fill();

    // Redline diagonal hash stripes
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#d5001c';
    for (let deg = 7600; deg <= redline; deg += 120) {
      const fr = deg / redline;
      const a = startAngle + (totalSweep * fr);
      const x1 = cx + Math.cos(a) * (r - 14);
      const y1 = cy + Math.sin(a) * (r - 14);
      const x2 = cx + Math.cos(a) * (r - 32);
      const y2 = cy + Math.sin(a) * (r - 32);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Yellow warning zone (7,000 to 7,600 RPM)
    const yStart = startAngle + (totalSweep * (7000 / redline));
    ctx.beginPath();
    ctx.arc(cx, cy, r - 22, yStart, rlStart);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f2a900';
    ctx.stroke();

    // 3. Tachometer Ticks & Bold Numerals: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
    const maxK = Math.ceil(redline / 1000);
    ctx.font = '700 21px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let k = 0; k <= maxK; k++) {
      const frac = (k * 1000) / redline;
      if (frac > 1.02) break;
      const angle = startAngle + (totalSweep * frac);

      // Major tick mark
      const x1 = cx + Math.cos(angle) * (r - 12);
      const y1 = cy + Math.sin(angle) * (r - 12);
      const x2 = cx + Math.cos(angle) * (r - 28);
      const y2 = cy + Math.sin(angle) * (r - 28);

      const isRed = (k * 1000) >= 7600;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = isRed ? '#d5001c' : '#f5f2ea';
      ctx.stroke();

      // Intermediate ticks (every 200 RPM)
      for (let sub = 1; sub <= 4; sub++) {
        const subFrac = ((k * 1000) + sub * 200) / redline;
        if (subFrac > 1.01) break;
        const subAngle = startAngle + (totalSweep * subFrac);
        const sx1 = cx + Math.cos(subAngle) * (r - 12);
        const sy1 = cy + Math.sin(subAngle) * (r - 12);
        const sx2 = cx + Math.cos(subAngle) * (r - 20);
        const sy2 = cy + Math.sin(subAngle) * (r - 20);

        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = ((k * 1000) + sub * 200) >= 7600 ? '#d5001c' : 'rgba(245, 242, 234, 0.45)';
        ctx.stroke();
      }

      // Numerals
      const tx = cx + Math.cos(angle) * (r - 46);
      const ty = cy + Math.sin(angle) * (r - 46);
      ctx.fillStyle = isRed ? '#d5001c' : '#ffffff';
      ctx.fillText(k.toString(), tx, ty);
    }

    // Inscriptions
    ctx.font = '700 9.5px "Rajdhani", sans-serif';
    ctx.fillStyle = '#8e96a8';
    ctx.fillText('rpm x 1000', cx, cy - 65);

    ctx.font = '700 8px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('REVVER • STUTTGART', cx, cy - 50);

    // 4. Recessed Frame Bezel for the Lower LCD Window
    ctx.beginPath();
    ctx.roundRect(cx - 72, cy + 24, 144, 100, 6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(196, 161, 89, 0.35)';
    ctx.fillStyle = '#0a0907';
    ctx.fill();
    ctx.stroke();

    // 5. Sweeping Long Needle in Porsche Guards Red
    const currentFrac = Math.max(0, Math.min(1, rpm / redline));
    const currentAngle = startAngle + (totalSweep * currentFrac);

    drawPorscheNeedle(ctx, cx, cy, currentAngle, r - 20, 18, 22);
  }

  // =============================================================
  // PURE DISPLAY: HERO TACHOMETER & INTEGRATED DIGITAL SPEEDOMETER
  // =============================================================
  function drawPureTachometer(ctx, cx, cy, r, rpm, redline, isLimiting) {
    // 1. Heavy Brushed Titanium / Satin Aluminum Outer Bezel Ring
    drawGaugeBase(ctx, cx, cy, r, 10);

    const startAngle = 135 * (Math.PI / 180);
    const endAngle = 405 * (Math.PI / 180);
    const totalSweep = endAngle - startAngle;

    // 2. Yellow Pre-Warning Arc (7,000 to 7,600 RPM)
    const yStart = startAngle + (totalSweep * (7000 / redline));
    const rlStart = startAngle + (totalSweep * (7600 / redline));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 24, yStart, rlStart);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#f2a900';
    ctx.stroke();

    // 3. Diagonal Redline Hash Band (7,600 to Redline)
    ctx.beginPath();
    ctx.arc(cx, cy, r - 15, rlStart, endAngle);
    ctx.arc(cx, cy, r - 38, endAngle, rlStart, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(213, 0, 28, 0.42)';
    ctx.fill();

    // Redline diagonal hash stripes
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#d5001c';
    for (let deg = 7600; deg <= redline; deg += 120) {
      const fr = deg / redline;
      const a = startAngle + (totalSweep * fr);
      const x1 = cx + Math.cos(a) * (r - 15);
      const y1 = cy + Math.sin(a) * (r - 15);
      const x2 = cx + Math.cos(a) * (r - 38);
      const y2 = cy + Math.sin(a) * (r - 38);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Large Crisp Ticks & Numerals: 0 through 10
    const maxK = Math.ceil(redline / 1000);
    ctx.font = '700 24px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let k = 0; k <= maxK; k++) {
      const frac = (k * 1000) / redline;
      if (frac > 1.02) break;
      const angle = startAngle + (totalSweep * frac);

      // Major tick mark
      const x1 = cx + Math.cos(angle) * (r - 14);
      const y1 = cy + Math.sin(angle) * (r - 14);
      const x2 = cx + Math.cos(angle) * (r - 34);
      const y2 = cy + Math.sin(angle) * (r - 34);

      const isRed = (k * 1000) >= 7600;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = isRed ? '#d5001c' : '#f5f2ea';
      ctx.stroke();

      // Intermediate ticks (every 200 RPM)
      for (let sub = 1; sub <= 4; sub++) {
        const subFrac = ((k * 1000) + sub * 200) / redline;
        if (subFrac > 1.01) break;
        const subAngle = startAngle + (totalSweep * subFrac);
        const sx1 = cx + Math.cos(subAngle) * (r - 14);
        const sy1 = cy + Math.sin(subAngle) * (r - 14);
        const sx2 = cx + Math.cos(subAngle) * (r - 24);
        const sy2 = cy + Math.sin(subAngle) * (r - 24);

        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = ((k * 1000) + sub * 200) >= 7600 ? '#d5001c' : 'rgba(245, 242, 234, 0.45)';
        ctx.stroke();
      }

      // Numerals
      const tx = cx + Math.cos(angle) * (r - 54);
      const ty = cy + Math.sin(angle) * (r - 54);
      ctx.fillStyle = isRed ? '#d5001c' : '#ffffff';
      ctx.fillText(k.toString(), tx, ty);
    }

    // Inscriptions
    ctx.font = '700 11px "Rajdhani", sans-serif';
    ctx.fillStyle = '#8e96a8';
    ctx.fillText('rpm x 1000', cx, cy - 88);

    ctx.font = '700 9px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('PORSCHE GT3 • 9,000 RPM', cx, cy - 70);

    // 5. Recessed LCD Digital Speedometer Frame
    ctx.beginPath();
    ctx.roundRect(cx - 110, cy + 28, 220, 122, 8);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(196, 161, 89, 0.45)';
    ctx.fillStyle = '#080806';
    ctx.fill();
    ctx.stroke();

    // 6. Sweeping Long Needle in Porsche Guards Red
    const currentFrac = Math.max(0, Math.min(1, rpm / redline));
    const currentAngle = startAngle + (totalSweep * currentFrac);

    drawPorscheNeedle(ctx, cx, cy, currentAngle, r - 22, 20, 24);
  }

  // =============================================================
  // POD 4: ANALOG SPEEDOMETER & MECHANICAL ODOMETER (Mid Right)
  // =============================================================
  function drawPod4Speedometer(ctx, cx, cy, r, speedMph, speedKmh, useMph, odoMiles) {
    drawGaugeBase(ctx, cx, cy, r, 7);

    const maxSpeed = 180;
    const startAngle = 135 * (Math.PI / 180);
    const endAngle = 405 * (Math.PI / 180);
    const totalSweep = endAngle - startAngle;

    // 1. Outer Scale: 0 to 180 MPH (ticks every 5 mph, numbers every 20)
    ctx.font = '700 12.5px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let mph = 0; mph <= maxSpeed; mph += 10) {
      const frac = mph / maxSpeed;
      const angle = startAngle + (totalSweep * frac);
      const isMajor = mph % 20 === 0;

      const x1 = cx + Math.cos(angle) * (r - 12);
      const y1 = cy + Math.sin(angle) * (r - 12);
      const x2 = cx + Math.cos(angle) * (r - (isMajor ? 24 : 18));
      const y2 = cy + Math.sin(angle) * (r - (isMajor ? 24 : 18));

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = isMajor ? 2.5 : 1.2;
      ctx.strokeStyle = isMajor ? '#f5f2ea' : 'rgba(245, 242, 234, 0.45)';
      ctx.stroke();

      if (isMajor) {
        const tx = cx + Math.cos(angle) * (r - 36);
        const ty = cy + Math.sin(angle) * (r - 36);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(mph.toString(), tx, ty);
      }
    }

    // 2. Inner Scale: Amber KM/H markings (up to 300 km/h)
    ctx.font = '600 7px "Rajdhani", sans-serif';
    ctx.fillStyle = 'rgba(255, 154, 0, 0.7)';
    for (let kmh = 20; kmh <= 280; kmh += 40) {
      const mphEquiv = kmh / 1.60934;
      if (mphEquiv > maxSpeed) break;
      const frac = mphEquiv / maxSpeed;
      const angle = startAngle + (totalSweep * frac);
      const tx = cx + Math.cos(angle) * (r - 48);
      const ty = cy + Math.sin(angle) * (r - 48);
      ctx.fillText(kmh.toString(), tx, ty);
    }

    ctx.font = '700 8.5px "Rajdhani", sans-serif';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('MPH / km/h', cx, cy + 42);

    // 3. Mechanical Rolling Odometer Drums
    drawOdometerDrum(ctx, cx, cy - 14, odoMiles);

    // 4. Sweeping Speed Needle in Guards Red
    const speedFrac = Math.max(0, Math.min(1, speedMph / maxSpeed));
    const speedAngle = startAngle + (totalSweep * speedFrac);
    drawPorscheNeedle(ctx, cx, cy, speedAngle, r - 22, 13, 16);
  }

  // Helper: Vintage Mechanical Rotating Odometer Barrel
  function drawOdometerDrum(ctx, cx, cy, totalMiles) {
    const odoStr = Math.floor(totalMiles).toString().padStart(6, '0');
    const tripVal = (totalMiles % 1000).toFixed(1).padStart(5, '0');

    // Total Mileage Barrel (6 digits)
    const odoW = 66;
    const odoH = 14;
    ctx.beginPath();
    ctx.rect(cx - odoW / 2, cy - odoH / 2, odoW, odoH);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#444955';
    ctx.stroke();

    ctx.font = '700 9px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5f2ea';

    for (let i = 0; i < 6; i++) {
      const dx = cx - odoW / 2 + 5.5 + i * 11;
      ctx.fillText(odoStr[i], dx, cy);
    }

    // Small Trip Odometer (below)
    const tripW = 50;
    const tripH = 11;
    const ty = cy + 18;
    ctx.beginPath();
    ctx.rect(cx - tripW / 2, ty - tripH / 2, tripW, tripH);
    ctx.fillStyle = '#050608';
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 7.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#f5f2ea';
    ctx.fillText(tripVal, cx - 4, ty);
    // Tenth digit in Guards Red
    ctx.fillStyle = '#d5001c';
    ctx.fillText(tripVal.slice(-1), cx + tripW / 2 - 6, ty);
  }

  // =============================================================
  // POD 5: TURBO BOOST & SPORT CHRONO G-METER (Far Right)
  // =============================================================
  function drawPod5TurboBoost(ctx, cx, cy, r, audio, drivetrain) {
    drawGaugeBase(ctx, cx, cy, r, 6);

    const startAngle = 140 * (Math.PI / 180);
    const endAngle = 400 * (Math.PI / 180);
    const totalSweep = endAngle - startAngle;

    ctx.font = '700 8.5px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c4a159';
    ctx.fillText('LADEDRUCK BAR', cx, cy - 22);

    // Boost markings: -0.5, 0, 0.5, 1.0, 1.5, 2.0 BAR
    const marks = ['-0.5', '0', '0.5', '1.0', '1.5', '2.0'];
    ctx.font = '700 8px "Barlow Condensed", sans-serif';

    for (let i = 0; i < marks.length; i++) {
      const frac = i / (marks.length - 1);
      const angle = startAngle + (totalSweep * frac);
      const isPositive = i >= 1;

      const x1 = cx + Math.cos(angle) * (r - 10);
      const y1 = cy + Math.sin(angle) * (r - 10);
      const x2 = cx + Math.cos(angle) * (r - 18);
      const y2 = cy + Math.sin(angle) * (r - 18);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = isPositive ? '#f2a900' : '#8891a0';
      ctx.stroke();

      const tx = cx + Math.cos(angle) * (r - 28);
      const ty = cy + Math.sin(angle) * (r - 28);
      ctx.fillStyle = isPositive ? '#ffffff' : '#8891a0';
      ctx.fillText(marks[i], tx, ty);
    }

    // Drive Mode / G-Force tag in lower half
    ctx.font = '700 7.5px "Rajdhani", sans-serif';
    ctx.fillStyle = '#f2a900';
    ctx.fillText((drivetrain.driveMode || 'sport').toUpperCase(), cx, cy + 26);

    ctx.font = '700 7.5px "Share Tech Mono", monospace';
    const latG = drivetrain.gForceLateral || 0;
    ctx.fillStyle = Math.abs(latG) > (drivetrain.tireGripThreshold || 0.45) ? '#d5001c' : '#8891a0';
    ctx.fillText(`${latG >= 0 ? '+' : ''}${latG.toFixed(2)}G LAT`, cx, cy + 38);

    // Sweeping Boost Needle in Guards Red
    // audio.currentBoost: 0 to 1.4 -> maps from 0.0 to 1.8 BAR
    const currentBar = (audio.currentBoost * 1.35) - (drivetrain.throttle < 0.1 ? 0.35 : 0);
    const boostFrac = Math.max(0, Math.min(1, (currentBar + 0.5) / 2.5));
    const boostAngle = startAngle + (totalSweep * boostFrac);
    drawPorscheNeedle(ctx, cx, cy, boostAngle, r - 22, 10, 12);
  }

  // =============================================================
  // PORSCHE 2-AXIS FRICTION CIRCLE RADAR (PCM / GT3 Track Style)
  // =============================================================
  function drawPorscheGRadar(gLong, gLat, scrubIntensity, screechIntensity) {
    if (!gRadarCtx || !gRadarCanvas) return;
    const ctx = gRadarCtx;
    const w = gRadarCanvas.width;
    const h = gRadarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = cx - 5; // ~29px radius represents 1.2G

    ctx.clearRect(0, 0, w, h);

    // 1. Concentric G Rings (0.5G inner, 1.0G grip limit)
    const r05 = maxRadius * (0.5 / 1.2);
    const r10 = maxRadius * (1.0 / 1.2);

    // Inner 0.5G ring (dashed)
    ctx.beginPath();
    ctx.arc(cx, cy, r05, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Outer 1.0G Grip Limit Ring (pulses red/amber when slipping)
    ctx.beginPath();
    ctx.arc(cx, cy, r10, 0, Math.PI * 2);
    if (screechIntensity > 0.1) {
      ctx.strokeStyle = '#d5001c';
      ctx.lineWidth = 1.6;
    } else if (scrubIntensity > 0.15) {
      ctx.strokeStyle = '#f2a900';
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = 'rgba(196, 161, 89, 0.35)';
      ctx.lineWidth = 1.0;
    }
    ctx.stroke();

    // Crosshair Axes (Brake/Accel vertical, Left/Right horizontal)
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, h - 4);
    ctx.moveTo(4, cy);
    ctx.lineTo(w - 4, cy);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.stroke();

    // 2. G-Vector Dot (x = lateral, y = -longitudinal)
    // Scale: 1.2G = maxRadius
    const dotX = Math.max(5, Math.min(w - 5, cx + (gLat / 1.2) * maxRadius));
    const dotY = Math.max(5, Math.min(h - 5, cy - (gLong / 1.2) * maxRadius));

    // Vector line from center
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dotX, dotY);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = screechIntensity > 0.1 ? 'rgba(213, 0, 28, 0.65)' : 'rgba(196, 161, 89, 0.5)';
    ctx.stroke();

    // Glowing G-Ball Dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = screechIntensity > 0.1 ? '#d5001c' : '#f2a900';
    ctx.shadowColor = screechIntensity > 0.1 ? 'rgba(213, 0, 28, 0.8)' : 'rgba(242, 169, 0, 0.6)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Center white dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  /* -------------------------------------------------------------
     13. Live Audio Spectrum Visualizer
     ------------------------------------------------------------- */
  function drawSpectrum() {
    const w = spectrumCanvas.width;
    const h = spectrumCanvas.height;

    spectrumCtx.clearRect(0, 0, w, h);

    if (!isEngineRunning || !audio.analyser) {
      spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      spectrumCtx.fillRect(0, h - 2, w, 2);
      return;
    }

    audio.getSpectrumData(spectrumArray);

    const barCount = 36;
    const barWidth = (w / barCount) - 2;

    for (let i = 0; i < barCount; i++) {
      const val = spectrumArray[i] || 0;
      const barHeight = Math.max(3, (val / 255) * h);
      const x = i * (barWidth + 2);
      const y = h - barHeight;

      // Color from cyan to amber
      const grad = spectrumCtx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, '#00f3ff');
      grad.addColorStop(1, '#ff9d00');

      spectrumCtx.fillStyle = grad;
      spectrumCtx.fillRect(x, y, barWidth, barHeight);
    }
  }

  // Initialize
  renderEngineList();
  requestAnimationFrame(loop);
});
