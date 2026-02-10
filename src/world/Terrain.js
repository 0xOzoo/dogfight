import * as THREE from 'three';
import { TERRAIN } from '../config.js';

export class Terrain {
  constructor(scene, mapId = 'island') {
    this.scene = scene;
    this.mapId = mapId;
    this.heightData = null;
    this.mesh = null;

    if (mapId === 'coastal_city') {
      this.generateCoastalCity();
      this.addDesertVegetation();
      this.addCityBuildings();
      this.addHighways();
      this.addNavalBase();
      this.addDestroyerShip();
      this.addCanyonBridges();
    } else {
      this.generate();
      this.addTrees();
      this.addBuildings();
      this.addBridges();
    }
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

    this.addWater();
  }

  addWater() {
    const { SIZE, WATER_LEVEL } = TERRAIN;
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

          float wave1 = sin(pos.x * 0.02 + uTime * 0.8) * cos(pos.z * 0.015 + uTime * 0.6) * 3.0;
          float wave2 = sin(pos.x * 0.05 + uTime * 1.2) * cos(pos.z * 0.04 - uTime * 0.9) * 1.5;
          float wave3 = sin(pos.x * 0.1 + pos.z * 0.08 + uTime * 2.0) * 0.5;
          pos.y += wave1 + wave2 + wave3;

          vWaveHeight = (wave1 + wave2 + wave3) / 5.0;
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
          float t = vWaveHeight * 0.5 + 0.5;
          vec3 color = mix(uColor1, uColor2, t);

          float foam = smoothstep(0.35, 0.5, vWaveHeight);
          color = mix(color, vec3(0.7, 0.8, 0.9), foam * 0.4);

          float shimmer = pow(max(0.0, vWaveHeight), 4.0) * 0.3;
          color += vec3(shimmer);

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

  // ============================================================
  // COASTAL CITY MAP
  // ============================================================

  generateCoastalCity() {
    const { SIZE, SEGMENTS, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;

    // Store layout positions for decoration methods
    this._cityX = 1500;
    this._cityZ = 1500;
    this._navalX = 3500;
    this._navalZ = 2500;
    this._destroyerX = 4200;
    this._destroyerZ = 3200;

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

      // 1. High desert plateau base
      let height = this.fbmNoise(nx + 50.3, nz + 70.1, 6);

      // Sharp ridges for canyon walls
      const ridge = 1 - Math.abs(this.fbmNoise(nx * 0.8 + 60.7, nz * 0.8 + 80.2, 4) * 2 - 1);
      height = height * 0.35 + ridge * ridge * 0.65;

      // Raise overall for tall mesas
      height = height * 0.6 + 0.35;

      // 2. Grand Canyon carving — 4 canyon systems
      const c1 = this.fbmNoise(nx * 0.2 + 100.1, nz * 0.12 + 100.7, 4);
      const c1Cut = Math.max(0, 1 - Math.pow(Math.abs(c1 - 0.5) * 3.5, 0.45) - 0.15);

      const c2 = this.fbmNoise(nx * 0.12 + 200.2, nz * 0.22 + 200.9, 4);
      const c2Cut = Math.max(0, 1 - Math.pow(Math.abs(c2 - 0.5) * 3.5, 0.45) - 0.15);

      const c3 = this.fbmNoise(nx * 0.18 + 300.3, nz * 0.18 + 300.1, 4);
      const c3Cut = Math.max(0, 1 - Math.pow(Math.abs(c3 - 0.5) * 3.5, 0.45) - 0.15);

      const c4 = this.fbmNoise(nx * 0.25 + 400.5, nz * 0.15 + 400.3, 3);
      const c4Cut = Math.max(0, 1 - Math.pow(Math.abs(c4 - 0.5) * 3.0, 0.5) - 0.2);

      const canyonCut = Math.max(c1Cut, c2Cut, c3Cut, c4Cut) * 0.8;
      height = Math.max(0.04, height - canyonCut);

      // 3. Mesa flattening — flat-topped plateaus
      if (height > 0.65) {
        height = 0.65 + (height - 0.65) * 0.25;
      }

      // 4. Coastal transition
      const coastNoise = this.fbmNoise(x / SIZE * 4 + 500, z / SIZE * 0.5 + 500, 3) * 1200;
      let coastLine = 2500 + coastNoise;

      // Bay indent for harbor
      const bayDist = Math.sqrt((x - 2500) * (x - 2500) + (z - 2200) * (z - 2200));
      coastLine -= Math.max(0, 1 - bayDist / 2000) * 1200;

      // East coast
      const eastCoast = 5000 + this.fbmNoise(0.5, z / SIZE * 4 + 600, 3) * 800;

      const inOcean = z > coastLine || x > eastCoast;
      const coastDist = inOcean ? 0 : Math.min(
        Math.max(0, coastLine - z),
        Math.max(0, eastCoast - x)
      );

      if (inOcean) {
        const depth = Math.max(Math.max(0, z - coastLine), Math.max(0, x - eastCoast));
        const depthFactor = Math.min(1, depth / 800);
        height = Math.max(-0.01, 0.01 * (1 - depthFactor));
      } else if (coastDist < 800) {
        const coastFactor = 1 - coastDist / 800;
        height = height * (1 - coastFactor * 0.85) + 0.025 * coastFactor;
      }

      // 5. Flatten city area
      const cityDist = Math.sqrt((x - this._cityX) * (x - this._cityX) + (z - this._cityZ) * (z - this._cityZ));
      if (cityDist < 1800) {
        const flat = Math.max(0, 1 - cityDist / 1800);
        height = height * (1 - flat * flat * 0.95) + 0.025 * flat * flat;
      }

      // 6. Flatten naval base
      const navDist = Math.sqrt((x - this._navalX) * (x - this._navalX) + (z - this._navalZ) * (z - this._navalZ));
      if (navDist < 700) {
        const flat = Math.max(0, 1 - navDist / 700);
        height = height * (1 - flat * flat * 0.95) + 0.02 * flat * flat;
      }

      // 7. Spawn area safety — cap height near (0,0)
      const spawnDist = Math.sqrt(x * x + z * z);
      if (spawnDist < 800) {
        const flattenStr = Math.max(0, 1 - spawnDist / 800);
        height = height * (1 - flattenStr * 0.6);
      }

      // 8. Map edge falloff
      const edgeDist = Math.max(Math.abs(x), Math.abs(z)) / (SIZE * 0.48);
      if (edgeDist > 0.8 && !inOcean) {
        height *= 1 - (edgeDist - 0.8) / 0.2 * 0.5;
      }

      height *= MAX_HEIGHT;
      vertices[i + 1] = height;
      this.heightData[i / 3] = height;

      // Desert coloring
      const nh = height / MAX_HEIGHT;
      let r, g, b;

      if (height < WATER_LEVEL) {
        r = 0.08; g = 0.25; b = 0.55;
      } else if (nh < 0.025) {
        r = 0.78; g = 0.72; b = 0.52;
      } else if (nh < 0.06) {
        r = 0.74; g = 0.64; b = 0.44;
      } else if (nh < 0.15) {
        r = 0.70; g = 0.56; b = 0.36;
      } else if (nh < 0.25) {
        r = 0.68; g = 0.42; b = 0.22;
      } else if (nh < 0.40) {
        r = 0.62; g = 0.32; b = 0.18;
      } else if (nh < 0.55) {
        r = 0.52; g = 0.28; b = 0.15;
      } else if (nh < 0.65) {
        r = 0.56; g = 0.46; b = 0.30;
      } else {
        r = 0.64; g = 0.56; b = 0.40;
      }

      // City area — concrete tint
      if (cityDist < 1200 && height > WATER_LEVEL && nh < 0.1) {
        const blend = Math.max(0, 1 - cityDist / 1200);
        r = r * (1 - blend) + 0.45 * blend;
        g = g * (1 - blend) + 0.43 * blend;
        b = b * (1 - blend) + 0.40 * blend;
      }

      // Naval base — concrete tint
      if (navDist < 500 && height > WATER_LEVEL) {
        const blend = Math.max(0, 1 - navDist / 500);
        r = r * (1 - blend) + 0.50 * blend;
        g = g * (1 - blend) + 0.48 * blend;
        b = b * (1 - blend) + 0.45 * blend;
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

    this.addWater();
  }

  addDesertVegetation() {
    const { SIZE, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;
    const maxBushes = 2000;

    const bushGeom = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshLambertMaterial({ color: 0x8a7a3a });
    const bushInstance = new THREE.InstancedMesh(bushGeom, bushMat, maxBushes);

    const dummy = new THREE.Object3D();
    let idx = 0;

    for (let i = 0; i < maxBushes * 6 && idx < maxBushes; i++) {
      const seed = i * 23.71 + 100;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.85;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.85;
      const height = this.getHeightAt(x, z);
      const nh = height / MAX_HEIGHT;

      // Only in desert zones, not city, not underwater, not mesa tops
      if (height < WATER_LEVEL + 4 || nh > 0.55 || nh < 0.03) continue;

      const cityDist = Math.sqrt((x - this._cityX) ** 2 + (z - this._cityZ) ** 2);
      if (cityDist < 1500) continue;
      const navDist = Math.sqrt((x - this._navalX) ** 2 + (z - this._navalZ) ** 2);
      if (navDist < 600) continue;

      // Sparse density
      if (this.seededRandom(seed + 2) > 0.15) continue;

      const scale = 3 + this.seededRandom(seed + 3) * 6;
      dummy.position.set(x, height + scale * 0.3, z);
      dummy.scale.set(scale, scale * 0.6, scale);
      dummy.rotation.set(0, this.seededRandom(seed + 4) * Math.PI * 2, 0);
      dummy.updateMatrix();
      bushInstance.setMatrixAt(idx++, dummy.matrix);
    }

    bushInstance.count = idx;
    bushInstance.instanceMatrix.needsUpdate = true;
    this.scene.add(bushInstance);
  }

  addCityBuildings() {
    const { WATER_LEVEL } = TERRAIN;
    const cx = this._cityX, cz = this._cityZ;

    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x5588aa });
    const darkSteelMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
    const residentialMat = new THREE.MeshLambertMaterial({ color: 0xccbb99 });

    const boxGeom = new THREE.BoxGeometry(1, 1, 1);

    // Downtown skyscrapers
    const towerInstance = new THREE.InstancedMesh(boxGeom, darkSteelMat, 60);
    const towerGlass = new THREE.InstancedMesh(boxGeom, glassMat, 60);
    // Inner city
    const innerInstance = new THREE.InstancedMesh(boxGeom, concreteMat, 150);
    const innerGlass = new THREE.InstancedMesh(boxGeom, glassMat, 150);
    // Neighborhoods
    const residInstance = new THREE.InstancedMesh(boxGeom, residentialMat, 400);
    // Suburban
    const suburbanInstance = new THREE.InstancedMesh(boxGeom, residentialMat, 150);

    towerInstance.castShadow = true;
    innerInstance.castShadow = true;
    residInstance.castShadow = true;

    const dummy = new THREE.Object3D();
    let tIdx = 0, tgIdx = 0, iIdx = 0, igIdx = 0, rIdx = 0, sIdx = 0;

    // === DOWNTOWN CORE (radius 0-600) ===
    for (let i = 0; i < 55 && tIdx < 60; i++) {
      const seed = (i + 80000) * 67.13;
      const angle = this.seededRandom(seed) * Math.PI * 2;
      const dist = this.seededRandom(seed + 1) * 600;
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;
      const bh = this.getHeightAt(bx, bz);
      if (bh < WATER_LEVEL + 2) continue;

      const distRatio = dist / 600;
      const width = 15 + this.seededRandom(seed + 2) * 20;
      const height = 150 + this.seededRandom(seed + 3) * 200 * (1 - distRatio * 0.5);
      const depth = 15 + this.seededRandom(seed + 4) * 20;
      const rotation = Math.floor(this.seededRandom(seed + 5) * 4) * Math.PI * 0.5;

      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, rotation, 0);
      dummy.updateMatrix();
      towerInstance.setMatrixAt(tIdx++, dummy.matrix);

      // Glass overlay
      if (tgIdx < 60) {
        dummy.scale.set(width * 1.01, height * 0.95, depth * 1.01);
        dummy.updateMatrix();
        towerGlass.setMatrixAt(tgIdx++, dummy.matrix);
      }
    }

    // === INNER CITY (radius 600-1200) ===
    for (let i = 0; i < 130 && iIdx < 150; i++) {
      const seed = (i + 81000) * 59.17;
      const angle = this.seededRandom(seed) * Math.PI * 2;
      const dist = 600 + this.seededRandom(seed + 1) * 600;
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;
      const bh = this.getHeightAt(bx, bz);
      if (bh < WATER_LEVEL + 2) continue;

      const width = 12 + this.seededRandom(seed + 2) * 18;
      const height = 40 + this.seededRandom(seed + 3) * 60;
      const depth = 12 + this.seededRandom(seed + 4) * 18;
      const rotation = Math.floor(this.seededRandom(seed + 5) * 4) * Math.PI * 0.5;

      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, rotation, 0);
      dummy.updateMatrix();
      innerInstance.setMatrixAt(iIdx++, dummy.matrix);

      if (igIdx < 150 && height > 50) {
        dummy.scale.set(width * 1.01, height * 0.95, depth * 1.01);
        dummy.updateMatrix();
        innerGlass.setMatrixAt(igIdx++, dummy.matrix);
      }
    }

    // === NEIGHBORHOODS (radius 1200-1800, grid clusters) ===
    const neighborhoods = [
      { x: cx - 1200, z: cz - 400 },
      { x: cx - 800, z: cz + 800 },
      { x: cx + 1000, z: cz - 600 },
      { x: cx + 400, z: cz + 1200 },
      { x: cx - 400, z: cz - 1200 },
    ];

    for (const hood of neighborhoods) {
      for (let row = 0; row < 8 && rIdx < 400; row++) {
        for (let col = 0; col < 8 && rIdx < 400; col++) {
          const seed = (rIdx + 82000) * 43.91;
          // Grid pattern with street gaps
          const bx = hood.x + col * 55 - 180 + (this.seededRandom(seed) - 0.5) * 10;
          const bz = hood.z + row * 55 - 180 + (this.seededRandom(seed + 1) - 0.5) * 10;
          const bh = this.getHeightAt(bx, bz);
          if (bh < WATER_LEVEL + 2) continue;

          // Skip some for variety
          if (this.seededRandom(seed + 2) > 0.7) { rIdx++; continue; }

          const width = 10 + this.seededRandom(seed + 3) * 12;
          const height = 12 + this.seededRandom(seed + 4) * 18;
          const depth = 10 + this.seededRandom(seed + 5) * 12;

          dummy.position.set(bx, bh + height / 2, bz);
          dummy.scale.set(width, height, depth);
          dummy.rotation.set(0, Math.floor(this.seededRandom(seed + 6) * 4) * Math.PI * 0.5, 0);
          dummy.updateMatrix();
          residInstance.setMatrixAt(rIdx++, dummy.matrix);
        }
      }
    }

    // === SUBURBAN (scattered small buildings) ===
    for (let i = 0; i < 200 && sIdx < 150; i++) {
      const seed = (i + 83000) * 37.13;
      const angle = this.seededRandom(seed) * Math.PI * 2;
      const dist = 1800 + this.seededRandom(seed + 1) * 800;
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;
      const bh = this.getHeightAt(bx, bz);
      if (bh < WATER_LEVEL + 2 || bh / TERRAIN.MAX_HEIGHT > 0.15) continue;

      const width = 8 + this.seededRandom(seed + 2) * 10;
      const height = 6 + this.seededRandom(seed + 3) * 9;
      const depth = 8 + this.seededRandom(seed + 4) * 10;

      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, this.seededRandom(seed + 5) * Math.PI, 0);
      dummy.updateMatrix();
      suburbanInstance.setMatrixAt(sIdx++, dummy.matrix);
    }

