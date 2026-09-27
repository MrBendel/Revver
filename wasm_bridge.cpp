#include <emscripten.h>
#include "engine_builder.h"
#include "synthesizer.h"
#include <algorithm>
#include <vector>

static SimulationInstance *g_instance = nullptr;
static float g_audioSampleRate = 44100.0f;
static std::vector<int16_t> g_pcmBuffer;

extern "C" {

EMSCRIPTEN_KEEPALIVE
int init_simulation(int profileId, float sampleRate) {
    if (g_instance != nullptr) {
        destroySimulationInstance(g_instance);
        g_instance = nullptr;
    }

    g_audioSampleRate = (sampleRate > 1000.0f) ? sampleRate : 44100.0f;
    g_instance = createSimulationInstance(profileId, g_audioSampleRate);
    if (g_instance == nullptr) return 0;

    // Start with ignition on, starter off
    g_instance->engine->getIgnitionModule()->m_enabled = true;
    g_instance->simulator->m_starterMotor.m_enabled = false;
    g_instance->transmission->changeGear(0); // Neutral
    g_instance->transmission->setClutchPressure(0.0); // Disengaged

    return 1;
}

EMSCRIPTEN_KEEPALIVE
void destroy_simulation() {
    if (g_instance != nullptr) {
        destroySimulationInstance(g_instance);
        g_instance = nullptr;
    }
}

static double g_targetRpm = 0.0;
static double g_targetRpmBlend = 0.0;

EMSCRIPTEN_KEEPALIVE
void set_throttle(float t) {
    if (g_instance != nullptr && g_instance->engine != nullptr) {
        double pedal = std::max(0.0, std::min(1.0, (double)t));
        // In engine-sim: 1.0 is closed plate (idle), 0.0 is wide open
        g_instance->engine->setThrottle(1.0 - pedal);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_target_rpm(float targetRpm, float strength) {
    g_targetRpm = (double)targetRpm;
    g_targetRpmBlend = std::max(0.0, std::min(1.0, (double)strength));
    if (g_instance != nullptr && g_instance->engine != nullptr && g_instance->engine->getCrankshaftCount() > 0) {
        if (targetRpm > 50.0f) {
            Crankshaft *crank = g_instance->engine->getCrankshaft(0);
            double targetOmega = -units::rpm(g_targetRpm);
            double currentOmega = crank->m_body.v_theta;
            crank->m_body.v_theta = currentOmega + (targetOmega - currentOmega) * g_targetRpmBlend;
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void set_starter(int active) {
    if (g_instance != nullptr && g_instance->simulator != nullptr) {
        g_instance->simulator->m_starterMotor.m_enabled = (active != 0);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_ignition(int active) {
    if (g_instance != nullptr && g_instance->engine != nullptr) {
        g_instance->engine->getIgnitionModule()->m_enabled = (active != 0);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_clutch(float clutch) {
    if (g_instance != nullptr && g_instance->transmission != nullptr) {
        double clamped = std::max(0.0, std::min(1.0, (double)clutch));
        g_instance->transmission->setClutchPressure(clamped);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_gear(int gear) {
    if (g_instance != nullptr && g_instance->transmission != nullptr) {
        g_instance->transmission->changeGear(gear);
    }
}

EMSCRIPTEN_KEEPALIVE
float get_rpm() {
    if (g_instance != nullptr && g_instance->engine != nullptr) {
        return (float)g_instance->engine->getRpm();
    }
    return 0.0f;
}

EMSCRIPTEN_KEEPALIVE
float get_speed_kmh() {
    if (g_instance != nullptr && g_instance->vehicle != nullptr) {
        // vehicle speed is in m/s, convert to km/h
        return (float)(g_instance->vehicle->getSpeed() * 3.6);
    }
    return 0.0f;
}

EMSCRIPTEN_KEEPALIVE
float get_manifold_pressure_bar() {
    if (g_instance != nullptr && g_instance->engine != nullptr) {
        // Pa to bar (1 bar = 100,000 Pa)
        return (float)(g_instance->engine->getManifoldPressure() / 100000.0);
    }
    return 1.0f;
}

EMSCRIPTEN_KEEPALIVE
int get_starter_active() {
    if (g_instance != nullptr && g_instance->simulator != nullptr) {
        return g_instance->simulator->m_starterMotor.m_enabled ? 1 : 0;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int get_ignition_active() {
    if (g_instance != nullptr && g_instance->engine != nullptr) {
        return g_instance->engine->getIgnitionModule()->m_enabled ? 1 : 0;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int render_audio_frames(float *outL, float *outR, int frames) {
    if (g_instance == nullptr || g_instance->simulator == nullptr) {
        for (int i = 0; i < frames; ++i) {
            outL[i] = 0.0f;
            outR[i] = 0.0f;
        }
        return frames;
    }

    Simulator *sim = g_instance->simulator;
    Synthesizer &synth = sim->synthesizer();

    if (g_pcmBuffer.size() < (size_t)frames) {
        g_pcmBuffer.resize(frames);
    }

    // Step physics for the exact duration of the requested audio frame block
    const double dt = (double)frames / (double)g_audioSampleRate;

    if (g_targetRpm > 50.0 && g_targetRpmBlend > 0.0 && g_instance->engine != nullptr && g_instance->engine->getCrankshaftCount() > 0) {
        Crankshaft *crank = g_instance->engine->getCrankshaft(0);
        double targetOmega = -units::rpm(g_targetRpm);
        double currentOmega = crank->m_body.v_theta;
        crank->m_body.v_theta = currentOmega + (targetOmega - currentOmega) * g_targetRpmBlend;
    }

    sim->startFrame(dt);

    int maxStepsAllowed = 50;
    int stepsRun = 0;
    while (sim->simulateStep() && stepsRun < maxStepsAllowed) {
        stepsRun++;
    }
    sim->endFrame();

    // Render audio directly into PCM 16-bit buffer
    int rendered = synth.renderAudioDirect(frames, g_pcmBuffer.data());

    // Convert PCM 16-bit to float [-1.0, 1.0] and output to stereo channels
    constexpr float pcmToFloat = 1.0f / 32768.0f;
    for (int i = 0; i < rendered; ++i) {
        float sample = (float)g_pcmBuffer[i] * pcmToFloat;
        outL[i] = sample;
        outR[i] = sample;
    }

    for (int i = rendered; i < frames; ++i) {
        outL[i] = 0.0f;
        outR[i] = 0.0f;
    }

    return rendered;
}

} // extern "C"
