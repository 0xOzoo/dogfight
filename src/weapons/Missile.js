import * as THREE from 'three';
import { WEAPONS } from '../config.js';

export class Missile {
  constructor(scene, position, velocity, target, owner) {
    this.scene = scene;
    this.position = position.clone();
    this.velocity = velocity.clone().normalize().multiplyScalar(WEAPONS.MISSILE.SPEED);
    this.target = target;
    this.owner = owner;
    this.alive = true;
    this.age = 0;
    this.armed = false;
    this.distanceTraveled = 0;

    // Track which flares we already rolled against (one check per flare)
    this._checkedFlares = new Set();

    // Jink detection: track target's acceleration direction to detect reversals
    this._prevTargetAccelDir = null;
    this._jinkCooldown = 0; // prevent multiple triggers from one maneuver

    // Create missile mesh
    this.mesh = this.createMesh();
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);

    // Smoke trail - thick ribbon
    this.smokeMaxPoints = 120;
    this.smokePoints = [];     // { pos, age, width }
    this.smokeGeometry = new THREE.BufferGeometry();
    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.Mesh(this.smokeGeometry, this.smokeMaterial);
    this.smokeMesh.frustumCulled = false;
    this.scene.add(this.smokeMesh);

    this.smokeSpawnTimer = 0;
  }

  createMesh() {
    const group = new THREE.Group();

    // Body - much bigger
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.5, 6, 8),
      new THREE.MeshPhongMaterial({ color: 0xcccccc })
    );
    body.rotation.x = Math.PI / 2;
    group.add(body);

    // Nose cone
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.2, 8),
      new THREE.MeshPhongMaterial({ color: 0x888888 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = -3.6;
    group.add(nose);

    // Fins - bigger
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.04, 1.0),
        new THREE.MeshPhongMaterial({ color: 0x999999 })
      );
      fin.position.z = 2.5;
      fin.rotation.z = (Math.PI / 2) * i;
      group.add(fin);
    }

    // Exhaust glow - bigger and brighter
    const exhaust = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.9,
      })
    );
    exhaust.position.z = 3.2;
    group.add(exhaust);

    // Secondary exhaust ring
    const exhaustRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.08, 6, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0.6,
      })
    );
    exhaustRing.position.z = 3.4;
    group.add(exhaustRing);

    return group;
  }

  update(dt, flares) {
    if (!this.alive) return;

    this.age += dt;
    if (this.age > WEAPONS.MISSILE.LIFE_TIME) {
      this.destroy();
      return;
    }

    // Arm check
    this.distanceTraveled += this.velocity.length() * dt;
    if (this.distanceTraveled > WEAPONS.MISSILE.ARM_DISTANCE) {
      this.armed = true;
    }

    // Check for flare decoy - 20% chance per individual flare, checked once per flare
    if (flares && flares.length > 0 && this.target) {
      for (const flare of flares) {
        if (!flare.alive) continue;
        // Skip flares we already checked
        if (this._checkedFlares.has(flare)) continue;

        // Skip friendly flares (closer to missile owner than to target)
        if (this.owner && this.owner.position) {
          const flareToOwner = flare.position.distanceTo(this.owner.position);
          const flareToTarget = flare.position.distanceTo(this.target.position);
          if (flareToOwner < flareToTarget) continue;
        }

        const flareDir = flare.position.clone().sub(this.position);
        const targetDir = this.target.position.clone().sub(this.position);

        // Flare must be roughly between missile and target
        if (flareDir.length() < targetDir.length() * 1.5) {
          // Mark as checked - one roll per flare
          this._checkedFlares.add(flare);

          if (Math.random() < WEAPONS.FLARES.DECOY_CHANCE) {
            // Missile fooled by flare - lose lock
            this.target = null;
            break;
          }
        }
      }
    }

    // Jink evasion: detect hard direction reversals by the target
    this._jinkCooldown = Math.max(0, this._jinkCooldown - dt);
    if (this.target && this.target.alive && this._jinkCooldown <= 0) {
      const cfg = WEAPONS.MISSILE;
      const targetG = Math.abs(this.target.gForce || 0);

      // Compute target's current acceleration direction (velocity change)
      const targetVel = this.target.velocity;
      const targetPrevVel = this.target.previousVelocity;
      if (targetVel && targetPrevVel) {
        const accel = targetVel.clone().sub(targetPrevVel);
        const accelLen = accel.length();
        if (accelLen > 1) {
          const accelDir = accel.normalize();

          if (this._prevTargetAccelDir) {
            // Dot product: +1 = same direction, -1 = full reversal
            const dot = accelDir.dot(this._prevTargetAccelDir);

            // Reversal detected: dot < 0 means acceleration flipped direction
            // Must also be pulling enough G to make it a real jink, not just coasting
            if (dot < -0.3 && targetG >= cfg.JINK_G_MIN) {
              // Sharper reversal = higher chance
              const reversalStrength = Math.abs(dot); // 0.3 to 1.0
              if (Math.random() < cfg.JINK_EVADE_CHANCE * reversalStrength) {
                this.target = null;
                this._jinkCooldown = 1.0;
              } else {
                // Failed jink, cooldown so same maneuver doesn't re-roll instantly
                this._jinkCooldown = 0.5;
              }
            }
          }

          this._prevTargetAccelDir = accelDir;
        }
      }
    }

    // Guidance - Proportional Navigation
    if (this.target && this.target.alive) {
      const cfg = WEAPONS.MISSILE;
      const toTarget = this.target.position.clone().sub(this.position);
      const distance = toTarget.length();

      // Proximity fuse
      if (this.armed && distance < cfg.PROXIMITY_FUSE) {
        this.detonate();
        return;
      }

      // Fire-and-forget: no range kill — missile tracks until lifetime expires

      // Proportional navigation
      const los = toTarget.normalize();
      const currentDir = this.velocity.clone().normalize();

      // Desired turn
      const cross = new THREE.Vector3().crossVectors(currentDir, los);

      // Turn rate limited — MAX_TURN_RATE is in degrees/sec, convert to radians
      const dotDir = currentDir.dot(los);
      const turnAngle = Math.atan2(cross.length(), dotDir); // full 0-π range
      const maxTurn = cfg.MAX_TURN_RATE * (Math.PI / 180) * dt;
      const actualTurn = Math.min(turnAngle * cfg.GUIDANCE_GAIN, maxTurn);

      if (cross.length() > 0.001) {
        const rotAxis = cross.normalize();
        const rotQ = new THREE.Quaternion().setFromAxisAngle(rotAxis, actualTurn);
        this.velocity.applyQuaternion(rotQ);
      }

      // Maintain speed
      this.velocity.normalize().multiplyScalar(cfg.SPEED);
    }

    // Update position
    this.position.addScaledVector(this.velocity, dt);

    // Update mesh
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.position.clone().add(this.velocity));

    // Update smoke trail
    this._updateSmokeTrail(dt);
  }

  _updateSmokeTrail(dt) {
    this.smokeSpawnTimer += dt;

    // Spawn smoke points frequently
    if (this.smokeSpawnTimer >= 0.016) {
      this.smokeSpawnTimer = 0;

      // Get a rough "up" perpendicular to velocity for ribbon orientation
      const velDir = this.velocity.clone().normalize();
      let up = new THREE.Vector3(0, 1, 0);
      // If velocity is nearly vertical, use a different reference
      if (Math.abs(velDir.dot(up)) > 0.95) {
        up.set(1, 0, 0);
      }
      up.crossVectors(velDir, up).normalize();

      this.smokePoints.push({
        pos: this.position.clone(),
        up: up,
        age: 0,
        width: 1.5 + Math.random() * 0.5, // Slight variation for organic look
      });

      if (this.smokePoints.length > this.smokeMaxPoints) {
        this.smokePoints.shift();
      }
    }

    // Age points
    for (let i = this.smokePoints.length - 1; i >= 0; i--) {
      this.smokePoints[i].age += dt;
      if (this.smokePoints[i].age > 3.0) {
        this.smokePoints.splice(i, 1);
      }
    }

    // Build ribbon mesh
    this._buildSmokeRibbon();
  }

  _buildSmokeRibbon() {
    const points = this.smokePoints;
    if (points.length < 2) {
      this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.smokeGeometry.setIndex(null);
      return;
    }

    const count = points.length;
    const vertices = new Float32Array(count * 2 * 3);
    const indices = [];

    for (let i = 0; i < count; i++) {
      const p = points[i];
      const lifeRatio = p.age / 3.0;
      // Width expands slightly then fades
      const expand = Math.min(1, p.age * 4); // Quick expand
      const fade = 1 - lifeRatio;
      const width = p.width * expand * fade * 0.5;

      const offset = p.up.clone().multiplyScalar(width);

      vertices[i * 6]     = p.pos.x + offset.x;
      vertices[i * 6 + 1] = p.pos.y + offset.y;
      vertices[i * 6 + 2] = p.pos.z + offset.z;

      vertices[i * 6 + 3] = p.pos.x - offset.x;
      vertices[i * 6 + 4] = p.pos.y - offset.y;
      vertices[i * 6 + 5] = p.pos.z - offset.z;

      if (i < count - 1) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.smokeGeometry.setIndex(indices);
    this.smokeGeometry.computeVertexNormals();
  }

  detonate() {
    if (!this.alive) return;

    // Apply damage to nearby targets
    if (this.target && this.target.alive) {
      const dist = this.position.distanceTo(this.target.position);
      if (dist < WEAPONS.MISSILE.PROXIMITY_FUSE) {
        const damageFalloff = 1 - (dist / WEAPONS.MISSILE.PROXIMITY_FUSE);
        this.target.applyDamage(WEAPONS.MISSILE.DAMAGE * damageFalloff, 'missile');
      }
    }

    this.detonationPosition = this.position.clone();
    this.destroy();
  }

  destroy() {
    this.alive = false;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.smokeMesh) {
      this.scene.remove(this.smokeMesh);
      this.smokeMesh = null;
    }
  }
}

