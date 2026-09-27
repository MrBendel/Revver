#include "engine_builder.h"

#include "constants.h"
#include "units.h"
#include "direct_throttle_linkage.h"
#include "standard_valvetrain.h"
#include "camshaft.h"
#include "function.h"
#include "fuel.h"
#include "build_wasm/impulse_response_data.h"

#include <cmath>
#include <vector>

static Function* makeHarmonicCamLobe(double durationAt50Thou, double gamma, double lift, int steps = 100) {
    const double angle = durationAt50Thou / 4.0;
    const double s = std::pow(2.0 * units::distance(50, units::thou) / lift, 1.0 / gamma) - 1.0;
    const double k = std::acos(s) / angle;
    const double extents = constants::pi / k;
    const double step = extents / (steps - 5.0);

    Function *func = new Function;
    func->initialize(steps * 2 + 1, step);

    for (int i = 0; i < steps; ++i) {
        if (i == 0) {
            func->addSample(0.0, lift);
        } else {
            const double x = i * step;
            const double l = (x >= extents) ? 0.0 : lift * std::pow(0.5 + 0.5 * std::cos(k * x), gamma);
            func->addSample(x, l);
            func->addSample(-x, l);
        }
    }
    return func;
}

static Function* makeTurbulenceToFlameSpeedRatio() {
    Function *func = new Function;
    func->initialize(10, 5.0);
    func->addSample(0.0, 3.0);
    for (int i = 1; i <= 9; ++i) {
        double v = i * 5.0;
        func->addSample(v, 1.5 * v);
    }
    return func;
}

static Function* makeFlowCurve(bool isExhaust, double flowAttenuation = 1.0, double liftScale = 1.0) {
    Function *func = new Function;
    const double step = units::distance(50, units::thou);
    func->initialize(10, step);
    const double intakeSamples[] = {0.0, 58.0, 103.0, 156.0, 214.0, 249.0, 268.0, 280.0, 280.0, 281.0};
    const double exhaustSamples[] = {0.0, 37.0, 72.0, 113.0, 160.0, 196.0, 222.0, 235.0, 245.0, 246.0};
    const double *samples = isExhaust ? exhaustSamples : intakeSamples;
    for (int i = 0; i < 10; ++i) {
        func->addSample(i * step * liftScale, GasSystem::k_28inH2O(samples[i] * flowAttenuation));
    }
    return func;
}

static Function* makeTimingCurve(double idleAdvanceDeg, double maxAdvanceDeg, double maxRpm) {
    Function *func = new Function;
    func->initialize(6, units::rpm(1000.0));
    func->addSample(units::rpm(0.0), idleAdvanceDeg * units::deg);
    func->addSample(units::rpm(1000.0), idleAdvanceDeg * units::deg);
    func->addSample(units::rpm(2000.0), (idleAdvanceDeg + 5.0) * units::deg);
    func->addSample(units::rpm(3500.0), maxAdvanceDeg * units::deg);
    func->addSample(units::rpm(maxRpm), maxAdvanceDeg * units::deg);
    func->addSample(units::rpm(maxRpm + 2000.0), maxAdvanceDeg * units::deg);
    return func;
}

static Function* makeTurbulenceCurve() {
    Function *func = new Function;
    func->initialize(30, 1.0);
    for (int i = 0; i < 30; ++i) {
        func->addSample((double)i, (double)i * 0.5);
    }
    return func;
}

