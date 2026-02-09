import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SceneManager } from './core/Scene.js';
import { InputManager } from './core/InputManager.js';
import { GameStateManager, GameState } from './core/GameStateManager.js';
import { Terrain } from './world/Terrain.js';
import { Sky } from './world/Sky.js';
import { Environment } from './world/Environment.js';
import { Aircraft } from './entities/Aircraft.js';
import { EnemyAircraft } from './entities/EnemyAircraft.js';
import { FlightModel } from './physics/FlightModel.js';
import { ProjectilePool } from './entities/Projectile.js';
import { MachineGun } from './weapons/MachineGun.js';
import { MissileSystem } from './weapons/Missile.js';
import { FlareSystem } from './weapons/Flares.js';
import { ExplosionSystem } from './effects/Explosions.js';
import { TrailSystem } from './effects/Trails.js';
import { PostProcessing } from './effects/PostProcessing.js';
import { HUD } from './hud/HUD.js';
import { Radar } from './hud/Radar.js';
import { TargetIndicator } from './hud/TargetIndicator.js';
import { AudioManager } from './audio/AudioManager.js';
import { Balloon } from './entities/Balloon.js';
import { BALLOON, AIRCRAFT } from './config.js';

class Game {
  constructor(modelTemplate) {
    this.modelTemplate = modelTemplate || null;

    // Core systems
    const canvas = document.getElementById('game-canvas');
    this.sceneManager = new SceneManager(canvas);
    this.input = new InputManager();
    this.gameState = new GameStateManager();
    this.clock = new THREE.Clock();

    // World
    this.terrain = new Terrain(this.sceneManager.scene);
    this.sky = new Sky(this.sceneManager.scene);
    this.environment = new Environment(this.sceneManager.scene);

    // Player
    this.player = new Aircraft(this.sceneManager.scene, this.modelTemplate);
    this.flightModel = new FlightModel();

    // Weapons
    this.projectilePool = new ProjectilePool(this.sceneManager.scene);
    this.machineGun = new MachineGun(this.projectilePool);
    this.missileSystem = new MissileSystem(this.sceneManager.scene);
    this.flareSystem = new FlareSystem(this.sceneManager.scene);
    this.aiFlareSystem = new FlareSystem(this.sceneManager.scene);

    // Effects
    this.explosions = new ExplosionSystem(this.sceneManager.scene);
    this.trails = new TrailSystem(this.sceneManager.scene);
    this.postProcessing = new PostProcessing();

    // HUD
    this.hud = new HUD();
    this.radar = new Radar();
    this.targetIndicator = new TargetIndicator();

    // Audio
    this.audio = new AudioManager();

    // Enemies
    this.enemies = [];
    this.enemyFlightModels = [];
    this.enemyGuns = [];

    // Balloons
    this.balloons = [];
    this.balloonRespawnTimers = [];


    // Track previous health for damage flash
    this.prevPlayerHealth = this.player.health;

    // Missile warning state
    this.missileWarningActive = false;

    // Lock tone timer
    this.lockToneTimer = 0;

    // Sonic boom tracking
    this.prevPlayerSpeed = 0;
    this.sonicBoomCooldown = 0;

    // Setup callbacks
    this.gameState.onStartCallback = () => this.onGameStart();
    this.gameState.onRestartCallback = () => this.onRestart();
    this.gameState.onSpawnWaveCallback = (wave, count) => this.spawnWave(wave, count);

    // Player trail
    this.playerTrail = null;

    // Start the game loop
    this.animate();
  }

  onGameStart() {
    this.audio.init();
    this.resetGame();
  }

  onRestart() {
    this.resetGame();
  }

  resetGame() {
    // Reset player
    this.player.reset();
    this.input.reset();

    // Reset weapons
    this.machineGun.reset();
    this.missileSystem.reset();
    this.flareSystem.reset();
    this.projectilePool.clear();

    // Clear enemies
    for (const enemy of this.enemies) {
      if (enemy.mesh) {
        this.sceneManager.scene.remove(enemy.mesh);
      }
    }
    this.enemies.length = 0;
    this.enemyFlightModels.length = 0;
    this.enemyGuns.length = 0;

    // Clear effects
    this.explosions.reset();
    this.trails.clear();
    this.postProcessing.reset();
    this.aiFlareSystem.reset();

    // Clear balloons
    for (const balloon of this.balloons) {
      balloon.destroy();
    }
    this.balloons.length = 0;
    this.balloonRespawnTimers.length = 0;

    // Spawn balloons
    this.spawnBalloons();

    // Setup player trail
    this.playerTrail = this.trails.createTrail(this.player);

    this.prevPlayerHealth = this.player.health;
    this.missileWarningActive = false;
  }