export class MissileSystem {
  constructor(scene) {
    this.scene = scene;
    this.missiles = [];
    this.playerMissileCount = WEAPONS.MISSILE.COUNT;
    this.lockTimer = 0;
    this.lockedTarget = null;
    this.lockingTarget = null;
    this.lockProgress = 0; // 0 to 1
  }

  updateLock(aircraft, targets, dt) {
    const cfg = WEAPONS.MISSILE;
    const forward = aircraft.getForwardDirection();

    let bestTarget = null;
    let bestDot = Math.cos(cfg.LOCK_CONE);

    for (const target of targets) {
      if (!target.alive) continue;
      const toTarget = target.position.clone().sub(aircraft.position).normalize();
      const dot = forward.dot(toTarget);
      const dist = aircraft.position.distanceTo(target.position);

      if (dot > bestDot && dist < cfg.MAX_RANGE) {
        bestDot = dot;
        bestTarget = target;
      }
    }

    if (bestTarget && bestTarget === this.lockingTarget) {
      this.lockTimer += dt;
      this.lockProgress = Math.min(1, this.lockTimer / cfg.LOCK_TIME);
      if (this.lockTimer >= cfg.LOCK_TIME) {
        this.lockedTarget = bestTarget;
      }
    } else {
      this.lockingTarget = bestTarget;
      this.lockTimer = 0;
      this.lockProgress = 0;
      this.lockedTarget = null;
    }
  }

