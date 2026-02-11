import * as THREE from 'three';
import { AIRCRAFT, PHYSICS, CAMERA } from '../config.js';

const TARGET_LENGTH = 20; // all models normalized to this length

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

    // Thrusters
    this.thrusters = [];

    // Build mesh
    this.mesh = this.createMesh(modelTemplate);
    this.scene.add(this.mesh);
  }

  createMesh(modelTemplate) {
    const group = new THREE.Group();

    if (modelTemplate) {
      const model = modelTemplate.clone();
      const cfg = modelTemplate._planeConfig;

      // Inner rotation group to fix model orientation (pure rotation, no scale flips)
      const innerGroup = new THREE.Group();
      if (cfg && cfg.rotation) {
        innerGroup.rotation.set(cfg.rotation[0], cfg.rotation[1], cfg.rotation[2]);
      }
      innerGroup.add(model);

      // Wrapper for uniform scaling
      const wrapper = new THREE.Group();
      wrapper.add(innerGroup);

      // Auto-normalize: compute bounding box at unit scale, then scale to TARGET_LENGTH
      const box = new THREE.Box3().setFromObject(wrapper);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const autoScale = maxDim > 0 ? TARGET_LENGTH / maxDim : 8;
      wrapper.scale.set(autoScale, autoScale, autoScale);

      // Fix face winding (DoubleSide for safety with any model)
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => { m.side = THREE.DoubleSide; });
        }
      });

      group.add(wrapper);
      this.modelInner = wrapper;

      // Compute final bounding box for thruster positioning
      const finalBox = new THREE.Box3().setFromObject(wrapper);
      const tailZ = finalBox.max.z;

      // Create thrusters at engine positions
      const engines = (cfg && cfg.engines) || [{x: 0, y: 0}];
      for (const engine of engines) {
        const thruster = this.createThruster();
        thruster.position.set(engine.x, engine.y, tailZ + 0.3);
        group.add(thruster);
        this.thrusters.push(thruster);
      }
    } else {
      // Fallback procedural mesh
      this.modelInner = this.createProceduralMesh(group);
      const thruster = this.createThruster();
      thruster.position.set(0, 0, 8);
      group.add(thruster);
      this.thrusters.push(thruster);
    }

    group.castShadow = true;
    return group;
  }

  createThruster() {
    const thrusterGroup = new THREE.Group();

    // Core glow (hot white-cyan center at nozzle)
    const coreGeom = new THREE.SphereGeometry(0.45, 10, 10);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xeeffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    thrusterGroup.userData.core = new THREE.Mesh(coreGeom, coreMat);
    thrusterGroup.add(thrusterGroup.userData.core);

    // Inner flame cone (bright cyan, extends backward)
    const innerGeom = new THREE.ConeGeometry(0.4, 4, 10);
    innerGeom.rotateX(-Math.PI / 2);
    innerGeom.translate(0, 0, 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x44ccff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    thrusterGroup.userData.innerFlame = new THREE.Mesh(innerGeom, innerMat);
    thrusterGroup.add(thrusterGroup.userData.innerFlame);

    // Outer flame cone (wider blue glow)
    const outerGeom = new THREE.ConeGeometry(0.7, 6, 10);
    outerGeom.rotateX(-Math.PI / 2);
    outerGeom.translate(0, 0, 3);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x2266dd,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    thrusterGroup.userData.outerFlame = new THREE.Mesh(outerGeom, outerMat);
    thrusterGroup.add(thrusterGroup.userData.outerFlame);

    // Point light for dynamic glow on fuselage
    thrusterGroup.userData.light = new THREE.PointLight(0x4488ff, 0, 15);
    thrusterGroup.add(thrusterGroup.userData.light);

    return thrusterGroup;
  }

  createProceduralMesh(group) {
    const bodyMat = new THREE.MeshPhongMaterial({
      color: 0x667788,
      specular: 0x333333,
      shininess: 40,
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

  updateMesh(input = null) {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
    this.mesh.updateMatrixWorld();

    // Animate thrusters
    const t = this.throttle;
    const flicker = 0.92 + Math.random() * 0.16;

    for (const thruster of this.thrusters) {
      const { core, innerFlame, outerFlame, light } = thruster.userData;

      // Core glow: always visible, pulses with throttle
      const coreScale = (0.3 + t * 0.7) * flicker;
      core.scale.set(coreScale, coreScale, coreScale);
      core.material.opacity = 0.3 + t * 0.6;

      // Inner flame: visible above idle throttle
      const innerIntensity = Math.max(0, (t - 0.15) / 0.85) * flicker;
      innerFlame.visible = innerIntensity > 0.01;
      if (innerFlame.visible) {
        const isx = innerIntensity * 0.6 + 0.4;
        innerFlame.scale.set(isx, isx, innerIntensity * 0.7 + 0.3);
        innerFlame.material.opacity = innerIntensity * 0.7;
      }

      // Outer flame: afterburner zone above 50% throttle
      if (t > 0.5) {
        const outerIntensity = ((t - 0.5) / 0.5) * flicker;
        outerFlame.visible = true;
        const osx = outerIntensity * 0.6 + 0.4;
        outerFlame.scale.set(osx, osx, outerIntensity * 0.8 + 0.2);
        outerFlame.material.opacity = outerIntensity * 0.3;
      } else {
        outerFlame.visible = false;
      }

      // Point light: illuminates fuselage rear
      light.intensity = t * 3 * flicker;
      light.distance = 8 + t * 12;
    }
  }

  updateCamera(camera, dt, zoomActive) {
    // Smooth FOV zoom
    const targetFov = zoomActive ? this.zoomFov : CAMERA.FOV;
    const zoomSpeed = 8;
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, zoomSpeed * dt);
    camera.fov = this.currentFov;
    camera.updateProjectionMatrix();

    if (this.cameraMode === 0) {
      // Chase camera
      if (this.mesh) this.mesh.visible = true;

      const lerpFactor = 1 - Math.exp(-CAMERA.CHASE_LERP * dt);

      const idealOffset = new THREE.Vector3(0, CAMERA.CHASE_HEIGHT, CAMERA.CHASE_DISTANCE);
      idealOffset.applyQuaternion(this.quaternion);
      idealOffset.add(this.position);

      const lookTarget = this.position.clone().add(
        this.getForwardDirection().multiplyScalar(30)
      );

      camera.position.lerp(idealOffset, lerpFactor);
      camera.up.set(0, 1, 0);
      camera.lookAt(lookTarget);
    } else {
      // Cockpit view (FPV) - first person from pilot's eye position
      if (this.mesh) this.mesh.visible = false;

      // Calculate pilot eye position based on model rotation
      const cfg = this.modelTemplate?._planeConfig;
      const innerRot = new THREE.Euler(
        cfg?.rotation?.[0] || 0,
        cfg?.rotation?.[1] || 0,
        cfg?.rotation?.[2] || 0
      );
      const innerQuat = new THREE.Quaternion().setFromEuler(innerRot);

      // Eye position offset (slightly forward and up)
      const eyeOffset = new THREE.Vector3(0, 1.2, 2.0);
      eyeOffset.applyQuaternion(innerQuat);
      eyeOffset.applyQuaternion(this.quaternion);
      eyeOffset.add(this.position);
      camera.position.copy(eyeOffset);

      // Look forward from aircraft orientation
      const forward = this.getForwardDirection();
      camera.up.set(0, 1, 0);
      camera.lookAt(this.position.clone().add(forward.multiplyScalar(100)));
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
    if (this.mesh) this.mesh.visible = true;
  }
}
