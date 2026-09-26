/**
 * REVVER — Virtual Drivetrain & Multi-Gear Transmission Simulator
 * Computes vehicle physics, gear ratios, automatic & manual shifting,
 * rev-match downshift blips, ignition shift-cuts, and rev-limiter bounce.
 */

class RevverDrivetrain {
  constructor(audioEngine) {
    this.audio = audioEngine;

    // Transmission setups tuned for realistic street & city driving
    this.gearboxes = {
      dct7: {
        id: 'dct7',
        name: '7-Speed PDK Dual-Clutch',
        // 1st: 4.80, 2nd: 3.10, 3rd: 2.10, 4th: 1.55, 5th: 1.20, 6th: 0.95, 7th: 0.74
        gears: [4.80, 3.10, 2.10, 1.55, 1.20, 0.95, 0.74],
        finalDrive: 3.90,
        shiftTimeMs: 75,
        type: 'auto'
      },
      auto8: {
        id: 'auto8',
        name: '8-Speed PDK (992 Spec)',
        // 1st: 4.90, 2nd: 3.20, 3rd: 2.20, 4th: 1.65, 5th: 1.30, 6th: 1.00, 7th: 0.82, 8th: 0.66
        gears: [4.90, 3.20, 2.20, 1.65, 1.30, 1.00, 0.82, 0.66],
        finalDrive: 3.90,
        shiftTimeMs: 65,
        type: 'auto'
      },
      manual6: {
        id: 'manual6',
        name: '6-Speed G50 Manual',
        // 1st: 4.40, 2nd: 2.65, 3rd: 1.80, 4th: 1.30, 5th: 0.98, 6th: 0.76
        gears: [4.40, 2.65, 1.80, 1.30, 0.98, 0.76],
        finalDrive: 3.90,
        shiftTimeMs: 200,
        type: 'manual'
      },
      seq6: {
        id: 'seq6',
        name: '6-Speed Sequential GT3 Cup',
        gears: [3.80, 2.45, 1.75, 1.35, 1.08, 0.88],
        finalDrive: 3.90,
        shiftTimeMs: 50,
        type: 'sequential'
      }
    };

    this.activeGearbox = this.gearboxes.dct7;
    this.isManualMode = false;

    // Shift map / Drive Mode: 'city' (Daily/Comfort - default), 'sport', 'track'
    this.driveMode = 'city';
    this.lastShiftTime = 0;
    this.shiftCooldownMs = 600; // Minimum interval between shifts

    // Physical state
    this.speedMps = 0; // Speed in meters per second
    this.speedMph = 0;
    this.speedKmh = 0;
    this.currentGear = 1; // 1 to gears.length, 0 = Neutral
    this.targetGear = 1;
    this.currentRpm = 850;
    this.idleRpm = 850;
    this.redlineRpm = 9000;

    // Shift state machine
    this.isShifting = false;
    this.shiftStartTime = 0;
    this.shiftDuration = 85;
    this.shiftStartRpm = 850;
    this.shiftCutActive = false;
    this.isRevLimiting = false;
    this.revLimiterTimer = 0;
    this.revMatchBlipActive = false;

    // Throttle & Braking
    this.throttle = 0; // 0.0 to 1.0
    this.brake = 0;    // 0.0 to 1.0
    this.gForceLongitudinal = 0; // G-force (+ for accel, - for decel)

    // Lateral Dynamics & Tire Simulation
    this.steering = 0;            // -1.0 (left) to +1.0 (right)
    this.gForceLateral = 0;       // Lateral G-force (- left, + right)
    this.tireCompound = 'cup2';   // 'cup2', 'pzero', 'vintage'
    this.tireAcousticsEnabled = true;
    this.tireScreechVolume = 0.35;// Subtle default (0.0 to 1.0)
    this.tireGripThreshold = 0.45;// Lateral G threshold where screech begins
    this.tireScrubIntensity = 0;  // 0.0 to 1.0 (friction scrub)
    this.tireScreechIntensity = 0;// 0.0 to 1.0 (slip squeal)

    // Wheel constants (typical 245/40R19 tire circumference ~2.08m)
    this.wheelCircumference = 2.08;
    this.wheelRpmPerMps = (60 / this.wheelCircumference); // ~28.846 RPM per m/s

    // Listeners for shift events
    this.onShiftCallback = null;
    this.onRevLimitCallback = null;
  }