static Engine* buildEngineInternal(int profileId) {
    Engine *engine = new Engine();
    DirectThrottleLinkage *throttle = new DirectThrottleLinkage();
    DirectThrottleLinkage::Parameters throttleParams;
    throttleParams.gamma = 2.0;
    throttle->initialize(throttleParams);

    int cylinderCount = 6;
    int banks = 2;
    double redline = 9000.0;
    double stroke = units::distance(81.5, units::mm);
    double bore = units::distance(102.0, units::mm);
    double rodLength = units::distance(130.0, units::mm);
    double rodMass = units::mass(480.0, units::g);
    double pistonMass = units::mass(390.0, units::g);
    double bankAngle = 90.0 * units::deg; // +90 and -90 for flat boxer
    double simFreq = 8000.0;
    const char *name = "Porsche 4.0L Flat-6 GT3";

    if (profileId == PROFILE_TURBO_FLAT6) {
        name = "Porsche 3.7L Twin-Turbo Flat-6";
        stroke = units::distance(76.4, units::mm);
        bore = units::distance(102.0, units::mm);
        redline = 7200.0;
        simFreq = 8000.0;
    } else if (profileId == PROFILE_PANAMERA_V8) {
        name = "Porsche 4.0L Twin-Turbo V8";
        cylinderCount = 8;
        stroke = units::distance(86.0, units::mm);
        bore = units::distance(86.0, units::mm);
        bankAngle = 45.0 * units::deg; // 90 degree V8 (+45 and -45)
        redline = 7000.0;
        simFreq = 8000.0;
    } else if (profileId == PROFILE_CARRERA_V10) {
        name = "Porsche 5.7L V10 Carrera GT";
        cylinderCount = 10;
        stroke = units::distance(76.0, units::mm);
        bore = units::distance(98.0, units::mm);
        bankAngle = 34.0 * units::deg; // 68 degree V10 (+34 and -34)
        redline = 8900.0;
        simFreq = 7000.0;
    }

    Engine::Parameters params;
    params.name = name;
    params.starterTorque = units::torque(140.0, units::ft_lb);
    params.starterSpeed = units::rpm(400.0);
    params.redline = units::rpm(redline);
    params.crankshaftCount = 1;
    params.cylinderBanks = banks;
    params.cylinderCount = cylinderCount;
    params.exhaustSystemCount = 2;
    params.intakeCount = 1;
    params.throttle = throttle;
    params.initialHighFrequencyGain = 0.012;
    params.initialJitter = 0.35;
    params.initialNoise = 1.0;
    params.initialSimulationFrequency = simFreq;
    engine->initialize(params);

    // Fuel setup
    Fuel *fuel = engine->getFuel();
    Fuel::Parameters fParams;
    fParams.maxTurbulenceEffect = 3.0;
    fParams.maxBurningEfficiency = 0.85;
    fParams.turbulenceToFlameSpeedRatio = makeTurbulenceToFlameSpeedRatio();
    fuel->initialize(fParams);

    // Crankshaft
    const double compressionHeight = units::distance(1.2, units::inch);
    const double crankMass = units::mass(14.0, units::kg);
    const double flywheelMass = units::mass(7.0, units::kg);
    const double flywheelRadius = units::distance(6.5, units::inch);

    Crankshaft *c0 = engine->getCrankshaft(0);
    Crankshaft::Parameters crankParams;
    crankParams.crankThrow = stroke / 2.0;
    crankParams.mass = crankMass;
    crankParams.flywheelMass = flywheelMass;
    crankParams.frictionTorque = units::torque(1.2, units::ft_lb);
    crankParams.momentOfInertia = (crankMass * stroke * stroke / 4.0) + (0.5 * flywheelMass * flywheelRadius * flywheelRadius);
    crankParams.pos_x = 0;
    crankParams.pos_y = 0;
    crankParams.tdc = constants::pi;
    crankParams.rodJournals = cylinderCount;
    c0->initialize(crankParams);

    // Crank journals setup
    if (cylinderCount == 6) {
        // Boxer 6
        const double rjAngles[6] = {
            0.0 * units::deg, 120.0 * units::deg, 240.0 * units::deg,
            180.0 * units::deg, 300.0 * units::deg, 60.0 * units::deg
        };
        for (int i = 0; i < 6; ++i) c0->setRodJournalAngle(i, rjAngles[i]);
    } else if (cylinderCount == 8) {
        // Crossplane V8: 0, 90, 270, 180 (pairs share journals)
        const double rjAngles[8] = {
            0.0 * units::deg, 90.0 * units::deg, 270.0 * units::deg, 180.0 * units::deg,
            0.0 * units::deg, 90.0 * units::deg, 270.0 * units::deg, 180.0 * units::deg
        };
        for (int i = 0; i < 8; ++i) c0->setRodJournalAngle(i, rjAngles[i]);
    } else if (cylinderCount == 10) {
        // 72 degree V10
        const double v_angle = 72.0 * units::deg;
        const double rjAngles[10] = {
            0 * v_angle, 2 * v_angle, 3 * v_angle, 4 * v_angle, 1 * v_angle,
            0 * v_angle, 2 * v_angle, 3 * v_angle, 4 * v_angle, 1 * v_angle
        };
        for (int i = 0; i < 10; ++i) c0->setRodJournalAngle(i, rjAngles[i]);
    }

    // Cylinder Banks
    const int cylsPerBank = cylinderCount / 2;
    CylinderBank::Parameters bankParams;
    bankParams.bore = bore;
    bankParams.deckHeight = (stroke / 2.0) + rodLength + compressionHeight;
    bankParams.cylinderCount = cylsPerBank;
    bankParams.positionX = 0;
    bankParams.positionY = 0;
    bankParams.displayDepth = 0.4;

    CylinderBank *b0 = engine->getCylinderBank(0);
    bankParams.angle = bankAngle;
    bankParams.index = 0;
    b0->initialize(bankParams);

    CylinderBank *b1 = engine->getCylinderBank(1);
    bankParams.angle = -bankAngle;
    bankParams.index = 1;
    b1->initialize(bankParams);

    // Intake & Exhaust
    Intake *intake = engine->getIntake(0);
    Intake::Parameters intakeParams;
    intakeParams.volume = units::volume(profileId == PROFILE_TURBO_FLAT6 ? 4.5 : 3.5, units::L);
    intakeParams.CrossSectionArea = units::area(30.0, units::cm2);
    intakeParams.InputFlowK = GasSystem::k_carb(profileId == PROFILE_TURBO_FLAT6 ? 1400.0 : 1000.0);
    intakeParams.IdleFlowK = GasSystem::k_carb(0.0);
    intakeParams.RunnerFlowRate = GasSystem::k_carb(350.0);
    intakeParams.RunnerLength = units::distance(8.0, units::inch);
    intakeParams.IdleThrottlePlatePosition = 0.9965;
    intakeParams.VelocityDecay = 0.5;
    intakeParams.MolecularAfr = 25.0 / 2.0;
    intake->initialize(intakeParams);

    for (int i = 0; i < 2; ++i) {
        ExhaustSystem *exhaust = engine->getExhaustSystem(i);
        ExhaustSystem::Parameters exParams;
        exParams.length = units::distance(45.0, units::inch);
        exParams.collectorCrossSectionArea = units::area(20.0, units::cm2);
        exParams.outletFlowRate = GasSystem::k_carb(1400.0);
        exParams.primaryFlowRate = GasSystem::k_carb(600.0);
        exParams.primaryTubeLength = units::distance(20.0, units::inch);
        exParams.velocityDecay = 0.8;
        exParams.audioVolume = 2.4;
        exParams.impulseResponse = nullptr;
        exhaust->initialize(exParams);
    }

    // Cam Lobes & Valvetrain
    Function *intakeLobe = makeHarmonicCamLobe(250.0 * units::deg, 2.0, units::distance(12.5, units::mm));
    Function *exhaustLobe = makeHarmonicCamLobe(246.0 * units::deg, 2.0, units::distance(12.0, units::mm));
    Function *flowIntake = makeFlowCurve(false, 1.1, 1.0);
    Function *flowExhaust = makeFlowCurve(true, 1.0, 1.0);

    const double rot360 = 360.0 * units::deg;
    const double intakeCenter = 114.0 * units::deg;
    const double exhaustCenter = 114.0 * units::deg;
    const double cycle = 720.0 * units::deg;

    // Camshaft parameters
    Camshaft::Parameters camParams;
    camParams.advance = 0.0;
    camParams.baseRadius = units::distance(0.6, units::inch);
    camParams.crankshaft = c0;
    camParams.lobes = cylsPerBank;

    // Allocate camshafts and valvetrains for both heads
    for (int bankIdx = 0; bankIdx < 2; ++bankIdx) {
        Camshaft *intakeCam = new Camshaft();
        camParams.lobeProfile = intakeLobe;
        intakeCam->initialize(camParams);

        Camshaft *exhaustCam = new Camshaft();
        camParams.lobeProfile = exhaustLobe;
        exhaustCam->initialize(camParams);

        for (int c = 0; c < cylsPerBank; ++c) {
            double firingFraction = 0.0;
            if (cylinderCount == 6) {
                // Cylinders: 0,1,2 on Bank 0; 3,4,5 on Bank 1
                // Firing order: 0, 5, 1, 3, 2, 4
                int order = 0;
                if (bankIdx == 0) {
                    if (c == 0) order = 0;
                    else if (c == 1) order = 2;
                    else order = 4;
                } else {
                    if (c == 0) order = 3;
                    else if (c == 1) order = 5;
                    else order = 1;
                }
                firingFraction = (double)order / 6.0;
            } else if (cylinderCount == 8) {
                int order = (bankIdx == 0) ? (c * 2) : (c * 2 + 1);
                firingFraction = (double)order / 8.0;
            } else {
                int order = (bankIdx == 0) ? (c * 2) : (c * 2 + 1);
                firingFraction = (double)order / 10.0;
            }

            const double lobeOffset = firingFraction * cycle;
            intakeCam->setLobeCenterline(c, rot360 + intakeCenter + lobeOffset);
            exhaustCam->setLobeCenterline(c, rot360 - exhaustCenter + lobeOffset);
        }

        StandardValvetrain *valvetrain = new StandardValvetrain();
        StandardValvetrain::Parameters vtParams;
        vtParams.intakeCamshaft = intakeCam;
        vtParams.exhaustCamshaft = exhaustCam;
        valvetrain->initialize(vtParams);

        CylinderHead *head = engine->getHead(bankIdx);
        CylinderHead::Parameters headParams;
        headParams.Bank = (bankIdx == 0) ? b0 : b1;
        headParams.CombustionChamberVolume = units::volume(55.0, units::cc);
        headParams.ExhaustPortFlow = flowExhaust;
        headParams.IntakePortFlow = flowIntake;
        headParams.ExhaustRunnerCrossSectionArea = units::area(12.0, units::cm2);
        headParams.ExhaustRunnerVolume = units::volume(60.0, units::cc);
        headParams.IntakeRunnerCrossSectionArea = units::area(15.0, units::cm2);
        headParams.IntakeRunnerVolume = units::volume(120.0, units::cc);
        headParams.Valvetrain = valvetrain;
        headParams.FlipDisplay = (bankIdx == 1);
        head->initialize(headParams);

        head->setAllIntakes(intake);
        head->setAllExhaustSystems(engine->getExhaustSystem(bankIdx));
        head->setAllHeaderPrimaryLengths(units::distance(12.0 + bankIdx * 2.0, units::inch));
        for (int c = 0; c < cylsPerBank; ++c) head->setSoundAttenuation(c, 1.0);
    }

    // Pistons and Connecting Rods
    ConnectingRod::Parameters crParams;
    crParams.mass = rodMass;
    crParams.length = rodLength;
    crParams.momentOfInertia = rodMass * rodLength * rodLength / 12.0;
    crParams.centerOfMass = 0.0;
    crParams.crankshaft = c0;

    Piston::Parameters pParams;
    pParams.mass = pistonMass;
    pParams.CompressionHeight = compressionHeight;
    pParams.BlowbyFlowCoefficient = GasSystem::k_28inH2O(0.05);
    pParams.Displacement = 0.0;
    pParams.WristPinPosition = 0.0;

    for (int i = 0; i < cylinderCount; ++i) {
        const int bankIdx = (i < cylsPerBank) ? 0 : 1;
        const int cylInBank = (i < cylsPerBank) ? i : (i - cylsPerBank);

        ConnectingRod *rod = engine->getConnectingRod(i);
        crParams.journal = i;
        crParams.piston = engine->getPiston(i);
        rod->initialize(crParams);

        Piston *piston = engine->getPiston(i);
        pParams.Bank = (bankIdx == 0) ? b0 : b1;
        pParams.CylinderIndex = cylInBank;
        pParams.Rod = rod;
        piston->initialize(pParams);
    }

    // Ignition Module
    IgnitionModule *ignition = engine->getIgnitionModule();
    IgnitionModule::Parameters ignParams;
    ignParams.cylinderCount = cylinderCount;
    ignParams.crankshaft = c0;
    ignParams.limiterDuration = 0.08;
    ignParams.revLimit = units::rpm(redline);
    ignParams.timingCurve = makeTimingCurve(18.0, 34.0, redline);
    ignition->initialize(ignParams);

    for (int i = 0; i < cylinderCount; ++i) {
        double firingFraction = 0.0;
        if (cylinderCount == 6) {
            int order = 0;
            if (i == 0) order = 0;
            else if (i == 1) order = 2;
            else if (i == 2) order = 4;
            else if (i == 3) order = 3;
            else if (i == 4) order = 5;
            else order = 1;
            firingFraction = (double)order / 6.0;
        } else {
            const int bankIdx = (i < cylsPerBank) ? 0 : 1;
            const int c = (i < cylsPerBank) ? i : (i - cylsPerBank);
            int order = (bankIdx == 0) ? (c * 2) : (c * 2 + 1);
            firingFraction = (double)order / cylinderCount;
        }
        ignition->setFiringOrder(i, firingFraction * cycle);
    }

    // Combustion Chambers
    CombustionChamber::Parameters ccParams;
    ccParams.CrankcasePressure = units::pressure(1.0, units::atm);
    ccParams.Fuel = fuel;
    ccParams.StartingPressure = units::pressure(1.0, units::atm);
    ccParams.StartingTemperature = units::celcius(25.0);
    ccParams.MeanPistonSpeedToTurbulence = makeTurbulenceCurve();

    for (int i = 0; i < cylinderCount; ++i) {
        ccParams.Piston = engine->getPiston(i);
        ccParams.Head = engine->getHead(ccParams.Piston->getCylinderBank()->getIndex());
        engine->getChamber(i)->initialize(ccParams);
    }

    engine->calculateDisplacement();
    return engine;
}

