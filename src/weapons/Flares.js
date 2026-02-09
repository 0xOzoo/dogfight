import * as THREE from 'three';
import { WEAPONS } from '../config.js';

class Flare {
  constructor(position, velocity) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.alive = true;
    this.age = 0;
    this.maxAge = WEAPONS.FLARES.DURATION;
    this.intensity = 1;
  }

  update(dt) {
    if (!this.alive) return;

    this.age += dt;
    if (this.age > this.maxAge) {
      this.alive = false;
      return;
    }

    // Flare decelerates and falls
    this.velocity.multiplyScalar(0.98);
    this.velocity.y -= 3 * dt; // light gravity
    this.position.addScaledVector(this.velocity, dt);

    // Intensity fades
    this.intensity = 1 - (this.age / this.maxAge);
  }
}

export class FlareSystem {
  constructor(scene) {
    this.scene = scene;
    this.flares = [];
    this.count = WEAPONS.FLARES.COUNT;
    this.cooldownTimer = 0;

    // Instanced mesh for flare particles
    const flareGeom = new THREE.SphereGeometry(0.5, 6, 6);
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.9,
    });

    this.maxFlares = 60;
    this.flareMesh = new THREE.InstancedMesh(flareGeom, flareMat, this.maxFlares);
    this.flareMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flareMesh.frustumCulled = false;
    this.scene.add(this.flareMesh);

    this._dummy = new THREE.Object3D();
    this._invisibleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < this.maxFlares; i++) {
      this.flareMesh.setMatrixAt(i, this._invisibleMatrix);
    }
    this.flareMesh.instanceMatrix.needsUpdate = true;
  }

  deploy(aircraft) {
    if (this.count <= 0) return;
    if (this.cooldownTimer > 0) return;

    this.cooldownTimer = WEAPONS.FLARES.COOLDOWN;
    this.count--;

    const cfg = WEAPONS.FLARES;

    // Spawn multiple flares in a salvo
    for (let i = 0; i < cfg.SALVO_COUNT; i++) {
      const spreadVel = new THREE.Vector3(
        (Math.random() - 0.5) * cfg.SPREAD,
        (Math.random() - 0.5) * cfg.SPREAD * 0.5 - cfg.SPREAD * 0.3,
        (Math.random() - 0.5) * cfg.SPREAD
      );

      const flareVel = aircraft.velocity.clone().multiplyScalar(0.3).add(spreadVel);
      const flarePos = aircraft.position.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          -2,
          (Math.random() - 0.5) * 3
        )
      );

      this.flares.push(new Flare(flarePos, flareVel));
    }
  }

  deployAt(position, velocity) {
    // Deploy flares at a position without consuming count (for AI use)
    const cfg = WEAPONS.FLARES;
    for (let i = 0; i < cfg.SALVO_COUNT; i++) {
      const spreadVel = new THREE.Vector3(
        (Math.random() - 0.5) * cfg.SPREAD,
        (Math.random() - 0.5) * cfg.SPREAD * 0.5 - cfg.SPREAD * 0.3,
        (Math.random() - 0.5) * cfg.SPREAD
      );
      const flareVel = velocity.clone().multiplyScalar(0.3).add(spreadVel);
      const flarePos = position.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          -2,
          (Math.random() - 0.5) * 3
        )
      );
      this.flares.push(new Flare(flarePos, flareVel));
    }
  }

  update(dt) {
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);

    for (let i = this.flares.length - 1; i >= 0; i--) {
      this.flares[i].update(dt);
      if (!this.flares[i].alive) {
        this.flares.splice(i, 1);
      }
    }

    // Update instanced mesh
    for (let i = 0; i < this.maxFlares; i++) {
      if (i < this.flares.length) {
        const flare = this.flares[i];
        this._dummy.position.copy(flare.position);
        const scale = 0.3 + flare.intensity * 0.7;
        this._dummy.scale.set(scale, scale, scale);
        this._dummy.updateMatrix();
        this.flareMesh.setMatrixAt(i, this._dummy.matrix);
      } else {
        this.flareMesh.setMatrixAt(i, this._invisibleMatrix);
      }
    }
    this.flareMesh.instanceMatrix.needsUpdate = true;
  }

  getActiveFlares() {
    return this.flares.filter(f => f.alive);
  }

  reset() {
    this.flares.length = 0;
    this.count = WEAPONS.FLARES.COUNT;
    this.cooldownTimer = 0;
    for (let i = 0; i < this.maxFlares; i++) {
      this.flareMesh.setMatrixAt(i, this._invisibleMatrix);
    }
    this.flareMesh.instanceMatrix.needsUpdate = true;
  }
}