  /**
   * Fundamental Kinematic Formula: Calculates engine RPM for road speed in meters/second in gear
   * RPM = (v_mps * 60 / C_tire) * finalDrive * gearRatio
   */
  calculateRpmForSpeed(speedMps, gear) {
    const g = Math.max(1, Math.min(this.activeGearbox.gears.length, gear));
    const ratio = this.activeGearbox.gears[g - 1] || 1.0;
    return speedMps * this.wheelRpmPerMps * this.activeGearbox.finalDrive * ratio;
  }

  /**
   * Inverted Kinematic Formula: Calculates vehicle speed in MPH for a given engine RPM in gear
   * Speed_mph = (RPM / (wheelRpmPerMps * finalDrive * gearRatio)) * 2.23694
   */
  calculateSpeedMphForRpm(rpm, gear) {
    const g = Math.max(1, Math.min(this.activeGearbox.gears.length, gear));
    const ratio = this.activeGearbox.gears[g - 1] || 1.0;
    const speedMps = rpm / (this.wheelRpmPerMps * this.activeGearbox.finalDrive * ratio);
    return speedMps * 2.23694;
  }

  setEngineLimits(idle, redline) {
    this.idleRpm = idle;
    this.redlineRpm = redline;
    if (this.currentRpm < this.idleRpm) {
      this.currentRpm = this.idleRpm;
    }
  }

  setGearbox(id) {
    if (this.gearboxes[id]) {
      this.activeGearbox = this.gearboxes[id];
      if (this.currentGear > this.activeGearbox.gears.length) {
        this.currentGear = this.activeGearbox.gears.length;
      }
    }
  }

  setDriveMode(mode) {
    if (['city', 'sport', 'track'].includes(mode)) {
      this.driveMode = mode;
      return true;
    }
    return false;
  }

