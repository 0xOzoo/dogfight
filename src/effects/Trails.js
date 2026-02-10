import * as THREE from 'three';

export class TrailSystem {
  constructor(scene) {
    this.scene = scene;
    this.trails = [];
  }

  createTrail(aircraft, offsetLeft, offsetRight) {
    const trail = new Trail(this.scene, aircraft, offsetLeft, offsetRight);
    this.trails.push(trail);
    return trail;
  }

  update(dt) {
    for (const trail of this.trails) {
      trail.update(dt);
    }
  }

  removeTrail(trail) {
    const idx = this.trails.indexOf(trail);
    if (idx >= 0) {
      trail.dispose();
      this.trails.splice(idx, 1);
    }
  }

  clear() {
    for (const trail of this.trails) {
      trail.dispose();
    }
    this.trails.length = 0;
  }
}

class Trail {
  constructor(scene, aircraft, offsetLeft, offsetRight) {
    this.scene = scene;
    this.aircraft = aircraft;
    this.maxPoints = 80;

    // Two wing tip trails
    this.offsetLeft = offsetLeft || new THREE.Vector3(-5, 0, 2);
    this.offsetRight = offsetRight || new THREE.Vector3(5, 0, 2);

    this.leftPoints = [];
    this.rightPoints = [];

    // Create line geometries for thin smoke trails
    this.leftGeometry = new THREE.BufferGeometry();
    this.rightGeometry = new THREE.BufferGeometry();

    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
    });

    this.leftLine = new THREE.Line(this.leftGeometry, material);
    this.rightLine = new THREE.Line(this.rightGeometry, material.clone());

    this.leftLine.frustumCulled = false;
    this.rightLine.frustumCulled = false;
    this.leftLine.userData.excludeAO = true;
    this.rightLine.userData.excludeAO = true;

    this.scene.add(this.leftLine);
    this.scene.add(this.rightLine);

    this.spawnTimer = 0;
    this.spawnInterval = 0.02; // seconds between trail points

    // === Vortex contrails (ribbon meshes for hard turns) ===
    this.vortexMaxPoints = 60;
    this.vortexLeftPoints = [];   // each: { pos, age, width }
    this.vortexRightPoints = [];

    // Left vortex ribbon
    this.vortexLeftGeom = new THREE.BufferGeometry();
    this.vortexLeftMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.vortexLeftMesh = new THREE.Mesh(this.vortexLeftGeom, this.vortexLeftMat);
    this.vortexLeftMesh.frustumCulled = false;
    this.vortexLeftMesh.userData.excludeAO = true;
    this.scene.add(this.vortexLeftMesh);

    // Right vortex ribbon
    this.vortexRightGeom = new THREE.BufferGeometry();
    this.vortexRightMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.vortexRightMesh = new THREE.Mesh(this.vortexRightGeom, this.vortexRightMat);
    this.vortexRightMesh.frustumCulled = false;
    this.vortexRightMesh.userData.excludeAO = true;
    this.scene.add(this.vortexRightMesh);

    this.vortexSpawnTimer = 0;
    this.vortexSpawnInterval = 0.016;
  }

  update(dt) {
    this.spawnTimer += dt;

    // Only spawn trail at high speed or high G
    const shouldTrail = this.aircraft.speed > 150 ||
      Math.abs(this.aircraft.gForce) > 3;

    if (this.spawnTimer >= this.spawnInterval && shouldTrail) {
      this.spawnTimer = 0;

      // Get world positions of wing tips
      const leftWorld = this.offsetLeft.clone().applyQuaternion(this.aircraft.quaternion)
        .add(this.aircraft.position);
      const rightWorld = this.offsetRight.clone().applyQuaternion(this.aircraft.quaternion)
        .add(this.aircraft.position);

      this.leftPoints.push(leftWorld);
      this.rightPoints.push(rightWorld);

      if (this.leftPoints.length > this.maxPoints) {
        this.leftPoints.shift();
        this.rightPoints.shift();
      }
    }

    // Fade oldest points by removing them gradually
    if (!shouldTrail && this.leftPoints.length > 0) {
      if (this.spawnTimer > 0.05) {
        this.leftPoints.shift();
        this.rightPoints.shift();
        this.spawnTimer = 0;
      }
    }

    // Update geometries
    if (this.leftPoints.length >= 2) {
      this.leftGeometry.setFromPoints(this.leftPoints);
      this.rightGeometry.setFromPoints(this.rightPoints);
    }

    // Opacity based on conditions
    const intensity = shouldTrail ? 0.3 : 0.1;
    this.leftLine.material.opacity = intensity;
    this.rightLine.material.opacity = intensity;

    // === Update vortex contrails ===
    this._updateVortexContrails(dt);
  }

  _updateVortexContrails(dt) {
    const gForce = Math.abs(this.aircraft.gForce);
    const speed = this.aircraft.speed;

    // Vortex contrails appear during hard turns (high G) at sufficient speed
    // G threshold: start appearing at 25G, full intensity at 40G+
    // Speed threshold: need at least 120 m/s
    const gIntensity = THREE.MathUtils.clamp((gForce - 25) / 15, 0, 1);
    const speedIntensity = THREE.MathUtils.clamp((speed - 120) / 80, 0, 1);
    const vortexActive = gIntensity * speedIntensity;

    this.vortexSpawnTimer += dt;

    // Age and remove old vortex points
    for (let i = this.vortexLeftPoints.length - 1; i >= 0; i--) {
      this.vortexLeftPoints[i].age += dt;
      this.vortexRightPoints[i].age += dt;
      if (this.vortexLeftPoints[i].age > 1.2) {
        this.vortexLeftPoints.splice(i, 1);
        this.vortexRightPoints.splice(i, 1);
      }
    }

    // Spawn new vortex points when conditions are met
    if (vortexActive > 0.05 && this.vortexSpawnTimer >= this.vortexSpawnInterval) {
      this.vortexSpawnTimer = 0;

      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.aircraft.quaternion);
      const ribbonWidth = 1.5 + vortexActive * 2.5; // Width based on G-force

      const leftWorld = this.offsetLeft.clone().applyQuaternion(this.aircraft.quaternion)
        .add(this.aircraft.position);
      const rightWorld = this.offsetRight.clone().applyQuaternion(this.aircraft.quaternion)
        .add(this.aircraft.position);

      this.vortexLeftPoints.push({
        pos: leftWorld,
        up: up.clone(),
        age: 0,
        width: ribbonWidth,
        intensity: vortexActive,
      });
      this.vortexRightPoints.push({
        pos: rightWorld,
        up: up.clone(),
        age: 0,
        width: ribbonWidth,
        intensity: vortexActive,
      });

      if (this.vortexLeftPoints.length > this.vortexMaxPoints) {
        this.vortexLeftPoints.shift();
        this.vortexRightPoints.shift();
      }
    }

    // Build ribbon meshes from vortex points
    this._buildRibbon(this.vortexLeftPoints, this.vortexLeftGeom, this.vortexLeftMat);
    this._buildRibbon(this.vortexRightPoints, this.vortexRightGeom, this.vortexRightMat);
  }

  _buildRibbon(points, geometry, material) {
    if (points.length < 2) {
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      geometry.setIndex(null);
      return;
    }

    const count = points.length;
    const vertices = new Float32Array(count * 2 * 3); // 2 verts per point (top/bottom of ribbon)
    const indices = [];
    let maxOpacity = 0;

    for (let i = 0; i < count; i++) {
      const p = points[i];
      const lifeRatio = p.age / 1.2; // 0 = new, 1 = expired
      const fadeOut = 1 - lifeRatio;
      const width = p.width * fadeOut * 0.5; // ribbon half-width, narrows as it fades

      maxOpacity = Math.max(maxOpacity, fadeOut * p.intensity);

      // Ribbon expands perpendicular to the trail using the stored up direction
      const offset = p.up.clone().multiplyScalar(width);

      // Top vertex
      vertices[i * 6]     = p.pos.x + offset.x;
      vertices[i * 6 + 1] = p.pos.y + offset.y;
      vertices[i * 6 + 2] = p.pos.z + offset.z;

      // Bottom vertex
      vertices[i * 6 + 3] = p.pos.x - offset.x;
      vertices[i * 6 + 4] = p.pos.y - offset.y;
      vertices[i * 6 + 5] = p.pos.z - offset.z;

      // Triangle indices for ribbon quad
      if (i < count - 1) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    material.opacity = Math.min(0.55, maxOpacity * 0.55);
  }

  dispose() {
    this.scene.remove(this.leftLine);
    this.scene.remove(this.rightLine);
    this.leftGeometry.dispose();
    this.rightGeometry.dispose();
    this.leftLine.material.dispose();
    this.rightLine.material.dispose();

    this.scene.remove(this.vortexLeftMesh);
    this.scene.remove(this.vortexRightMesh);
    this.vortexLeftGeom.dispose();
    this.vortexRightGeom.dispose();
    this.vortexLeftMat.dispose();
    this.vortexRightMat.dispose();
  }
}
