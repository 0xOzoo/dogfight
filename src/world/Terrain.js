import * as THREE from 'three';
import { TERRAIN, MAPS } from '../config.js';

export class Terrain {
  constructor(scene, mapId = 'island') {
    this.scene = scene;
    this.mapId = mapId;
    this.heightData = null;
    this.mesh = null;
    this.buildingColliders = [];
    this.propPositions = []; // Static plane prop spawn positions

    // MapManager reference (set externally for 3D-tile maps)
    this.mapManager = null;

    // Check if this map uses 3D tiles
    const mapCfg = MAPS.find(m => m.id === mapId);
    this.is3DTileMap = !!(mapCfg && mapCfg.tiles3d);

    if (this.is3DTileMap) {
      // 3D tile maps (NYC, Paris, etc.) use MapManager - just create water/ground plane
      this.generateTilesBase();
    } else if (mapId === 'coastal_city') {
      this.generateCoastalCity();
      this.addDesertVegetation();
      this.addCityBuildings();
      this.addHighways();
      this.addNavalBase();
      this.addDestroyerShip();
      this.addCanyonBridges();
      this.addDesertVillages();
      this.addMilitaryBase();
      this.addDesertFeatures();
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

  generateTilesBase() {
    const { SIZE, WATER_LEVEL } = TERRAIN;

    // Flat height data (sea level everywhere - 3D tiles provide actual geometry)
    const SEGMENTS = TERRAIN.SEGMENTS;
    this.heightData = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1));
    // All zeros = sea level

    // Large ocean/water plane
    const waterGeometry = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, 1, 1);
    waterGeometry.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x1a3a4a) },
        uDeepColor: { value: new THREE.Color(0x0a1a2a) },
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 pos = position;
          pos.y += sin(pos.x * 0.02 + uTime) * 1.5 + cos(pos.z * 0.015 + uTime * 0.7) * 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uDeepColor;
        varying vec2 vUv;
        void main() {
          vec3 col = mix(uDeepColor, uColor, vUv.y * 0.5 + 0.5);
          gl_FragColor = vec4(col, 0.85);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.water = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.water.position.y = WATER_LEVEL;
    this.water.userData.excludeAO = true;
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

      // Deck colliders along bridge length
      const deckColCount = Math.max(3, Math.floor(length / 35));
      for (let c = 0; c <= deckColCount; c++) {
        const t = c / deckColCount;
        const cx = spot.x1 + dx * t;
        const cz = spot.z1 + dz * t;
        this.buildingColliders.push({
          x: cx, z: cz,
          radius: deckWidth / 2 + 2,
          bottom: deckHeight - 3,
          top: deckHeight + 5,
        });
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

        // Pillar collider
        this.buildingColliders.push({
          x: px, z: pz,
          radius: pillarWidth / 2 + 2,
          bottom: groundH,
          top: deckHeight,
        });
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

        this.buildingColliders.push({
          x: ex, z: ez,
          radius: 5,
          bottom: deckHeight,
          top: deckHeight + towerH,
        });
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
    this._airbaseX = -3000;
    this._airbaseZ = -3500;
    this._oasisX = -2000;
    this._oasisZ = -500;
    this._villages = [
      { x: -1500, z: -700 },   // Oasis settlement
      { x: -1000, z: -2200 },  // Central desert
      { x: 800, z: -2500 },    // Northeast mesa
      { x: -3200, z: -2000 },  // Western canyon
      { x: 2500, z: -1800 },   // Eastern desert
      { x: -500, z: -4000 },   // Far north
    ];

    // River path from oasis to coast
    this._riverPath = [
      { x: -2000, z: -500 },
      { x: -1500, z: 200 },
      { x: -1000, z: 700 },
      { x: -400, z: 1300 },
      { x: 100, z: 1900 },
      { x: 300, z: 2500 },
    ];

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

      // 6b. River carving — find min distance to river path
      let minRiverDist = Infinity;
      let riverT = 0; // 0=oasis, 1=coast
      const rp = this._riverPath;
      for (let s = 0; s < rp.length - 1; s++) {
        const ax = rp[s].x, az = rp[s].z;
        const bx = rp[s + 1].x, bz = rp[s + 1].z;
        const abx = bx - ax, abz = bz - az;
        const apx = x - ax, apz = z - az;
        const lenSq = abx * abx + abz * abz;
        let t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / lenSq));
        const projX = ax + abx * t, projZ = az + abz * t;
        const d = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
        if (d < minRiverDist) {
          minRiverDist = d;
          riverT = (s + t) / (rp.length - 1);
        }
      }

      // River width varies: narrow at oasis, wider at coast
      const riverWidth = 40 + riverT * 100;
      const riverBank = riverWidth + 80;
      if (minRiverDist < riverWidth) {
        height = Math.min(height, 0.002); // Below water level
      } else if (minRiverDist < riverBank && !inOcean) {
        const bankFactor = 1 - (minRiverDist - riverWidth) / (riverBank - riverWidth);
        height = Math.min(height, height * (1 - bankFactor * 0.8) + 0.003 * bankFactor);
      }

      // Oasis lake
      const oasisDist = Math.sqrt((x - this._oasisX) ** 2 + (z - this._oasisZ) ** 2);
      if (oasisDist < 400) {
        const oasisFactor = Math.max(0, 1 - oasisDist / 400);
        if (oasisDist < 200) {
          height = Math.min(height, 0.002);
        } else {
          height = Math.min(height, height * (1 - oasisFactor * 0.9) + 0.003 * oasisFactor);
        }
      }

      // 6c. Flatten airbase area (large rectangle for full military compound)
      const abDx = Math.abs(x - this._airbaseX);
      const abDz = Math.abs(z - (this._airbaseZ - 200)); // offset center to cover buildings south of runway
      if (abDx < 1900 && abDz < 800) {
        const abFx = Math.max(0, 1 - abDx / 1900);
        const abFz = Math.max(0, 1 - abDz / 800);
        const abFlat = Math.min(1, abFx * abFz * 2.5); // steep transition, hard flat center
        height = height * (1 - abFlat) + 0.06 * abFlat;
      }

      // 6d. Flatten desert village areas
      for (const v of this._villages) {
        const vDist = Math.sqrt((x - v.x) ** 2 + (z - v.z) ** 2);
        if (vDist < 450) {
          const vFlat = Math.max(0, 1 - vDist / 450);
          height = height * (1 - vFlat * vFlat * 0.85) + 0.05 * vFlat * vFlat;
        }
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

      // Oasis / river bank — green tint
      if (height > WATER_LEVEL) {
        let greenBlend = 0;
        if (oasisDist < 500) {
          greenBlend = Math.max(greenBlend, (1 - oasisDist / 500) * 0.8);
        }
        if (minRiverDist < riverBank + 60) {
          greenBlend = Math.max(greenBlend, (1 - minRiverDist / (riverBank + 60)) * 0.5);
        }
        if (greenBlend > 0) {
          r = r * (1 - greenBlend) + 0.25 * greenBlend;
          g = g * (1 - greenBlend) + 0.50 * greenBlend;
          b = b * (1 - greenBlend) + 0.15 * greenBlend;
        }
      }

      // Airbase — dark tarmac tint
      if (abDx < 1900 && abDz < 800 && height > WATER_LEVEL) {
        const abBlend = Math.max(0, 1 - Math.max(abDx / 1900, abDz / 800)) * 0.6;
        r = r * (1 - abBlend) + 0.35 * abBlend;
        g = g * (1 - abBlend) + 0.33 * abBlend;
        b = b * (1 - abBlend) + 0.30 * abBlend;
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
    const maxBushes = 4500;

    const bushGeom = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshLambertMaterial({ color: 0x8a7a3a });
    const bushInstance = new THREE.InstancedMesh(bushGeom, bushMat, maxBushes);

    // Oasis palms / lush vegetation
    const palmCrownGeom = new THREE.IcosahedronGeometry(1, 1);
    const palmMat = new THREE.MeshLambertMaterial({ color: 0x2d8a2d });
    const palmInstance = new THREE.InstancedMesh(palmCrownGeom, palmMat, 600);
    const trunkGeom = new THREE.CylinderGeometry(0.12, 0.2, 1, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const trunkInstance = new THREE.InstancedMesh(trunkGeom, trunkMat, 600);

    const dummy = new THREE.Object3D();
    let idx = 0;
    let palmIdx = 0, trunkIdx = 0;

    // Oasis and riverbank vegetation
    for (let i = 0; i < 2000 && palmIdx < 600; i++) {
      const seed = (i + 50000) * 31.17;
      // Spread around oasis and river
      let x, z;
      if (this.seededRandom(seed + 10) < 0.4) {
        // Around oasis
        const angle = this.seededRandom(seed) * Math.PI * 2;
        const dist = 100 + this.seededRandom(seed + 1) * 400;
        x = this._oasisX + Math.cos(angle) * dist;
        z = this._oasisZ + Math.sin(angle) * dist;
      } else {
        // Along river
        const rp = this._riverPath;
        const seg = Math.floor(this.seededRandom(seed + 2) * (rp.length - 1));
        const t = this.seededRandom(seed + 3);
        const rx = rp[seg].x + (rp[Math.min(seg + 1, rp.length - 1)].x - rp[seg].x) * t;
        const rz = rp[seg].z + (rp[Math.min(seg + 1, rp.length - 1)].z - rp[seg].z) * t;
        const offset = (this.seededRandom(seed + 4) - 0.5) * 200;
        const perpAngle = Math.atan2(rp[Math.min(seg + 1, rp.length - 1)].z - rp[seg].z, rp[Math.min(seg + 1, rp.length - 1)].x - rp[seg].x) + Math.PI / 2;
        x = rx + Math.cos(perpAngle) * offset;
        z = rz + Math.sin(perpAngle) * offset;
      }

      const height = this.getHeightAt(x, z);
      if (height < WATER_LEVEL + 1 || height > WATER_LEVEL + 80) continue;

      const treeScale = 8 + this.seededRandom(seed + 5) * 12;
      const trunkH = treeScale * 0.8;

      // Trunk
      dummy.position.set(x, height + trunkH / 2, z);
      dummy.scale.set(treeScale * 0.2, trunkH, treeScale * 0.2);
      dummy.rotation.set(0, this.seededRandom(seed + 6) * Math.PI * 2, (this.seededRandom(seed + 7) - 0.5) * 0.3);
      dummy.updateMatrix();
      trunkInstance.setMatrixAt(trunkIdx++, dummy.matrix);

      // Crown
      dummy.position.set(x, height + trunkH + treeScale * 0.3, z);
      dummy.scale.set(treeScale * 0.7, treeScale * 0.5, treeScale * 0.7);
      dummy.rotation.set(0, this.seededRandom(seed + 8) * Math.PI * 2, 0);
      dummy.updateMatrix();
      palmInstance.setMatrixAt(palmIdx++, dummy.matrix);
    }

    palmInstance.count = palmIdx;
    trunkInstance.count = trunkIdx;
    palmInstance.instanceMatrix.needsUpdate = true;
    trunkInstance.instanceMatrix.needsUpdate = true;
    this.scene.add(palmInstance);
    this.scene.add(trunkInstance);

    // Desert bushes
    for (let i = 0; i < maxBushes * 6 && idx < maxBushes; i++) {
      const seed = i * 23.71 + 100;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.85;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.85;
      const height = this.getHeightAt(x, z);
      const nh = height / MAX_HEIGHT;

      if (height < WATER_LEVEL + 4 || nh > 0.55 || nh < 0.03) continue;

      const cityDist = Math.sqrt((x - this._cityX) ** 2 + (z - this._cityZ) ** 2);
      if (cityDist < 1500) continue;
      const navDist = Math.sqrt((x - this._navalX) ** 2 + (z - this._navalZ) ** 2);
      if (navDist < 600) continue;
      const abDist = Math.abs(x - this._airbaseX) < 1900 && Math.abs(z - (this._airbaseZ - 200)) < 800;
      if (abDist) continue;

      if (this.seededRandom(seed + 2) > 0.22) continue;

      const scale = 4 + this.seededRandom(seed + 3) * 10;
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

    const towerInstance = new THREE.InstancedMesh(boxGeom, darkSteelMat, 200);
    const towerGlass = new THREE.InstancedMesh(boxGeom, glassMat, 200);
    const innerInstance = new THREE.InstancedMesh(boxGeom, concreteMat, 300);
    const innerGlass = new THREE.InstancedMesh(boxGeom, glassMat, 300);
    const residInstance = new THREE.InstancedMesh(boxGeom, residentialMat, 600);
    const suburbanInstance = new THREE.InstancedMesh(boxGeom, residentialMat, 200);

    towerInstance.castShadow = true;
    innerInstance.castShadow = true;
    residInstance.castShadow = true;

    const dummy = new THREE.Object3D();
    let tIdx = 0, tgIdx = 0, iIdx = 0, igIdx = 0, rIdx = 0, sIdx = 0;

    const _addCollider = (bx, bz, w, d, bh, h) => {
      this.buildingColliders.push({
        x: bx, z: bz,
        radius: Math.max(w, d) / 2 + 2,
        bottom: bh, top: bh + h,
      });
    };

    // === DOWNTOWN CORE — tight Manhattan-style grid ===
    const gridSize = 100; // cell size (building + street)
    const streetW = 35;   // street gap between buildings
    const gridExtent = 7; // 7x7 grid = 700m across

    for (let row = -gridExtent; row <= gridExtent; row++) {
      for (let col = -gridExtent; col <= gridExtent; col++) {
        const cellX = cx + col * gridSize;
        const cellZ = cz + row * gridSize;
        const distFromCenter = Math.sqrt((col * gridSize) ** 2 + (row * gridSize) ** 2);

        const bh = this.getHeightAt(cellX, cellZ);
        if (bh < WATER_LEVEL + 2) continue;

        const seed = (row * 100 + col + 80000) * 67.13;

        // Skip some cells randomly for variety / intersections
        if (this.seededRandom(seed + 10) > 0.85) continue;

        const bw = gridSize - streetW + (this.seededRandom(seed + 2) - 0.5) * 10;
        const bd = gridSize - streetW + (this.seededRandom(seed + 4) - 0.5) * 10;

        let height;
        if (distFromCenter < 400) {
          // Downtown core: very tall skyscrapers
          height = 150 + this.seededRandom(seed + 3) * 250;
          if (tIdx < 200) {
            dummy.position.set(cellX, bh + height / 2, cellZ);
            dummy.scale.set(bw, height, bd);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            towerInstance.setMatrixAt(tIdx++, dummy.matrix);
            if (tgIdx < 200) {
              dummy.scale.set(bw * 1.01, height * 0.96, bd * 1.01);
              dummy.updateMatrix();
              towerGlass.setMatrixAt(tgIdx++, dummy.matrix);
            }
          }
        } else if (distFromCenter < 800) {
          // Inner city: medium-tall
          height = 50 + this.seededRandom(seed + 3) * 80;
          if (iIdx < 300) {
            dummy.position.set(cellX, bh + height / 2, cellZ);
            dummy.scale.set(bw, height, bd);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            innerInstance.setMatrixAt(iIdx++, dummy.matrix);
            if (igIdx < 300 && height > 60) {
              dummy.scale.set(bw * 1.01, height * 0.96, bd * 1.01);
              dummy.updateMatrix();
              innerGlass.setMatrixAt(igIdx++, dummy.matrix);
            }
          }
        } else {
          continue; // Beyond inner city, use neighborhoods below
        }

        _addCollider(cellX, cellZ, bw, bd, bh, height);
      }
    }

    // === NEIGHBORHOODS — grid clusters with wider streets ===
    const neighborhoods = [
      { x: cx - 1400, z: cz - 400 },
      { x: cx - 900, z: cz + 900 },
      { x: cx + 1100, z: cz - 500 },
      { x: cx + 500, z: cz + 1300 },
      { x: cx - 500, z: cz - 1300 },
      { x: cx + 1300, z: cz + 600 },
    ];

    for (const hood of neighborhoods) {
      for (let row = 0; row < 6 && rIdx < 600; row++) {
        for (let col = 0; col < 6 && rIdx < 600; col++) {
          const seed = (rIdx + 82000) * 43.91;
          const bx = hood.x + col * 65 - 150 + (this.seededRandom(seed) - 0.5) * 8;
          const bz = hood.z + row * 65 - 150 + (this.seededRandom(seed + 1) - 0.5) * 8;
          const bh = this.getHeightAt(bx, bz);
          if (bh < WATER_LEVEL + 2) continue;
          if (this.seededRandom(seed + 2) > 0.75) { rIdx++; continue; }

          const width = 30 + this.seededRandom(seed + 3) * 20;
          const height = 15 + this.seededRandom(seed + 4) * 25;
          const depth = 30 + this.seededRandom(seed + 5) * 20;

          dummy.position.set(bx, bh + height / 2, bz);
          dummy.scale.set(width, height, depth);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          residInstance.setMatrixAt(rIdx++, dummy.matrix);
          _addCollider(bx, bz, width, depth, bh, height);
        }
      }
    }

    // === SUBURBAN scatter ===
    for (let i = 0; i < 300 && sIdx < 200; i++) {
      const seed = (i + 83000) * 37.13;
      const angle = this.seededRandom(seed) * Math.PI * 2;
      const dist = 1800 + this.seededRandom(seed + 1) * 800;
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;
      const bh = this.getHeightAt(bx, bz);
      if (bh < WATER_LEVEL + 2 || bh / TERRAIN.MAX_HEIGHT > 0.15) continue;

      const width = 12 + this.seededRandom(seed + 2) * 15;
      const height = 8 + this.seededRandom(seed + 3) * 12;
      const depth = 12 + this.seededRandom(seed + 4) * 15;

      dummy.position.set(bx, bh + height / 2, bz);
      dummy.scale.set(width, height, depth);
      dummy.rotation.set(0, this.seededRandom(seed + 5) * Math.PI, 0);
      dummy.updateMatrix();
      suburbanInstance.setMatrixAt(sIdx++, dummy.matrix);
      _addCollider(bx, bz, width, depth, bh, height);
    }

    towerInstance.count = tIdx;
    towerGlass.count = tgIdx;
    innerInstance.count = iIdx;
    innerGlass.count = igIdx;
    residInstance.count = rIdx;
    suburbanInstance.count = sIdx;

    for (const inst of [towerInstance, towerGlass, innerInstance, innerGlass, residInstance, suburbanInstance]) {
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }
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

        // Highway deck colliders
        const hwColCount = Math.max(3, Math.floor(length / 40));
        for (let c = 0; c <= hwColCount; c++) {
          const t = c / hwColCount;
          const cx = p1.x + dx * t;
          const cz = p1.z + dz * t;
          this.buildingColliders.push({
            x: cx, z: cz,
            radius: 24,
            bottom: deckH - 2,
            top: deckH + 4,
          });
        }

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

          this.buildingColliders.push({
            x: px, z: pz,
            radius: 5,
            bottom: groundH,
            top: deckH,
          });
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

      // Deck colliders along bridge length
      const deckColCount = Math.max(3, Math.floor(length / 35));
      for (let c = 0; c <= deckColCount; c++) {
        const t = c / deckColCount;
        const cx = spot.x1 + dx * t;
        const cz = spot.z1 + dz * t;
        this.buildingColliders.push({
          x: cx, z: cz,
          radius: spot.deckWidth / 2 + 2,
          bottom: deckHeight - 3,
          top: deckHeight + 5,
        });
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

        // Pillar collider
        this.buildingColliders.push({
          x: px, z: pz,
          radius: pw / 2 + 2,
          bottom: groundH,
          top: deckHeight,
        });
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

        this.buildingColliders.push({
          x: ex, z: ez,
          radius: 5,
          bottom: deckHeight,
          top: deckHeight + 65,
        });
      }
    }
  }

  addDesertVillages() {
    const { WATER_LEVEL } = TERRAIN;

    const wallMat = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const wallMat2 = new THREE.MeshLambertMaterial({ color: 0xb89a70 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xa08060 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xd4c4a0 });
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 8);

    const wallInstance = new THREE.InstancedMesh(boxGeom, wallMat, 800);
    const wall2Instance = new THREE.InstancedMesh(boxGeom, wallMat2, 400);
    const roofInstance = new THREE.InstancedMesh(boxGeom, roofMat, 800);
    const darkInstance = new THREE.InstancedMesh(boxGeom, darkMat, 300);
    const towerInstance = new THREE.InstancedMesh(cylGeom, towerMat, 40);
    wallInstance.castShadow = true;
    wall2Instance.castShadow = true;
    towerInstance.castShadow = true;

    const dummy = new THREE.Object3D();
    let wIdx = 0, w2Idx = 0, rIdx = 0, dIdx = 0, twIdx = 0;

    for (let vi = 0; vi < this._villages.length; vi++) {
      const village = this._villages[vi];
      const vx = village.x, vz = village.z;
      const seed0 = (vi + 1) * 347.13;
      const buildingCount = 45 + Math.floor(this.seededRandom(seed0) * 30);
      const villageRadius = 300;

      // === Main buildings ===
      for (let b = 0; b < buildingCount && wIdx < 800; b++) {
        const seed = (wIdx + 70000) * 59.17;
        const angle = this.seededRandom(seed) * Math.PI * 2;
        const dist = 20 + this.seededRandom(seed + 1) * (villageRadius - 30);

        const bx = vx + Math.cos(angle) * dist;
        const bz = vz + Math.sin(angle) * dist;
        const bh = this.getHeightAt(bx, bz);
        if (bh < WATER_LEVEL + 2) continue;

        // Desert buildings: 12-30m wide, 8-25m tall
        const width = 12 + this.seededRandom(seed + 2) * 18;
        const height = 8 + this.seededRandom(seed + 3) * 17;
        const depth = 12 + this.seededRandom(seed + 4) * 18;
        const rotation = Math.floor(this.seededRandom(seed + 5) * 4) * Math.PI / 2;

        dummy.position.set(bx, bh + height / 2, bz);
        dummy.scale.set(width, height, depth);
        dummy.rotation.set(0, rotation, 0);
        dummy.updateMatrix();
        wallInstance.setMatrixAt(wIdx, dummy.matrix);

        // Flat roof parapet
        dummy.position.set(bx, bh + height + 0.8, bz);
        dummy.scale.set(width + 1.5, 1.5, depth + 1.5);
        dummy.updateMatrix();
        roofInstance.setMatrixAt(rIdx++, dummy.matrix);

        wIdx++;

        // Some buildings get a second storey offset
        if (this.seededRandom(seed + 6) > 0.65 && w2Idx < 400) {
          const h2 = 6 + this.seededRandom(seed + 7) * 10;
          const offX = (this.seededRandom(seed + 8) - 0.5) * width * 0.3;
          const offZ = (this.seededRandom(seed + 9) - 0.5) * depth * 0.3;
          dummy.position.set(bx + offX, bh + height + h2 / 2, bz + offZ);
          dummy.scale.set(width * 0.6, h2, depth * 0.6);
          dummy.rotation.set(0, rotation, 0);
          dummy.updateMatrix();
          wall2Instance.setMatrixAt(w2Idx++, dummy.matrix);
        }
      }

      // === Minaret / Watchtower (tall landmark per village) ===
      if (twIdx < 40) {
        const ch = this.getHeightAt(vx, vz);
        const minaretH = 45 + this.seededRandom(seed0 + 10) * 25;
        // Main tower shaft
        dummy.position.set(vx, ch + minaretH / 2, vz);
        dummy.scale.set(4, minaretH, 4);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        towerInstance.setMatrixAt(twIdx++, dummy.matrix);

        // Balcony ring near top
        if (twIdx < 40) {
          dummy.position.set(vx, ch + minaretH * 0.8, vz);
          dummy.scale.set(7, 2, 7);
          dummy.updateMatrix();
          towerInstance.setMatrixAt(twIdx++, dummy.matrix);
        }

        // Dome/cap at top
        if (twIdx < 40) {
          dummy.position.set(vx, ch + minaretH + 3, vz);
          dummy.scale.set(3, 6, 3);
          dummy.updateMatrix();
          towerInstance.setMatrixAt(twIdx++, dummy.matrix);
        }
      }

      // === Secondary watchtower at village edge ===
      if (twIdx < 40) {
        const twAngle = this.seededRandom(seed0 + 20) * Math.PI * 2;
        const twX = vx + Math.cos(twAngle) * villageRadius * 0.8;
        const twZ = vz + Math.sin(twAngle) * villageRadius * 0.8;
        const twH = this.getHeightAt(twX, twZ);
        const guardH = 30 + this.seededRandom(seed0 + 21) * 15;

        dummy.position.set(twX, twH + guardH / 2, twZ);
        dummy.scale.set(5, guardH, 5);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        towerInstance.setMatrixAt(twIdx++, dummy.matrix);

        // Platform
        if (twIdx < 40) {
          dummy.position.set(twX, twH + guardH, twZ);
          dummy.scale.set(8, 2, 8);
          dummy.updateMatrix();
          towerInstance.setMatrixAt(twIdx++, dummy.matrix);
        }
      }

      // === Compound walls (enclosures around village edges) ===
      const wallCount = 5 + Math.floor(this.seededRandom(seed0 + 30) * 4);
      for (let w = 0; w < wallCount && dIdx < 300; w++) {
        const seed = (w + vi * 100 + 71000) * 43.71;
        const wAngle = (w / wallCount) * Math.PI * 2 + this.seededRandom(seed) * 0.5;
        const wDist = villageRadius * (0.5 + this.seededRandom(seed + 1) * 0.5);
        const wx = vx + Math.cos(wAngle) * wDist;
        const wz = vz + Math.sin(wAngle) * wDist;
        const wh = this.getHeightAt(wx, wz);
        const wallLen = 40 + this.seededRandom(seed + 2) * 60;
        const wallHt = 4 + this.seededRandom(seed + 5) * 4;

        dummy.position.set(wx, wh + wallHt / 2, wz);
        dummy.scale.set(2, wallHt, wallLen);
        dummy.rotation.set(0, wAngle + Math.PI / 2, 0);
        dummy.updateMatrix();
        darkInstance.setMatrixAt(dIdx++, dummy.matrix);
      }

      // === Central market / plaza ===
      if (dIdx < 300) {
        const ch = this.getHeightAt(vx + 30, vz + 30);
        // Large canopy
        dummy.position.set(vx + 30, ch + 6, vz + 30);
        dummy.scale.set(25, 0.8, 25);
        dummy.rotation.set(0, 0.3, 0);
        dummy.updateMatrix();
        darkInstance.setMatrixAt(dIdx++, dummy.matrix);

        // Support pillars
        for (const corner of [[-10, -10], [10, -10], [10, 10], [-10, 10]]) {
          if (dIdx >= 300) break;
          dummy.position.set(vx + 30 + corner[0], ch + 3, vz + 30 + corner[1]);
          dummy.scale.set(1, 6, 1);
          dummy.updateMatrix();
          darkInstance.setMatrixAt(dIdx++, dummy.matrix);
        }
      }
    }

    wallInstance.count = wIdx;
    wall2Instance.count = w2Idx;
    roofInstance.count = Math.min(rIdx, 800);
    darkInstance.count = dIdx;
    towerInstance.count = twIdx;
    for (const inst of [wallInstance, wall2Instance, roofInstance, darkInstance, towerInstance]) {
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }
  }

  addMilitaryBase() {
    const { WATER_LEVEL } = TERRAIN;
    const ax = this._airbaseX, az = this._airbaseZ;
    const baseH = Math.max(this.getHeightAt(ax, az), WATER_LEVEL + 2);

    const tarmacMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const markingMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x5588aa });
    const greenMat = new THREE.MeshLambertMaterial({ color: 0x556b2f });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

    // === RUNWAY === 2800m long, 60m wide
    const runwayGeom = new THREE.BoxGeometry(2800, 1, 60);
    const runway = new THREE.Mesh(runwayGeom, tarmacMat);
    runway.position.set(ax, baseH + 0.5, az);
    this.scene.add(runway);

    // Center line dashes
    for (let d = -1350; d < 1350; d += 80) {
      const dashGeom = new THREE.BoxGeometry(40, 1.1, 2);
      const dash = new THREE.Mesh(dashGeom, markingMat);
      dash.position.set(ax + d, baseH + 0.6, az);
      this.scene.add(dash);
    }

    // Runway threshold markings
    for (const endX of [ax - 1350, ax + 1350]) {
      for (let s = -4; s <= 4; s++) {
        const stripeGeom = new THREE.BoxGeometry(40, 1.1, 3);
        const stripe = new THREE.Mesh(stripeGeom, markingMat);
        stripe.position.set(endX, baseH + 0.6, az + s * 6);
        this.scene.add(stripe);
      }
      // Runway numbers
      const numGeom = new THREE.BoxGeometry(15, 1.1, 20);
      const num = new THREE.Mesh(numGeom, markingMat);
      num.position.set(endX + (endX < ax ? 60 : -60), baseH + 0.6, az);
      this.scene.add(num);
    }

    // Edge lines
    for (const side of [-28, 28]) {
      const edgeGeom = new THREE.BoxGeometry(2800, 1.1, 1.5);
      const edge = new THREE.Mesh(edgeGeom, markingMat);
      edge.position.set(ax, baseH + 0.6, az + side);
      this.scene.add(edge);
    }

    // === TAXIWAYS ===
    const taxiways = [
      { x: ax + 200, z: az - 100, w: 700, d: 35 },
      { x: ax - 400, z: az - 100, w: 35, d: 150 },
      { x: ax + 600, z: az - 100, w: 35, d: 150 },
    ];
    for (const tw of taxiways) {
      const tGeom = new THREE.BoxGeometry(tw.w, 1, tw.d);
      const t = new THREE.Mesh(tGeom, tarmacMat);
      t.position.set(tw.x, baseH + 0.5, tw.z);
      this.scene.add(t);
    }

    // === LARGE APRON (parking area) ===
    const apronGeom = new THREE.BoxGeometry(800, 1, 350);
    const apron = new THREE.Mesh(apronGeom, tarmacMat);
    apron.position.set(ax + 100, baseH + 0.5, az - 300);
    this.scene.add(apron);

    // === HANGARS (6 large) ===
    for (let h = 0; h < 6; h++) {
      const hx = ax - 300 + h * 130;
      const hz = az - 520;
      const hangarGeom = new THREE.BoxGeometry(70, 25, 50);
      const hangar = new THREE.Mesh(hangarGeom, metalMat);
      hangar.position.set(hx, baseH + 12.5, hz);
      hangar.castShadow = true;
      this.scene.add(hangar);

      // Arched roof
      const roofGeom = new THREE.BoxGeometry(72, 4, 52);
      const roof = new THREE.Mesh(roofGeom, darkMat);
      roof.position.set(hx, baseH + 26, hz);
      this.scene.add(roof);

      // Front door
      const doorGeom = new THREE.BoxGeometry(55, 20, 1);
      const door = new THREE.Mesh(doorGeom, darkMat);
      door.position.set(hx, baseH + 10, hz + 25.5);
      this.scene.add(door);

      // Hangar collider
      this.buildingColliders.push({
        x: hx, z: hz,
        radius: 42,
        bottom: baseH,
        top: baseH + 28,
      });
    }

    // === CONTROL TOWER ===
    const towerH = 55;
    const towerGeom = new THREE.BoxGeometry(14, towerH, 14);
    const tower = new THREE.Mesh(towerGeom, concreteMat);
    tower.position.set(ax + 600, baseH + towerH / 2, az - 400);
    tower.castShadow = true;
    this.scene.add(tower);

    const cabGeom = new THREE.BoxGeometry(20, 10, 20);
    const cab = new THREE.Mesh(cabGeom, glassMat);
    cab.position.set(ax + 600, baseH + towerH + 5, az - 400);
    this.scene.add(cab);

    // Tower collider
    this.buildingColliders.push({
      x: ax + 600, z: az - 400,
      radius: 12,
      bottom: baseH,
      top: baseH + towerH + 16,
    });

    // Roof overhang
    const overhangGeom = new THREE.BoxGeometry(24, 1.5, 24);
    const overhang = new THREE.Mesh(overhangGeom, concreteMat);
    overhang.position.set(ax + 600, baseH + towerH + 10.5, az - 400);
    this.scene.add(overhang);

    // Radar on tower
    const radarGeom = new THREE.SphereGeometry(5, 10, 8);
    const radar = new THREE.Mesh(radarGeom, new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
    radar.position.set(ax + 600, baseH + towerH + 16, az - 400);
    this.scene.add(radar);

    // === BARRACKS (4 long buildings) ===
    for (let b = 0; b < 4; b++) {
      const bx = ax - 600 + b * 70;
      const bz = az - 350;
      const barracksGeom = new THREE.BoxGeometry(50, 10, 80);
      const barracks = new THREE.Mesh(barracksGeom, concreteMat);
      barracks.position.set(bx, baseH + 5, bz);
      barracks.castShadow = true;
      this.scene.add(barracks);

      // Flat roof detail
      const roofGeom = new THREE.BoxGeometry(52, 1, 82);
      const roof = new THREE.Mesh(roofGeom, darkMat);
      roof.position.set(bx, baseH + 10.5, bz);
      this.scene.add(roof);

      // Barracks collider
      this.buildingColliders.push({
        x: bx, z: bz,
        radius: 47,
        bottom: baseH,
        top: baseH + 12,
      });
    }

    // === SAM SITE ===
    const samX = ax - 800, samZ = az + 200;
    // Radar dish
    const samRadarGeom = new THREE.CylinderGeometry(0.5, 0.5, 20, 6);
    const samMast = new THREE.Mesh(samRadarGeom, fenceMat);
    samMast.position.set(samX, baseH + 10, samZ);
    this.scene.add(samMast);

    const samDishGeom = new THREE.BoxGeometry(12, 8, 2);
    const samDish = new THREE.Mesh(samDishGeom, fenceMat);
    samDish.position.set(samX, baseH + 22, samZ);
    this.scene.add(samDish);

    // Launcher rails
    for (let l = 0; l < 4; l++) {
      const lAngle = (l / 4) * Math.PI * 2;
      const lx = samX + Math.cos(lAngle) * 25;
      const lz = samZ + Math.sin(lAngle) * 25;
      const launcherGeom = new THREE.BoxGeometry(3, 3, 10);
      const launcher = new THREE.Mesh(launcherGeom, greenMat);
      launcher.position.set(lx, baseH + 3, lz);
      launcher.rotation.set(-0.5, lAngle, 0);
      launcher.castShadow = true;
      this.scene.add(launcher);
    }

    // === FUEL DEPOT (6 large tanks) ===
    const fuelGeom = new THREE.CylinderGeometry(10, 10, 18, 12);
    for (let f = 0; f < 6; f++) {
      const fx = ax - 700 + (f % 3) * 40;
      const fz = az - 150 + Math.floor(f / 3) * 40;
      const fuel = new THREE.Mesh(fuelGeom, new THREE.MeshLambertMaterial({ color: 0x888888 }));
      fuel.position.set(fx, baseH + 9, fz);
      fuel.castShadow = true;
      this.scene.add(fuel);
    }

    // === PERIMETER WALL / FENCE ===
    const perimeterPoints = [
      { x: ax - 900, z: az + 100 },
      { x: ax + 800, z: az + 100 },
      { x: ax + 800, z: az - 600 },
      { x: ax - 900, z: az - 600 },
    ];
    for (let p = 0; p < perimeterPoints.length; p++) {
      const p1 = perimeterPoints[p];
      const p2 = perimeterPoints[(p + 1) % perimeterPoints.length];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const mx = (p1.x + p2.x) / 2, mz = (p1.z + p2.z) / 2;

      const wallGeom = new THREE.BoxGeometry(1.5, 6, len);
      const wall = new THREE.Mesh(wallGeom, fenceMat);
      wall.position.set(mx, baseH + 3, mz);
      wall.rotation.y = angle;
      this.scene.add(wall);
    }

    // === GUARD TOWERS at corners ===
    for (const corner of perimeterPoints) {
      const gtGeom = new THREE.BoxGeometry(5, 18, 5);
      const gt = new THREE.Mesh(gtGeom, concreteMat);
      gt.position.set(corner.x, baseH + 9, corner.z);
      gt.castShadow = true;
      this.scene.add(gt);

      // Platform
      const platGeom = new THREE.BoxGeometry(8, 1.5, 8);
      const plat = new THREE.Mesh(platGeom, concreteMat);
      plat.position.set(corner.x, baseH + 18.5, corner.z);
      this.scene.add(plat);
    }

    // === MILITARY VEHICLES (boxes on the apron) ===
    for (let v = 0; v < 15; v++) {
      const seed = (v + 95000) * 31.17;
      const vx = ax - 200 + this.seededRandom(seed) * 600;
      const vz = az - 200 - this.seededRandom(seed + 1) * 250;
      // Truck shape
      const truckGeom = new THREE.BoxGeometry(
        4 + this.seededRandom(seed + 2) * 4,
        3 + this.seededRandom(seed + 3) * 3,
        8 + this.seededRandom(seed + 4) * 6
      );
      const truck = new THREE.Mesh(truckGeom, greenMat);
      truck.position.set(vx, baseH + 2, vz);
      truck.rotation.y = this.seededRandom(seed + 5) * Math.PI;
      this.scene.add(truck);
    }

    // === CRATE STACKS ===
    for (let c = 0; c < 10; c++) {
      const seed = (c + 96000) * 47.13;
      const cx = ax - 400 + this.seededRandom(seed) * 800;
      const cz = az - 250 - this.seededRandom(seed + 1) * 300;
      for (let s = 0; s < 2 + Math.floor(this.seededRandom(seed + 2) * 3); s++) {
        const crateGeom = new THREE.BoxGeometry(6, 5, 6);
        const crate = new THREE.Mesh(crateGeom, greenMat);
        crate.position.set(cx + (this.seededRandom(seed + 3 + s) - 0.5) * 4, baseH + 2.5 + s * 5, cz);
        this.scene.add(crate);
      }
    }

    // === PLANE PROP POSITIONS (10 planes scattered on apron + runway edges) ===
    const propSpots = [
      { x: ax + 100, z: az - 200, heading: Math.PI * 0.5 },
      { x: ax + 250, z: az - 200, heading: Math.PI * 0.5 },
      { x: ax + 400, z: az - 250, heading: Math.PI * 0.3 },
      { x: ax - 50, z: az - 180, heading: -Math.PI * 0.5 },
      { x: ax + 150, z: az - 320, heading: Math.PI * 0.7 },
      { x: ax - 200, z: az + 30, heading: 0 },
      { x: ax + 550, z: az - 200, heading: Math.PI * 0.4 },
      { x: ax - 100, z: az - 280, heading: Math.PI },
      { x: ax + 300, z: az - 380, heading: -Math.PI * 0.3 },
      { x: ax - 300, z: az + 25, heading: Math.PI * 0.1 },
    ];

    for (const spot of propSpots) {
      this.propPositions.push({
        x: spot.x,
        y: baseH + 2,
        z: spot.z,
        heading: spot.heading,
      });
    }
  }

  addDesertFeatures() {
    const { SIZE, MAX_HEIGHT, WATER_LEVEL } = TERRAIN;

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    const rockMat2 = new THREE.MeshLambertMaterial({ color: 0x7a4a22 });
    const steelMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    const rustMat = new THREE.MeshLambertMaterial({ color: 0x885533 });
    const ruinMat = new THREE.MeshLambertMaterial({ color: 0xb8a882 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const roadMat = new THREE.MeshLambertMaterial({
      color: 0x3a3530,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 6);

    // Helpers to check if position is in an exclusion zone
    const isExcluded = (x, z) => {
      const cd = Math.sqrt((x - this._cityX) ** 2 + (z - this._cityZ) ** 2);
      if (cd < 2000) return true;
      const nd = Math.sqrt((x - this._navalX) ** 2 + (z - this._navalZ) ** 2);
      if (nd < 800) return true;
      if (Math.abs(x - this._airbaseX) < 1900 && Math.abs(z - (this._airbaseZ - 200)) < 800) return true;
      const od = Math.sqrt((x - this._oasisX) ** 2 + (z - this._oasisZ) ** 2);
      if (od < 500) return true;
      if (z > 2200) return true; // ocean
      return false;
    };

    // === ROCK SPIRES / MONOLITHS ===
    // Tall dramatic rocks scattered across the desert
    const rockInstance = new THREE.InstancedMesh(boxGeom, rockMat, 200);
    const rock2Instance = new THREE.InstancedMesh(boxGeom, rockMat2, 200);
    rockInstance.castShadow = true;
    rock2Instance.castShadow = true;

    const dummy = new THREE.Object3D();
    let rIdx = 0, r2Idx = 0;

    for (let i = 0; i < 120; i++) {
      const seed = (i + 60000) * 73.91;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.8;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.8;
      if (isExcluded(x, z)) continue;

      const h = this.getHeightAt(x, z);
      const nh = h / MAX_HEIGHT;
      if (h < WATER_LEVEL + 5 || nh < 0.04) continue;

      // Tall spire
      const spireH = 25 + this.seededRandom(seed + 2) * 80;
      const spireW = 6 + this.seededRandom(seed + 3) * 15;
      const spireD = 6 + this.seededRandom(seed + 4) * 12;

      if (rIdx < 200) {
        dummy.position.set(x, h + spireH / 2, z);
        dummy.scale.set(spireW, spireH, spireD);
        dummy.rotation.set(
          (this.seededRandom(seed + 5) - 0.5) * 0.15,
          this.seededRandom(seed + 6) * Math.PI,
          (this.seededRandom(seed + 7) - 0.5) * 0.1
        );
        dummy.updateMatrix();
        rockInstance.setMatrixAt(rIdx++, dummy.matrix);
      }

      // Smaller rocks at base
      for (let r = 0; r < 3 && r2Idx < 200; r++) {
        const rs = (r + 1) * 11.37 + seed;
        const rx = x + (this.seededRandom(rs) - 0.5) * spireW * 2;
        const rz = z + (this.seededRandom(rs + 1) - 0.5) * spireD * 2;
        const rh = this.getHeightAt(rx, rz);
        const boulderH = 5 + this.seededRandom(rs + 2) * 15;

        dummy.position.set(rx, rh + boulderH / 2, rz);
        dummy.scale.set(
          5 + this.seededRandom(rs + 3) * 10,
          boulderH,
          5 + this.seededRandom(rs + 4) * 10
        );
        dummy.rotation.set(0, this.seededRandom(rs + 5) * Math.PI, 0);
        dummy.updateMatrix();
        rock2Instance.setMatrixAt(r2Idx++, dummy.matrix);
      }
    }

    rockInstance.count = rIdx;
    rock2Instance.count = r2Idx;
    rockInstance.instanceMatrix.needsUpdate = true;
    rock2Instance.instanceMatrix.needsUpdate = true;
    this.scene.add(rockInstance);
    this.scene.add(rock2Instance);

    // === COMMUNICATION TOWERS ===
    for (let i = 0; i < 18; i++) {
      const seed = (i + 61000) * 53.17;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.75;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.75;
      if (isExcluded(x, z)) continue;

      const h = this.getHeightAt(x, z);
      if (h < WATER_LEVEL + 5) continue;

      const towerH = 50 + this.seededRandom(seed + 2) * 50;

      // Lattice tower (tapered cylinder)
      const towerGeom = new THREE.CylinderGeometry(1, 3, towerH, 4);
      const tower = new THREE.Mesh(towerGeom, steelMat);
      tower.position.set(x, h + towerH / 2, z);
      tower.castShadow = true;
      this.scene.add(tower);

      // Cross-beams at intervals
      for (let b = 0; b < 4; b++) {
        const by = h + towerH * 0.2 + (b / 4) * towerH * 0.7;
        const beamW = 3 - b * 0.5;
        const beamGeom = new THREE.BoxGeometry(beamW * 2, 0.5, beamW * 2);
        const beam = new THREE.Mesh(beamGeom, steelMat);
        beam.position.set(x, by, z);
        beam.rotation.y = b * Math.PI / 4;
        this.scene.add(beam);
      }

      // Antenna at top
      const antennaGeom = new THREE.CylinderGeometry(0.2, 0.2, 15, 4);
      const antenna = new THREE.Mesh(antennaGeom, steelMat);
      antenna.position.set(x, h + towerH + 7.5, z);
      this.scene.add(antenna);

      // Red warning light
      const lightGeom = new THREE.SphereGeometry(0.8, 6, 6);
      const light = new THREE.Mesh(lightGeom, new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x551111 }));
      light.position.set(x, h + towerH + 16, z);
      this.scene.add(light);

      // Equipment shed at base
      const shedGeom = new THREE.BoxGeometry(6, 4, 8);
      const shed = new THREE.Mesh(shedGeom, steelMat);
      shed.position.set(x + 5, h + 2, z);
      this.scene.add(shed);
    }

    // === OIL DERRICKS / PUMP JACKS ===
    for (let i = 0; i < 12; i++) {
      const seed = (i + 62000) * 41.31;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.7;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.7;
      if (isExcluded(x, z)) continue;

      const h = this.getHeightAt(x, z);
      const nh = h / MAX_HEIGHT;
      if (h < WATER_LEVEL + 5 || nh > 0.4) continue;

      // Derrick frame (tall pyramid-ish)
      const derrickH = 35 + this.seededRandom(seed + 2) * 20;
      const derrickGeom = new THREE.CylinderGeometry(1.5, 5, derrickH, 4);
      const derrick = new THREE.Mesh(derrickGeom, rustMat);
      derrick.position.set(x, h + derrickH / 2, z);
      derrick.castShadow = true;
      this.scene.add(derrick);

      // Pump head (beam)
      const pumpGeom = new THREE.BoxGeometry(15, 2, 3);
      const pump = new THREE.Mesh(pumpGeom, darkMat);
      pump.position.set(x + 8, h + 8, z);
      pump.rotation.z = -0.2;
      this.scene.add(pump);

      // Support A-frame
      const aFrameGeom = new THREE.BoxGeometry(2, 10, 2);
      const aFrame = new THREE.Mesh(aFrameGeom, rustMat);
      aFrame.position.set(x + 2, h + 5, z);
      this.scene.add(aFrame);

      // Oil tank nearby
      const tankGeom = new THREE.CylinderGeometry(5, 5, 8, 10);
      const tank = new THREE.Mesh(tankGeom, darkMat);
      tank.position.set(x - 12, h + 4, z + 8);
      tank.castShadow = true;
      this.scene.add(tank);

      // Pipe from derrick to tank
      const pipeGeom = new THREE.CylinderGeometry(0.4, 0.4, 15, 6);
      const pipe = new THREE.Mesh(pipeGeom, rustMat);
      pipe.position.set(x - 6, h + 2, z + 4);
      pipe.rotation.z = Math.PI / 2;
      this.scene.add(pipe);
    }

    // === ANCIENT RUINS ===
    const ruinInstance = new THREE.InstancedMesh(cylGeom, ruinMat, 150);
    const ruinBoxInstance = new THREE.InstancedMesh(boxGeom, ruinMat, 100);
    ruinInstance.castShadow = true;
    let ruIdx = 0, rubIdx = 0;

    const ruinSites = [
      { x: -500, z: -3000 },
      { x: 1500, z: -3500 },
      { x: -2500, z: -3500 },
      { x: 3000, z: -1000 },
      { x: -3500, z: -500 },
      { x: 500, z: -5000 },
      { x: -1800, z: -3000 },
      { x: 2000, z: -4000 },
    ];

    for (const site of ruinSites) {
      const sh = this.getHeightAt(site.x, site.z);
      if (sh < WATER_LEVEL + 3) continue;
      if (isExcluded(site.x, site.z)) continue;

      const seed = (site.x * 7 + site.z * 13 + 63000);

      // Columns in a rough circle
      const colCount = 6 + Math.floor(this.seededRandom(seed) * 8);
      const radius = 20 + this.seededRandom(seed + 1) * 30;

      for (let c = 0; c < colCount && ruIdx < 150; c++) {
        const cAngle = (c / colCount) * Math.PI * 2 + this.seededRandom(seed + c + 10) * 0.3;
        const cx = site.x + Math.cos(cAngle) * radius;
        const cz = site.z + Math.sin(cAngle) * radius;
        const ch = this.getHeightAt(cx, cz);

        // Some columns broken (shorter)
        const broken = this.seededRandom(seed + c + 20) > 0.5;
        const colH = broken ? 5 + this.seededRandom(seed + c + 21) * 12 : 15 + this.seededRandom(seed + c + 22) * 15;

        dummy.position.set(cx, ch + colH / 2, cz);
        dummy.scale.set(2, colH, 2);
        dummy.rotation.set(
          broken ? (this.seededRandom(seed + c + 23) - 0.5) * 0.3 : 0,
          0,
          broken ? (this.seededRandom(seed + c + 24) - 0.5) * 0.2 : 0
        );
        dummy.updateMatrix();
        ruinInstance.setMatrixAt(ruIdx++, dummy.matrix);
      }

      // Fallen stone blocks
      for (let b = 0; b < 5 && rubIdx < 100; b++) {
        const bs = seed + b * 7 + 50;
        const bx = site.x + (this.seededRandom(bs) - 0.5) * radius * 2;
        const bz = site.z + (this.seededRandom(bs + 1) - 0.5) * radius * 2;
        const bh = this.getHeightAt(bx, bz);
        dummy.position.set(bx, bh + 1.5, bz);
        dummy.scale.set(
          3 + this.seededRandom(bs + 2) * 8,
          2 + this.seededRandom(bs + 3) * 3,
          3 + this.seededRandom(bs + 4) * 8
        );
        dummy.rotation.set(0, this.seededRandom(bs + 5) * Math.PI, 0);
        dummy.updateMatrix();
        ruinBoxInstance.setMatrixAt(rubIdx++, dummy.matrix);
      }

      // Central altar / foundation
      if (rubIdx < 100) {
        dummy.position.set(site.x, sh + 1.5, site.z);
        dummy.scale.set(radius * 0.8, 3, radius * 0.8);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        ruinBoxInstance.setMatrixAt(rubIdx++, dummy.matrix);
      }
    }

    ruinInstance.count = ruIdx;
    ruinBoxInstance.count = rubIdx;
    ruinInstance.instanceMatrix.needsUpdate = true;
    ruinBoxInstance.instanceMatrix.needsUpdate = true;
    this.scene.add(ruinInstance);
    this.scene.add(ruinBoxInstance);

    // === DESERT OUTPOSTS (small fortified compounds) ===
    const outposts = [
      { x: 0, z: -1500 },
      { x: -2000, z: -3000 },
      { x: 1500, z: -1800 },
      { x: -500, z: -2800 },
      { x: 3000, z: -2500 },
      { x: -3500, z: -1000 },
    ];

    const outpostWallMat = new THREE.MeshLambertMaterial({ color: 0xc0a878 });
    const outpostDarkMat = new THREE.MeshLambertMaterial({ color: 0x888070 });

    for (const op of outposts) {
      const oh = this.getHeightAt(op.x, op.z);
      if (oh < WATER_LEVEL + 3 || isExcluded(op.x, op.z)) continue;

      // Perimeter wall (square compound, ~80m across)
      const wallH = 6;
      const wallSize = 40;
      for (const [dx, dz, w, d] of [
        [0, -wallSize, wallSize * 2, 2],
        [0, wallSize, wallSize * 2, 2],
        [-wallSize, 0, 2, wallSize * 2],
        [wallSize, 0, 2, wallSize * 2],
      ]) {
        const wg = new THREE.BoxGeometry(w, wallH, d);
        const wm = new THREE.Mesh(wg, outpostWallMat);
        wm.position.set(op.x + dx, oh + wallH / 2, op.z + dz);
        wm.castShadow = true;
        this.scene.add(wm);
      }

      // 2-3 buildings inside
      for (let b = 0; b < 3; b++) {
        const bSeed = (op.x * 3 + op.z * 7 + b * 111);
        const bw = 12 + this.seededRandom(bSeed) * 10;
        const bh = 6 + this.seededRandom(bSeed + 1) * 8;
        const bd = 12 + this.seededRandom(bSeed + 2) * 10;
        const bx = op.x + (this.seededRandom(bSeed + 3) - 0.5) * 50;
        const bz = op.z + (this.seededRandom(bSeed + 4) - 0.5) * 50;

        const bg = new THREE.BoxGeometry(bw, bh, bd);
        const bm = new THREE.Mesh(bg, outpostWallMat);
        bm.position.set(bx, oh + bh / 2, bz);
        bm.castShadow = true;
        this.scene.add(bm);
      }

      // Guard tower at one corner
      const gtGeom = new THREE.BoxGeometry(4, 15, 4);
      const gt = new THREE.Mesh(gtGeom, outpostDarkMat);
      gt.position.set(op.x + wallSize, oh + 7.5, op.z + wallSize);
      gt.castShadow = true;
      this.scene.add(gt);

      const platGeom = new THREE.BoxGeometry(7, 1, 7);
      const plat = new THREE.Mesh(platGeom, outpostDarkMat);
      plat.position.set(op.x + wallSize, oh + 15.5, op.z + wallSize);
      this.scene.add(plat);
    }

    // === DESERT ROADS connecting major locations ===
    const roadRoutes = [
      // Oasis to nearest village
      [{ x: this._oasisX, z: this._oasisZ }, { x: -1500, z: -700 }],
      // Village chain
      [{ x: -1500, z: -700 }, { x: -1000, z: -2200 }],
      [{ x: -1000, z: -2200 }, { x: 800, z: -2500 }],
      // Airbase road to nearby village
      [{ x: this._airbaseX + 800, z: this._airbaseZ }, { x: -1000, z: -2200 }],
      // Road toward city from central desert
      [{ x: 800, z: -2500 }, { x: 2500, z: -1800 }],
      // City approach road
      [{ x: this._cityX - 800, z: this._cityZ - 800 }, { x: 500, z: -200 }],
      [{ x: 500, z: -200 }, { x: -500, z: -700 }],
      // Far north connection
      [{ x: -1000, z: -2200 }, { x: -500, z: -4000 }],
      // Eastern branch
      [{ x: 2500, z: -1800 }, { x: 3000, z: -1000 }],
      // Airbase to far north village
      [{ x: this._airbaseX, z: this._airbaseZ - 300 }, { x: -500, z: -4000 }],
    ];

    const roadWidth = 14;
    for (const route of roadRoutes) {
      const p1 = route[0], p2 = route[1];
      const rdx = p2.x - p1.x, rdz = p2.z - p1.z;
      const length = Math.sqrt(rdx * rdx + rdz * rdz);
      // Perpendicular direction for road width
      const perpX = -rdz / length, perpZ = rdx / length;

      const segCount = Math.max(8, Math.floor(length / 20));
      const vertices = [];
      const indices = [];
      let validCount = 0;

      for (let s = 0; s <= segCount; s++) {
        const t = s / segCount;
        const cx = p1.x + rdx * t;
        const cz = p1.z + rdz * t;
        const ch = this.getHeightAt(cx, cz);

        if (ch < WATER_LEVEL + 1) {
          // Mark as underwater — we'll handle gaps
          vertices.push(cx + perpX * roadWidth * 0.5, ch + 1.5, cz + perpZ * roadWidth * 0.5);
          vertices.push(cx - perpX * roadWidth * 0.5, ch + 1.5, cz - perpZ * roadWidth * 0.5);
          validCount++;
          continue;
        }

        const lx = cx + perpX * roadWidth * 0.5;
        const lz = cz + perpZ * roadWidth * 0.5;
        const rx = cx - perpX * roadWidth * 0.5;
        const rz = cz - perpZ * roadWidth * 0.5;
        const lh = this.getHeightAt(lx, lz);
        const rh = this.getHeightAt(rx, rz);

        vertices.push(lx, lh + 1.5, lz);
        vertices.push(rx, rh + 1.5, rz);
        validCount++;
      }

      // Build triangle strip indices
      for (let s = 0; s < validCount - 1; s++) {
        const i = s * 2;
        indices.push(i, i + 1, i + 2);
        indices.push(i + 1, i + 3, i + 2);
      }

      if (indices.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();
        const roadMesh = new THREE.Mesh(geom, roadMat);
        roadMesh.receiveShadow = true;
        this.scene.add(roadMesh);
      }
    }

    // === POWER LINE PYLONS along some roads ===
    const pylonRoute = roadRoutes[3]; // airbase to village
    if (pylonRoute) {
      const p1 = pylonRoute[0], p2 = pylonRoute[1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      const pylonCount = Math.floor(length / 200);

      for (let p = 0; p <= pylonCount; p++) {
        const t = p / pylonCount;
        const px = p1.x + dx * t + 30; // offset from road
        const pz = p1.z + dz * t + 30;
        const ph = this.getHeightAt(px, pz);
        if (ph < WATER_LEVEL + 3) continue;

        // Pylon
        const pylonGeom = new THREE.CylinderGeometry(0.5, 1, 30, 4);
        const pylon = new THREE.Mesh(pylonGeom, steelMat);
        pylon.position.set(px, ph + 15, pz);
        pylon.castShadow = true;
        this.scene.add(pylon);

        // Cross-arm
        const armGeom = new THREE.BoxGeometry(18, 1, 1);
        const arm = new THREE.Mesh(armGeom, steelMat);
        arm.position.set(px, ph + 28, pz);
        this.scene.add(arm);
      }
    }

    // === WIND TURBINES on mesa tops ===
    for (let i = 0; i < 8; i++) {
      const seed = (i + 64000) * 67.31;
      const x = (this.seededRandom(seed) - 0.5) * SIZE * 0.6;
      const z = (this.seededRandom(seed + 1) - 0.5) * SIZE * 0.6;
      if (isExcluded(x, z)) continue;

      const h = this.getHeightAt(x, z);
      const nh = h / MAX_HEIGHT;
      if (nh < 0.5 || nh > 0.7) continue; // Only on mesa tops

      const hubH = 60 + this.seededRandom(seed + 2) * 20;

      // Tower
      const towerGeom = new THREE.CylinderGeometry(1.5, 3, hubH, 8);
      const tower = new THREE.Mesh(towerGeom, new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
      tower.position.set(x, h + hubH / 2, z);
      tower.castShadow = true;
      this.scene.add(tower);

      // Hub
      const hubGeom = new THREE.SphereGeometry(2.5, 8, 6);
      const hub = new THREE.Mesh(hubGeom, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      hub.position.set(x, h + hubH + 2, z);
      this.scene.add(hub);

      // Blades (3)
      for (let b = 0; b < 3; b++) {
        const bladeAngle = (b / 3) * Math.PI * 2 + this.seededRandom(seed + 3) * Math.PI;
        const bladeLen = 25;
        const bladeGeom = new THREE.BoxGeometry(2, bladeLen, 0.5);
        const blade = new THREE.Mesh(bladeGeom, new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
        blade.position.set(
          x + Math.sin(bladeAngle) * bladeLen / 2,
          h + hubH + 2 + Math.cos(bladeAngle) * bladeLen / 2,
          z + 3
        );
        blade.rotation.z = -bladeAngle;
        this.scene.add(blade);
      }
    }
  }

  checkBuildingCollision(position) {
    // 3D tile maps: delegate to MapManager for collision
    if (this.is3DTileMap && this.mapManager) {
      return this.mapManager.checkBuildingCollision(position);
    }
    for (const c of this.buildingColliders) {
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      if (dist2D < c.radius && position.y > c.bottom && position.y < c.top) {
        return true;
      }
    }
    return false;
  }

  getHeightAt(x, z) {
    // 3D tile maps: delegate to MapManager for height
    if (this.is3DTileMap && this.mapManager) {
      return this.mapManager.getHeightAt(x, z);
    }
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
    // 3D tile maps: delegate to MapManager for collision
    if (this.is3DTileMap && this.mapManager) {
      return this.mapManager.checkCollision(position);
    }
    const terrainHeight = this.getHeightAt(position.x, position.z);
    return position.y < terrainHeight + TERRAIN.COLLISION_MARGIN;
  }
}
