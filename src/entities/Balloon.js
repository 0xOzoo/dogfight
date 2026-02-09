import * as THREE from 'three';
import { BALLOON } from '../config.js';

export class Balloon {
  constructor(scene, position) {
    this.scene = scene;
    this.position = position.clone();
    this.alive = true;
    this.health = BALLOON.HEALTH;
    this.baseY = position.y;
    this.bobTimer = Math.random() * Math.PI * 2;
    this.collisionRadius = BALLOON.COLLISION_RADIUS;

    this.mesh = this.createMesh();
    this.scene.add(this.mesh);
  }

  createMesh() {
    const group = new THREE.Group();

    // Balloon envelope (large sphere) - big and visible
    const envelopeGeom = new THREE.SphereGeometry(45, 24, 16);
    const envelopeMat = new THREE.MeshPhongMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.85,
      specular: 0x333333,
      shininess: 20,
      emissive: 0x331111,
    });
    const envelope = new THREE.Mesh(envelopeGeom, envelopeMat);
    envelope.position.y = 35;
    group.add(envelope);

    // Accent stripes
    const stripeGeom = new THREE.SphereGeometry(45.4, 24, 4, 0, Math.PI * 2, 1.0, 0.5);
    const stripeMat = new THREE.MeshPhongMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.9,
    });
    const stripe = new THREE.Mesh(stripeGeom, stripeMat);
    stripe.position.y = 35;
    group.add(stripe);

    // Second stripe band
    const stripe2Geom = new THREE.SphereGeometry(45.4, 24, 4, 0, Math.PI * 2, 1.8, 0.5);
    const stripe2 = new THREE.Mesh(stripe2Geom, stripeMat);
    stripe2.position.y = 35;
    group.add(stripe2);

    // Basket
    const basketGeom = new THREE.BoxGeometry(12, 7, 12);
    const basketMat = new THREE.MeshPhongMaterial({ color: 0x885522 });
    const basket = new THREE.Mesh(basketGeom, basketMat);
    basket.position.y = -18;
    group.add(basket);

    // Ropes (4 lines from basket corners to balloon bottom)
    const ropeMat = new THREE.LineBasicMaterial({ color: 0x886644 });
    const corners = [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]];
    for (const c of corners) {
      const ropeGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c[0], -15, c[2]),
        new THREE.Vector3(c[0] * 0.3, -5, c[2] * 0.3),
      ]);
      group.add(new THREE.Line(ropeGeom, ropeMat));
    }

    // Ammo crate icon (green box on basket)
    const crateGeom = new THREE.BoxGeometry(6, 4, 6);
    const crateMat = new THREE.MeshPhongMaterial({ color: 0x44aa44, emissive: 0x113311 });
    const crate = new THREE.Mesh(crateGeom, crateMat);
    crate.position.y = -12;
    group.add(crate);

    group.position.copy(this.position);
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
    if (!this.alive) return;

    // Gentle bobbing
    this.bobTimer += dt * 0.5;
    this.position.y = this.baseY + Math.sin(this.bobTimer) * 5;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y += dt * 0.1;
  }

  destroy() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
  }
}
