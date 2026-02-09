import { RADAR } from '../config.js';

export class Radar {
  constructor() {
    this.canvas = document.getElementById('radar-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.size = RADAR.SIZE;
    this.range = RADAR.RANGE;
    this.sweepAngle = 0;
    this.sweepSpeed = RADAR.SWEEP_SPEED;

    // Detected blips persist briefly
    this.blips = [];
    this.blipDuration = 2; // seconds
  }

  update(dt, playerAircraft, enemies, missiles, balloons) {
    this.sweepAngle += this.sweepSpeed * dt;
    if (this.sweepAngle > Math.PI * 2) {
      this.sweepAngle -= Math.PI * 2;
    }

    // Age out old blips
    for (let i = this.blips.length - 1; i >= 0; i--) {
      this.blips[i].age += dt;
      if (this.blips[i].age > this.blipDuration) {
        this.blips.splice(i, 1);
      }
    }

    // Get player heading for radar orientation
    const forward = playerAircraft.getForwardDirection();
    const playerHeading = Math.atan2(forward.x, -forward.z);

    // Check for targets in sweep
    const sweepWidth = this.sweepSpeed * dt;

    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;

        const dx = enemy.position.x - playerAircraft.position.x;
        const dz = enemy.position.z - playerAircraft.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > this.range) continue;

        // Angle of target relative to player heading
        const angle = Math.atan2(dx, -dz) - playerHeading;

        // Check if sweep line just passed this angle
        const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const normalizedSweep = ((this.sweepAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        const angleDiff = Math.abs(normalizedAngle - normalizedSweep);
        if (angleDiff < sweepWidth || angleDiff > Math.PI * 2 - sweepWidth) {
          // Add/refresh blip
          const rx = (dx / this.range) * (this.size / 2);
          const rz = (dz / this.range) * (this.size / 2);

          this.blips.push({
            x: rx,
            z: rz,
            age: 0,
            type: 'enemy',
          });
        }
      }
    }

    // Incoming missiles as special blips
    if (missiles) {
      for (const missile of missiles) {
        if (!missile.alive) continue;
        const dx = missile.position.x - playerAircraft.position.x;
        const dz = missile.position.z - playerAircraft.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > this.range) continue;

        const rx = (dx / this.range) * (this.size / 2);
        const rz = (dz / this.range) * (this.size / 2);

        // Always show missiles (no sweep required)
        this.blips.push({
          x: rx,
          z: rz,
          age: 0,
          type: 'missile',
        });
      }
    }

    // Balloons as always-visible green blips
    if (balloons) {
      for (const balloon of balloons) {
        if (!balloon.alive) continue;
        const dx = balloon.position.x - playerAircraft.position.x;
        const dz = balloon.position.z - playerAircraft.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > this.range) continue;

        const rx = (dx / this.range) * (this.size / 2);
        const rz = (dz / this.range) * (this.size / 2);

        this.blips.push({
          x: rx,
          z: rz,
          age: 0,
          type: 'balloon',
        });
      }
    }

    this.render(playerHeading);
  }

  render(playerHeading) {
    const ctx = this.ctx;
    const size = this.size;
    const center = size / 2;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.fillStyle = 'rgba(0, 20, 10, 0.3)';
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
    ctx.lineWidth = 0.5;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.arc(center, center, (center - 2) * r / 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross lines
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.beginPath();
    ctx.moveTo(center, 2);
    ctx.lineTo(center, size - 2);
    ctx.moveTo(2, center);
    ctx.lineTo(size - 2, center);
    ctx.stroke();

    // Sweep line
    const sweepRelative = this.sweepAngle;
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(
      center + Math.sin(sweepRelative) * (center - 2),
      center - Math.cos(sweepRelative) * (center - 2)
    );
    ctx.stroke();

    // Sweep trail (fading arc)
    const trailLength = 0.5; // radians
    const gradient = ctx.createConicGradient(sweepRelative - Math.PI / 2, center, center);
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.15)');
    gradient.addColorStop(trailLength / (Math.PI * 2), 'rgba(0, 255, 136, 0)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.fill();

    // Player (center dot)
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(center, center, 2, 0, Math.PI * 2);
    ctx.fill();

    // Player direction indicator
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center, center - 12);
    ctx.stroke();

    // Blips
    for (const blip of this.blips) {
      const alpha = 1 - blip.age / this.blipDuration;

      // Rotate blip position relative to player heading
      const cos = Math.cos(-playerHeading);
      const sin = Math.sin(-playerHeading);
      const rx = blip.x * cos - blip.z * sin;
      const rz = blip.x * sin + blip.z * cos;

      const bx = center + rx;
      const bz = center + rz;

      if (blip.type === 'enemy') {
        ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.fillRect(bx - 2, bz - 2, 4, 4);
      } else if (blip.type === 'missile') {
        ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(bx, bz, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'balloon') {
        ctx.fillStyle = `rgba(50, 255, 100, ${alpha})`;
        ctx.beginPath();
        ctx.arc(bx, bz, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
