// Global configuration constants

export const PHYSICS = {
  GRAVITY: 9.81,
  AIR_DENSITY_SEA_LEVEL: 1.225,
  WING_AREA: 38,
  WING_SPAN: 11,
  ASPECT_RATIO: 3.18,
  OSWALD_EFFICIENCY: 0.85,
  CD0: 0.015,                        // Lower drag = faster
  CL_MAX: 2.0,
  CL_PER_AOA: 6.0,
  MAX_AOA: 0.35,
  STALL_AOA: 0.30,
  MASS: 7000,
  MAX_THRUST: 180000,                 // More thrust = better acceleration
  IDLE_THRUST: 20000,
  MAX_SPEED: 700,                     // m/s - faster top speed
  MIN_SPEED_FOR_CONTROL: 30,
  PITCH_RATE: 2.5,
  ROLL_RATE: 4.5,
  YAW_RATE: 1.2,
  PITCH_DAMPING: 5.0,
  ROLL_DAMPING: 6.0,
  YAW_DAMPING: 4.0,
  AUTO_LEVEL_RATE: 0.8,
  VELOCITY_ALIGNMENT: 2.5,
  MIN_SPEED_CLAMP: 80,               // Higher min speed for arcade feel
};

export const WEAPONS = {
  MACHINE_GUN: {
    FIRE_RATE: 6000,
    MUZZLE_VELOCITY: 2000,
    MAX_RANGE: 3000,
    DAMAGE: 8,
    SPREAD: 0.008,
    AMMO: 500,
    TRACER_INTERVAL: 3,
    TRACER_LENGTH: 18,
    PROJECTILE_LIFE: 2,
  },
  MISSILE: {
    COUNT: 4,
    SPEED: 700,
    MAX_TURN_RATE: 120,
    LOCK_TIME: 1.5,                   // Faster lock for closer range
    LOCK_CONE: 0.4,                   // Wider cone
    GUIDANCE_GAIN: 8,
    MAX_RANGE: 1500,                  // Combat lock range
    LIFE_TIME: 8,
    DAMAGE: 100,
    ARM_DISTANCE: 60,
    PROXIMITY_FUSE: 15,
    JINK_EVADE_CHANCE: 0.6,          // Chance to break lock on a hard direction reversal
    JINK_G_MIN: 15,                   // Minimum G during the jink for it to count
  },
  FLARES: {
    COUNT: 30,
    COOLDOWN: 0.5,
    DURATION: 4,
    SPREAD: 40,
    DECOY_CHANCE: 0.20,            // 20% chance per flare to decoy a missile
    SALVO_COUNT: 3,
  },
};

export const AIRCRAFT = {
  HEALTH: 60,
  COLLISION_RADIUS: 8,
  LENGTH: 15,
  INITIAL_ALTITUDE: 800,             // Start higher
  INITIAL_SPEED: 350,                // Start faster
};

export const ENEMY = {
  DETECTION_RANGE: 3500,
  FIRE_RANGE: 500,                    // Closer fire range
  MISSILE_RANGE: 1200,                // AI missile fire range
  DISENGAGE_RANGE: 5000,
  PATROL_RADIUS: 2000,
  PATROL_ALTITUDE: 2200,              // Above max terrain height
  ACCURACY: 0.4,
  REACTION_TIME: 1.2,                 // Slower reactions — more human
  EVASION_CHANCE: 0.3,
  TURN_AGGRESSION: 0.5,              // How hard they turn (0-1, lower = wider turns)
  THROTTLE_CRUISE: 0.55,             // Cruising throttle
};

export const BALLOON = {
  COUNT: 6,
  HEALTH: 50,
  RESPAWN_TIME: 15,
  MIN_HEIGHT: 500,
  MAX_HEIGHT: 900,
  SPAWN_RADIUS: 4000,
  COLLISION_RADIUS: 55,
  FLY_THROUGH_RADIUS: 60,       // Radius for player fly-through destruction
  AMMO_REFILL: 500,
  MISSILE_REFILL: 2,
  FLARE_REFILL: 5,
};

export const TERRAIN = {
  SIZE: 20000,
  SEGMENTS: 256,
  MAX_HEIGHT: 1800,                   // Taller mountains = deeper canyons
  TEXTURE_REPEAT: 64,
  WATER_LEVEL: 5,
  COLLISION_MARGIN: 10,
};

export const WORLD = {
  FOG_NEAR: 5000,
  FOG_FAR: 18000,
  SUN_ELEVATION: 30,
  SUN_AZIMUTH: 45,
  AMBIENT_INTENSITY: 0.4,
  SUN_INTENSITY: 1.2,
  BOUNDARY_SOFT: 7000,   // Start turning player back
  BOUNDARY_HARD: 9000,   // Force turn back
};

export const CAMERA = {
  FOV: 65,
  NEAR: 1,
  FAR: 25000,
  CHASE_DISTANCE: 12,                // Ace Combat - tight behind
  CHASE_HEIGHT: 4,                    // Ace Combat - low over-the-shoulder
  CHASE_LERP: 5,                      // Responsive follow
  COCKPIT_OFFSET_Y: 1.5,
  COCKPIT_OFFSET_Z: 4,
};

export const RADAR = {
  RANGE: 5000,
  SWEEP_SPEED: 3,
  SIZE: 200,
};

export const AUDIO = {
  ENGINE_BASE_FREQ: 80,
  ENGINE_MAX_FREQ: 300,
  WIND_GAIN_FACTOR: 0.003,
  MAX_WIND_GAIN: 0.4,
};

export const PLANES = [
  // rotation: [rx, ry, rz] Euler angles to orient model so nose=-Z, top=+Y
  // engines: [{x,y}] offsets from tail center for thruster positioning (post-normalization units)
  { id: 'f16', name: 'F-16 FIGHTING FALCON', modelPath: 'assets/models/f16/scene.gltf',
    rotation: [Math.PI, 0, 0], engines: [{x: 0, y: 0}] },
  { id: 'f22', name: 'F-22 RAPTOR', modelPath: 'assets/models/f22/scene.gltf',
    rotation: [0, 0, Math.PI], engines: [{x: -1.5, y: 0}, {x: 1.5, y: 0}] },
  { id: 'j20', name: 'CHENGDU J-20', modelPath: 'assets/models/j20/scene.gltf',
    rotation: [Math.PI, 0, 0], engines: [{x: -1.0, y: 0}, {x: 1.0, y: 0}] },
  { id: 'mig21', name: 'MIG-21 FISHBED', modelPath: 'assets/models/mig21/scene.gltf',
    rotation: [0, 0, Math.PI], engines: [{x: 0, y: 0}] },
];

export const MAPS = [
  { id: 'island', name: 'ISLAND', description: 'Tropical island surrounded by ocean' },
  { id: 'coastal_city', name: 'COASTAL CITY', description: 'Desert canyons and a sprawling coastal metropolis' },
];