  /**
   * Main Physics Simulation Step (runs ~60 times per second)
   * @param {number} dt - delta time in seconds
   * @param {number} inputThrottle - 0.0 to 1.0
   * @param {number} inputBrake - 0.0 to 1.0
   * @param {number|null} externalGpsSpeedMps - ground truth speed if using phone GPS
   * @param {number} inputSteering - -1.0 (left) to +1.0 (right)
   * @param {number|null} externalLateralG - ground truth lateral G from phone IMU
   */
  update(dt, inputThrottle, inputBrake, externalGpsSpeedMps = null, inputSteering = 0, externalLateralG = null) {
    const now = performance.now();
    this.throttle = Math.max(0, Math.min(1, inputThrottle));
    this.brake = Math.max(0, Math.min(1, inputBrake));

    // 1. Vehicle Acceleration & Speed Calculation
    if (externalGpsSpeedMps !== null && externalGpsSpeedMps > 0.5) {
      // Direct GPS speed integration with smooth lag filter
      const prevSpeed = this.speedMps;
      this.speedMps += (externalGpsSpeedMps - this.speedMps) * 0.15;
      this.gForceLongitudinal = ((this.speedMps - prevSpeed) / dt) / 9.81;
    } else {
      // Virtual EV Drivetrain Simulation (Dual Motor AWD electric torque curve)
      let netAccel = 0;

      if (this.throttle > 0 && !this.shiftCutActive) {
        // High electric torque down low, tapering smoothly at higher speed
        const torqueFactor = Math.max(0.35, 1.0 - (this.speedMps / 85));
        const maxAccelMps2 = 8.5; // ~0.87G launch
        netAccel += this.throttle * maxAccelMps2 * torqueFactor;
      }

      if (this.brake > 0) {
        netAccel -= this.brake * 11.0; // ~1.1G heavy braking
      }

      // Aero drag and rolling resistance
      const drag = 0.005 * Math.pow(this.speedMps, 2);
      const rollingResistance = 0.8;
      netAccel -= (drag + rollingResistance);

      // Integrate velocity
      this.speedMps += netAccel * dt;
      if (this.speedMps < 0) this.speedMps = 0;

      this.gForceLongitudinal = netAccel / 9.81;
    }

    // Convert speed to MPH and KM/H
    this.speedMph = this.speedMps * 2.23694;
    this.speedKmh = this.speedMps * 3.6;

    // 1b. Lateral Dynamics & Cornering G-Force
    if (externalLateralG !== null && Math.abs(externalLateralG) > 0.02) {
      // Direct IMU reading from phone accelerometer
      this.gForceLateral += (externalLateralG - this.gForceLateral) * Math.min(1.0, dt * 10);
    } else {
      // Virtual steering angle integration with speed-sensitive rack response
      this.steering += (inputSteering - this.steering) * Math.min(1.0, dt * 12);

      if (this.speedMps < 0.4) {
        this.gForceLateral = 0;
      } else {
        // Centripetal acceleration: a = v^2 / r, normalized to Gs
        // Scaled to realistic 911 chassis limits
        const speedFactor = Math.pow(Math.min(50, this.speedMps), 1.25);
        const rawG = (speedFactor * this.steering * 0.24) / 9.81;

        // Compound grip ceiling: Cup 2 (1.20G), P Zero (1.08G), Vintage (0.90G)
        const maxGrip = this.tireCompound === 'cup2' ? 1.20 : (this.tireCompound === 'pzero' ? 1.08 : 0.90);
        this.gForceLateral = Math.max(-maxGrip, Math.min(maxGrip, rawG));
      }
    }

    // 1c. Tire Scrub & Screech Slip Intensity
    const absLatG = Math.abs(this.gForceLateral);
    const scrubOnset = 0.20;
    const screechOnset = this.tireGripThreshold;

    // Progressive lateral scrub: textured asphalt friction
    const latScrub = Math.max(0, Math.min(1.0, (absLatG - scrubOnset) / (screechOnset - scrubOnset + 0.3)));

    // High lateral screech: rubber stick-slip squeal
    const latScreech = Math.max(0, Math.min(1.0, (absLatG - screechOnset) / 0.45));

    // Longitudinal slip (threshold braking lockup or 1st gear launch burnout)
    let longSlip = 0;
    if (this.brake > 0.85 && this.speedMps > 3.0) {
      longSlip = (this.brake - 0.85) / 0.15;
    } else if (this.throttle > 0.90 && this.speedMps < 6.0 && this.currentGear === 1) {
      longSlip = 0.65;
    }

    this.tireScrubIntensity = Math.min(1.0, Math.max(latScrub, longSlip * 0.85));
    this.tireScreechIntensity = Math.min(1.0, Math.max(latScreech, longSlip * 0.80));

    // 2. RPM Calculation from Gear Ratio and Wheel Speed
    const currentRatio = this.activeGearbox.gears[this.currentGear - 1] || 1.0;
    const finalDrive = this.activeGearbox.finalDrive;
    const theoreticalRpm = this.speedMps * this.wheelRpmPerMps * finalDrive * currentRatio;

    // 3. Handle Gear Shift State Machine
    if (this.isShifting) {
      const elapsed = now - this.shiftStartTime;
      const progress = Math.min(1, elapsed / this.shiftDuration);

      if (elapsed < this.shiftDuration * 0.65) {
        this.shiftCutActive = true;
      } else {
        this.shiftCutActive = false;
      }

      // Smooth RPM transition curve between old gear and new gear
      const targetRatio = this.activeGearbox.gears[this.targetGear - 1] || 1.0;
      const targetGearRpm = Math.max(this.idleRpm, this.speedMps * this.wheelRpmPerMps * finalDrive * targetRatio);

      // Smooth S-curve easing (smoothstep: 3*p^2 - 2*p^3)
      const ease = progress * progress * (3.0 - 2.0 * progress);

      if (this.revMatchBlipActive) {
        // Downshift blip: throttle blip smoothly matches lower gear
        const blipPeak = Math.max(targetGearRpm + 350, (this.shiftStartRpm || this.currentRpm) + 500);
        if (progress < 0.45) {
          const pUp = progress / 0.45;
          this.currentRpm = (this.shiftStartRpm || this.currentRpm) + (blipPeak - (this.shiftStartRpm || this.currentRpm)) * (pUp * pUp);
        } else {
          const pDown = (progress - 0.45) / 0.55;
          this.currentRpm = blipPeak + (targetGearRpm - blipPeak) * (pDown * pDown);
        }
      } else {
        // Upshift: silky smooth mechanical drop to target gear RPM
        const startRpm = this.shiftStartRpm || this.currentRpm;
        this.currentRpm = startRpm + (targetGearRpm - startRpm) * ease;
      }

      if (progress >= 1) {
        this.isShifting = false;
        this.currentGear = this.targetGear;
        this.currentRpm = targetGearRpm;
        this.shiftCutActive = false;
        this.revMatchBlipActive = false;
      }
    } else {
      // Normal driving (engaged gear)
      if (this.speedMps < 0.3) {
        // Stationary at standstill: idle or neutral free revving
        if (this.throttle > 0.05) {
          const revTarget = this.idleRpm + (this.throttle * (this.redlineRpm - this.idleRpm) * 0.95);
          this.currentRpm += (revTarget - this.currentRpm) * 0.18;
        } else {
          this.currentRpm += (this.idleRpm - this.currentRpm) * 0.22;
        }
      } else {
        // Moving: realistic torque converter / dual-clutch slip under ~8 mph
        const slipFactor = Math.min(1.0, this.speedMps / 3.6); // 0 to 1 as speed reaches ~8 mph
        // At launch/pull-away, heavy throttle slips clutch into mid-RPM powerband (up to 48% redline)
        const clutchSlipRpm = this.idleRpm + (Math.pow(this.throttle, 1.25) * (this.redlineRpm * 0.48 - this.idleRpm));
        const effectiveRpm = (clutchSlipRpm * (1 - slipFactor)) + (theoreticalRpm * slipFactor);
        const targetRpm = Math.max(this.idleRpm, Math.max(theoreticalRpm, effectiveRpm));

        this.currentRpm += (targetRpm - this.currentRpm) * 0.38;
      }

      // 4. Transmission Automatic Shift Decision Logic
      if (!this.isManualMode) {
        this.checkAutomaticShifts();
      }
    }

    // 5. Rev Limiter Bouncing
    if (this.currentRpm >= this.redlineRpm) {
      this.isRevLimiting = true;
      // Bounce down by 250-400 RPM rapidly
      this.currentRpm = this.redlineRpm - (Math.random() * 320 + 80);
      if (this.onRevLimitCallback) this.onRevLimitCallback();
      if (Math.random() < 0.4 && this.audio) {
        this.audio.triggerExhaustPop();
      }
    } else {
      this.isRevLimiting = false;
    }

    // Pass latest values to audio engine
    if (this.audio) {
      this.audio.update(this.currentRpm, this.throttle, this.shiftCutActive);
    }
  }

