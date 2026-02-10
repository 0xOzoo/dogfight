import * as THREE from 'three';
import { WEAPONS } from '../config.js';

export class TargetIndicator {
  constructor() {
    this.targetInfo = document.getElementById('target-info');
    this.lockIndicator = document.getElementById('target-lock-indicator');
    this.distanceDisplay = document.getElementById('target-distance');

    // Screen-space markers (created dynamically)
    this.markers = [];
    this.markerPool = [];
    this.maxMarkers = 10;

    this.createMarkerPool();
    this._createLeadIndicator();
    this._createLockZoneCircle();
  }

  createMarkerPool() {
    const hud = document.getElementById('hud');
    for (let i = 0; i < this.maxMarkers; i++) {
      const marker = document.createElement('div');
      marker.className = 'target-marker';
      marker.style.cssText = `
        position: absolute;
        width: 24px;
        height: 24px;
        border: 2px solid #ff6600;
        transform: translate(-50%, -50%) rotate(45deg);
        pointer-events: none;
        display: none;
      `;

      const distLabel = document.createElement('span');
      distLabel.style.cssText = `
        position: absolute;
        top: 28px;
        left: 50%;
        transform: translateX(-50%) rotate(-45deg);
        color: #ff6600;
        font-size: 10px;
        font-family: 'Courier New', monospace;
        white-space: nowrap;
      `;
      marker.appendChild(distLabel);
      hud.appendChild(marker);

      this.markerPool.push({ element: marker, label: distLabel });
    }
  }

  _createLeadIndicator() {
    const hud = document.getElementById('hud');

    // Lead indicator - shows where to aim guns
    this.leadMarker = document.createElement('div');
    this.leadMarker.style.cssText = `
      position: absolute;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 100, 100, 0.9);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      display: none;
      z-index: 50;
    `;

    // Cross lines inside the lead circle
    const hLine = document.createElement('div');
    hLine.style.cssText = `
      position: absolute;
      width: 8px;
      height: 2px;
      background: rgba(255, 100, 100, 0.9);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    `;
    const vLine = document.createElement('div');
    vLine.style.cssText = `
      position: absolute;
      width: 2px;
      height: 8px;
      background: rgba(255, 100, 100, 0.9);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    `;
    this.leadMarker.appendChild(hLine);
    this.leadMarker.appendChild(vLine);

    // Distance label below lead marker
    this.leadLabel = document.createElement('span');
    this.leadLabel.style.cssText = `
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255, 100, 100, 0.8);
      font-size: 10px;
      font-family: 'Courier New', monospace;
      white-space: nowrap;
    `;
    this.leadMarker.appendChild(this.leadLabel);
    hud.appendChild(this.leadMarker);
  }

