import * as THREE from 'three';
import { PHYSICS, WORLD } from '../config.js';

export class FlightModel {
  constructor() {
    // Temp vectors to avoid allocations
    this._force = new THREE.Vector3();
    this._liftDir = new THREE.Vector3();
    this._dragDir = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._velNorm = new THREE.Vector3();
    this._angularDelta = new THREE.Quaternion();
    this._targetQuat = new THREE.Quaternion();
    this._worldUp = new THREE.Vector3(0, 1, 0);
  }

  /**
   * War Thunder-style instructor: given a target direction the player wants
   * the nose to point at, compute optimal pitch/roll/yaw inputs.
   *
   * The instructor:
   * 1. Computes the error angle between nose and target
   * 2. Banks the plane to align the lift vector for the turn
   * 3. Pitches to pull the nose toward the target
   * 4. Adds coordinated yaw
   * 5. Auto-levels wings when close to target (for stable flight)
   */
  computeInstructorInputs(aircraft, targetDir) {
    this._forward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(aircraft.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(aircraft.quaternion);

    // Error between forward and target direction
    const dot = this._forward.dot(targetDir);
    const errorAngle = Math.acos(Math.min(1, Math.max(-1, dot)));

    // Cross product gives rotation axis
    const cross = new THREE.Vector3().crossVectors(this._forward, targetDir);

    // Decompose error into pitch and yaw components in aircraft local space
    // How much the target is above/below us (pitch error)
    const pitchError = -this._up.dot(targetDir);
    // How much the target is left/right of us (needs roll to turn)
    const yawError = this._right.dot(targetDir);

    // Sensitivity ramps up with error angle for responsive feel
    // Near center (< ~5 deg): very gentle = precise aiming
    // Medium (5-30 deg): proportional
    // Large (> 30 deg): full authority
    const errorNorm = Math.min(1, errorAngle / 0.8); // 0.8 rad ~ 45 deg for full authority
    const sensitivity = errorNorm * errorNorm; // quadratic for precision near center

    let pitchInput = 0;
    let rollInput = 0;
    let yawInput = 0;

    // === ROLL: Bank into the turn ===
    // The plane should roll to put the lift vector in the direction of the turn
    // This is the key War Thunder behavior: roll first, then pull
    if (errorAngle > 0.03) { // Small deadzone ~1.7 degrees
      // Target is off to the side - we need to bank toward it
      // yawError > 0 = target is to the right = roll right (negative roll in our system)
      const rollCommand = yawError * 3.0 * Math.min(1, errorAngle / 0.3);
      rollInput = THREE.MathUtils.clamp(rollCommand, -1, 1);
    }

    // === AUTO-LEVEL ===
    // When the mouse is near center (target near forward), gently level the wings
    // This prevents the plane from staying banked when you're done turning
    if (errorAngle < 0.15) { // ~8.6 degrees - nearly on target
      // How much are we currently banked?
      const bankAngle = Math.atan2(this._right.dot(this._worldUp), this._up.dot(this._worldUp));
      // Roll toward level (negated — positive bankAngle means roll negative to correct)
      const levelRoll = -bankAngle * 2.0 * (1 - errorAngle / 0.15);
      rollInput += THREE.MathUtils.clamp(levelRoll, -0.5, 0.5);
      rollInput = THREE.MathUtils.clamp(rollInput, -1, 1);
    }

    // === PITCH: Pull toward target ===
    // Once banked, pulling pitch brings the nose toward the target
    if (errorAngle > 0.02) {
      // The vertical component of the error in the aircraft's frame
      const verticalError = cross.dot(this._right);
      const pitchCommand = verticalError * 3.0;
      pitchInput = THREE.MathUtils.clamp(pitchCommand, -1, 1);

      // Also add direct pitch for small corrections (fine aiming)
      const directPitch = pitchError * 2.0;
      pitchInput = THREE.MathUtils.clamp(pitchInput + directPitch * (1 - sensitivity), -1, 1);
    }

    // === YAW: Coordinated turn ===
    // Small yaw to assist the turn and reduce sideslip
    yawInput = THREE.MathUtils.clamp(-yawError * 0.5, -0.3, 0.3);

    return { pitch: pitchInput, roll: rollInput, yaw: yawInput };
  }

  update(aircraft, input, dt) {
    if (!aircraft.alive) return;

    const {
      GRAVITY, AIR_DENSITY_SEA_LEVEL, WING_AREA, ASPECT_RATIO,
      OSWALD_EFFICIENCY, CD0, CL_PER_AOA, MAX_AOA, STALL_AOA,
      CL_MAX, MASS, MAX_THRUST, IDLE_THRUST, MAX_SPEED,
      PITCH_RATE, ROLL_RATE, YAW_RATE,
      PITCH_DAMPING, ROLL_DAMPING, YAW_DAMPING,
      MIN_SPEED_FOR_CONTROL, VELOCITY_ALIGNMENT, MIN_SPEED_CLAMP,
    } = PHYSICS;

    // Update throttle from input
    aircraft.throttle = input.throttle;

    // Get aircraft axes
    this._forward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(aircraft.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(aircraft.quaternion);

    // Speed
    aircraft.speed = aircraft.velocity.length();
    const speedSq = aircraft.speed * aircraft.speed;

    // Air density (decreases with altitude, but less aggressive for arcade)
    const altitude = Math.max(0, aircraft.position.y);
    const rho = AIR_DENSITY_SEA_LEVEL * Math.exp(-altitude / 15000);

    // Dynamic pressure
    const q = 0.5 * rho * speedSq;

    // Control authority - more forgiving, still works at lower speeds
    const controlAuthority = Math.min(1, Math.pow(aircraft.speed / MIN_SPEED_FOR_CONTROL, 0.7));

    // --- DETERMINE CONTROL INPUTS ---
    let inputPitch, inputRoll, inputYaw;

    if (input.useMouseAim && input.mouseTargetDir) {
      // WAR THUNDER INSTRUCTOR MODE
      // Compute optimal controls to aim the nose at the mouse target direction
      const instructorInputs = this.computeInstructorInputs(aircraft, input.mouseTargetDir);
      inputPitch = instructorInputs.pitch;
      inputRoll = instructorInputs.roll;
      inputYaw = instructorInputs.yaw;
    } else {
      // DIRECT KEYBOARD CONTROL
      inputPitch = input.pitch;
      inputRoll = input.roll;
      inputYaw = input.yaw;
    }

    // --- ANGULAR VELOCITY (rotation controls) ---
    const targetPitch = inputPitch * PITCH_RATE * controlAuthority;
    const targetRoll = inputRoll * ROLL_RATE * controlAuthority;
    const targetYaw = inputYaw * YAW_RATE * controlAuthority;

    // Smooth angular velocity with damping
    const pitchLerp = Math.min(1, PITCH_DAMPING * dt);
    const rollLerp = Math.min(1, ROLL_DAMPING * dt);
    const yawLerp = Math.min(1, YAW_DAMPING * dt);

    aircraft.angularVelocity.x += (targetPitch - aircraft.angularVelocity.x) * pitchLerp;
    aircraft.angularVelocity.y += (targetYaw - aircraft.angularVelocity.y) * yawLerp;
    aircraft.angularVelocity.z += (targetRoll - aircraft.angularVelocity.z) * rollLerp;

    // Apply angular velocity to quaternion
    const angMag = aircraft.angularVelocity.length();
    if (angMag > 0.0001) {
      const axis = aircraft.angularVelocity.clone().normalize();
      const worldAxis = axis.clone().applyQuaternion(aircraft.quaternion);

      this._angularDelta.setFromAxisAngle(worldAxis, angMag * dt);
      aircraft.quaternion.premultiply(this._angularDelta);
      aircraft.quaternion.normalize();
    }

    // --- VELOCITY ALIGNMENT (instructor stabilization) ---
    // Gently align velocity vector with nose direction (reduces sideslip)
    if (aircraft.speed > 20) {
      this._velNorm.copy(aircraft.velocity).normalize();
      const currentForward = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);

      const alignQuat = new THREE.Quaternion().setFromUnitVectors(this._velNorm, currentForward);
      alignQuat.slerp(new THREE.Quaternion(), 1 - VELOCITY_ALIGNMENT * dt);
      aircraft.velocity.applyQuaternion(alignQuat);
      aircraft.velocity.normalize().multiplyScalar(aircraft.speed);
    }

    // Recalculate forward after rotation
    this._forward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(aircraft.quaternion);

    // --- ANGLE OF ATTACK ---
    let aoa = 0;
    if (aircraft.speed > 1) {
      this._velNorm.copy(aircraft.velocity).normalize();
      const dotFwd = this._forward.dot(this._velNorm);
      const dotUp = this._up.dot(this._velNorm);
      aoa = Math.atan2(-dotUp, dotFwd);
    }
    aoa = THREE.MathUtils.clamp(aoa, -MAX_AOA, MAX_AOA);

    // --- LIFT ---
    let Cl = CL_PER_AOA * aoa;

    // Stall: softer stall for arcade feel
    if (Math.abs(aoa) > STALL_AOA) {
      const stallFactor = 1 - (Math.abs(aoa) - STALL_AOA) / (MAX_AOA - STALL_AOA);
      Cl *= Math.max(0.35, stallFactor);
    }
    Cl = THREE.MathUtils.clamp(Cl, -CL_MAX, CL_MAX);

    // Lift collapses below 220 knots (113 m/s) — no lift, plane drops
    const liftSpeedMin = 113; // 220 kts in m/s
    const liftSpeedFactor = THREE.MathUtils.clamp((aircraft.speed - liftSpeedMin * 0.7) / (liftSpeedMin * 0.3), 0, 1);
    const liftMagnitude = q * WING_AREA * Cl * liftSpeedFactor;

    // Lift direction
    if (aircraft.speed > 5) {
      this._velNorm.copy(aircraft.velocity).normalize();
      this._liftDir.crossVectors(this._velNorm, this._right).normalize();
      if (this._liftDir.dot(this._up) < 0) {
        this._liftDir.negate();
      }
    } else {
      this._liftDir.set(0, 1, 0);
    }

    // --- DRAG ---
    const ClSq = Cl * Cl;
    const Cd = CD0 + ClSq / (Math.PI * ASPECT_RATIO * OSWALD_EFFICIENCY);
    const dragMagnitude = q * WING_AREA * Cd;

    if (aircraft.speed > 1) {
      this._dragDir.copy(aircraft.velocity).normalize().negate();
    } else {
      this._dragDir.set(0, 0, 0);
    }

    // --- THRUST ---
    // No idle thrust when throttle is zero — engine is off
    const thrustMagnitude = aircraft.throttle > 0
      ? IDLE_THRUST + (MAX_THRUST - IDLE_THRUST) * aircraft.throttle
      : 0;

    // --- AIRBRAKE ---
    // When airbrake is active (CTRL held at 0% throttle), multiply drag significantly
    const airbrakeActive = input.airbrake;
    const airbrakeFactor = airbrakeActive ? 6.0 : 1.0;

    // --- TOTAL FORCE ---
    this._force.set(0, 0, 0);

    // Gravity
    this._force.y -= GRAVITY * MASS;

    // Lift
    this._force.addScaledVector(this._liftDir, liftMagnitude);

    // Drag (amplified by airbrake)
    this._force.addScaledVector(this._dragDir, dragMagnitude * airbrakeFactor);

    // Thrust (along forward axis)
    this._force.addScaledVector(this._forward, thrustMagnitude);

    // --- INTEGRATION ---
    const acceleration = this._force.clone().divideScalar(MASS);

    // G-Force calculation (just for HUD display, no gameplay effect)
    const accelWithoutGravity = acceleration.clone();
    accelWithoutGravity.y += GRAVITY;
    const gUp = accelWithoutGravity.dot(this._up) / GRAVITY;
    aircraft.gForce = gUp;

    // Semi-implicit Euler integration
    aircraft.velocity.addScaledVector(acceleration, dt);

    // Speed limiting
    const currentSpeed = aircraft.velocity.length();
    if (currentSpeed > MAX_SPEED) {
      aircraft.velocity.normalize().multiplyScalar(MAX_SPEED);
    }

    // Arcade: minimum speed clamp (prevents stalling to a halt)
    // Airbrake allows much lower speed
    const effectiveMinSpeed = airbrakeActive ? MIN_SPEED_CLAMP * 0.4 : MIN_SPEED_CLAMP;
    if (currentSpeed < effectiveMinSpeed && aircraft.position.y > 50) {
      aircraft.velocity.normalize().multiplyScalar(effectiveMinSpeed);
    }

    // Update position
    aircraft.position.addScaledVector(aircraft.velocity, dt);

    // Keep above ground level (emergency)
    if (aircraft.position.y < 0) {
      aircraft.position.y = 0;
      if (aircraft.velocity.y < 0) {
        aircraft.velocity.y = 0;
      }
    }

    // --- WORLD BOUNDARY ---
    // Steer velocity back toward center when approaching map edge
    const distFromCenter = Math.sqrt(
      aircraft.position.x * aircraft.position.x +
      aircraft.position.z * aircraft.position.z
    );
    if (distFromCenter > WORLD.BOUNDARY_SOFT) {
      const urgency = THREE.MathUtils.clamp(
        (distFromCenter - WORLD.BOUNDARY_SOFT) / (WORLD.BOUNDARY_HARD - WORLD.BOUNDARY_SOFT),
        0, 1
      );
      // Direction back to center (horizontal only)
      const toCenter = new THREE.Vector3(-aircraft.position.x, 0, -aircraft.position.z).normalize();
      // Blend velocity toward center
      const currentHoriz = new THREE.Vector3(aircraft.velocity.x, 0, aircraft.velocity.z);
      const horizSpeed = currentHoriz.length();
      if (horizSpeed > 1) {
        const currentDir = currentHoriz.normalize();
        const blended = currentDir.lerp(toCenter, urgency * urgency).normalize();
        aircraft.velocity.x = blended.x * horizSpeed;
        aircraft.velocity.z = blended.z * horizSpeed;
      }
      // Also nudge the nose toward center via quaternion
      if (urgency > 0.3) {
        const currentForward = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        const horizForward = new THREE.Vector3(currentForward.x, 0, currentForward.z).normalize();
        const targetDir = horizForward.lerp(toCenter, urgency * 0.5).normalize();
        const fullTarget = new THREE.Vector3(targetDir.x, currentForward.y, targetDir.z).normalize();
        const turnQuat = new THREE.Quaternion().setFromUnitVectors(currentForward, fullTarget);
        aircraft.quaternion.premultiply(turnQuat);
        aircraft.quaternion.normalize();
      }
      // Hard clamp at the hard boundary
      if (distFromCenter > WORLD.BOUNDARY_HARD) {
        const scale = WORLD.BOUNDARY_HARD / distFromCenter;
        aircraft.position.x *= scale;
        aircraft.position.z *= scale;
      }
    }

    // Update speed
    aircraft.speed = aircraft.velocity.length();

    // Store for next frame
    aircraft.previousVelocity.copy(aircraft.velocity);
  }
}
