import * as THREE from 'three';

export class StaticProp {
  constructor(scene, position, heading, modelTemplate) {
    this.scene = scene;
    this.position = position.clone();
    this.alive = true;
    this.health = 30;
    this.collisionRadius = 12;

    this.mesh = this.createMesh(modelTemplate, heading);
    this.scene.add(this.mesh);
  }

  createMesh(modelTemplate, heading) {
    if (modelTemplate) {
      const model = modelTemplate.clone();
      const config = modelTemplate._planeConfig;

      // Normalize size same as Aircraft
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const TARGET_LENGTH = 20;
      const s = maxDim > 0 ? TARGET_LENGTH / maxDim : 1;

      const wrapper = new THREE.Group();

      if (config && config.rotation) {
        const [rx, ry, rz] = config.rotation;
        model.rotation.set(rx, ry, rz);
      }

      model.scale.set(s, s, s);

      // Center
      const box2 = new THREE.Box3().setFromObject(model);
      const center = box2.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += TARGET_LENGTH * 0.15;

      wrapper.add(model);
      wrapper.position.copy(this.position);
      wrapper.rotation.y = heading || 0;

      return wrapper;
    }

    // Fallback: simple geometric plane shape
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x667788 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 18), bodyMat);
    group.add(body);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 5), bodyMat);
    wing.position.z = -1;
    group.add(wing);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 3), bodyMat);
    tail.position.set(0, 0, 7);
    group.add(tail);

    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 3), bodyMat);
    vStab.position.set(0, 2, 7);
    group.add(vStab);

    group.position.copy(this.position);
    group.rotation.y = heading || 0;
    return group;
  }

  applyDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  update(dt) {
    // Static — no movement
  }

  destroy() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
  }
}
