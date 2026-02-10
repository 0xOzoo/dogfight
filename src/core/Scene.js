import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CAMERA, WORLD } from '../config.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Scene
    this.scene = new THREE.Scene();

    // Fog
    this.scene.fog = new THREE.FogExp2(0x8899bb, 0.00008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR
    );
    this.camera.position.set(0, CAMERA.CHASE_HEIGHT, CAMERA.CHASE_DISTANCE);

    // Lights
    this.setupLights();

    // Post-processing
    this.setupPostProcessing();

    // Resize handler
    window.addEventListener('resize', () => this.onResize());
  }

  setupLights() {
    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x6688cc, WORLD.AMBIENT_INTENSITY);
    this.scene.add(this.ambientLight);

    // Sun (directional light)
    const sunElevRad = THREE.MathUtils.degToRad(WORLD.SUN_ELEVATION);
    const sunAzRad = THREE.MathUtils.degToRad(WORLD.SUN_AZIMUTH);
    const sunDist = 10000;

    this.sunLight = new THREE.DirectionalLight(0xffeedd, WORLD.SUN_INTENSITY);
    this.sunLight.position.set(
      Math.cos(sunAzRad) * Math.cos(sunElevRad) * sunDist,
      Math.sin(sunElevRad) * sunDist,
      Math.sin(sunAzRad) * Math.cos(sunElevRad) * sunDist
    );
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 15000;
    this.sunLight.shadow.camera.left = -500;
    this.sunLight.shadow.camera.right = 500;
    this.sunLight.shadow.camera.top = 500;
    this.sunLight.shadow.camera.bottom = -500;
    this.scene.add(this.sunLight);

    // Hemisphere light for sky/ground color bleed
    this.hemiLight = new THREE.HemisphereLight(0x88aaff, 0x445522, 0.3);
    this.scene.add(this.hemiLight);
  }

  setupPostProcessing() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.composer = new EffectComposer(this.renderer);

    // Scene render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // GTAO (Ground Truth Ambient Occlusion)
    this.gtaoPass = new GTAOPass(
      this.scene,
      this.camera,
      width,
      height,
      {
        // render parameters — use default normal source
      },
      {
        // AO parameters
        radius: 3,
        distanceExponent: 2,
        thickness: 5,
        scale: 1.0,
        samples: 16,
        distanceFallOff: 1.0,
      },
      {
        // Poisson denoise parameters
        rings: 2,
        radiusExponent: 2,
        samples: 16,
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
      }
    );
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.blendIntensity = 1.0;

    // Override visibility to also exclude objects tagged with excludeAO
    const origOverride = this.gtaoPass.overrideVisibility.bind(this.gtaoPass);
    this.gtaoPass.overrideVisibility = () => {
      origOverride();
      this.scene.traverse((object) => {
        if (object.userData && object.userData.excludeAO) {
          object.visible = false;
        }
      });
    };

    this.composer.addPass(this.gtaoPass);

    // Output pass (tone mapping + sRGB conversion)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }
}
