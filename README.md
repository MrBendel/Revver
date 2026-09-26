# REVVER — Stuttgart 911 Heritage Cockpit & Virtual Powertrain

**Revver** transforms silent Electric Vehicles (EVs) into iconic Porsche 911 flat-6 powerhouses by fusing smartphone sensor telemetry (accelerometer + GPS) with an authentic procedural engine sound synthesizer and virtual multi-gear transmission.

Inspired by Ange Yaghi's [engine-sim](https://github.com/ange-yaghi/engine-sim) procedural combustion acoustics and classic Porsche 911 cockpit instrumentation.

---

## 🏎️ Core Features

### 1. Ange Yaghi's Engine-Sim Procedural Combustion Core (`engine_sim_processor.js`)
- **Web Audio AudioWorklet**: Runs dedicated real-time synthesis at 48,000 Hz off the main UI thread.
- **720° Four-Stroke Physical Crankshaft Dynamics**: Integrates instantaneous flywheel angular velocity ($\frac{d\omega}{dt} = \frac{\sum \tau}{I}$) sample-by-sample.
- **Mechanical Warble & Idle Lope**: Intra-cycle instantaneous angular velocity fluctuations ($\Delta\omega$ per cylinder combustion kick) provide natural pitch breathing and heartbeat idle lope.
- **Cycle-to-Cycle Thermodynamic Flame Jitter (`inputSampleNoise`)**: Random-walk variation in flame propagation speed, cylinder peak pressure, and ignition timing.
- **Pressure Derivative Shock Wave ($dP/dt$)**: Mixing scaled pressure derivatives creates the sharp, metallic valve-opening "crack" and snap.
- **Exhaust Collector Acoustic Transmission Lines**: Inverted negative open-end wave reflections ($R = -0.46$) and cross-bank balance pipe scavenging deliver authentic cavernous **throatiness**.
- **Physical Starter Motor Sequence**: 105 N·m series DC motor fighting cylinder TDC compression strokes with dynamic armature pitch sag (`whir-RRR-chug`), sequential combustion catch, and cold-start bypass flare to ~2,200 RPM.
- **Physical Shutdown Braking & Piston Recoil**: Closed-throttle compression thuds, piston rebound clunk at ~60 RPM, and manifold vacuum relief hiss.

### 2. Stuttgart Powertrain Models
- **Stuttgart 4.0L High-Rev Flat-6**: 9,000 RPM redline, 992 GT3 DNA, razor-sharp boxer howl.
- **Classic 993 RS 3.8L Flat-6**: 7,800 RPM redline, air-cooled boxer rasp, dry-sump mechanical clatter.
- **Stuttgart 3.7L Twin-Turbo Flat-6**: 911 Turbo S, heavy boost spool, wastegate flutter, deep boxer punch.
- **Shelby Beast 5.2L V8**: American crossplane 90° crank lope and heavy overrun burble.
- **Carrera GT 5.7L V10**: 8,500 RPM screaming Le Mans V10 symphony.
- **Group B 2.2L Turbo Inline-5**: Historic Audi Quattro 5-cylinder warble and wastegate chatter.
- **Custom Game WAV Importer**: Support for importing external .wav / .ogg sound loops (TORCS, VDrift, Assetto Corsa).

### 3. Porsche Transmissions & Drive Modes (`drivetrain.js`)
- **7-Speed PDK Dual-Clutch**: Porsche Doppelkupplung with 75ms torque cut.
- **8-Speed PDK (992 Spec)**: Rapid multi-gear shifts with launch control.
- **6-Speed G50 Manual**: Classic mechanical gate feel with auto rev-matching.
- **6-Speed Sequential GT3 Cup**: Straight-cut dog ring gear whine.
- **Sport Chrono Drive Modes**:
  - *Normal / Touring*: Shifts at relaxed town speeds (~2,200 RPM) for quiet commuting.
  - *Sport Dynamic*: Holds gears to 6,000+ RPM with dynamic kickdown blips.
  - *Sport Plus / Track*: Sings to redline at 8,500+ RPM.

### 4. Tire Acoustics & Lateral G Slip Simulation
- Speed-dependent pavement rolling hiss.
- Textured asphalt scrub friction on turn-in.
- Lateral G-force slip screech with progressive onset (Cup 2 R, P Zero, and Vintage 993 compounds).
- 48 kHz recorded tire skid acoustic loops.

### 5. Porsche Heritage Cockpit & Instruments (`index.html`, `style.css`, `app.js`)
- **Dual Display Modes**:
  - *Pure Tach & Digital Speedometer*: Focused driver display with bold digital speed and gear matrix.
  - *5-Gauge Heritage Binnacle*: Classic 911 5-dial array with oil temperature, oil pressure, fuel level, and speedometer.
- **Porsche Sport Chrono Stopwatch Pod**: Interactive dash-top analog/digital stopwatch.
- **F1 Shift Lights Bar**: Progressive jewel LEDs embedded in dash brow.
- **Porsche Le Mans Left-Hand Key Switch**: Interactive ignition key slot.
- **Fullscreen CarPlay / Android Auto HUD Mode**: Optimized for in-car dashboard touchscreens.

### 6. Smartphone Sensor Fusion (`sensors.js`)
- High-frequency 60 Hz accelerometer & gyroscope tracking (`DeviceMotionEvent`).
- Mount tilt gravity calibration to isolate true vehicle acceleration from phone tilt angle.
- Ground-truth GPS speed integration (`navigator.geolocation`).

---

## 🚀 Getting Started

### Local Development:
```bash
# Clone the repository
git clone https://github.com/MrBendel/Revver.git
cd Revver

# Start any local HTTP server (e.g. Python, Node.js, or npx serve)
npx serve -l 8080 .
# or
python -m http.server 8080
```
Open your browser at `http://localhost:8080/`.

### Controls:
- **[W]** or **[↑]**: Throttle / Full Gas
- **[S]** or **[↓]**: Brake
- **[A]** / **[D]**: Steering (Cornering Lateral G)
- **[E]** or **[→]**: Upshift (Right Paddle)
- **[Q]** or **[←]**: Downshift (Left Paddle)
- **[Spacebar]**: Throttle Blip / Exhaust Crackle Pop
- **Le Mans Key (Top Left)**: Start / Stop Engine
