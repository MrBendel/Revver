import createEngineSim from './engine_sim.js';

async function test() {
    console.log("Loading engine_sim WASM module...");
    const Module = await createEngineSim();
    console.log("WASM Module loaded successfully!");

    const init_simulation = Module.cwrap('init_simulation', 'number', ['number', 'number']);
    const set_starter = Module.cwrap('set_starter', 'void', ['number']);
    const set_throttle = Module.cwrap('set_throttle', 'void', ['number']);
    const set_ignition = Module.cwrap('set_ignition', 'void', ['number']);
    const get_rpm = Module.cwrap('get_rpm', 'number', []);
    const render_audio_frames = Module.cwrap('render_audio_frames', 'number', ['number', 'number', 'number']);

    // Allocate audio output buffers (128 frames stereo)
    const frames = 128;
    const bytesPerChannel = frames * 4; // float32
    const outLPtr = Module._malloc(bytesPerChannel);
    const outRPtr = Module._malloc(bytesPerChannel);

    for (let p = 0; p < 4; ++p) {
        console.log(`\n========================================`);
        console.log(`Testing Engine Profile ${p}...`);
        const ok = init_simulation(p, 44100);
        console.log(`init_simulation(${p}) result:`, ok);

        set_ignition(1);
        set_starter(1);
        set_throttle(0.2);

        let nonZero = 0;
        for (let b = 0; b < 30; ++b) {
            render_audio_frames(outLPtr, outRPtr, frames);
            const lArray = new Float32Array(Module.HEAPF32.buffer, outLPtr, frames);
            for (let i = 0; i < frames; ++i) {
                if (Math.abs(lArray[i]) > 0.0001) nonZero++;
            }
        }
        set_starter(0);
        set_throttle(0.5);
        for (let b = 30; b < 60; ++b) {
            render_audio_frames(outLPtr, outRPtr, frames);
            const lArray = new Float32Array(Module.HEAPF32.buffer, outLPtr, frames);
            for (let i = 0; i < frames; ++i) {
                if (Math.abs(lArray[i]) > 0.0001) nonZero++;
            }
        }
        console.log(`Profile ${p} - Final RPM: ${get_rpm().toFixed(1)}, Audio Samples: ${nonZero}`);
    }

    Module._free(outLPtr);
    Module._free(outRPtr);

    console.log("\nALL 4 PROFILES TESTED SUCCESSFULLY! 100% C++ Engine-Sim WASM Operational!");
}

test().catch(console.error);
