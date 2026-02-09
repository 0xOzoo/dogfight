import * as THREE from 'three';
import { AIRCRAFT, PHYSICS, CAMERA } from '../config.js';

export class Aircraft {
  constructor(scene, modelTemplate) {
    this.scene = scene;

    // State
    this.position = new THREE.Vector3(0, AIRCRAFT.INITIAL_ALTITUDE, 0);
    this.velocity = new THREE.Vector3(0, 0, -AIRCRAFT.INITIAL_SPEED);
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3(0, 0, 0);

    this.throttle = 0.5;
    this.speed = AIRCRAFT.INITIAL_SPEED;
    this.health = AIRCRAFT.HEALTH;
    this.alive = true;
    this.lastDamageSource = null; // 'gun' or 'missile'

    // G-force tracking (display only)
    this.gForce = 1;
    this.previousVelocity = this.velocity.clone();

    // Weapon state
    this.ammo = 0;
    this.missiles = 0;
    this.flares = 0;

    // Camera modes
    this.cameraMode = 0; // 0 = chase, 1 = cockpit
    this.cameraOffset = new THREE.Vector3(0, CAMERA.CHASE_HEIGHT, CAMERA.CHASE_DISTANCE);

    // Zoom state
    this.currentFov = CAMERA.FOV;
    this.zoomFov = 30; // Zoomed-in FOV for gun aiming

    // Build mesh
    this.mesh = this.createMesh(modelTemplate);
    this.scene.add(this.mesh);
  }

