/**
 * REVVER — In-Car Phone Sensor Fusion (IMU Accelerometer + GPS)
 * Captures 3-axis acceleration, applies gravity compensation for arbitrary phone mounts,
 * maps vehicle G-force to instant throttle load, and reads GPS ground velocity.
 */

class RevverSensorManager {
  constructor() {
    this.isActive = false;
    this.hasSensorAccess = false;
    this.hasGpsAccess = false;

    // Sensor Readings (filtered)
    this.rawAx = 0;
    this.rawAy = 0;
    this.rawAz = 0;

    // Gravity reference vector (from calibration)
    this.gravityCalibrated = false;
    this.calibGx = 0;
    this.calibGy = 9.81;
    this.calibGz = 0;

    // Longitudinal Vehicle Acceleration (Forward/Aft G)
    this.longitudinalAccelMps2 = 0;
    this.longitudinalG = 0;
    this.lateralG = 0;

    // Filtered Output Throttle & Brake
    this.estimatedThrottle = 0; // 0.0 to 1.0
    this.estimatedBrake = 0;    // 0.0 to 1.0

    // Lateral dynamics (side-to-side G-force from cornering)
    this.lateralAccelMps2 = 0;
    this.lateralG = 0;

    // GPS ground speed
    this.gpsSpeedMps = 0;
    this.gpsAccuracyMeters = 0;
    this.gpsWatchId = null;

    // Tuning Parameters
    this.sensitivity = 1.0;
    this.regenThresholdG = -0.12;

    // Listeners
    this.motionHandler = this.onDeviceMotion.bind(this);
  }

  /**
   * Request permissions and initialize hardware sensors
   */
  async requestSensors() {
    // Check for iOS 13+ permission model
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const response = await DeviceMotionEvent.requestPermission();
        if (response === 'granted') {
          this.bindMotionListener();
        } else {
          console.warn('DeviceMotion permission denied by user.');
        }
      } catch (err) {
        console.error('Error requesting DeviceMotion permission:', err);
      }
    } else if ('DeviceMotionEvent' in window) {
      // Standard Android Chrome / WebKit
      this.bindMotionListener();
    }

    // Start GPS Location tracking
    this.startGpsTracking();
  }

  bindMotionListener() {
    window.addEventListener('devicemotion', this.motionHandler, { passive: true });
    this.hasSensorAccess = true;
    this.isActive = true;
  }

  /**
   * DeviceMotionEvent Handler (~60Hz on mobile)
   */
  onDeviceMotion(e) {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc || acc.x === null) return;

    // Low-pass filter raw readings to remove road vibration bumps
    const alpha = 0.25;
    this.rawAx += (acc.x - this.rawAx) * alpha;
    this.rawAy += (acc.y - this.rawAy) * alpha;
    this.rawAz += (acc.z - this.rawAz) * alpha;

    if (!this.gravityCalibrated) {
      // Auto-calibrate baseline gravity on first steady reading
      this.calibGx = this.rawAx;
      this.calibGy = this.rawAy;
      this.calibGz = this.rawAz;
      this.gravityCalibrated = true;
    }

    // Isolate vehicle forward acceleration by taking difference against calibrated mount orientation
    // Assuming phone is mounted upright facing driver or in console:
    // Dynamic acceleration component:
    const dX = this.rawAx - this.calibGx;
    const dY = this.rawAy - this.calibGy;
    const dZ = this.rawAz - this.calibGz;

    // Forward vector approximation (projecting onto phone's Y/Z tilt axis)
    const forwardAccel = -dY; // On typical upright phone mount, forward push pulls phone backwards along -Y
    this.longitudinalAccelMps2 = forwardAccel;
    this.longitudinalG = forwardAccel / 9.81;

    // Lateral vector approximation (phone X axis represents vehicle side-to-side cornering)
    const lateralAccel = dX;
    this.lateralAccelMps2 = lateralAccel;
    this.lateralG = lateralAccel / 9.81;

    // Map G-force to instant engine throttle:
    // Moderate EV acceleration produces +0.15G to +0.8G
    const deadband = 0.04; // Ignore subtle foot movement / road tilt
    if (this.longitudinalG > deadband) {
      // Positive acceleration -> Throttle
      const effectiveG = (this.longitudinalG - deadband) * this.sensitivity;
      this.estimatedThrottle = Math.min(1.0, effectiveG / 0.45); // ~0.45G = 100% throttle
      this.estimatedBrake = 0;
    } else if (this.longitudinalG < this.regenThresholdG) {
      // Negative acceleration -> Regen braking / deceleration
      const brakeMagnitude = Math.abs(this.longitudinalG);
      this.estimatedBrake = Math.min(1.0, brakeMagnitude / 0.6);
      this.estimatedThrottle = 0;
    } else {
      // Coasting / steady speed
      this.estimatedThrottle = Math.max(0, this.estimatedThrottle - 0.08);
      this.estimatedBrake = 0;
    }
  }

  /**
   * Calibrate Mount: User hits this button when vehicle is stationary
   */
  calibrateMountOrientation() {
    this.calibGx = this.rawAx;
    this.calibGy = this.rawAy;
    this.calibGz = this.rawAz;
    this.gravityCalibrated = true;
    return { x: this.calibGx.toFixed(2), y: this.calibGy.toFixed(2), z: this.calibGz.toFixed(2) };
  }

  /**
   * Starts GPS Geolocation speed tracking
   */
  startGpsTracking() {
    if (!('geolocation' in navigator)) {
      console.warn('Geolocation not supported on this browser.');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 5000
    };

    this.gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.hasGpsAccess = true;
        this.gpsAccuracyMeters = pos.coords.accuracy || 0;

        if (pos.coords.speed !== null && pos.coords.speed >= 0) {
          this.gpsSpeedMps = pos.coords.speed;
        }
      },
      (err) => {
        console.warn('GPS location tracking error:', err.message);
      },
      options
    );
  }

  stop() {
    if (this.hasSensorAccess) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.hasSensorAccess = false;
    }
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    this.isActive = false;
  }
}

window.RevverSensorManager = RevverSensorManager;
