import * as THREE from 'three';
import { WORLD } from '../config.js';

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.timeOfDay = 0.35; // 0-1, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset

    // Cache references
    this.sunLight = null;
    this.ambientLight = null;
    this.hemiLight = null;

    // Find lights in scene
    scene.traverse((child) => {
      if (child.isDirectionalLight) this.sunLight = child;
      if (child.isAmbientLight) this.ambientLight = child;
      if (child.isHemisphereLight) this.hemiLight = child;
    });
  }

  update(dt) {
    // Slowly cycle time (optional, currently static)
    // this.timeOfDay += dt * 0.01;
    // if (this.timeOfDay > 1) this.timeOfDay -= 1;

    this.updateLighting();
  }

  updateLighting() {
    if (!this.sunLight) return;

    // Sun position based on time of day
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const elevation = Math.sin(sunAngle);
    const azimuth = THREE.MathUtils.degToRad(WORLD.SUN_AZIMUTH);
    const dist = 10000;

    this.sunLight.position.set(
      Math.cos(azimuth) * Math.cos(Math.max(0, sunAngle)) * dist,
      Math.max(50, elevation * dist),
      Math.sin(azimuth) * Math.cos(Math.max(0, sunAngle)) * dist
    );

    // Color temperature shifts
    const dayFactor = Math.max(0, elevation);

    // Golden hour warm tones
    if (dayFactor < 0.3) {
      const warmth = 1 - dayFactor / 0.3;
      this.sunLight.color.setRGB(
        1,
        0.7 + dayFactor,
        0.4 + dayFactor * 1.5
      );
      this.sunLight.intensity = 0.3 + dayFactor * 3;
    } else {
      this.sunLight.color.set(0xffeedd);
      this.sunLight.intensity = WORLD.SUN_INTENSITY;
    }

    // Ambient follows
    if (this.ambientLight) {
      this.ambientLight.intensity = 0.2 + dayFactor * 0.3;
    }

    // Fog color
    if (this.scene.fog) {
      const fogR = 0.5 + dayFactor * 0.3;
      const fogG = 0.5 + dayFactor * 0.2;
      const fogB = 0.55 + dayFactor * 0.25;
      this.scene.fog.color.setRGB(fogR, fogG, fogB);
    }
  }
}
