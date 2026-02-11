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
    this.zoom = false;
    this.airbrake = false;

    // Mouse aim position (used for instructor unprojection)
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;

    // Target direction computed from mouse via camera unprojection
    this.mouseTargetDir = new THREE.Vector3(0, 0, -1);

    // Camera reference (set by main.js each frame)
    this.camera = null;

    // Track single-press actions
    this._prevKeys = {};

    // Virtual mouse position (for pointer lock — accumulates movementX/Y)
    this._virtualMouseX = window.innerWidth / 2;
    this._virtualMouseY = window.innerHeight / 2;
    this._pointerLocked = false;

    // Mouse/keyboard handoff state
    this._rawMouseX = 0;
    this._rawMouseY = 0;
    this._waitingForMouse = false;
    this._kbMouseRefX = 0;
    this._kbMouseRefY = 0;

    // Gamepad state
    this._prevGamepadButtons = [];
    this._gamepadActive = false;
    this.gamepadConnected = false;
    this._gpPitch = 0;
    this._gpRoll = 0;
    this._gpYaw = 0;

    // Create visible mouse reticle
    this._createMouseReticle();

    this.setupListeners();
  }

  _createMouseReticle() {
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

  requestPointerLock() {
    const canvas = document.getElementById('game-canvas');
    if (canvas && !this._pointerLocked) {
      canvas.requestPointerLock();
    }
  }

  exitPointerLock() {
    if (this._pointerLocked) {
      document.exitPointerLock();
    }
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

    window.addEventListener('mousemove', (e) => {
      if (this._pointerLocked) {
        // Pointer locked: accumulate relative movement into virtual cursor
        this._virtualMouseX += e.movementX;
        this._virtualMouseY += e.movementY;
        // Clamp to window bounds
        this._virtualMouseX = Math.max(0, Math.min(window.innerWidth, this._virtualMouseX));
        this._virtualMouseY = Math.max(0, Math.min(window.innerHeight, this._virtualMouseY));
        this._rawMouseX = this._virtualMouseX;
        this._rawMouseY = this._virtualMouseY;
      } else {
        this._rawMouseX = e.clientX;
        this._rawMouseY = e.clientY;
        this._virtualMouseX = e.clientX;
        this._virtualMouseY = e.clientY;
      }
      this.reticle.style.left = this._rawMouseX + 'px';
      this.reticle.style.top = this._rawMouseY + 'px';
    });

    window.addEventListener('mousedown', (e) => {
      this.mouseButtons[e.button] = true;
    });

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons[e.button] = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Track pointer lock state
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = !!document.pointerLockElement;
      if (this._pointerLocked) {
        // Center virtual cursor when lock acquired
        this._virtualMouseX = window.innerWidth / 2;
        this._virtualMouseY = window.innerHeight / 2;
        this._rawMouseX = this._virtualMouseX;
        this._rawMouseY = this._virtualMouseY;
      }
    });

    window.addEventListener('blur', () => {
      this.keys = {};
      this.mouseButtons = {};
    });
  }

  justPressed(code) {
    return this.keys[code] && !this._prevKeys[code];
  }

  _applyDeadzone(value, threshold = 0.15) {
    if (Math.abs(value) < threshold) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * (Math.abs(value) - threshold) / (1 - threshold);
  }

  _gpJustPressed(index) {
    const gamepads = navigator.getGamepads();
    const gp = gamepads[this._gamepadIndex];
    if (!gp || !gp.buttons[index]) return false;
    return gp.buttons[index].pressed && !this._prevGamepadButtons[index];
  }

  _pollGamepad(dt) {
    const gamepads = navigator.getGamepads();
    if (!gamepads) {
      this._gamepadActive = false;
      this.gamepadConnected = false;
      return;
    }

    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        this._gamepadIndex = i;
        break;
      }
    }

    if (!gp) {
      this._gamepadActive = false;
      this.gamepadConnected = false;
      return;
    }

    this.gamepadConnected = true;

    // Left stick
    this._gpRoll = this._applyDeadzone(gp.axes[0] || 0);
    this._gpPitch = this._applyDeadzone(gp.axes[1] || 0);
    this._gpPitch = -this._gpPitch;
    this._gpRoll = -this._gpRoll;

    // Right stick
    const rsX = this._applyDeadzone(gp.axes[2] || 0);
    const rsY = this._applyDeadzone(gp.axes[3] || 0);
    this._gpYaw = -rsX;

    // Triggers
    const ltValue = gp.buttons[6] ? gp.buttons[6].value : 0;
    const rtValue = gp.buttons[7] ? gp.buttons[7].value : 0;

    if (rtValue > 0.05) {
      this.throttle = Math.min(1, this.throttle + rtValue * dt * 0.8);
    }
    if (ltValue > 0.05) {
      this.throttle = Math.max(0, this.throttle - ltValue * dt * 0.8);
    }
    if (ltValue > 0.05 && this.throttle <= 0) {
      this.airbrake = true;
    }

    const sticksActive = this._gpPitch !== 0 || this._gpRoll !== 0 || this._gpYaw !== 0;
    const triggersActive = ltValue > 0.05 || rtValue > 0.05;
    this._gamepadActive = sticksActive || triggersActive;

    // Hold buttons
    if (gp.buttons[0] && gp.buttons[0].pressed) this.firing = true;
    if (gp.buttons[5] && gp.buttons[5].pressed) this.zoom = true;

    // Single-press buttons
    if (this._gpJustPressed(1)) this.deployFlares = true;
    if (this._gpJustPressed(2)) this.fireMissile = true;
    if (this._gpJustPressed(3)) this.cycleTarget = true;
    if (this._gpJustPressed(8)) this.toggleCamera = true;
    if (this._gpJustPressed(9)) this.pause = true;

    this._prevGamepadButtons = [];
    for (let i = 0; i < gp.buttons.length; i++) {
      this._prevGamepadButtons[i] = gp.buttons[i] ? gp.buttons[i].pressed : false;
    }
  }

  update(dt) {
    const smooth = Math.min(1, dt * 8);

    // Reset per-frame actions
    this.firing = false;
    this.fireMissile = false;
    this.deployFlares = false;
    this.cycleTarget = false;
    this.toggleCamera = false;
    this.pause = false;
    this.zoom = false;
    this.airbrake = false;

    // === POLL GAMEPAD ===
    this._pollGamepad(dt);

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
    const gpSticksActive = this._gpPitch !== 0 || this._gpRoll !== 0 || this._gpYaw !== 0;

    // === COMBINE: gamepad vs keyboard vs mouse ===
    if (gpSticksActive) {
      this.pitch += (this._gpPitch - this.pitch) * smooth;
      this.roll += (this._gpRoll - this.roll) * smooth;
      this.yaw += (this._gpYaw - this.yaw) * smooth;
      this.useMouseAim = false;
      this._waitingForMouse = true;
      this._kbMouseRefX = this._rawMouseX;
      this._kbMouseRefY = this._rawMouseY;
    } else if (kbActive) {
      this.pitch += (kbPitch - this.pitch) * smooth;
      this.roll += (kbRoll - this.roll) * smooth;
      this.yaw += (kbYaw - this.yaw) * smooth;
      this.useMouseAim = false;
      this._waitingForMouse = true;
      this._kbMouseRefX = this._rawMouseX;
      this._kbMouseRefY = this._rawMouseY;
    } else if (this._waitingForMouse) {
      const dx = this._rawMouseX - this._kbMouseRefX;
      const dy = this._rawMouseY - this._kbMouseRefY;
      if (dx * dx + dy * dy > 400) {
        this._waitingForMouse = false;
      }
      this.useMouseAim = false;
      this.pitch += (0 - this.pitch) * smooth;
      this.roll += (0 - this.roll) * smooth;
      this.yaw += (0 - this.yaw) * smooth;
    } else {
      // Mouse aim active
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

    // Throttle (keyboard)
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      this.throttle = Math.min(1, this.throttle + dt * 0.5);
    }
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
      this.throttle = Math.max(0, this.throttle - dt * 0.5);
    }

    // Airbrake
    if ((this.keys['ControlLeft'] || this.keys['ControlRight']) && this.throttle <= 0) {
      this.airbrake = true;
    }

    // Fire
    if (this.keys['Space'] || this.mouseButtons[0]) this.firing = true;

    // Zoom
    if (this.mouseButtons[2]) this.zoom = true;

    // Single-press keyboard
    if (this.justPressed('KeyF')) this.fireMissile = true;
    if (this.justPressed('KeyX')) this.deployFlares = true;
    if (this.justPressed('KeyT')) this.cycleTarget = true;
    if (this.justPressed('KeyV')) this.toggleCamera = true;
    if (this.justPressed('Escape')) this.pause = true;

    this._updateControlsHint();

    this._prevKeys = { ...this.keys };
  }

  _updateControlsHint() {
    const kbHint = document.getElementById('controls-hint-kb');
    const gpHint = document.getElementById('controls-hint-gp');
    if (!kbHint || !gpHint) return;

    if (this._gamepadActive) {
      kbHint.style.display = 'none';
      gpHint.style.display = 'block';
    } else if (!this.gamepadConnected) {
      kbHint.style.display = 'block';
      gpHint.style.display = 'none';
    } else {
      const kbOrMouseActive = Object.values(this.keys).some(v => v) ||
        Object.values(this.mouseButtons).some(v => v);
      if (kbOrMouseActive) {
        kbHint.style.display = 'block';
        gpHint.style.display = 'none';
      }
    }
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
