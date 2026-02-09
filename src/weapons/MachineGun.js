import * as THREE from 'three';
import { WEAPONS } from '../config.js';

export class MachineGun {
  constructor(projectilePool) {
    this.projectilePool = projectilePool;
    this.ammo = WEAPONS.MACHINE_GUN.AMMO;
    this.fireTimer = 0;
    this.fireInterval = 60 / WEAPONS.MACHINE_GUN.FIRE_RATE; // seconds per round
    this.roundCount = 0;
    this.firing = false;
    this.muzzleFlash = null;
  }

  fire(aircraft) {
    if (this.ammo <= 0) return;
    if (this.fireTimer > 0) return;

    this.fireTimer = this.fireInterval;
    this.ammo--;
    this.roundCount++;
    this.firing = true;

    const cfg = WEAPONS.MACHINE_GUN;

    // Muzzle position (front of aircraft)
    const forward = aircraft.getForwardDirection();
    const muzzlePos = aircraft.position.clone().add(forward.clone().multiplyScalar(10));

    // Add random spread
    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * cfg.SPREAD,
      (Math.random() - 0.5) * cfg.SPREAD,
      0
    );
    spread.applyQuaternion(aircraft.quaternion);

    const direction = forward.clone().add(spread).normalize();
    const velocity = direction.multiplyScalar(cfg.MUZZLE_VELOCITY).add(aircraft.velocity);

    // Only spawn visible tracer every Nth round
    if (this.roundCount % cfg.TRACER_INTERVAL === 0) {
      this.projectilePool.spawn(muzzlePos, velocity, aircraft);
    } else {
      // Still do hit detection for non-tracer rounds
      this.projectilePool.spawn(muzzlePos, velocity, aircraft);
    }
  }

  update(dt, aircraft, isFiring) {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.firing = false;

    if (isFiring && this.ammo > 0) {
      this.fire(aircraft);
    }
  }

  reset() {
    this.ammo = WEAPONS.MACHINE_GUN.AMMO;
    this.fireTimer = 0;
    this.roundCount = 0;
    this.firing = false;
  }
}