  createMesh(modelTemplate) {
    const group = new THREE.Group();

    // Exhaust position depends on which mesh we use
    let exhaustZ = 8.0;
    let afterburnerZ = 9.5;
    let exhaustRadius = 0.4;
    let abConeRadius = 0.3;
    let abConeLength = 3;

    if (modelTemplate) {
      // GLTF model: nose faces +Z, belly faces +Y (upside-down).
      // Flip Y to right the model, flip Z so nose points -Z (game forward).
      // Two negative axes = positive determinant = no reflection.
      const model = modelTemplate.clone();
      const wrapper = new THREE.Group();
      const scale = 8.0;
      wrapper.scale.set(scale, -scale, -scale);
      wrapper.add(model);
      group.add(wrapper);
      this.modelInner = wrapper;

      // Fix inverted face winding from negative Z scale
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => { m.side = THREE.DoubleSide; });
          } else {
            child.material.side = THREE.DoubleSide;
          }
        }
      });

      // Model tail was at Z≈+0.40, after Z-flip → Z≈-0.40, scaled → Z≈+3.2
      // (negative scale negates Z: +0.40 * -8 = -3.2 in wrapper, but wrapper is in group
      //  where its local -Z maps to group +Z? No — the scale IS the wrapper transform.
      //  Point at model Z=+0.40 → wrapper output: 0.40 * -8 = -3.2 in group space.
      //  That's in FRONT of the plane. The tail should be BEHIND (+Z in group).
      //  Model Z=-2.27 → -2.27 * -8 = +18.2 in group space = behind the plane.)
      // So the actual tail (engine) end is at group Z ≈ +18, exhaust goes there.
      exhaustZ = 18.5;
      afterburnerZ = 20.0;
      exhaustRadius = 0.5;
      abConeRadius = 0.35;
      abConeLength = 3;
    } else {
      // Fallback procedural mesh
      this.modelInner = this.createProceduralMesh(group);
    }

    // Engine exhaust glow (positioned at tail of whichever model)
    const exhaustGeom = new THREE.CircleGeometry(exhaustRadius, 16);
    const exhaustMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6,
    });
    this.exhaustMesh = new THREE.Mesh(exhaustGeom, exhaustMat);
    this.exhaustMesh.position.z = exhaustZ;
    group.add(this.exhaustMesh);

    // Afterburner cone (visible at high throttle)
    const abGeom = new THREE.ConeGeometry(abConeRadius, abConeLength, 8);
    abGeom.rotateX(-Math.PI / 2);
    const abMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0,
    });
    this.afterburnerMesh = new THREE.Mesh(abGeom, abMat);
    this.afterburnerMesh.position.z = afterburnerZ;
    group.add(this.afterburnerMesh);

    group.castShadow = true;
    return group;
  }

  createProceduralMesh(group) {
    const bodyMat = new THREE.MeshPhongMaterial({
      color: 0x667788,
      specular: 0x333333,
      shininess: 40,
    });
    const darkMat = new THREE.MeshPhongMaterial({
      color: 0x445566,
      specular: 0x222222,
      shininess: 30,
    });
    const intakeMat = new THREE.MeshPhongMaterial({
      color: 0x222222,
      specular: 0x111111,
      shininess: 10,
    });

    // Fuselage
    const fuselagePoints = [
      new THREE.Vector2(0.0,  -8.0),
      new THREE.Vector2(0.3,  -7.0),
      new THREE.Vector2(0.6,  -6.0),
      new THREE.Vector2(0.85, -4.5),
      new THREE.Vector2(1.0,  -3.0),
      new THREE.Vector2(1.1,  -1.5),
      new THREE.Vector2(1.15, 0.0),
      new THREE.Vector2(1.1,  1.5),
      new THREE.Vector2(1.05, 3.0),
      new THREE.Vector2(0.95, 4.5),
      new THREE.Vector2(0.75, 5.5),
      new THREE.Vector2(0.55, 6.5),
      new THREE.Vector2(0.35, 7.0),
      new THREE.Vector2(0.15, 7.3),
    ];
    const fuselageGeom = new THREE.LatheGeometry(fuselagePoints, 12);
    fuselageGeom.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(fuselageGeom, bodyMat));

    // Wings
    for (const side of [1, -1]) {
      const wShape = new THREE.Shape();
      wShape.moveTo(side * 0.8, 0);
      wShape.lineTo(side * 5.8, 1.5);
      wShape.lineTo(side * 5.5, 2.8);
      wShape.lineTo(side * 0.9, 2.0);
      wShape.lineTo(side * 0.8, 0);
      const wGeom = new THREE.ExtrudeGeometry(wShape, { depth: 0.12, bevelEnabled: false });
      const wing = new THREE.Mesh(wGeom, bodyMat);
      wing.rotation.x = -Math.PI / 2;
      wing.position.set(0, -0.1, -0.5);
      group.add(wing);
    }

    // Vertical fin
    const vFinShape = new THREE.Shape();
    vFinShape.moveTo(0, 0);
    vFinShape.lineTo(-0.8, 3.2);
    vFinShape.lineTo(0.3, 3.5);
    vFinShape.lineTo(1.5, 0);
    vFinShape.lineTo(0, 0);
    const vFinGeom = new THREE.ExtrudeGeometry(vFinShape, { depth: 0.08, bevelEnabled: false });
    const vFin = new THREE.Mesh(vFinGeom, bodyMat);
    vFin.position.set(-0.04, 0.45, 4.5);
    group.add(vFin);

    // Nozzle
    const nozzleGeom = new THREE.CylinderGeometry(0.55, 0.4, 1.2, 12, 1, true);
    nozzleGeom.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(nozzleGeom, intakeMat));

    return null;
  }

  getForwardDirection() {
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.quaternion);
    return forward;
  }

  getUpDirection() {
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(this.quaternion);
    return up;
  }

  getRightDirection() {
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(this.quaternion);
    return right;
  }

  applyDamage(amount, source) {
    this.health -= amount;
    if (source) this.lastDamageSource = source;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  updateMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    // Exhaust glow based on throttle
    if (this.exhaustMesh) {
      this.exhaustMesh.material.opacity = 0.2 + this.throttle * 0.6;
      const scale = 0.5 + this.throttle * 0.5;
      this.exhaustMesh.scale.set(scale, scale, 1);
    }

    // Afterburner at high throttle
    if (this.afterburnerMesh) {
      if (this.throttle > 0.85) {
        const abIntensity = (this.throttle - 0.85) / 0.15;
        this.afterburnerMesh.material.opacity = abIntensity * 0.6;
        const abScale = 0.5 + abIntensity * 0.5;
        this.afterburnerMesh.scale.set(abScale, abScale, 0.5 + abIntensity * 0.5);
      } else {
        this.afterburnerMesh.material.opacity = 0;
      }
    }
  }

  updateCamera(camera, dt, zoomActive) {
    // Smooth FOV zoom
    const targetFov = zoomActive ? this.zoomFov : CAMERA.FOV;
    const zoomSpeed = 8; // Higher = faster transition
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, zoomSpeed * dt);
    camera.fov = this.currentFov;
    camera.updateProjectionMatrix();

    if (this.cameraMode === 0) {
      // Ace Combat-style chase camera: close behind, slightly above
      const idealOffset = new THREE.Vector3(0, CAMERA.CHASE_HEIGHT, CAMERA.CHASE_DISTANCE);
      idealOffset.applyQuaternion(this.quaternion);
      idealOffset.add(this.position);

      // Look ahead - close so the plane stays centered and prominent
      const lookTarget = this.position.clone().add(
        this.getForwardDirection().multiplyScalar(30)
      );

      const lerpFactor = 1 - Math.exp(-CAMERA.CHASE_LERP * dt);
      camera.position.lerp(idealOffset, lerpFactor);
      camera.lookAt(lookTarget);
    } else {
      // Cockpit camera
      const cockpitPos = new THREE.Vector3(0, CAMERA.COCKPIT_OFFSET_Y, -CAMERA.COCKPIT_OFFSET_Z);
      cockpitPos.applyQuaternion(this.quaternion);
      cockpitPos.add(this.position);

      camera.position.copy(cockpitPos);
      camera.quaternion.copy(this.quaternion);
      const lookOffset = this.getForwardDirection().multiplyScalar(100);
      camera.lookAt(this.position.clone().add(lookOffset));
    }
  }

  reset() {
    this.position.set(0, AIRCRAFT.INITIAL_ALTITUDE, 0);
    this.velocity.set(0, 0, -AIRCRAFT.INITIAL_SPEED);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);
    this.throttle = 0.5;
    this.speed = AIRCRAFT.INITIAL_SPEED;
    this.health = AIRCRAFT.HEALTH;
    this.alive = true;
    this.gForce = 1;
    this.cameraMode = 0;
  }
}
