import os
import subprocess
import sys
import glob

EMSDK_DIR = r"C:\Users\andre\emsdk"
EMXX = os.path.join(EMSDK_DIR, "upstream", "emscripten", "em++.exe")
BASE_DIR = r"c:\Users\andre\Documents\Antigravity\Revver"
BUILD_DIR = os.path.join(BASE_DIR, "build_wasm")
INC_DIR = os.path.join(BASE_DIR, "engine-sim-src", "include")
SCS_INC_DIR = os.path.join(BASE_DIR, "engine-sim-src", "dependencies", "submodules", "simple-2d-constraint-solver", "include")

SRC_DIR = os.path.join(BASE_DIR, "engine-sim-src", "src")
SCS_SRC_DIR = os.path.join(BASE_DIR, "engine-sim-src", "dependencies", "submodules", "simple-2d-constraint-solver", "src")

scs_sources = [
    os.path.join(SCS_SRC_DIR, f) for f in os.listdir(SCS_SRC_DIR) if f.endswith(".cpp")
]

core_engine_files = [
    "audio_buffer.cpp",
    "camshaft.cpp",
    "combustion_chamber.cpp",
    "connecting_rod.cpp",
    "convolution_filter.cpp",
    "crankshaft.cpp",
    "cylinder_bank.cpp",
    "cylinder_head.cpp",
    "delay_filter.cpp",
    "derivative_filter.cpp",
    "direct_throttle_linkage.cpp",
    "dynamometer.cpp",
    "engine.cpp",
    "exhaust_system.cpp",
    "feedback_comb_filter.cpp",
    "filter.cpp",
    "fuel.cpp",
    "function.cpp",
    "gas_system.cpp",
    "gaussian_filter.cpp",
    "governor.cpp",
    "ignition_module.cpp",
    "impulse_response.cpp",
    "intake.cpp",
    "jitter_filter.cpp",
    "leveling_filter.cpp",
    "low_pass_filter.cpp",
    "part.cpp",
    "piston.cpp",
    "piston_engine_simulator.cpp",
    "simulator.cpp",
    "standard_valvetrain.cpp",
    "starter_motor.cpp",
    "synthesizer.cpp",
    "throttle.cpp",
    "transmission.cpp",
    "utilities.cpp",
    "valvetrain.cpp",
    "vehicle.cpp",
    "vehicle_drag_constraint.cpp",
    "vtec_valvetrain.cpp"
]

engine_sources = [os.path.join(SRC_DIR, f) for f in core_engine_files]

app_sources = [
    (os.path.join(BASE_DIR, "engine_builder.cpp"), "engine_builder.o"),
    (os.path.join(BASE_DIR, "wasm_bridge.cpp"), "wasm_bridge.o")
]

all_to_compile = []
for s in scs_sources:
    fname = os.path.splitext(os.path.basename(s))[0] + "_scs.o"
    all_to_compile.append((s, fname))

for s in engine_sources:
    fname = os.path.splitext(os.path.basename(s))[0] + "_eng.o"
    all_to_compile.append((s, fname))

all_to_compile.extend(app_sources)

print(f"Checking {len(all_to_compile)} source files...", flush=True)
recompiled = 0
for src, obj_name in all_to_compile:
    obj_path = os.path.join(BUILD_DIR, obj_name)
    if not os.path.exists(obj_path) or os.path.getmtime(src) > os.path.getmtime(obj_path):
        print(f"Compiling {os.path.basename(src)} -> {obj_name}...", flush=True)
        cmd = [
            EMXX,
            "-c",
            "-O3",
            "-std=c++17",
            "-D__forceinline=inline",
            f"-I{BASE_DIR}",
            f"-I{INC_DIR}",
            f"-I{SCS_INC_DIR}",
            src,
            "-o",
            obj_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"FAILED compiling {src}:\n{res.stderr}")
            sys.exit(1)
        recompiled += 1

print(f"Recompiled {recompiled} files.", flush=True)
obj_files = glob.glob(os.path.join(BUILD_DIR, "*.o"))
print(f"Found {len(obj_files)} object files for linking.", flush=True)

# 3. Link into engine_sim.js and engine_sim.wasm
output_js = os.path.join(BASE_DIR, "engine_sim.js")
exported_funcs = [
    "_init_simulation",
    "_destroy_simulation",
    "_set_throttle",
    "_set_target_rpm",
    "_set_starter",
    "_set_ignition",
    "_set_clutch",
    "_set_gear",
    "_get_rpm",
    "_get_speed_kmh",
    "_get_manifold_pressure_bar",
    "_get_starter_active",
    "_get_ignition_active",
    "_render_audio_frames",
    "_malloc",
    "_free"
]

exported_runtime = [
    "ccall",
    "cwrap",
    "setValue",
    "getValue",
    "HEAPF32"
]

funcs_arg = "[" + ",".join([f"'{f}'" for f in exported_funcs]) + "]"
runtime_arg = "[" + ",".join([f"'{r}'" for r in exported_runtime]) + "]"

link_cmd = [
    EMXX,
    "-O3",
    "-s", "WASM=1",
    "-s", "ALLOW_MEMORY_GROWTH=1",
    "-s", "INITIAL_MEMORY=67108864", # 64MB initial memory
    "-s", f"EXPORTED_FUNCTIONS={funcs_arg}",
    "-s", f"EXPORTED_RUNTIME_METHODS={runtime_arg}",
    "-s", "INCOMING_MODULE_JS_API=['wasmBinary','instantiateWasm','locateFile','print','printErr']",
    "-s", "MODULARIZE=1",
    "-s", "EXPORT_ES6=1",
    "-s", "EXPORT_NAME=createEngineSim",
    *obj_files,
    "-o", output_js
]

print("Linking engine_sim.wasm and engine_sim.js...", flush=True)
res_link = subprocess.run(link_cmd, capture_output=True, text=True)
if res_link.returncode != 0:
    print(f"FAILED linking:\n{res_link.stderr}")
    sys.exit(1)

print("SUCCESS: engine_sim.wasm and engine_sim.js generated successfully!", flush=True)
if os.path.exists(os.path.join(BASE_DIR, "engine_sim.wasm")):
    size = os.path.getsize(os.path.join(BASE_DIR, "engine_sim.wasm"))
    print(f"engine_sim.wasm size: {size / 1024 / 1024:.2f} MB")