    towerInstance.count = tIdx;
    towerGlass.count = tgIdx;
    innerInstance.count = iIdx;
    innerGlass.count = igIdx;
    residInstance.count = rIdx;
    suburbanInstance.count = sIdx;

    towerInstance.instanceMatrix.needsUpdate = true;
    towerGlass.instanceMatrix.needsUpdate = true;
    innerInstance.instanceMatrix.needsUpdate = true;
    innerGlass.instanceMatrix.needsUpdate = true;
    residInstance.instanceMatrix.needsUpdate = true;
    suburbanInstance.instanceMatrix.needsUpdate = true;

    this.scene.add(towerInstance);
    this.scene.add(towerGlass);
    this.scene.add(innerInstance);
    this.scene.add(innerGlass);
    this.scene.add(residInstance);
    this.scene.add(suburbanInstance);
  }

  addHighways() {
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const lineMat = new THREE.MeshLambertMaterial({ color: 0xcccc44 });

    // Highway routes as waypoint arrays
    const routes = [
      // North-south: city to inland desert
      [
        { x: this._cityX, z: this._cityZ - 600 },
        { x: this._cityX - 200, z: this._cityZ - 1200 },
        { x: 1000, z: 0 },
        { x: 800, z: -1000 },
        { x: 600, z: -2000 },
      ],
      // Coastal: city to naval base
      [
        { x: this._cityX + 500, z: this._cityZ },
        { x: 2200, z: 1800 },
        { x: 2800, z: 2100 },
        { x: this._navalX - 300, z: this._navalZ - 200 },
      ],
    ];

    for (const route of routes) {
      for (let s = 0; s < route.length - 1; s++) {
        const p1 = route[s];
        const p2 = route[s + 1];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);
        const midX = (p1.x + p2.x) / 2;
        const midZ = (p1.z + p2.z) / 2;

        const h1 = this.getHeightAt(p1.x, p1.z);
        const h2 = this.getHeightAt(p2.x, p2.z);
        const deckH = Math.max(h1, h2) + 30;

        // Road deck
        const deckGeom = new THREE.BoxGeometry(45, 3, length + 20);
        const deck = new THREE.Mesh(deckGeom, bridgeMat);
        deck.position.set(midX, deckH, midZ);
        deck.rotation.y = angle;
        deck.castShadow = true;
        this.scene.add(deck);

        // Center line
        const lineGeom = new THREE.BoxGeometry(1, 3.2, length + 20);
        const line = new THREE.Mesh(lineGeom, lineMat);
        line.position.set(midX, deckH + 0.1, midZ);
        line.rotation.y = angle;
        this.scene.add(line);

        // Support pillars
        const pillarCount = Math.max(2, Math.floor(length / 100));
        for (let p = 0; p <= pillarCount; p++) {
          const t = p / pillarCount;
          const px = p1.x + dx * t;
          const pz = p1.z + dz * t;
          const groundH = this.getHeightAt(px, pz);
          const pillarH = deckH - groundH;
          if (pillarH < 3) continue;

          const pillarGeom = new THREE.BoxGeometry(6, pillarH, 6);
          const pillar = new THREE.Mesh(pillarGeom, pillarMat);
          pillar.position.set(px, groundH + pillarH / 2, pz);
          pillar.castShadow = true;
          this.scene.add(pillar);
        }

        // Railings
        for (const side of [-22, 22]) {
          const railGeom = new THREE.BoxGeometry(1.5, 4, length + 20);
          const rail = new THREE.Mesh(railGeom, pillarMat);
          rail.position.set(
            midX + Math.cos(angle + Math.PI / 2) * side,
            deckH + 2.5,
            midZ + Math.sin(angle + Math.PI / 2) * side
          );
          rail.rotation.y = angle;
          this.scene.add(rail);
        }
      }
    }
  }

  addNavalBase() {
    const { WATER_LEVEL } = TERRAIN;
    const nx = this._navalX, nz = this._navalZ;

    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x5588aa });
    const tankMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

    // Dock piers extending into water
    const piers = [
      { x: nx - 200, z: nz + 300, length: 250, width: 30, angle: 0 },
      { x: nx, z: nz + 350, length: 300, width: 35, angle: 0.1 },
      { x: nx + 200, z: nz + 280, length: 220, width: 30, angle: -0.05 },
    ];

    for (const pier of piers) {
      const pierGeom = new THREE.BoxGeometry(pier.width, 5, pier.length);
      const pierMesh = new THREE.Mesh(pierGeom, concreteMat);
      pierMesh.position.set(pier.x, WATER_LEVEL + 3, pier.z + pier.length / 2);
      pierMesh.rotation.y = pier.angle;
      pierMesh.castShadow = true;
      this.scene.add(pierMesh);
    }

    // Warehouses in grid
    const baseH = this.getHeightAt(nx, nz);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        const wx = nx - 250 + col * 130;
        const wz = nz - 200 + row * 100;
        const wh = Math.max(baseH, WATER_LEVEL + 2);
        const height = 15 + this.seededRandom(row * 4 + col + 90000) * 8;
        const whGeom = new THREE.BoxGeometry(40, height, 50);
        const wh_mesh = new THREE.Mesh(whGeom, metalMat);
        wh_mesh.position.set(wx, wh + height / 2, wz);
        wh_mesh.castShadow = true;
        this.scene.add(wh_mesh);
      }
    }

    // Control tower
    const towerH = 60;
    const towerGeom = new THREE.BoxGeometry(15, towerH, 15);
    const tower = new THREE.Mesh(towerGeom, concreteMat);
    const towerBaseH = Math.max(baseH, WATER_LEVEL + 2);
    tower.position.set(nx + 100, towerBaseH + towerH / 2, nz - 100);
    tower.castShadow = true;
    this.scene.add(tower);

    // Tower glass top
    const glassGeom = new THREE.BoxGeometry(18, 8, 18);
    const glass = new THREE.Mesh(glassGeom, glassMat);
    glass.position.set(nx + 100, towerBaseH + towerH + 4, nz - 100);
    this.scene.add(glass);

    // Fuel tanks (cylinders)
    const tankGeom = new THREE.CylinderGeometry(8, 8, 15, 12);
    for (let t = 0; t < 6; t++) {
      const tx = nx - 350 + (t % 3) * 50;
      const tz = nz + 50 + Math.floor(t / 3) * 50;
      const th = Math.max(this.getHeightAt(tx, tz), WATER_LEVEL + 2);
      const tank = new THREE.Mesh(tankGeom, tankMat);
      tank.position.set(tx, th + 7.5, tz);
      tank.castShadow = true;
      this.scene.add(tank);
    }

    // Hangars
    for (let h = 0; h < 4; h++) {
      const hx = nx + 200 + (h % 2) * 100;
      const hz = nz - 50 + Math.floor(h / 2) * 80;
      const hh = Math.max(this.getHeightAt(hx, hz), WATER_LEVEL + 2);
      const hangarGeom = new THREE.BoxGeometry(50, 18, 60);
      const hangar = new THREE.Mesh(hangarGeom, darkMat);
      hangar.position.set(hx, hh + 9, hz);
      hangar.castShadow = true;
      this.scene.add(hangar);
    }
  }

  addDestroyerShip() {
    const { WATER_LEVEL } = TERRAIN;
    const ship = new THREE.Group();
    const dx = this._destroyerX, dz = this._destroyerZ;

    const hullMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const superMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x5588aa });
    const turretMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const antennaMat = new THREE.MeshLambertMaterial({ color: 0x999999 });

    // Hull — main body
    const hullGeom = new THREE.BoxGeometry(18, 10, 150);
    const hull = new THREE.Mesh(hullGeom, hullMat);
    hull.position.set(0, -2, 0);
    ship.add(hull);

    // Bow taper — wedge shape at front
    const bowGeom = new THREE.ConeGeometry(12, 25, 4);
    bowGeom.rotateX(Math.PI / 2);
    bowGeom.rotateY(Math.PI / 4);
    const bow = new THREE.Mesh(bowGeom, hullMat);
    bow.position.set(0, -2, -85);
    ship.add(bow);

    // Deck
    const deckGeom = new THREE.BoxGeometry(16, 1, 145);
    const deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.set(0, 3.5, 0);
    ship.add(deck);

    // Superstructure (bridge island)
    const superGeom = new THREE.BoxGeometry(14, 18, 30);
    const superstructure = new THREE.Mesh(superGeom, superMat);
    superstructure.position.set(0, 13, -15);
    ship.add(superstructure);

    // Bridge windows
    const bridgeGeom = new THREE.BoxGeometry(15, 5, 20);
    const bridge = new THREE.Mesh(bridgeGeom, glassMat);
    bridge.position.set(0, 24, -15);
    ship.add(bridge);

    // Radar mast
    const mastGeom = new THREE.CylinderGeometry(0.3, 0.5, 25, 6);
    const mast = new THREE.Mesh(mastGeom, antennaMat);
    mast.position.set(0, 39, -15);
    ship.add(mast);

    // Radar dish
    const dishGeom = new THREE.BoxGeometry(8, 4, 1);
    const dish = new THREE.Mesh(dishGeom, antennaMat);
    dish.position.set(0, 50, -15);
    ship.add(dish);

    // Forward gun turret
    const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3, 8), turretMat);
    turretBase.position.set(0, 5.5, -50);
    ship.add(turretBase);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 6), turretMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 6.5, -58);
    ship.add(barrel);

    // Aft gun turret
    const aftTurret = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 2.5, 8), turretMat);
    aftTurret.position.set(0, 5, 40);
    ship.add(aftTurret);
    const aftBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 6), turretMat);
    aftBarrel.rotation.x = -Math.PI / 2;
    aftBarrel.position.set(0, 5.8, 47);
    ship.add(aftBarrel);

    // VLS cells (missile launchers) — flat boxes forward of bridge
    const vlsGeom = new THREE.BoxGeometry(8, 2, 10);
    const vls = new THREE.Mesh(vlsGeom, turretMat);
    vls.position.set(0, 4.5, -38);
    ship.add(vls);

    // Smokestack
    const stackGeom = new THREE.CylinderGeometry(1.5, 2, 8, 8);
    const stack = new THREE.Mesh(stackGeom, turretMat);
    stack.position.set(0, 12, 5);
    ship.add(stack);

    // Helicopter pad at stern
    const helipadGeom = new THREE.CylinderGeometry(10, 10, 0.5, 16);
    const helipad = new THREE.Mesh(helipadGeom, deckMat);
    helipad.position.set(0, 4, 60);
    ship.add(helipad);

    // CIWS dome
    const ciwsGeom = new THREE.SphereGeometry(2, 8, 8);
    const ciws = new THREE.Mesh(ciwsGeom, antennaMat);
    ciws.position.set(0, 27, -5);
    ship.add(ciws);

    // Position and orient the ship
    ship.position.set(dx, WATER_LEVEL + 4, dz);
    ship.rotation.y = -0.8; // Angled facing out to sea
    ship.castShadow = true;
    this.scene.add(ship);
  }

  addCanyonBridges() {
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0x996644 });
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x885533 });
    const cableMat = new THREE.MeshBasicMaterial({ color: 0xaa8866 });

    const bridgeSpots = [
      // Major canyon crossings in the desert area
      { x1: -2500, z1: -2000, x2: -1800, z2: -2000, height: 140, deckWidth: 40 },
      { x1: -500, z1: -1500, x2: -500, z2: -800, height: 120, deckWidth: 35 },
      { x1: 2000, z1: -3000, x2: 2700, z2: -2800, height: 160, deckWidth: 40 },
      { x1: -3000, z1: 0, x2: -2300, z2: 200, height: 180, deckWidth: 42 },
      { x1: 500, z1: -3500, x2: 1200, z2: -3300, height: 150, deckWidth: 38 },
      // Near city approach
      { x1: 400, z1: 400, x2: 1000, z2: 600, height: 50, deckWidth: 50 },
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

      // Bridge deck
      const deckGeom = new THREE.BoxGeometry(spot.deckWidth, 4, length + 30);
      const deck = new THREE.Mesh(deckGeom, bridgeMat);
      deck.position.set(midX, deckHeight, midZ);
      deck.rotation.y = angle;
      deck.castShadow = true;
      this.scene.add(deck);

      // Railings
      for (const side of [-spot.deckWidth / 2, spot.deckWidth / 2]) {
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

      // Support pillars
      const pillarCount = Math.max(2, Math.floor(length / 70));
      for (let p = 0; p <= pillarCount; p++) {
        const t = p / pillarCount;
        const px = spot.x1 + dx * t;
        const pz = spot.z1 + dz * t;
        const groundH = this.getHeightAt(px, pz);
        const pillarH = deckHeight - groundH;
        if (pillarH < 5) continue;

        const pw = spot.deckWidth * 0.2;
        const pillarGeom = new THREE.BoxGeometry(pw, pillarH, pw);
        const pillar = new THREE.Mesh(pillarGeom, pillarMat);
        pillar.position.set(px, groundH + pillarH / 2, pz);
        pillar.castShadow = true;
        this.scene.add(pillar);
      }

      // Suspension cables
      const cablePoints = [];
      for (let c = 0; c <= 20; c++) {
        const t = c / 20;
        const cx = spot.x1 + dx * t;
        const cz = spot.z1 + dz * t;
        const sag = -Math.sin(t * Math.PI) * 40;
        cablePoints.push(new THREE.Vector3(cx, deckHeight + 35 + sag, cz));
      }
      const cableGeom = new THREE.BufferGeometry().setFromPoints(cablePoints);
      this.scene.add(new THREE.Line(cableGeom, cableMat));

      // Tower pylons at ends
      for (const end of [0, 1]) {
        const ex = end === 0 ? spot.x1 : spot.x2;
        const ez = end === 0 ? spot.z1 : spot.z2;
        const towerGeom = new THREE.BoxGeometry(6, 65, 6);
        const tower = new THREE.Mesh(towerGeom, pillarMat);
        tower.position.set(ex, deckHeight + 32.5, ez);
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
