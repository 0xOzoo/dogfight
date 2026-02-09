import * as THREE from 'three';

export class InputManager {
  constructor() {
    this.keys = {};
    this.mouseButtons = {};

    // Processed inputs (smoothed)
    this.pitch = 0;    // -1 to 1
    this.roll = 0;     // -1 to 1
    this.yaw = 0;      // -1 to 1
    this.throttle = 0.5; // 0 to 1
    this.firing = false;
    this.fireMissile = false;
    this.deployFlares = false;
    this.cycleTarget = false;
    this.toggleCamera = false;
    this.pause = false;
    this.zoom = false; // Right-click zoom
    this.airbrake = false;

    // Mouse aim position (used for instructor unprojection)
    this.mouseScreenX = 0;  // -1 to 1 (normalized screen position)
    this.mouseScreenY = 0;  // -1 to 1

    // Target direction computed from mouse via camera unprojection
    this.mouseTargetDir = new THREE.Vector3(0, 0, -1);

    // Camera reference (set by main.js each frame)
    this.camera = null;

    // Track single-press actions
    this._prevKeys = {};

    // Mouse/keyboard handoff state
    // Raw mouse pixel position (always updated by mousemove)
    this._rawMouseX = 0;
    this._rawMouseY = 0;
    // When keyboard is used, we record the mouse position at that moment.
    // Mouse aim only re-engages after the mouse moves >20px from that point.
    this._waitingForMouse = false;
    this._kbMouseRefX = 0;
    this._kbMouseRefY = 0;

    // Create visible mouse reticle
    this._createMouseReticle();

    this.setupListeners();
  }

  _createMouseReticle() {
    // Create a CSS element that follows the mouse - shows where the plane will aim
    this.reticle = document.createElement('div');
    this.reticle.id = 'mouse-reticle';
    this.reticle.style.cssText = `
      position: fixed;
      width: 24px;
      height: 24px;
      border: 2px solid rgba(0, 255, 100, 0.7);
      border-radius: 50%;
      pointer-events: none;
      z-index: 1000;
      transform: translate(-50%, -50%);
      display: none;
      box-shadow: 0 0 6px rgba(0, 255, 100, 0.3);
    `;
    // Inner dot
    const dot = document.createElement('div');
    dot.style.cssText = `
      position: absolute;
      width: 4px;
      height: 4px;
      background: rgba(0, 255, 100, 0.9);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    `;
    this.reticle.appendChild(dot);
    document.body.appendChild(this.reticle);
  }

  setupListeners() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!e.code.startsWith('F1')) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (!e.code.startsWith('F1')) {
        e.preventDefault();
      }
    });

    // Track absolute mouse position on screen
    window.addEventListener('mousemove', (e) => {
      this._rawMouseX = e.clientX;
      this._rawMouseY = e.clientY;
      // Update reticle position
      this.reticle.style.left = e.clientX + 'px';
      this.reticle.style.top = e.clientY + 'px';
    });

    window.addEventListener('mousedown', (e) => {
      this.mouseButtons[e.button] = true;
    });

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons[e.button] = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('blur', () => {
      this.keys = {};
      this.mouseButtons = {};
    });
  }

  justPressed(code) {
    return this.keys[code] && !this._prevKeys[code];
  }

  update(dt) {
    const smooth = Math.min(1, dt * 8);

    // === KEYBOARD INPUT ===
    let kbPitch = 0;
    let kbRoll = 0;
    let kbYaw = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) kbPitch = 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) kbPitch = -1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) kbRoll = 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) kbRoll = -1;
    if (this.keys['KeyQ']) kbYaw = 1;
    if (this.keys['KeyE']) kbYaw = -1;

    const kbActive = kbPitch !== 0 || kbRoll !== 0 || kbYaw !== 0;

    // === COMBINE: keyboard vs mouse ===
    if (kbActive) {
      // Keyboard direct control — override mouse entirely
      this.pitch += (kbPitch - this.pitch) * smooth;
      this.roll += (kbRoll - this.roll) * smooth;
      this.yaw += (kbYaw - this.yaw) * smooth;
      this.useMouseAim = false;
      // Record where the mouse is so we can detect intentional movement later
      this._waitingForMouse = true;
      this._kbMouseRefX = this._rawMouseX;
      this._kbMouseRefY = this._rawMouseY;
    } else if (this._waitingForMouse) {
      // Keyboard just released — coast until mouse moves intentionally (>20px)
      const dx = this._rawMouseX - this._kbMouseRefX;
      const dy = this._rawMouseY - this._kbMouseRefY;
      if (dx * dx + dy * dy > 400) {
        this._waitingForMouse = false;
      }
      // Coast: smoothly decay inputs to zero (fly straight)
      this.useMouseAim = false;
      this.pitch += (0 - this.pitch) * smooth;
      this.roll += (0 - this.roll) * smooth;
      this.yaw += (0 - this.yaw) * smooth;
    } else {
      // Mouse aim active — update aim position from raw mouse
      this.mouseScreenX = (this._rawMouseX / window.innerWidth) * 2 - 1;
      this.mouseScreenY = (this._rawMouseY / window.innerHeight) * 2 - 1;
      this.useMouseAim = true;
    }

    // Unproject mouse screen position to get 3D target direction
    if (this.camera && this.useMouseAim) {
      const mouseNDC = new THREE.Vector3(this.mouseScreenX, -this.mouseScreenY, 0.5);
      mouseNDC.unproject(this.camera);
      this.mouseTargetDir.copy(mouseNDC).sub(this.camera.position).normalize();
    }

    // Show/hide reticle
    this.reticle.style.display = this.useMouseAim ? 'block' : 'none';

    // Throttle
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      this.throttle = Math.min(1, this.throttle + dt * 0.5);
    }
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
      this.throttle = Math.max(0, this.throttle - dt * 0.5);
    }

    // Airbrake: CTRL held while throttle is at 0
    this.airbrake = (this.keys['ControlLeft'] || this.keys['ControlRight']) && this.throttle <= 0;

    // Fire
    this.firing = this.keys['Space'] || this.mouseButtons[0];

    // Zoom (right mouse button)
    this.zoom = !!this.mouseButtons[2];

    // Single-press
    this.fireMissile = this.justPressed('KeyF');
    this.deployFlares = this.justPressed('KeyX');
    this.cycleTarget = this.justPressed('KeyT');
    this.toggleCamera = this.justPressed('KeyV');
    this.pause = this.justPressed('Escape');

    this._prevKeys = { ...this.keys };
  }

  reset() {
    this.throttle = 0.5;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;
    this.useMouseAim = true;
    this._waitingForMouse = false;
  }
}
