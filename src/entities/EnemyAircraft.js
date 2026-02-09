import * as THREE from 'three';
import { Aircraft } from './Aircraft.js';
import { ENEMY, PHYSICS, AIRCRAFT, WEAPONS, WORLD } from '../config.js';

const AIState = {
  PATROL: 'patrol',
  ENGAGE: 'engage',
  EVADE: 'evade',
  RETURN: 'return',
};

export class EnemyAircraft extends Aircraft {
  constructor(scene, spawnPosition, modelTemplate) {
    super(scene, modelTemplate);

    // Override position
    this.position.copy(spawnPosition || new THREE.Vector3(
      (Math.random() - 0.5) * 4000,
      ENEMY.PATROL_ALTITUDE + Math.random() * 200,
      (Math.random() - 0.5) * 4000
    ));

    // Random initial heading
    const angle = Math.random() * Math.PI * 2;
    this.velocity.set(
      Math.sin(angle) * AIRCRAFT.INITIAL_SPEED * 0.8,
      0,
      Math.cos(angle) * AIRCRAFT.INITIAL_SPEED * 0.8
    );
    this.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      this.velocity.clone().normalize()
    );

    // AI state
    this.aiState = AIState.PATROL;
    this.stateTimer = 0;
    this.reactionTimer = ENEMY.REACTION_TIME;
    this.target = null;

    // Patrol parameters
    this.patrolCenter = this.position.clone();
    this.patrolAngle = angle;
    this.patrolRadius = ENEMY.PATROL_RADIUS;

    // Combat
    this.fireTimer = 0;
    this.burstTimer = 0;        // How long current burst lasts
    this.burstCooldown = 0;     // Pause between bursts
    this.missileTimer = 8;      // Longer cooldown before first missile
    this.hasFiredMissile = false;
    this.flareCooldown = 0;
    this.ammo = WEAPONS.MACHINE_GUN.AMMO;

    // Personality — slight random variation per bot
    this.aggression = 0.3 + Math.random() * 0.4;  // 0.3-0.7
    this.skillLevel = 0.3 + Math.random() * 0.4;  // 0.3-0.7

    // Commit to maneuvers: pick a turn direction and hold it
    this._commitTimer = 0;
    this._commitRoll = 0;
    this._commitPitch = 0;

    // AI input state (mimics InputManager)
    this.aiInput = {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0.6,
      firing: false,
      fireMissile: false,
      deployFlares: false,
    };

