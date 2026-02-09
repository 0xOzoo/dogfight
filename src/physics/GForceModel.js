import { GFORCE } from '../config.js';

export class GForceModel {
  constructor() {
    this.accumulatedHighG = 0;
    this.blackoutLevel = 0;  // 0 to 1
    this.redoutLevel = 0;    // 0 to 1
    this.controlLoss = false;
  }

  update(aircraft, dt) {
    const g = aircraft.gForce;

    // Blackout (positive G)
    if (g > GFORCE.BLACKOUT_START) {
      const excess = (g - GFORCE.BLACKOUT_START) / (GFORCE.BLACKOUT_FULL - GFORCE.BLACKOUT_START);
      this.blackoutLevel = Math.min(1, this.blackoutLevel + excess * dt * 2);
    } else {
      this.blackoutLevel = Math.max(0, this.blackoutLevel - dt * GFORCE.RECOVERY_RATE * 0.3);
    }

    // Redout (negative G)
    if (g < GFORCE.REDOUT_START) {
      const excess = (GFORCE.REDOUT_START - g) / (GFORCE.REDOUT_START - GFORCE.REDOUT_FULL);
      this.redoutLevel = Math.min(1, this.redoutLevel + excess * dt * 2);
    } else {
      this.redoutLevel = Math.max(0, this.redoutLevel - dt * GFORCE.RECOVERY_RATE * 0.3);
    }

    // Loss of control at extreme G
    if (Math.abs(g) > GFORCE.LOSS_OF_CONTROL_G) {
      this.accumulatedHighG += dt;
      if (this.accumulatedHighG > GFORCE.LOSS_OF_CONTROL_TIME) {
        this.controlLoss = true;
      }
    } else {
      this.accumulatedHighG = Math.max(0, this.accumulatedHighG - dt * 0.5);
      if (this.accumulatedHighG <= 0) {
        this.controlLoss = false;
      }
    }
  }

  applyEffect(overlayElement) {
    if (this.blackoutLevel > 0.01) {
      // Progressive vignette effect → full black
      const opacity = this.blackoutLevel * 0.9;
      const spread = 1 - this.blackoutLevel * 0.6; // vignette shrinks
      overlayElement.style.opacity = '1';
      overlayElement.style.background = `radial-gradient(ellipse at center,
        rgba(0,0,0,0) ${spread * 40}%,
        rgba(0,0,0,${opacity}) ${spread * 80}%,
        rgba(0,0,0,${Math.min(1, opacity * 1.5)}) 100%)`;
    } else if (this.redoutLevel > 0.01) {
      const opacity = this.redoutLevel * 0.8;
      const spread = 1 - this.redoutLevel * 0.5;
      overlayElement.style.opacity = '1';
      overlayElement.style.background = `radial-gradient(ellipse at center,
        rgba(180,0,0,0) ${spread * 40}%,
        rgba(200,0,0,${opacity}) ${spread * 80}%,
        rgba(150,0,0,${Math.min(1, opacity * 1.5)}) 100%)`;
    } else {
      overlayElement.style.opacity = '0';
    }
  }

  reset() {
    this.accumulatedHighG = 0;
    this.blackoutLevel = 0;
    this.redoutLevel = 0;
    this.controlLoss = false;
  }
}
