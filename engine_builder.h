#ifndef ENGINE_BUILDER_H
#define ENGINE_BUILDER_H

#include "engine.h"
#include "vehicle.h"
#include "transmission.h"
#include "piston_engine_simulator.h"

enum EngineProfile {
    PROFILE_GT3_FLAT6 = 0,
    PROFILE_TURBO_FLAT6 = 1,
    PROFILE_PANAMERA_V8 = 2,
    PROFILE_CARRERA_V10 = 3
};

struct SimulationInstance {
    Engine *engine = nullptr;
    Vehicle *vehicle = nullptr;
    Transmission *transmission = nullptr;
    Simulator *simulator = nullptr;
};

SimulationInstance* createSimulationInstance(int profileId, float audioSampleRate);
void destroySimulationInstance(SimulationInstance *instance);

#endif // ENGINE_BUILDER_H