    // Different color for enemies
    this.recolorMesh();
  }

  recolorMesh() {
    this.mesh.traverse((child) => {
      if (child.isMesh && child.material &&
          child !== this.exhaustMesh && child !== this.afterburnerMesh) {
        if (child.material.color) {
          child.material = child.material.clone();
          child.material.color.set(0x885544);
        }
      }
    });
  }

  updateAI(dt, playerAircraft, incomingMissiles, terrain) {
    if (!this.alive) return this.aiInput;

    this.terrain = terrain;
    this.stateTimer += dt;
    this.reactionTimer -= dt;
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    this._commitTimer = Math.max(0, this._commitTimer - dt);

    const distToPlayer = this.position.distanceTo(playerAircraft.position);
    const toPlayer = playerAircraft.position.clone().sub(this.position);
    const toPlayerDir = toPlayer.clone().normalize();
    const forward = this.getForwardDirection();
    const dotToPlayer = forward.dot(toPlayerDir);

    // State transitions
    this.updateState(dt, distToPlayer, dotToPlayer, playerAircraft, incomingMissiles);

    // Execute behavior based on state
    switch (this.aiState) {
      case AIState.PATROL:
        this.doPatrol(dt);
        break;
      case AIState.ENGAGE:
        this.doEngage(dt, playerAircraft, distToPlayer, toPlayerDir, dotToPlayer);
        break;
      case AIState.EVADE:
        this.doEvade(dt, incomingMissiles);
        break;
      case AIState.RETURN:
        this.doReturn(dt);
        break;
    }

    // Safety: avoid terrain and map boundaries (highest priority)
    this.avoidTerrain(dt, terrain);

    return this.aiInput;
  }

  updateState(dt, distToPlayer, dotToPlayer, player, incomingMissiles) {
    // Check for incoming missiles - priority evade
    if (incomingMissiles && incomingMissiles.length > 0 && this.aiState !== AIState.EVADE) {
      this.aiState = AIState.EVADE;
      this.stateTimer = 0;
      this.aiInput.deployFlares = true;
      return;
    }

    switch (this.aiState) {
      case AIState.PATROL:
        if (distToPlayer < ENEMY.DETECTION_RANGE && player.alive && this.reactionTimer <= 0) {
          this.aiState = AIState.ENGAGE;
          this.target = player;
          this.stateTimer = 0;
        }
        break;

      case AIState.ENGAGE:
        if (!player.alive || distToPlayer > ENEMY.DISENGAGE_RANGE) {
          this.aiState = AIState.RETURN;
          this.stateTimer = 0;
        }
        break;

      case AIState.EVADE:
        if (this.stateTimer > 4 || (!incomingMissiles || incomingMissiles.length === 0)) {
          this.aiState = distToPlayer < ENEMY.DETECTION_RANGE ? AIState.ENGAGE : AIState.RETURN;
          this.stateTimer = 0;
        }
        break;

      case AIState.RETURN:
        const distToPatrol = this.position.distanceTo(this.patrolCenter);
        if (distToPatrol < ENEMY.PATROL_RADIUS * 0.5) {
          this.aiState = AIState.PATROL;
          this.stateTimer = 0;
        } else if (distToPlayer < ENEMY.DETECTION_RANGE * 0.6 && player.alive) {
          this.aiState = AIState.ENGAGE;
          this.stateTimer = 0;
        }
        break;
    }
  }

  doPatrol(dt) {
    // Fly in a wide, lazy circle
    this.patrolAngle += dt * 0.2;
    const targetPos = new THREE.Vector3(
      this.patrolCenter.x + Math.cos(this.patrolAngle) * this.patrolRadius,
      ENEMY.PATROL_ALTITUDE,
      this.patrolCenter.z + Math.sin(this.patrolAngle) * this.patrolRadius
    );

    this.steerToward(targetPos, dt, 0.25);
    this.aiInput.throttle = ENEMY.THROTTLE_CRUISE;
    this.aiInput.firing = false;
    this.aiInput.fireMissile = false;
  }

  doEngage(dt, player, distToPlayer, toPlayerDir, dotToPlayer) {
    // Human-like engagement: fly toward the player in wide arcs, not perfect pursuit

    // Commit to maneuvers for a while instead of perfectly tracking frame-by-frame
    if (this._commitTimer <= 0) {
      this._commitTimer = 1.0 + Math.random() * 1.5; // Hold maneuver for 1-2.5 seconds

      if (distToPlayer > 1500) {
        // Far away: fly mostly straight toward player, gentle turns
        const leadPos = this.calculateLeadPosition(player);
        const toTarget = leadPos.clone().sub(this.position).normalize();
        const right = this.getRightDirection();
        const up = this.getUpDirection();

        this._commitRoll = THREE.MathUtils.clamp(right.dot(toTarget) * 2 * this.aggression, -0.6, 0.6);
        this._commitPitch = THREE.MathUtils.clamp(-up.dot(toTarget) * 2 * this.aggression, -0.5, 0.5);
      } else if (distToPlayer > 400) {
        // Medium range: pursue with moderate aggression
        const leadPos = this.calculateLeadPosition(player);
        const toTarget = leadPos.clone().sub(this.position).normalize();
        const right = this.getRightDirection();
        const up = this.getUpDirection();

        this._commitRoll = THREE.MathUtils.clamp(right.dot(toTarget) * 2.5 * this.aggression, -0.8, 0.8);
        this._commitPitch = THREE.MathUtils.clamp(-up.dot(toTarget) * 2.5 * this.aggression, -0.7, 0.7);
      } else {
        // Close range: pull hard to get guns on, but commit to the turn direction
        const right = this.getRightDirection();
        const sideOfTarget = right.dot(toPlayerDir);
        this._commitRoll = sideOfTarget > 0 ? 0.7 : -0.7;
        this._commitPitch = 0.5 + this.aggression * 0.3;
      }
    }

    // Apply committed maneuver (smoothed)
    const smooth = Math.min(1, dt * 3);
    this.aiInput.roll += (this._commitRoll - this.aiInput.roll) * smooth;
    this.aiInput.pitch += (this._commitPitch - this.aiInput.pitch) * smooth;
    this.aiInput.yaw = this.aiInput.roll * 0.15; // light coordinated yaw

    // Throttle — predictable, keeps moderate speed
    if (distToPlayer > 2000) {
      this.aiInput.throttle = 0.85;
    } else if (distToPlayer < 300) {
      this.aiInput.throttle = 0.35; // Overshooting, slow down
    } else {
      this.aiInput.throttle = ENEMY.THROTTLE_CRUISE + this.aggression * 0.2;
    }

    // Firing logic — burst fire with pauses
    this.fireTimer -= dt;
    this.missileTimer -= dt;
    this.burstCooldown -= dt;

    if (distToPlayer < ENEMY.FIRE_RANGE && dotToPlayer > 0.92 && this.reactionTimer <= 0) {
      if (this.burstCooldown <= 0) {
        this.aiInput.firing = true;
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          // End burst, start cooldown
          this.burstCooldown = 0.8 + Math.random() * 1.2; // 0.8-2s pause between bursts
          this.burstTimer = 0.3 + Math.random() * 0.5;    // 0.3-0.8s burst length
        }
      } else {
        this.aiInput.firing = false;
      }
    } else {
      this.aiInput.firing = false;
      this.burstTimer = 0.3 + Math.random() * 0.5; // Reset burst for next pass
    }

    // Missile logic — less aggressive, longer cooldowns
    if (distToPlayer < ENEMY.MISSILE_RANGE && distToPlayer > 600 &&
        dotToPlayer > 0.85 && this.missileTimer <= 0 && !this.hasFiredMissile) {
      this.aiInput.fireMissile = true;
      this.hasFiredMissile = true;
      this.missileTimer = 15;
    } else {
      this.aiInput.fireMissile = false;
    }
  }

  doEvade(dt, incomingMissiles) {
    this.aiInput.throttle = 0.9;
    this.aiInput.firing = false;
    this.aiInput.fireMissile = false;

    // Pick one evasion direction and commit
    if (incomingMissiles && incomingMissiles.length > 0) {
      const missile = incomingMissiles[0];
      const toMissile = missile.position.clone().sub(this.position).normalize();
      const right = this.getRightDirection();

      // Break perpendicular, but hold the maneuver (don't jitter)
      if (this._commitTimer <= 0) {
        this._commitTimer = 1.5 + Math.random();
        this._commitRoll = right.dot(toMissile) > 0 ? -0.8 : 0.8;
        this._commitPitch = 0.7;
      }

      const smooth = Math.min(1, dt * 2);
      this.aiInput.roll += (this._commitRoll - this.aiInput.roll) * smooth;
      this.aiInput.pitch += (this._commitPitch - this.aiInput.pitch) * smooth;

      if (this.flareCooldown <= 0) {
        this.aiInput.deployFlares = true;
        this.flareCooldown = 3;
      }
    } else {
      // Gentle S-turn while no immediate threat
      this.aiInput.roll = Math.sin(this.stateTimer * 2) * 0.5;
      this.aiInput.pitch = 0.3;
    }
  }

  doReturn(dt) {
    this.steerToward(this.patrolCenter.clone().setY(ENEMY.PATROL_ALTITUDE), dt, 0.35);
    this.aiInput.throttle = ENEMY.THROTTLE_CRUISE;
    this.aiInput.firing = false;
    this.aiInput.fireMissile = false;
  }

  calculateLeadPosition(target) {
    const toTarget = target.position.clone().sub(this.position);
    const dist = toTarget.length();
    const closingSpeed = this.speed + target.speed;
    const timeToIntercept = dist / Math.max(closingSpeed, 100);

    // Predict target position — use skill level to make lead less perfect
    const leadAccuracy = this.skillLevel * 0.5; // 0.15-0.35 (much less accurate)
    const leadPos = target.position.clone().add(
      target.velocity.clone().multiplyScalar(timeToIntercept * leadAccuracy)
    );

    // Clamp above terrain
    if (this.terrain && this.terrain.getHeightAt) {
      const groundH = this.terrain.getHeightAt(leadPos.x, leadPos.z);
      leadPos.y = Math.max(leadPos.y, groundH + 200);
    }

    return leadPos;
  }

  steerToward(targetPos, dt, aggression) {
    const toTarget = targetPos.clone().sub(this.position);
    const toTargetDir = toTarget.normalize();
    const forward = this.getForwardDirection();
    const right = this.getRightDirection();
    const up = this.getUpDirection();

    const pitchDot = up.dot(toTargetDir);
    this.aiInput.pitch = THREE.MathUtils.clamp(-pitchDot * 2 * aggression, -0.7, 0.7);

    const yawDot = right.dot(toTargetDir);
    this.aiInput.roll = THREE.MathUtils.clamp(yawDot * 2 * aggression, -0.7, 0.7);

    this.aiInput.yaw = THREE.MathUtils.clamp(yawDot * 0.3 * aggression, -0.2, 0.2);
  }

  avoidTerrain(dt, terrain) {
    const forward = this.getForwardDirection();
    const right = this.getRightDirection();

    let groundHeight = 0;
    if (terrain && terrain.getHeightAt) {
      groundHeight = terrain.getHeightAt(this.position.x, this.position.z);

      for (let t = 1; t <= 5; t++) {
        const dist = this.speed * t;
        const ax = this.position.x + forward.x * dist;
        const az = this.position.z + forward.z * dist;
        const ah = terrain.getHeightAt(ax, az);
        groundHeight = Math.max(groundHeight, ah);
      }

      for (const side of [-1, 1]) {
        const sx = this.position.x + right.x * 100 * side + forward.x * this.speed;
        const sz = this.position.z + right.z * 100 * side + forward.z * this.speed;
        const sh = terrain.getHeightAt(sx, sz);
        groundHeight = Math.max(groundHeight, sh);
      }
    }

    const minAbsolute = 200;
    const effectiveGround = Math.max(groundHeight, minAbsolute);
    const altitudeAboveGround = this.position.y - effectiveGround;

    if (this.position.y < effectiveGround + 100) {
      this.position.y = effectiveGround + 100;
      if (this.velocity.y < 0) this.velocity.y = Math.abs(this.velocity.y) * 0.5;
    }

    const verticalSpeed = this.velocity.y;
    const descendingFast = verticalSpeed < -20;

    if (altitudeAboveGround < 250 || (altitudeAboveGround < 500 && descendingFast)) {
      this.aiInput.pitch = 1.0;
      this.aiInput.roll = 0;
      this.aiInput.yaw = 0;
      this.aiInput.throttle = 1.0;
      return;
    }

    if (altitudeAboveGround < 500) {
      this.aiInput.pitch = Math.max(this.aiInput.pitch, 0.8);
      this.aiInput.throttle = Math.max(this.aiInput.throttle, 0.9);
      this.aiInput.roll *= 0.2;
    } else if (altitudeAboveGround < 800) {
      this.aiInput.pitch = Math.max(this.aiInput.pitch, 0.4);
      this.aiInput.throttle = Math.max(this.aiInput.throttle, 0.7);
    }

    // Stay within world bounds
    const softBound = WORLD.BOUNDARY_SOFT - 1000;
    const hardBound = WORLD.BOUNDARY_HARD - 1000;
    const distFromCenter = Math.sqrt(this.position.x * this.position.x + this.position.z * this.position.z);

    if (distFromCenter > softBound) {
      const toCenter = new THREE.Vector3(-this.position.x, 0, -this.position.z).normalize();
      const urgency = THREE.MathUtils.clamp((distFromCenter - softBound) / (hardBound - softBound), 0, 1);

      if (urgency > 0.6) {
        this.steerToward(new THREE.Vector3(0, ENEMY.PATROL_ALTITUDE, 0), dt, 1.0);
        this.aiInput.throttle = 0.8;
      } else {
        const yawDot = right.dot(toCenter);
        const rollCorrection = THREE.MathUtils.clamp(yawDot * 4 * urgency, -1, 1);
        this.aiInput.roll = THREE.MathUtils.lerp(this.aiInput.roll, rollCorrection, urgency);
        this.aiInput.pitch = Math.max(this.aiInput.pitch, 0.3 * urgency);
      }
    }
  }

  reset() {
    super.reset();
    this.aiState = AIState.PATROL;
    this.stateTimer = 0;
    this.reactionTimer = ENEMY.REACTION_TIME;
    this.fireTimer = 0;
    this.burstTimer = 0.3;
    this.burstCooldown = 0;
    this.missileTimer = 8;
    this.hasFiredMissile = false;
    this.ammo = WEAPONS.MACHINE_GUN.AMMO;
    this._commitTimer = 0;
    this.position.set(
      (Math.random() - 0.5) * 4000,
      ENEMY.PATROL_ALTITUDE + Math.random() * 200,
      (Math.random() - 0.5) * 4000
    );
  }
}