  spawnBalloons() {
    for (let i = 0; i < BALLOON.COUNT; i++) {
      this.spawnBalloon();
    }
  }

  spawnBalloon() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * BALLOON.SPAWN_RADIUS;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const groundH = this.terrain.getHeightAt(x, z);
    const y = Math.max(groundH + 100, BALLOON.MIN_HEIGHT) + Math.random() * (BALLOON.MAX_HEIGHT - BALLOON.MIN_HEIGHT);
    const pos = new THREE.Vector3(x, y, z);
    const balloon = new Balloon(this.sceneManager.scene, pos);
    this.balloons.push(balloon);
  }

  spawnWave(wave, count) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 3000 + Math.random() * 2000;
      const spawnX = this.player.position.x + Math.cos(angle) * dist;
      const spawnZ = this.player.position.z + Math.sin(angle) * dist;
      const groundH = this.terrain.getHeightAt(spawnX, spawnZ);
      const pos = new THREE.Vector3(
        spawnX,
        Math.max(400, groundH + 300) + Math.random() * 300,
        spawnZ
      );

      const enemy = new EnemyAircraft(this.sceneManager.scene, pos, this.modelTemplate);
      this.enemies.push(enemy);
      this.enemyFlightModels.push(new FlightModel());

      // Enemy gun (uses same projectile pool)
      const gun = new MachineGun(this.projectilePool);
      this.enemyGuns.push(gun);

      // Enemy trail
      this.trails.createTrail(enemy);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.05); // Cap delta time

    if (this.gameState.state === GameState.PLAYING) {
      try {
        this.update(dt);
      } catch (e) {
        console.error('Game update error:', e);
      }
    }

    // Always render
    this.sceneManager.render();
  }

  update(dt) {
    // Input
    this.input.update(dt);

    // Pause toggle
    if (this.input.pause) {
      this.gameState.togglePause();
      if (this.gameState.state === GameState.PAUSED) {
        this.audio.suspend();
        return;
      } else {
        this.audio.resume();
      }
    }

    // Camera toggle
    if (this.input.toggleCamera) {
      this.player.cameraMode = (this.player.cameraMode + 1) % 2;
    }

    // Flight physics - pass camera for mouse aim unprojection
    this.input.camera = this.sceneManager.camera;
    this.flightModel.update(this.player, this.input, dt);

    // Pass airbrake state to aircraft for HUD display
    this.player.airbrake = this.input.airbrake;

    // Terrain collision
    if (this.terrain.checkCollision(this.player.position)) {
      this.player.alive = false;
      this.explosions.spawn(this.player.position);
      this.audio.playExplosionSound(0);
      this.gameState.gameOver(false);
      return;
    }

    // Player mesh update
    this.player.updateMesh();

    // Weapons
    this.machineGun.update(dt, this.player, this.input.firing);
    if (this.machineGun.firing) {
      this.audio.playGunSound();
    }

    // Missile lock
    this.missileSystem.updateLock(this.player, this.enemies, dt);

    // Lock tone
    this.lockToneTimer -= dt;
    if (this.missileSystem.lockingTarget && this.lockToneTimer <= 0) {
      const isLocked = !!this.missileSystem.lockedTarget;
      this.audio.playLockTone(isLocked);
      this.lockToneTimer = isLocked ? 0.15 : 0.5;
    }

    // Fire missile
    if (this.input.fireMissile && this.missileSystem.lockedTarget) {
      this.missileSystem.fire(this.player);
      this.audio.playMissileSound();
    }

    // Flares
    if (this.input.deployFlares) {
      this.flareSystem.deploy(this.player);
      this.audio.playFlareSound();
    }
    this.flareSystem.update(dt);

    // Projectile hits
    const allTargets = [this.player, ...this.enemies, ...this.balloons];
    const hits = this.projectilePool.update(dt, allTargets, this.terrain);
    for (const hit of hits) {
      this.explosions.spawn(hit.position);
      this.postProcessing.addShake(0.3);
      this.audio.playExplosionSound(
        this.player.position.distanceTo(hit.position)
      );
    }

    // Small ground-hit explosions for bullets hitting terrain
    if (this.projectilePool.groundHits) {
      for (const pos of this.projectilePool.groundHits) {
        this.explosions.spawnSmall(pos);
      }
    }

    // Missile updates
    const activeFlares = [...this.flareSystem.getActiveFlares(), ...this.aiFlareSystem.getActiveFlares()];
    const detonations = this.missileSystem.update(dt, activeFlares);
    for (const pos of detonations) {
      this.explosions.spawn(pos);
      this.postProcessing.addShake(1.0);
      this.audio.playExplosionSound(
        this.player.position.distanceTo(pos)
      );
    }

    // Enemy AI & physics
    const incomingToPlayer = this.missileSystem.getMissilesTargeting(this.player);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const fm = this.enemyFlightModels[i];
      const gun = this.enemyGuns[i];

      if (!enemy.alive) {
        // Enemy destroyed
        this.explosions.spawn(enemy.position);
        this.audio.playExplosionSound(
          this.player.position.distanceTo(enemy.position)
        );
        if (this.hud.addKill) this.hud.addKill(enemy.lastDamageSource || 'gun');
        this.player.health = AIRCRAFT.HEALTH;
        this.machineGun.ammo = Math.min(this.machineGun.ammo + BALLOON.AMMO_REFILL, 500);
        this.missileSystem.playerMissileCount = Math.min(
          this.missileSystem.playerMissileCount + BALLOON.MISSILE_REFILL, 4
        );
        this.flareSystem.count = Math.min(
          this.flareSystem.count + BALLOON.FLARE_REFILL, 30
        );
        if (this.hud.showAmmoReplenish) this.hud.showAmmoReplenish();
        this.gameState.enemyKilled();

        this.sceneManager.scene.remove(enemy.mesh);
        this.enemies.splice(i, 1);
        this.enemyFlightModels.splice(i, 1);
        this.enemyGuns.splice(i, 1);
        continue;
      }

      // AI decision
      const incomingToEnemy = this.missileSystem.getMissilesTargeting(enemy);
      const aiInput = enemy.updateAI(dt, this.player, incomingToEnemy, this.terrain);

      // AI flight physics
      fm.update(enemy, aiInput, dt);

      // Hard altitude floor for AI — runs AFTER physics so it can't be overridden
      const groundH = this.terrain.getHeightAt(enemy.position.x, enemy.position.z);
      const minAlt = Math.max(groundH + 150, 200);
      if (enemy.position.y < minAlt) {
        enemy.position.y = minAlt;
        if (enemy.velocity.y < 0) enemy.velocity.y = 0;
      }

      // AI terrain collision (should never trigger now but kept as safety)
      if (this.terrain.checkCollision(enemy.position)) {
        enemy.alive = false;
        continue;
      }

      // AI weapons
      if (aiInput.firing) {
        gun.update(dt, enemy, true);
      } else {
        gun.update(dt, enemy, false);
      }

      // AI missile fire
      if (aiInput.fireMissile && this.player.alive) {
        this.missileSystem.fireAI(enemy, this.player);
      }

      // AI flare deploy
      if (aiInput.deployFlares && incomingToEnemy.length > 0) {
        this.aiFlareSystem.deployAt(enemy.position, enemy.velocity);
        aiInput.deployFlares = false;
      }

      // Enemy sonic boom
      const enemyPrevSpeed = enemy._prevSpeed || 0;
      if (enemyPrevSpeed < 343 && enemy.speed >= 343) {
        this.explosions.spawnSonicBoom(enemy.position.clone(), enemy.velocity.clone());
        const dist = this.player.position.distanceTo(enemy.position);
        if (dist < 5000) {
          this.audio.playSonicBoom();
          const shakeAmount = Math.max(0.2, 1.5 - dist * 0.0003);
          this.postProcessing.addShake(shakeAmount);
        }
      }
      enemy._prevSpeed = enemy.speed;

      enemy.updateMesh();
    }

    // Check incoming missiles to player for warning
    if (incomingToPlayer.length > 0 && !this.missileWarningActive) {
      this.missileWarningActive = true;
      this.audio.betty('MISSILE');
    } else if (incomingToPlayer.length === 0) {
      this.missileWarningActive = false;
    }
    if (this.hud.setMissileWarning) {
      this.hud.setMissileWarning(incomingToPlayer.length > 0);
    }

    // Altitude warning
    if (this.hud.warningText === 'PULL UP') {
      this.audio.betty('PULL UP');
    } else if (this.hud.warningText === 'STALL') {
      this.audio.betty('STALL');
    }

    // Damage flash
    if (this.player.health < this.prevPlayerHealth) {
      this.postProcessing.damageFlash();
      this.postProcessing.addShake(0.5);
    }
    this.prevPlayerHealth = this.player.health;

    // Check player death
    if (!this.player.alive) {
      this.explosions.spawn(this.player.position);
      this.audio.playExplosionSound(0);
      this.gameState.gameOver(false);
      return;
    }

    // Balloon updates
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const balloon = this.balloons[i];
      balloon.update(dt);

      // Fly-through destruction: player can destroy balloons by flying into them
      if (balloon.alive && this.player.alive) {
        const distToPlayer = this.player.position.distanceTo(balloon.position);
        if (distToPlayer < BALLOON.FLY_THROUGH_RADIUS) {
          balloon.alive = false;
        }
      }

      if (!balloon.alive) {
        this.explosions.spawn(balloon.position);
        this.audio.playExplosionSound(
          this.player.position.distanceTo(balloon.position)
        );
        // Replenish player ammo
        this.machineGun.ammo = Math.min(this.machineGun.ammo + BALLOON.AMMO_REFILL, 500);
        this.missileSystem.playerMissileCount = Math.min(
          this.missileSystem.playerMissileCount + BALLOON.MISSILE_REFILL, 4
        );
        this.flareSystem.count = Math.min(
          this.flareSystem.count + BALLOON.FLARE_REFILL, 30
        );
        if (this.hud.showAmmoReplenish) this.hud.showAmmoReplenish();
        balloon.destroy();
        this.balloons.splice(i, 1);
        // Schedule respawn
        this.balloonRespawnTimers.push(BALLOON.RESPAWN_TIME);
      }
    }

    // Balloon respawn timers
    for (let i = this.balloonRespawnTimers.length - 1; i >= 0; i--) {
      this.balloonRespawnTimers[i] -= dt;
      if (this.balloonRespawnTimers[i] <= 0) {
        this.spawnBalloon();
        this.balloonRespawnTimers.splice(i, 1);
      }
    }

    // Effects updates
    this.explosions.update(dt);
    this.trails.update(dt);
    this.aiFlareSystem.update(dt);
    this.postProcessing.update(dt, this.sceneManager.camera);
    this.environment.update(dt);
    this.terrain.update(dt);

    // Sky follow camera
    this.sky.update(this.sceneManager.camera.position);

    // Camera (pass zoom state for right-click zoom)
    this.player.updateCamera(this.sceneManager.camera, dt, this.input.zoom);

    // Audio
    this.audio.updateEngine(this.player.throttle, this.player.speed);
    this.audio.update(dt);

    // Sonic boom - crossing Mach 1 (343 m/s)
    this.sonicBoomCooldown = Math.max(0, this.sonicBoomCooldown - dt);
    const mach1 = 343;
    if (this.prevPlayerSpeed < mach1 && this.player.speed >= mach1 && this.sonicBoomCooldown <= 0) {
      this.audio.playSonicBoom();
      this.postProcessing.addShake(1.5);
      this.postProcessing.sonicBoomFlash();
      this.explosions.spawnSonicBoom(this.player.position.clone(), this.player.velocity.clone());
      this.sonicBoomCooldown = 3; // Prevent re-triggering for 3 seconds
    }
    this.prevPlayerSpeed = this.player.speed;

    // HUD
    this.hud.update(dt, this.player, this.machineGun, this.missileSystem, this.flareSystem, this.terrain);
    this.radar.update(dt, this.player, this.enemies, incomingToPlayer, this.balloons);
    this.targetIndicator.update(
      this.sceneManager.camera,
      this.player,
      this.enemies,
      this.missileSystem
    );

    // Game state
    this.gameState.update(dt);
  }
}

// Load GLTF model then start game
window.addEventListener('DOMContentLoaded', () => {
  const loader = new GLTFLoader();
  loader.load(
    'assets/models/f16/scene.gltf',
    (gltf) => {
      const modelTemplate = gltf.scene;
      modelTemplate.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      new Game(modelTemplate);
    },
    undefined,
    (error) => {
      console.warn('Failed to load F-16 model, using procedural mesh:', error);
      new Game(null);
    }
  );
});
