// Post-processing effects are handled via the G-force overlay in GForceModel
// and CSS effects. This module provides additional screen effects.

export class PostProcessing {
  constructor() {
    this.overlay = document.getElementById('g-overlay');
    this.damageFlashTimer = 0;
    this.sonicBoomFlashTimer = 0;
    this.shakeIntensity = 0;
    this.shakeDecay = 5;
  }

  damageFlash() {
    this.damageFlashTimer = 0.2;
  }

  sonicBoomFlash() {
    this.sonicBoomFlashTimer = 0.4;
  }

  addShake(intensity) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  update(dt, camera) {
    // Damage flash
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= dt;
      const alpha = Math.max(0, this.damageFlashTimer / 0.2 * 0.3);
      this.overlay.style.opacity = '1';
      this.overlay.style.background = `rgba(255, 0, 0, ${alpha})`;
    } else if (this.sonicBoomFlashTimer > 0) {
      // Sonic boom flash - white flash that fades quickly
      this.sonicBoomFlashTimer -= dt;
      const t = Math.max(0, this.sonicBoomFlashTimer / 0.4);
      const alpha = t * t * 0.25; // quadratic fade, max 25% opacity
      this.overlay.style.opacity = '1';
      this.overlay.style.background = `rgba(255, 255, 255, ${alpha})`;
    } else {
      this.overlay.style.opacity = '0';
    }

    // Camera shake
    if (this.shakeIntensity > 0.001 && camera) {
      camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
    }
  }

  reset() {
    this.damageFlashTimer = 0;
    this.sonicBoomFlashTimer = 0;
    this.shakeIntensity = 0;
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      this.overlay.style.background = '';
    }
  }
}
