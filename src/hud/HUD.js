export class HUD {
  constructor() {
    this.speedValue = document.getElementById('speed-value');
    this.altitudeValue = document.getElementById('altitude-value');
    this.gValue = document.getElementById('g-value');
    this.headingValue = document.getElementById('heading-value');
    this.throttleBar = document.getElementById('throttle-bar');
    this.throttleValue = document.getElementById('throttle-value');
    this.ammoValue = document.getElementById('ammo-value');
    this.missileValue = document.getElementById('missile-value');
    this.flareValue = document.getElementById('flare-value');
    this.healthBar = document.getElementById('health-bar');
    this.warnings = document.getElementById('warnings');

    // Killfeed
    this.killfeed = document.getElementById('killfeed');

    // Missile warning
    this.missileWarning = document.getElementById('missile-warning');

    // Ammo replenish notification
    this.ammoReplenish = document.getElementById('ammo-replenish');
    this._replenishTimer = null;

    this.warningFlashTimer = 0;
    this.warningText = '';

    // Kill counter for enemy naming
    this._killIndex = 0;
    this._pilotNames = [
      'Curtis', 'Takumi', 'Viper', 'Goose', 'Maverick', 'Jester', 'Blaze',
      'Cipher', 'Pixy', 'Mobius', 'Shamrock', 'Talisman', 'Trigger',
      'Phoenix', 'Rooster', 'Halo', 'Reaper', 'Nomad', 'Bishop', 'Falcon',
      'Cobra', 'Stingray', 'Thunder', 'Ghost', 'Razor', 'Hawk', 'Merlin',
      'Joker', 'Bandog', 'Wiseman', 'Count', 'Huxian', 'Jaeger', 'Sarge',
      'Rico', 'Duke', 'Frost', 'Raven', 'Bolt', 'Archer',
    ];
    this._usedNames = [];
  }

  update(dt, aircraft, machineGun, missileSystem, flareSystem, terrain) {
    // Speed (m/s → knots)
    const speedKnots = Math.round(aircraft.speed * 1.944);
    this.speedValue.textContent = speedKnots;

    // Altitude (meters → feet)
    const altFeet = Math.round(aircraft.position.y * 3.281);
    this.altitudeValue.textContent = altFeet;

    // G-Force
    this.gValue.textContent = aircraft.gForce.toFixed(1);
    if (Math.abs(aircraft.gForce) > 6) {
      this.gValue.style.color = '#ff3333';
    } else if (Math.abs(aircraft.gForce) > 4) {
      this.gValue.style.color = '#ffaa00';
    } else {
      this.gValue.style.color = '#00ff88';
    }

    // Heading (degrees)
    const forward = aircraft.getForwardDirection();
    let heading = Math.atan2(forward.x, -forward.z);
    if (heading < 0) heading += Math.PI * 2;
    const headingDeg = Math.round(heading * 180 / Math.PI);
    this.headingValue.textContent = String(headingDeg).padStart(3, '0');

    // Throttle
    const thrPct = Math.round(aircraft.throttle * 100);
    this.throttleBar.style.width = `${thrPct}%`;
    if (aircraft.airbrake) {
      this.throttleValue.textContent = 'BRK';
      this.throttleBar.style.background = '#ff3333';
    } else {
      this.throttleValue.textContent = thrPct;
      if (thrPct > 90) {
        this.throttleBar.style.background = '#ff6600';
      } else {
        this.throttleBar.style.background = '#00ff88';
      }
    }

    // Ammo
    if (machineGun) {
      this.ammoValue.textContent = machineGun.ammo;
      if (machineGun.ammo <= 50) {
        this.ammoValue.style.color = '#ff3333';
      } else {
        this.ammoValue.style.color = '#00ff88';
      }
    }

    // Missiles
    if (missileSystem) {
      this.missileValue.textContent = missileSystem.playerMissileCount;
    }

    // Flares
    if (flareSystem) {
      this.flareValue.textContent = flareSystem.count;
    }

    // Health bar
    const healthPct = Math.max(0, aircraft.health);
    this.healthBar.style.width = `${healthPct}%`;
    if (healthPct < 25) {
      this.healthBar.classList.add('critical');
      this.healthBar.style.backgroundColor = '#ff3333';
    } else if (healthPct < 50) {
      this.healthBar.classList.remove('critical');
      this.healthBar.style.backgroundColor = '#ffaa00';
    } else {
      this.healthBar.classList.remove('critical');
      this.healthBar.style.backgroundColor = '#00ff88';
    }

    // Warnings
    this.updateWarnings(dt, aircraft, terrain);
  }

  _getRandomPilotName() {
    // Refill pool if exhausted
    if (this._usedNames.length >= this._pilotNames.length) {
      this._usedNames = [];
    }
    const available = this._pilotNames.filter(n => !this._usedNames.includes(n));
    const name = available[Math.floor(Math.random() * available.length)];
    this._usedNames.push(name);
    return name;
  }

  addKill(weapon) {
    if (!this.killfeed) return;
    this._killIndex++;
    const entry = document.createElement('div');
    entry.className = 'killfeed-entry';

    const weaponLabel = weapon === 'missile' ? 'MSL' : 'GUN';
    const victimName = this._getRandomPilotName();
    entry.innerHTML = `<span class="kf-killer">YOU</span><span class="kf-weapon">\u2014${weaponLabel}\u2192</span><span class="kf-victim">${victimName}</span>`;

    this.killfeed.appendChild(entry);

    // Remove after animation completes
    setTimeout(() => {
      if (entry.parentNode) entry.parentNode.removeChild(entry);
    }, 4000);

    // Keep max 5 entries
    while (this.killfeed.children.length > 5) {
      this.killfeed.removeChild(this.killfeed.firstChild);
    }
  }

  setMissileWarning(active) {
    if (!this.missileWarning) return;
    if (active) {
      this.missileWarning.classList.remove('hidden');
    } else {
      this.missileWarning.classList.add('hidden');
    }
  }

  showAmmoReplenish() {
    if (!this.ammoReplenish) return;
    // Remove existing and re-trigger animation
    if (this._replenishTimer) clearTimeout(this._replenishTimer);
    this.ammoReplenish.classList.remove('hidden');
    // Force animation restart
    this.ammoReplenish.style.animation = 'none';
    this.ammoReplenish.offsetHeight; // reflow
    this.ammoReplenish.style.animation = '';

    this._replenishTimer = setTimeout(() => {
      this.ammoReplenish.classList.add('hidden');
    }, 2000);
  }

  updateWarnings(dt, aircraft, terrain) {
    let warning = '';

    // Low altitude
    if (terrain) {
      const terrainHeight = terrain.getHeightAt(aircraft.position.x, aircraft.position.z);
      const agl = aircraft.position.y - terrainHeight;
      if (agl < 100) {
        warning = 'PULL UP';
      } else if (agl < 200) {
        warning = 'LOW ALTITUDE';
      }
    }

    // Stall warning
    if (aircraft.speed < 80 && aircraft.position.y > 50) {
      warning = 'STALL';
    }

    // Overspeed
    if (aircraft.speed > 600) {
      warning = 'OVERSPEED';
    }

    // Boundary warning
    const distFromCenter = Math.sqrt(
      aircraft.position.x * aircraft.position.x +
      aircraft.position.z * aircraft.position.z
    );
    if (distFromCenter > 7000) {
      warning = 'RETURN TO COMBAT AREA';
    }

    // Flash warning text
    if (warning) {
      this.warningFlashTimer += dt;
      const show = Math.floor(this.warningFlashTimer * 3) % 2 === 0;
      this.warnings.textContent = show ? warning : '';
      this.warnings.style.color = '#ff3333';
    } else {
      this.warnings.textContent = '';
      this.warningFlashTimer = 0;
    }

    this.warningText = warning;
  }
}