  /**
   * Dynamic Throttle-Adaptive Transmission Shift Control
   * Implements full powertrain kinematic calculation:
   * - Cruising & Light Throttle (< 25%): Shifts at relaxed RPMs (2,200 - 2,800 RPM)
   *   around town without screaming.
   * - Moderate Acceleration (35% - 65%): Holds gears up into the 4,500 - 6,200 RPM powerband.
   * - Spirited / WOT / Passing (> 70%): Sings all the way to 85% - 95% of Redline
   *   (7,500 - 8,700 RPM) before snapping off lightning PDK shifts!
   * - Kickdown: Stamping the pedal drops 1 or 2 gears instantly into 5,000+ RPM.
   * - Proactive Downshifting: Deceleration & braking progressively drops gears to keep
   *   the powertrain alert and responsive.
   */
  checkAutomaticShifts() {
    const now = performance.now();
    if (this.isShifting || now - this.lastShiftTime < this.shiftCooldownMs) return;

    const numGears = this.activeGearbox.gears.length;
    const speedMph = this.speedMph;

    // 1. DYNAMIC UPSHIFT TARGET CURVE BASED ON DRIVE MODE & THROTTLE LOAD
    let minUpshiftRpm;
    let maxUpshiftRpm;
    let downshiftFloorRpm;

    if (this.driveMode === 'track') {
      // Track / Race Mode: Keeps revs screaming between 4,500 and 8,800 RPM!
      minUpshiftRpm = Math.max(4800, this.redlineRpm * 0.62);
      maxUpshiftRpm = this.redlineRpm * 0.96; // Shifts at ~8,640 RPM on 9,000 redline!
      downshiftFloorRpm = Math.max(3800, this.redlineRpm * 0.48);
    } else if (this.driveMode === 'sport') {
      // Sport Mode: Energetic powerband between 3,200 and 8,200 RPM
      minUpshiftRpm = Math.max(3200, this.redlineRpm * 0.40);
      maxUpshiftRpm = this.redlineRpm * 0.92; // Shifts at ~8,280 RPM on 9,000 redline!
      downshiftFloorRpm = Math.max(2400, this.redlineRpm * 0.30);
    } else {
      // City / Street Mode:
      // Light throttle (< 25%): shifts early (2,300 - 2,800 RPM) for quiet around-town driving
      // Heavy throttle (> 70%): revs freely to 7,500 - 8,200 RPM!
      minUpshiftRpm = Math.max(2200, this.idleRpm + 1350);
      maxUpshiftRpm = this.redlineRpm * 0.88; // Revs up to 7,920 RPM on 9,000 redline!
      downshiftFloorRpm = Math.max(1400, this.idleRpm + 550);
    }

    // Non-linear throttle pedal progression
    const throttleFactor = Math.pow(Math.max(0, this.throttle), 1.25);
    const targetUpshiftRpm = minUpshiftRpm + (throttleFactor * (maxUpshiftRpm - minUpshiftRpm));

    // 2. KICK-DOWN DOWNSHIFT (Stamping on the gas pedal)
    // Instantly drops 1 or 2 gears when passing or demanding acceleration
    if (this.throttle > 0.60 && this.currentGear > 1 && now - this.lastShiftTime > 450) {
      // Try 2-gear aggressive kickdown (if in gear 3 or higher)
      if (this.currentGear >= 3) {
        const doubleDownRpm = this.calculateRpmForSpeed(this.speedMps, this.currentGear - 2);
        if (doubleDownRpm < this.redlineRpm * 0.84 && doubleDownRpm > this.currentRpm + 1400) {
          this.initiateShift(this.currentGear - 2, true);
          this.lastShiftTime = now;
          return;
        }
      }
      // Single gear kickdown
      const singleDownRpm = this.calculateRpmForSpeed(this.speedMps, this.currentGear - 1);
      if (singleDownRpm < this.redlineRpm * 0.88 && singleDownRpm > this.currentRpm + 900) {
        this.initiateShift(this.currentGear - 1, true);
        this.lastShiftTime = now;
        return;
      }
    }

    // 3. UPSHIFT LOGIC:
    // Only upshifts when RPM reaches target OR during steady-state low-throttle cruising
    if (this.currentGear < numGears && this.speedMps > 1.2) {
      const isCruising = this.throttle < 0.22;
      // Low-throttle economy cruising speed milestones (mph)
      const economyCruiseMph = [14, 24, 34, 44, 54, 64, 76, 92];
      const cruiseCondition = isCruising && (speedMph >= (economyCruiseMph[this.currentGear - 1] || 999));

      const rpmCondition = (this.currentRpm >= targetUpshiftRpm) || (this.currentRpm >= this.redlineRpm * 0.96);

      if (rpmCondition || cruiseCondition) {
        // Anti-bog check: ensure next gear lands cleanly above idle
        const nextGearRpm = this.calculateRpmForSpeed(this.speedMps, this.currentGear + 1);
        if (nextGearRpm >= this.idleRpm + 250) {
          this.initiateShift(this.currentGear + 1, false);
          this.lastShiftTime = now;
          return;
        }
      }
    }

    // 4. DOWNSHIFT LOGIC:
    if (this.currentGear > 1) {
      // Standstill stoplight drop to 1st
      if (this.speedMps < 0.9) {
        this.initiateShift(1, true);
        this.lastShiftTime = now;
        return;
      }

      // Proactive brake-assist downshifting
      const brakeAssistOffset = this.brake * 700;
      const downshiftThreshold = downshiftFloorRpm + brakeAssistOffset;

      if (this.currentRpm <= downshiftThreshold) {
        const prevGearRpm = this.calculateRpmForSpeed(this.speedMps, this.currentGear - 1);
        if (prevGearRpm < this.redlineRpm * 0.88) {
          this.initiateShift(this.currentGear - 1, true);
          this.lastShiftTime = now;
          return;
        }
      }
    }
  }

