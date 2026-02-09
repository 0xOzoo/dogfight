import * as THREE from 'three';
import { TERRAIN } from '../config.js';

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.heightData = null;
    this.mesh = null;

    this.generate();
    this.addTrees();
    this.addBuildings();
    this.addBridges();
  }

  noise2D(x, y) {
    const dot = x * 12.9898 + y * 78.233;
    const s = Math.sin(dot) * 43758.5453;
    return s - Math.floor(s);
  }

  smoothNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = this.noise2D(ix, iy);
    const n10 = this.noise2D(ix + 1, iy);
    const n01 = this.noise2D(ix, iy + 1);
    const n11 = this.noise2D(ix + 1, iy + 1);
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  }

  fbmNoise(x, y, octaves = 6) {
    let value = 0, amplitude = 0.5, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.smoothNoise(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return value / maxValue;
  }

  seededRandom(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  generate() {
    const { SIZE, SEGMENTS, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;

    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array;
    this.heightData = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1));
    const colors = new Float32Array(vertices.length);

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const z = vertices[i + 2];

      const nx = x / SIZE * 8;
      const nz = z / SIZE * 8;

      // Base terrain with multiple octaves
      let height = this.fbmNoise(nx + 5.3, nz + 7.1, 6);

      // Sharp ridges for canyon walls
      const ridge = 1 - Math.abs(this.fbmNoise(nx * 0.7 + 13.7, nz * 0.7 + 9.2, 4) * 2 - 1);
      height = height * 0.4 + ridge * ridge * 0.6;

      // === CANYON SYSTEMS ===
      // Three distinct canyon systems with different orientations
      // Canyon 1: NW-SE diagonal
      const canyon1Noise = this.fbmNoise(nx * 0.25 + 3.1, nz * 0.25 + 1.7, 3);
      const canyon1 = 1 - Math.pow(Math.abs(canyon1Noise - 0.5) * 3.5, 0.5);

      // Canyon 2: Roughly N-S with winding
      const canyon2Noise = this.fbmNoise(nx * 0.35 + 8.2, nz * 0.15 + 5.9, 3);
      const canyon2 = 1 - Math.pow(Math.abs(canyon2Noise - 0.5) * 3.5, 0.5);

      // Canyon 3: E-W canyon cutting through the middle
      const canyon3Noise = this.fbmNoise(nx * 0.15 + 15.3, nz * 0.3 + 12.1, 3);
      const canyon3 = 1 - Math.pow(Math.abs(canyon3Noise - 0.5) * 3.5, 0.5);

      // Combine canyons - deeper and wider cuts
      const canyonCarve = Math.max(0, Math.max(canyon1, canyon2, canyon3) - 0.2) * 0.7;
      height = Math.max(0.02, height - canyonCarve);

      // Mountain peaks in certain areas
      const peakNoise = this.fbmNoise(nx * 0.5 + 20.1, nz * 0.5 + 15.3, 3);
      if (peakNoise > 0.55) {
        height += (peakNoise - 0.55) * 2.5;
      }

      // Secondary peaks for more dramatic terrain
      const peakNoise2 = this.fbmNoise(nx * 0.4 + 30.7, nz * 0.4 + 25.1, 3);
      if (peakNoise2 > 0.6) {
        height += (peakNoise2 - 0.6) * 1.8;
      }

      // Distance from center: island shape
      const dist = Math.sqrt(x * x + z * z) / (SIZE * 0.45);
      const islandShape = Math.max(0, 1 - dist * dist);
      height *= islandShape;

      // Flatten some low areas for villages/airstrip
      const flatNoise = this.fbmNoise(nx * 0.2 + 30, nz * 0.2 + 30, 2);
      if (flatNoise > 0.55 && height < 0.3) {
        height = height * 0.3 + 0.05;
      }

      // Flatten a larger area for the main city
      const cityDist = Math.sqrt((x - 500) * (x - 500) + (z + 500) * (z + 500));
      if (cityDist < 800) {
        const cityFlatten = Math.max(0, 1 - cityDist / 800);
        height = height * (1 - cityFlatten * 0.7) + 0.04 * cityFlatten;
      }

      height *= MAX_HEIGHT;
      vertices[i + 1] = height;

      const vertexIndex = i / 3;
      this.heightData[vertexIndex] = height;

      // Color by altitude
      const normalizedHeight = height / MAX_HEIGHT;
      let r, g, b;

      if (height < WATER_LEVEL) {
        r = 0.08; g = 0.25; b = 0.55;
      } else if (normalizedHeight < 0.04) {
        // Sandy beach
        r = 0.65; g = 0.6; b = 0.4;
      } else if (normalizedHeight < 0.12) {
        // Lush lowland grass
        r = 0.3; g = 0.55; b = 0.15;
      } else if (normalizedHeight < 0.25) {
        // Darker green forest
        r = 0.15; g = 0.4; b = 0.1;
      } else if (normalizedHeight < 0.4) {
        // Mixed forest/rock
        r = 0.2; g = 0.3; b = 0.12;
      } else if (normalizedHeight < 0.6) {
        // Grey rock
        r = 0.42; g = 0.4; b = 0.38;
      } else if (normalizedHeight < 0.8) {
        // Dark rock/alpine
        r = 0.35; g = 0.32; b = 0.3;
      } else {
        // Snow caps
        r = 0.88; g = 0.88; b = 0.92;
      }

      const variation = (this.seededRandom(i) - 0.5) * 0.04;
      colors[i] = r + variation;
      colors[i + 1] = g + variation;
      colors[i + 2] = b + variation;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    // Animated water with wave vertex shader
    const waterSegs = 128;
    const waterGeometry = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, waterSegs, waterSegs);
    waterGeometry.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(0x0a3a6a) },
        uColor2: { value: new THREE.Color(0x2a7aaa) },
        uFogColor: { value: this.scene.fog ? this.scene.fog.color : new THREE.Color(0x8899bb) },
        uFogDensity: { value: this.scene.fog ? this.scene.fog.density : 0.00008 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWaveHeight;
        varying float vFogDepth;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Multiple wave layers for natural ocean look
          float wave1 = sin(pos.x * 0.02 + uTime * 0.8) * cos(pos.z * 0.015 + uTime * 0.6) * 3.0;
          float wave2 = sin(pos.x * 0.05 + uTime * 1.2) * cos(pos.z * 0.04 - uTime * 0.9) * 1.5;
          float wave3 = sin(pos.x * 0.1 + pos.z * 0.08 + uTime * 2.0) * 0.5;
          pos.y += wave1 + wave2 + wave3;

          vWaveHeight = (wave1 + wave2 + wave3) / 5.0; // normalized -1 to 1
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          vFogDepth = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uTime;
        varying vec2 vUv;
        varying float vWaveHeight;
        varying float vFogDepth;

        void main() {
          // Mix deep/shallow color based on wave height
          float t = vWaveHeight * 0.5 + 0.5;
          vec3 color = mix(uColor1, uColor2, t);

          // Foam/whitecaps on wave crests
          float foam = smoothstep(0.35, 0.5, vWaveHeight);
          color = mix(color, vec3(0.7, 0.8, 0.9), foam * 0.4);

          // Specular-like shimmer
          float shimmer = pow(max(0.0, vWaveHeight), 4.0) * 0.3;
          color += vec3(shimmer);

          // Fog
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(color, 0.85);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.water = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.water.position.y = WATER_LEVEL;
    this.scene.add(this.water);
  }

  update(dt) {
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value += dt;
    }
  }

  addTrees() {
    const { SIZE, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;
    const maxTrees = 8000;

    // Pine (mountain)
    const pineGeom = new THREE.ConeGeometry(1, 1, 6);
    const pineMat = new THREE.MeshLambertMaterial({ color: 0x1a5c1a });
    const pineInstance = new THREE.InstancedMesh(pineGeom, pineMat, maxTrees);

    // Deciduous (lowland)
    const decidGeom = new THREE.IcosahedronGeometry(1, 1);
    const decidMat = new THREE.MeshLambertMaterial({ color: 0x2d8a2d });
    const decidInstance = new THREE.InstancedMesh(decidGeom, decidMat, maxTrees);

    // Trunks
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.25, 1, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
    const trunkInstance = new THREE.InstancedMesh(trunkGeom, trunkMat, maxTrees * 2);

    pineInstance.castShadow = true;
    decidInstance.castShadow = true;

    const dummy = new THREE.Object3D();
    let pineIdx = 0, decidIdx = 0, trunkIdx = 0;

    for (let i = 0; i < maxTrees * 4 && (pineIdx < maxTrees || decidIdx < maxTrees); i++) {
      const seed = i * 17.31;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.88;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.88;
      const height = this.getHeightAt(x, z);
      const normalizedH = height / MAX_HEIGHT;

      if (height < WATER_LEVEL + 4 || normalizedH > 0.5 || normalizedH < 0.03) continue;

      // Denser forests in certain noise bands - more generous threshold
      const forestDensity = this.fbmNoise(x / SIZE * 15, z / SIZE * 15, 2);
      if (forestDensity < 0.25) continue;

      // Skip if in city area
      const cityDist = Math.sqrt((x - 500) * (x - 500) + (z + 500) * (z + 500));
      if (cityDist < 600) continue;

      // Bigger trees: 12-30m crowns
      const treeScale = 12 + this.seededRandom(seed + 3) * 18;
      const trunkH = treeScale * 0.7;
      const rotation = this.seededRandom(seed + 4) * Math.PI * 2;

      // Trunk
      if (trunkIdx < maxTrees * 2) {
        dummy.position.set(x, height + trunkH / 2, z);
        dummy.scale.set(treeScale * 0.25, trunkH, treeScale * 0.25);
        dummy.rotation.set(0, rotation, 0);
        dummy.updateMatrix();
        trunkInstance.setMatrixAt(trunkIdx++, dummy.matrix);
      }

      if (normalizedH > 0.25) {
        if (pineIdx < maxTrees) {
          dummy.position.set(x, height + trunkH + treeScale * 0.4, z);
          dummy.scale.set(treeScale, treeScale * 1.2, treeScale);
          dummy.rotation.set(0, rotation, 0);
          dummy.updateMatrix();
          pineInstance.setMatrixAt(pineIdx++, dummy.matrix);
        }
      } else {
        if (decidIdx < maxTrees) {
          dummy.position.set(x, height + trunkH + treeScale * 0.3, z);
          const sx = treeScale * (0.8 + this.seededRandom(seed + 6) * 0.4);
          const sy = treeScale * (0.7 + this.seededRandom(seed + 7) * 0.6);
          const sz = treeScale * (0.8 + this.seededRandom(seed + 8) * 0.4);
          dummy.scale.set(sx, sy, sz);
          dummy.rotation.set(0, rotation, 0);
          dummy.updateMatrix();
          decidInstance.setMatrixAt(decidIdx++, dummy.matrix);
        }
      }
    }

    pineInstance.count = pineIdx;
    decidInstance.count = decidIdx;
    trunkInstance.count = trunkIdx;
    pineInstance.instanceMatrix.needsUpdate = true;
    decidInstance.instanceMatrix.needsUpdate = true;
    trunkInstance.instanceMatrix.needsUpdate = true;

    this.scene.add(pineInstance);
    this.scene.add(decidInstance);
    this.scene.add(trunkInstance);
  }

  addBuildings() {
    const { SIZE, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;
    const maxBuildings = 1500;

    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd4c4a8 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x6699bb });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x777777 });

    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const roofGeom = new THREE.ConeGeometry(0.85, 0.6, 4);
    roofGeom.rotateY(Math.PI / 4);

    const wallInstance = new THREE.InstancedMesh(boxGeom, wallMat, maxBuildings);
    const roofInstance = new THREE.InstancedMesh(roofGeom, roofMat, maxBuildings);
    // City buildings (concrete/glass)
    const cityWallInstance = new THREE.InstancedMesh(boxGeom, concreteMat, 200);
    const cityGlassInstance = new THREE.InstancedMesh(boxGeom, glassMat, 200);
    // Industrial
    const industrialInstance = new THREE.InstancedMesh(boxGeom, metalMat, 200);

    wallInstance.castShadow = true;
    cityWallInstance.castShadow = true;
    cityGlassInstance.castShadow = true;
    industrialInstance.castShadow = true;

    // Generate village centers on flat lowland
    const villages = [];
    for (let v = 0; v < 35; v++) {
      const seed = v * 347.13 + 42.7;
      const vx = (this.seededRandom(seed) - 0.5) * SIZE * 0.65;
      const vz = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.65;
      const vh = this.getHeightAt(vx, vz);
      const normalizedH = vh / MAX_HEIGHT;

      if (vh > WATER_LEVEL + 5 && normalizedH < 0.2 && normalizedH > 0.02) {
        villages.push({
          x: vx, z: vz,
          radius: 200 + this.seededRandom(seed + 2) * 400,
          density: 25 + Math.floor(this.seededRandom(seed + 3) * 55),
        });
      }
    }

    const dummy = new THREE.Object3D();
    let bIdx = 0;

    // Main town near center
    villages.unshift({
      x: 500, z: -500,
      radius: 500,
      density: 80,
    });

    for (const village of villages) {
      for (let b = 0; b < village.density && bIdx < maxBuildings; b++) {
        const seed = bIdx * 73.91 + village.x;
        const angle = this.seededRandom(seed) * Math.PI * 2;
        const dist = this.seededRandom(seed + 1) * village.radius;

        const bx = village.x + Math.cos(angle) * dist;
        const bz = village.z + Math.sin(angle) * dist;
        const bh = this.getHeightAt(bx, bz);

        if (bh < WATER_LEVEL + 2) continue;

        const distRatio = dist / village.radius;
        const baseSize = village.radius > 400 ? 15 : 8;

        const width = baseSize + this.seededRandom(seed + 2) * baseSize * (1 - distRatio * 0.5);
        const height = baseSize * 0.8 + this.seededRandom(seed + 3) * baseSize * 1.5 * (1 - distRatio * 0.7);
        const depth = baseSize + this.seededRandom(seed + 4) * baseSize * (1 - distRatio * 0.5);
        const rotation = this.seededRandom(seed + 5) * Math.PI * 2;

        // Wall
        dummy.position.set(bx, bh + height / 2, bz);
        dummy.scale.set(width, height, depth);
        dummy.rotation.set(0, rotation, 0);
        dummy.updateMatrix();
        wallInstance.setMatrixAt(bIdx, dummy.matrix);

        // Roof
        dummy.position.set(bx, bh + height + 0.25 * Math.max(width, depth), bz);
        dummy.scale.set(width * 0.9, Math.max(width, depth) * 0.45, depth * 0.9);
        dummy.updateMatrix();
        roofInstance.setMatrixAt(bIdx, dummy.matrix);

        bIdx++;
      }
    }

    // Scattered farmhouses
    for (let i = 0; i < 400 && bIdx < maxBuildings; i++) {
      const seed = (i + 5000) * 41.17;
      const bx = (this.seededRandom(seed) - 0.5) * SIZE * 0.75;
      const bz = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.75;
      const bh = this.getHeightAt(bx, bz);
      const normalizedH = bh / MAX_HEIGHT;

      if (bh < WATER_LEVEL + 3 || normalizedH > 0.25) continue;
      if (this.seededRandom(seed + 2) > 0.3) continue;

      const width = 8 + this.seededRandom(seed + 3) * 14;
      const height = 6 + this.seededRandom(seed + 4) * 10;
      const depth = 8 + this.seededRandom(seed + 5) * 14;
      const rotation = this.seededRandom(seed + 6) * Math.PI;

      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, rotation, 0);
      dummy.updateMatrix();
      wallInstance.setMatrixAt(bIdx, dummy.matrix);

      dummy.position.set(bx, bh + height + 0.25 * Math.max(width, depth), bz);
      dummy.scale.set(width * 0.9, Math.max(width, depth) * 0.45, depth * 0.9);
      dummy.updateMatrix();
      roofInstance.setMatrixAt(bIdx, dummy.matrix);

      bIdx++;
    }

    wallInstance.count = bIdx;
    roofInstance.count = bIdx;
    wallInstance.instanceMatrix.needsUpdate = true;
    roofInstance.instanceMatrix.needsUpdate = true;

    this.scene.add(wallInstance);
    this.scene.add(roofInstance);

    // === CITY DISTRICT - tall buildings, skyscrapers ===
    let cityIdx = 0;
    let glassIdx = 0;
    const cityCenter = { x: 500, z: -500 };

    for (let i = 0; i < 120 && cityIdx < 200; i++) {
      const seed = (i + 10000) * 53.17;
      const angle = this.seededRandom(seed) * Math.PI * 2;
      const dist = this.seededRandom(seed + 1) * 500;

      const bx = cityCenter.x + Math.cos(angle) * dist;
      const bz = cityCenter.z + Math.sin(angle) * dist;
      const bh = this.getHeightAt(bx, bz);

      if (bh < WATER_LEVEL + 2) continue;

      const distRatio = dist / 500;
      // Taller near center, shorter at edges
      const maxH = 80 * (1 - distRatio * 0.7);
      const width = 10 + this.seededRandom(seed + 2) * 15;
      const height = 20 + this.seededRandom(seed + 3) * maxH;
      const depth = 10 + this.seededRandom(seed + 4) * 15;
      const rotation = this.seededRandom(seed + 5) * Math.PI * 0.5; // Grid-aligned

      // Concrete base
      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, rotation, 0);
      dummy.updateMatrix();
      cityWallInstance.setMatrixAt(cityIdx++, dummy.matrix);

      // Glass windows (slightly smaller overlay)
      if (glassIdx < 200 && height > 30) {
        dummy.position.set(bx, bh + height / 2, bz);
        dummy.scale.set(width * 1.01, height * 0.95, depth * 1.01);
        dummy.updateMatrix();
        cityGlassInstance.setMatrixAt(glassIdx++, dummy.matrix);
      }
    }

    cityWallInstance.count = cityIdx;
    cityGlassInstance.count = glassIdx;
    cityWallInstance.instanceMatrix.needsUpdate = true;
    cityGlassInstance.instanceMatrix.needsUpdate = true;
    this.scene.add(cityWallInstance);
    this.scene.add(cityGlassInstance);

    // === INDUSTRIAL ZONES ===
    let indIdx = 0;
    const industrialZones = [
      { x: -2000, z: 1000 },
      { x: 3000, z: -1500 },
      { x: -1000, z: -3000 },
    ];

    for (const zone of industrialZones) {
      for (let i = 0; i < 30 && indIdx < 200; i++) {
        const seed = (indIdx + 20000) * 37.91;
        const bx = zone.x + (this.seededRandom(seed) - 0.5) * 600;
        const bz = zone.z + (this.seededRandom(seed + 1) - 0.5) * 600;
        const bh = this.getHeightAt(bx, bz);
        const normalizedH = bh / MAX_HEIGHT;

        if (bh < WATER_LEVEL + 3 || normalizedH > 0.2) continue;

        // Large, flat warehouses and hangars
        const width = 20 + this.seededRandom(seed + 2) * 30;
        const height = 8 + this.seededRandom(seed + 3) * 15;
        const depth = 20 + this.seededRandom(seed + 4) * 40;
        const rotation = this.seededRandom(seed + 5) * Math.PI;

        dummy.position.set(bx, bh + height / 2, bz);
        dummy.scale.set(width, height, depth);
        dummy.rotation.set(0, rotation, 0);
        dummy.updateMatrix();
        industrialInstance.setMatrixAt(indIdx++, dummy.matrix);
      }
    }

    industrialInstance.count = indIdx;
    industrialInstance.instanceMatrix.needsUpdate = true;
    this.scene.add(industrialInstance);
  }

  addBridges() {
    const { WATER_LEVEL } = TERRAIN;

    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x888888 });

    // More bridges - placed across canyon systems and valleys
    const bridgeSpots = [
      // Canyon crossings
      { x1: -2000, z1: -1000, x2: -1600, z2: -1000, height: 100, deckWidth: 40 },
      { x1: 1000, z1: 500, x2: 1500, z2: 500, height: 80, deckWidth: 35 },
      { x1: -500, z1: 2000, x2: 200, z2: 2000, height: 120, deckWidth: 40 },
      { x1: 3000, z1: -2000, x2: 3500, z2: -1700, height: 90, deckWidth: 35 },
      // Additional bridges
      { x1: -3500, z1: 500, x2: -3000, z2: 800, height: 110, deckWidth: 35 },
      { x1: 2000, z1: 2500, x2: 2500, z2: 2500, height: 70, deckWidth: 30 },
      // Large highway bridge near city
      { x1: 200, z1: -1200, x2: 800, z2: -1200, height: 60, deckWidth: 50 },
      // Massive canyon bridge - key flythrough spot
      { x1: -1500, z1: -3000, x2: -800, z2: -2800, height: 150, deckWidth: 45 },
    ];

    for (const spot of bridgeSpots) {
      const dx = spot.x2 - spot.x1;
      const dz = spot.z2 - spot.z1;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const midX = (spot.x1 + spot.x2) / 2;
      const midZ = (spot.z1 + spot.z2) / 2;

      const h1 = this.getHeightAt(spot.x1, spot.z1);
      const h2 = this.getHeightAt(spot.x2, spot.z2);
      const deckHeight = Math.max(h1, h2) + spot.height;
      const deckWidth = spot.deckWidth || 40;

      // Bridge deck
      const deckGeom = new THREE.BoxGeometry(deckWidth, 4, length + 30);
      const deck = new THREE.Mesh(deckGeom, bridgeMat);
      deck.position.set(midX, deckHeight, midZ);
      deck.rotation.y = angle;
      deck.castShadow = true;
      this.scene.add(deck);

      // Railings
      for (const side of [-deckWidth / 2, deckWidth / 2]) {
        const railGeom = new THREE.BoxGeometry(1.5, 6, length + 30);
        const rail = new THREE.Mesh(railGeom, bridgeMat);
        rail.position.set(
          midX + Math.cos(angle + Math.PI / 2) * side,
          deckHeight + 4,
          midZ + Math.sin(angle + Math.PI / 2) * side
        );
        rail.rotation.y = angle;
        this.scene.add(rail);
      }

      // Support pillars - thicker for wider bridges
      const pillarCount = Math.max(2, Math.floor(length / 70));
      for (let p = 0; p <= pillarCount; p++) {
        const t = p / pillarCount;
        const px = spot.x1 + dx * t;
        const pz = spot.z1 + dz * t;
        const groundH = this.getHeightAt(px, pz);
        const pillarH = deckHeight - groundH;

        if (pillarH < 5) continue;

        const pillarWidth = deckWidth * 0.2;
        const pillarGeom = new THREE.BoxGeometry(pillarWidth, pillarH, pillarWidth);
        const pillar = new THREE.Mesh(pillarGeom, pillarMat);
        pillar.position.set(px, groundH + pillarH / 2, pz);
        pillar.castShadow = true;
        this.scene.add(pillar);
      }

      // Cable/arch above deck (suspension bridge look)
      const cablePoints = [];
      const cableSegments = 20;
      for (let c = 0; c <= cableSegments; c++) {
        const t = c / cableSegments;
        const cx = spot.x1 + dx * t;
        const cz = spot.z1 + dz * t;
        const sag = -Math.sin(t * Math.PI) * 40;
        cablePoints.push(new THREE.Vector3(cx, deckHeight + 35 + sag, cz));
      }
      const cableGeom = new THREE.BufferGeometry().setFromPoints(cablePoints);
      const cable = new THREE.Line(cableGeom, cableMat);
      this.scene.add(cable);

      // Tower pylons at bridge ends - taller
      for (const end of [0, 1]) {
        const ex = end === 0 ? spot.x1 : spot.x2;
        const ez = end === 0 ? spot.z1 : spot.z2;
        const towerH = 65;

        const towerGeom = new THREE.BoxGeometry(6, towerH, 6);
        const tower = new THREE.Mesh(towerGeom, pillarMat);
        tower.position.set(ex, deckHeight + towerH / 2, ez);
        tower.castShadow = true;
        this.scene.add(tower);
      }
    }
  }

  getHeightAt(x, z) {
    const { SIZE, SEGMENTS } = TERRAIN;
    const halfSize = SIZE / 2;
    const gx = ((x + halfSize) / SIZE) * SEGMENTS;
    const gz = ((z + halfSize) / SIZE) * SEGMENTS;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);

    if (ix < 0 || ix >= SEGMENTS || iz < 0 || iz >= SEGMENTS) return 0;

    const fx = gx - ix;
    const fz = gz - iz;
    const stride = SEGMENTS + 1;
    const h00 = this.heightData[iz * stride + ix] || 0;
    const h10 = this.heightData[iz * stride + (ix + 1)] || 0;
    const h01 = this.heightData[(iz + 1) * stride + ix] || 0;
    const h11 = this.heightData[(iz + 1) * stride + (ix + 1)] || 0;

    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  checkCollision(position) {
    const terrainHeight = this.getHeightAt(position.x, position.z);
    return position.y < terrainHeight + TERRAIN.COLLISION_MARGIN;
  }
}
