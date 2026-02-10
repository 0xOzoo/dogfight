import * as THREE from 'three';

export class LobbyPreview {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.running = false;
    this.currentModel = null;
    this.animFrameId = null;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.updateSize();

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(35, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 100);
    this.camera.position.set(0, 2, 6);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0x88aacc, 0.6);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    keyLight.position.set(3, 4, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    // Rotation pivot
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.rotationSpeed = 0.5; // rad/s

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this.updateSize());
    this._resizeObserver.observe(this.canvas.parentElement);

    this.clock = new THREE.Clock();
  }

  updateSize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  setModel(modelTemplate) {
    // Remove previous model
    if (this.currentModel) {
      this.pivot.remove(this.currentModel);
      this.currentModel = null;
    }

    if (!modelTemplate) return;

    const model = modelTemplate.clone();

    // Preview uses NO game rotation — models are displayed in their native orientation
    // which typically has top=+Y from the authoring tool, correct for the turntable view
    const wrapper = new THREE.Group();
    wrapper.add(model);

    // Fix face winding
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { m.side = THREE.DoubleSide; });
      }
    });

    // Compute bounding box to center and scale the model
    const box = new THREE.Box3().setFromObject(wrapper);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Normalize to roughly fit in view
    const desiredSize = 3.5;
    const s = maxDim > 0 ? desiredSize / maxDim : 1;
    wrapper.scale.set(s, s, s);

    // Re-center after scale
    const box2 = new THREE.Box3().setFromObject(wrapper);
    const center2 = box2.getCenter(new THREE.Vector3());
    wrapper.position.sub(center2);

    this.pivot.add(wrapper);
    this.currentModel = wrapper;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animate();
  }

  stop() {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  animate() {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(() => this.animate());

    const dt = this.clock.getDelta();
    this.pivot.rotation.y += this.rotationSpeed * dt;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    this.renderer.dispose();
    this.scene = null;
  }
}