  /**
   * Initiates a gear shift with appropriate audio cut / throttle blip
   */
  initiateShift(newGear, isDownshift) {
    if (this.isShifting || newGear === this.currentGear) return;
    if (newGear < 1 || newGear > this.activeGearbox.gears.length) return;

    this.isShifting = true;
    this.shiftStartTime = performance.now();
    this.shiftDuration = this.activeGearbox.shiftTimeMs;
    this.shiftStartRpm = this.currentRpm;
    this.targetGear = newGear;
    this.revMatchBlipActive = isDownshift;

    if (!isDownshift) {
      // Upshift: smooth mechanical torque reduction (no popping in normal driving)
      this.shiftCutActive = true;
      // High-RPM full-throttle exhaust pop ONLY in track mode
      if (this.driveMode === 'track' && this.throttle > 0.85 && this.currentRpm > 5500 && this.audio) {
        setTimeout(() => {
          this.audio.triggerExhaustPop();
        }, this.shiftDuration * 0.5);
      }
    } else {
      // Downshift: rev-match blip, NO pop in street driving
      this.shiftCutActive = false;
    }

    if (this.onShiftCallback) {
      this.onShiftCallback(newGear, isDownshift);
    }
  }

  manualShiftUp() {
    if (this.currentGear < this.activeGearbox.gears.length) {
      this.initiateShift(this.currentGear + 1, false);
      this.lastShiftTime = performance.now();
    }
  }

  manualShiftDown() {
    if (this.currentGear > 1) {
      this.initiateShift(this.currentGear - 1, true);
      this.lastShiftTime = performance.now();
    }
  }

  toggleManualMode() {
    this.isManualMode = !this.isManualMode;
    return this.isManualMode;
  }
}

window.RevverDrivetrain = RevverDrivetrain;