SimulationInstance* createSimulationInstance(int profileId, float audioSampleRate) {
    SimulationInstance *inst = new SimulationInstance();
    inst->engine = buildEngineInternal(profileId);

    // Vehicle
    inst->vehicle = new Vehicle();
    Vehicle::Parameters vParams;
    vParams.mass = units::mass(1450.0, units::kg); // Porsche 911 GT3 mass
    vParams.dragCoefficient = 0.33;
    vParams.crossSectionArea = units::area(2.05, units::m2);
    vParams.diffRatio = 3.9;
    vParams.tireRadius = units::distance(0.33, units::m);
    vParams.rollingResistance = 350.0;
    inst->vehicle->initialize(vParams);

    // 6-Speed Transmission
    inst->transmission = new Transmission();
    const double gearRatios[6] = { 3.82, 2.26, 1.64, 1.29, 1.06, 0.88 };
    Transmission::Parameters tParams;
    tParams.GearCount = 6;
    tParams.GearRatios = gearRatios;
    tParams.MaxClutchTorque = units::torque(650.0, units::Nm);
    inst->transmission->initialize(tParams);

    // Create Simulator
    inst->simulator = inst->engine->createSimulator(inst->vehicle, inst->transmission);
    PistonEngineSimulator *pes = static_cast<PistonEngineSimulator*>(inst->simulator);
    pes->setFluidSimulationSteps(4);

    // Synthesizer setup
    Synthesizer::Parameters synthParams;
    synthParams.audioSampleRate = audioSampleRate;
    synthParams.inputSampleRate = static_cast<float>(inst->simulator->getSimulationFrequency());
    synthParams.inputChannelCount = inst->engine->getExhaustSystemCount();
    synthParams.inputBufferSize = 2048;
    synthParams.audioBufferSize = 44100;
    inst->simulator->synthesizer().initialize(synthParams);

    // Load authentic exhaust impulse response into synthesizer
    for (int i = 0; i < inst->engine->getExhaustSystemCount(); ++i) {
        inst->simulator->synthesizer().initializeImpulseResponse(
            DEFAULT_IR_DATA,
            DEFAULT_IR_LENGTH,
            2.2f,
            i
        );
    }

    Synthesizer::AudioParameters audioParams = inst->simulator->synthesizer().getAudioParameters();
    audioParams.volume = 1.0f;
    audioParams.convolution = 1.0f;
    audioParams.inputSampleNoise = static_cast<float>(inst->engine->getInitialJitter());
    audioParams.airNoise = static_cast<float>(inst->engine->getInitialNoise());
    audioParams.dF_F_mix = static_cast<float>(inst->engine->getInitialHighFrequencyGain());
    audioParams.airNoiseFrequencyCutoff = 2200.0f;
    audioParams.levelerTarget = 26000.0f;
    audioParams.levelerMaxGain = 2.0f;
    audioParams.levelerMinGain = 0.0001f;
    inst->simulator->synthesizer().setAudioParameters(audioParams);

    return inst;
}

void destroySimulationInstance(SimulationInstance *instance) {
    if (instance == nullptr) return;
    if (instance->simulator != nullptr) {
        instance->simulator->destroy();
        delete instance->simulator;
        instance->simulator = nullptr;
    }
    if (instance->engine != nullptr) {
        instance->engine->destroy();
        delete instance->engine;
        instance->engine = nullptr;
    }
    if (instance->transmission != nullptr) {
        delete instance->transmission;
        instance->transmission = nullptr;
    }
    if (instance->vehicle != nullptr) {
        delete instance->vehicle;
        instance->vehicle = nullptr;
    }
    delete instance;
}