  fire(aircraft) {
    if (this.playerMissileCount <= 0) return null;
    if (!this.lockedTarget) return null;

    this.playerMissileCount--;

    const forward = aircraft.getForwardDirection();
    const spawnPos = aircraft.position.clone().add(forward.clone().multiplyScalar(5));
    spawnPos.y -= 1.5; // Under fuselage

    const missile = new Missile(
      this.scene,
      spawnPos,
      forward.clone().multiplyScalar(WEAPONS.MISSILE.SPEED).add(aircraft.velocity),
      this.lockedTarget,
      aircraft
    );

    this.missiles.push(missile);
    return missile;
  }

  fireAI(aircraft, target) {
    const forward = aircraft.getForwardDirection();
    const spawnPos = aircraft.position.clone().add(forward.clone().multiplyScalar(5));

    const missile = new Missile(
      this.scene,
      spawnPos,
      forward.clone().multiplyScalar(WEAPONS.MISSILE.SPEED).add(aircraft.velocity),
      target,
      aircraft
    );

    this.missiles.push(missile);
    return missile;
  }

  update(dt, flares) {
    const detonations = [];

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      missile.update(dt, flares);

      if (!missile.alive) {
        if (missile.detonationPosition) {
          detonations.push(missile.detonationPosition);
        }
        this.missiles.splice(i, 1);
      }
    }

    return detonations;
  }

  getMissilesTargeting(aircraft) {
    return this.missiles.filter(m => m.alive && m.target === aircraft);
  }

  reset() {
    for (const missile of this.missiles) {
      missile.destroy();
    }
    this.missiles.length = 0;
    this.playerMissileCount = WEAPONS.MISSILE.COUNT;
    this.lockTimer = 0;
    this.lockedTarget = null;
    this.lockingTarget = null;
    this.lockProgress = 0;
  }
}
