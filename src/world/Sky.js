import * as THREE from 'three';
import { WORLD, TERRAIN } from '../config.js';

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.createSkyDome();
  }

  createSkyDome() {
    // Large sphere for sky
    const geometry = new THREE.SphereGeometry(TERRAIN.SIZE * 0.9, 32, 32);
    // Flip normals inward
    geometry.scale(-1, 1, -1);

    // Custom shader material for atmospheric gradient
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirection: {
          value: new THREE.Vector3(
            Math.cos(THREE.MathUtils.degToRad(WORLD.SUN_AZIMUTH)) * Math.cos(THREE.MathUtils.degToRad(WORLD.SUN_ELEVATION)),
            Math.sin(THREE.MathUtils.degToRad(WORLD.SUN_ELEVATION)),
            Math.sin(THREE.MathUtils.degToRad(WORLD.SUN_AZIMUTH)) * Math.cos(THREE.MathUtils.degToRad(WORLD.SUN_ELEVATION))
          ).normalize()
        },
        uTopColor: { value: new THREE.Color(0x0044aa) },
        uHorizonColor: { value: new THREE.Color(0x88aacc) },
        uSunColor: { value: new THREE.Color(0xffeecc) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDirection;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float elevation = dir.y;

          // Sky gradient
          float t = max(0.0, elevation);
          vec3 sky = mix(uHorizonColor, uTopColor, pow(t, 0.5));

          // Sun glow
          float sunDot = max(0.0, dot(dir, uSunDirection));
          float sunGlow = pow(sunDot, 64.0);
          float sunHalo = pow(sunDot, 8.0) * 0.3;

          sky += uSunColor * (sunGlow + sunHalo);

          // Below horizon
          if (elevation < 0.0) {
            vec3 groundColor = vec3(0.3, 0.35, 0.3);
            sky = mix(uHorizonColor, groundColor, min(1.0, -elevation * 5.0));
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.skyMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.skyMesh);

    // Sun disc (sprite)
    const sunElevRad = THREE.MathUtils.degToRad(WORLD.SUN_ELEVATION);
    const sunAzRad = THREE.MathUtils.degToRad(WORLD.SUN_AZIMUTH);
    const sunDist = TERRAIN.SIZE * 0.8;

    const sunTexture = this.createSunTexture();
    const sunMaterial = new THREE.SpriteMaterial({
      map: sunTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.sun = new THREE.Sprite(sunMaterial);
    this.sun.scale.set(800, 800, 1);
    this.sunOffset = new THREE.Vector3(
      Math.cos(sunAzRad) * Math.cos(sunElevRad) * sunDist,
      Math.sin(sunElevRad) * sunDist,
      Math.sin(sunAzRad) * Math.cos(sunElevRad) * sunDist
    );
    this.sun.position.copy(this.sunOffset);
    this.scene.add(this.sun);
  }

  createSunTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 240, 200, 1.0)');
    gradient.addColorStop(0.1, 'rgba(255, 220, 150, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 180, 80, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 150, 50, 0.0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  update(cameraPosition) {
    // Keep sky centered on camera
    this.skyMesh.position.copy(cameraPosition);
    this.sun.position.set(
      cameraPosition.x + this.sunOffset.x,
      this.sunOffset.y,
      cameraPosition.z + this.sunOffset.z
    );
  }
}
