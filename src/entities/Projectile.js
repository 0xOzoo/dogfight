import * as THREE from 'three';
import { WEAPONS } from '../config.js';

export class Projectile {
  constructor(position, velocity, owner) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.owner = owner;
    this.alive = true;
    this.age = 0;
    this.maxAge = WEAPONS.MACHINE_GUN.PROJECTILE_LIFE;
    this.damage = WEAPONS.MACHINE_GUN.DAMAGE;
  }

  update(dt) {
    if (!this.alive) return;

    this.age += dt;
    if (this.age > this.maxAge) {
      this.alive = false;
      return;
    }

    // Simple ballistic - no gravity for tracers (short range)
    this.position.addScaledVector(this.velocity, dt);
  }
}

// Pool manager for projectiles to avoid GC pressure
export class ProjectilePool {
  constructor(scene, maxProjectiles = 200) {
    this.scene = scene;
    this.projectiles = [];
    this.maxProjectiles = maxProjectiles;

    // Instanced mesh for tracers
    const tracerGeom = new THREE.CylinderGeometry(0.4, 0.4, WEAPONS.MACHINE_GUN.TRACER_LENGTH, 6);
    tracerGeom.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.9,
    });

    this.tracerMesh = new THREE.InstancedMesh(tracerGeom, tracerMat, maxProjectiles);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.scene.add(this.tracerMesh);

    this._dummy = new THREE.Object3D();
    this._invisibleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    // Initialize all instances as invisible
    for (let i = 0; i < maxProjectiles; i++) {
      this.tracerMesh.setMatrixAt(i, this._invisibleMatrix);
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
  }

  spawn(position, velocity, owner) {
    // Remove oldest if at capacity
    if (this.projectiles.length >= this.maxProjectiles) {
      this.projectiles.shift();
    }
    const projectile = new Projectile(position, velocity, owner);
    this.projectiles.push(projectile);
    return projectile;
  }

  update(dt, targets, terrain) {
    const hits = [];
    this.groundHits = [];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(dt);

      if (!proj.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Check terrain collision
      if (terrain && terrain.checkCollision(proj.position)) {
        this.groundHits.push(proj.position.clone());
        proj.alive = false;
        this.projectiles.splice(i, 1);
        continue;
      }

      // Check target collision
      if (targets) {
        for (const target of targets) {
          if (target === proj.owner || !target.alive) continue;
          const dist = proj.position.distanceTo(target.position);
          const hitRadius = target.collisionRadius || 10;
          if (dist < hitRadius) {
            target.applyDamage(proj.damage, 'gun');
            hits.push({ target, position: proj.position.clone() });
            proj.alive = false;
            this.projectiles.splice(i, 1);
            break;
          }
        }
      }
    }

    // Update instanced mesh
    for (let i = 0; i < this.maxProjectiles; i++) {
      if (i < this.projectiles.length) {
        const proj = this.projectiles[i];
        this._dummy.position.copy(proj.position);
        // Orient tracer along velocity
        this._dummy.lookAt(proj.position.clone().add(proj.velocity));
        this._dummy.updateMatrix();
        this.tracerMesh.setMatrixAt(i, this._dummy.matrix);
      } else {
        this.tracerMesh.setMatrixAt(i, this._invisibleMatrix);
      }
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;

    return hits;
  }

  clear() {
    this.projectiles.length = 0;
    for (let i = 0; i < this.maxProjectiles; i++) {
      this.tracerMesh.setMatrixAt(i, this._invisibleMatrix);
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
  }
}