  _createLockZoneCircle() {
    const hud = document.getElementById('hud');

    this.lockZoneCircle = document.createElement('div');
    this.lockZoneCircle.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border: 1.5px dashed rgba(255, 102, 0, 0.35);
      border-radius: 50%;
      pointer-events: none;
      z-index: 40;
      transition: border-color 0.2s;
    `;
    hud.appendChild(this.lockZoneCircle);
  }

  _updateLockZoneCircle(camera) {
    // The lock cone is WEAPONS.MISSILE.LOCK_CONE radians half-angle
    // Map this angle to screen pixels using the camera FOV
    const lockCone = WEAPONS.MISSILE.LOCK_CONE;
    const vFov = camera.fov * (Math.PI / 180);
    const aspect = camera.aspect;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    // Fraction of vertical FOV the lock cone occupies
    const fractionV = (lockCone * 2) / vFov;
    const fractionH = (lockCone * 2) / hFov;

    const screenH = window.innerHeight;
    const screenW = window.innerWidth;

    // Use the smaller dimension so the circle fits
    const diameterV = fractionV * screenH;
    const diameterH = fractionH * screenW;
    const diameter = Math.min(diameterV, diameterH);

    this.lockZoneCircle.style.width = `${diameter}px`;
    this.lockZoneCircle.style.height = `${diameter}px`;
  }

  _updateLeadIndicator(camera, player, enemies) {
    this.leadMarker.style.display = 'none';

    if (!enemies || enemies.length === 0) return;

    // Find closest enemy within gun range
    const gunRange = WEAPONS.MACHINE_GUN.MAX_RANGE;
    const bulletSpeed = WEAPONS.MACHINE_GUN.MUZZLE_VELOCITY;
    let closestEnemy = null;
    let closestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dist = player.position.distanceTo(enemy.position);
      if (dist < gunRange && dist < closestDist) {
        closestDist = dist;
        closestEnemy = enemy;
      }
    }

    if (!closestEnemy) return;

    // Calculate lead position:
    // Time for bullet to reach target = distance / (bullet speed + closing speed component)
    const toEnemy = closestEnemy.position.clone().sub(player.position);
    const playerForward = player.getForwardDirection();

    // Relative velocity of target from player's perspective
    const relVel = closestEnemy.velocity.clone().sub(player.velocity);

    // Iterative lead calculation (2 iterations for accuracy)
    let leadPos = closestEnemy.position.clone();
    for (let i = 0; i < 2; i++) {
      const dist = leadPos.distanceTo(player.position);
      const tof = dist / bulletSpeed; // time of flight
      leadPos = closestEnemy.position.clone().add(
        closestEnemy.velocity.clone().multiplyScalar(tof)
      );
    }

    // Project lead position to screen
    const screenPos = leadPos.clone().project(camera);
    if (screenPos.z > 1) return; // Behind camera

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const x = (screenPos.x * 0.5 + 0.5) * screenW;
    const y = (-screenPos.y * 0.5 + 0.5) * screenH;

    // Only show if on screen
    if (x < -30 || x > screenW + 30 || y < -30 || y > screenH + 30) return;

    this.leadMarker.style.display = 'block';
    this.leadMarker.style.left = `${x}px`;
    this.leadMarker.style.top = `${y}px`;
    this.leadLabel.textContent = `${Math.round(closestDist)}m`;

    // Color based on distance: green when close, orange when far
    const t = Math.min(1, closestDist / gunRange);
    if (t < 0.5) {
      this.leadMarker.style.borderColor = 'rgba(100, 255, 100, 0.9)';
      this.leadLabel.style.color = 'rgba(100, 255, 100, 0.8)';
    } else {
      this.leadMarker.style.borderColor = 'rgba(255, 150, 50, 0.9)';
      this.leadLabel.style.color = 'rgba(255, 150, 50, 0.8)';
    }
  }

  update(camera, playerAircraft, enemies, missileSystem) {
    // Hide all markers first
    for (const marker of this.markerPool) {
      marker.element.style.display = 'none';
    }

    if (!enemies || enemies.length === 0) {
      this.targetInfo.classList.add('hidden');
      this.leadMarker.style.display = 'none';
      return;
    }

    let markerIdx = 0;
    const screenSize = new THREE.Vector2(window.innerWidth, window.innerHeight);

    for (const enemy of enemies) {
      if (!enemy.alive || markerIdx >= this.maxMarkers) continue;

      const dist = playerAircraft.position.distanceTo(enemy.position);
      if (dist > 6000) continue;

      // Project to screen
      const screenPos = enemy.position.clone().project(camera);

      // Check if in front of camera
      if (screenPos.z > 1) continue;

      const x = (screenPos.x * 0.5 + 0.5) * screenSize.x;
      const y = (-screenPos.y * 0.5 + 0.5) * screenSize.y;

      // Check if on screen (with margin)
      if (x < -50 || x > screenSize.x + 50 || y < -50 || y > screenSize.y + 50) continue;

      const marker = this.markerPool[markerIdx];
      marker.element.style.display = 'block';
      marker.element.style.left = `${x}px`;
      marker.element.style.top = `${y}px`;

      const distKm = (dist / 1000).toFixed(1);
      marker.label.textContent = `${distKm}km`;

      // Locked target gets special treatment
      if (missileSystem && enemy === missileSystem.lockedTarget) {
        marker.element.style.borderColor = '#ff0000';
        marker.element.style.width = '30px';
        marker.element.style.height = '30px';
        marker.label.style.color = '#ff0000';
      } else if (missileSystem && enemy === missileSystem.lockingTarget) {
        marker.element.style.borderColor = '#ffaa00';
        marker.element.style.width = '24px';
        marker.element.style.height = '24px';
        marker.label.style.color = '#ffaa00';
      } else {
        marker.element.style.borderColor = '#ff6600';
        marker.element.style.width = '24px';
        marker.element.style.height = '24px';
        marker.label.style.color = '#ff6600';
      }

      markerIdx++;
    }

    // Update lock indicator panel
    if (missileSystem && missileSystem.lockingTarget) {
      this.targetInfo.classList.remove('hidden');
      const lockDist = playerAircraft.position.distanceTo(
        missileSystem.lockingTarget.position
      );
      this.distanceDisplay.textContent = `${(lockDist / 1000).toFixed(1)}km`;

      if (missileSystem.lockedTarget) {
        this.lockIndicator.classList.add('locked');
        this.lockIndicator.style.borderColor = '#ff0000';
        this.distanceDisplay.style.color = '#ff0000';
      } else {
        this.lockIndicator.classList.remove('locked');
        // Animate lock progress
        const progress = missileSystem.lockProgress;
        const dashLength = Math.PI * 2 * 15; // circumference
        const dashOffset = dashLength * (1 - progress);
        this.lockIndicator.style.borderColor = '#ff6600';
        this.lockIndicator.style.borderStyle = progress > 0 ? 'solid' : 'dashed';
        this.distanceDisplay.style.color = '#ff6600';
      }
    } else {
      this.targetInfo.classList.add('hidden');
    }

    // Update gun lead indicator
    this._updateLeadIndicator(camera, playerAircraft, enemies);

    // Update lock zone circle
    this._updateLockZoneCircle(camera);
    if (missileSystem && missileSystem.lockedTarget) {
      this.lockZoneCircle.style.borderColor = 'rgba(255, 0, 0, 0.6)';
      this.lockZoneCircle.style.borderStyle = 'solid';
    } else if (missileSystem && missileSystem.lockingTarget) {
      this.lockZoneCircle.style.borderColor = 'rgba(255, 170, 0, 0.5)';
      this.lockZoneCircle.style.borderStyle = 'dashed';
    } else {
      this.lockZoneCircle.style.borderColor = 'rgba(255, 102, 0, 0.25)';
      this.lockZoneCircle.style.borderStyle = 'dashed';
    }
  }

  destroy() {
    // Remove marker pool elements
    for (const marker of this.markerPool) {
      if (marker.element.parentNode) marker.element.parentNode.removeChild(marker.element);
    }
    this.markerPool.length = 0;
    // Remove lead marker
    if (this.leadMarker && this.leadMarker.parentNode) {
      this.leadMarker.parentNode.removeChild(this.leadMarker);
    }
    // Remove lock zone circle
    if (this.lockZoneCircle && this.lockZoneCircle.parentNode) {
      this.lockZoneCircle.parentNode.removeChild(this.lockZoneCircle);
    }
    // Hide target info panel
    if (this.targetInfo) this.targetInfo.classList.add('hidden');
    // Reset lock indicator
    if (this.lockIndicator) {
      this.lockIndicator.classList.remove('locked');
      this.lockIndicator.style.borderColor = '';
      this.lockIndicator.style.borderStyle = '';
    }
  }
}
