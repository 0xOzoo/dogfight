import * as THREE from 'three';

class Explosion {
  constructor(position, small = false) {
    this.position = position.clone();
    this.age = 0;
    this.maxAge = small ? 0.6 : 2.0;
    this.alive = true;
    this.particles = [];

    if (small) {
      // Small bullet-impact explosion
      const particleCount = 6;
      for (let i = 0; i < particleCount; i++) {
        const speed = 5 + Math.random() * 15;
        const direction = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 1.5,
          (Math.random() - 0.5) * 2
        ).normalize();

        this.particles.push({
          position: this.position.clone(),
          velocity: direction.multiplyScalar(speed),
          size: 0.5 + Math.random() * 1.0,
          life: 0.2 + Math.random() * 0.4,
          age: 0,
          color: Math.random() > 0.5 ? 0xffaa44 : 0xcc6622,
        });
      }
      // Small dirt puff
      for (let i = 0; i < 3; i++) {
        const speed = 3 + Math.random() * 8;
        const direction = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 2,
          (Math.random() - 0.5) * 2
        ).normalize();

        this.particles.push({
          position: this.position.clone(),
          velocity: direction.multiplyScalar(speed),
          size: 0.3 + Math.random() * 0.4,
          life: 0.3 + Math.random() * 0.3,
          age: 0,
          color: 0x665533,
          isDebris: true,
        });
      }
      return;
    }

    // Generate particles
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
      const speed = 20 + Math.random() * 60;
      const direction = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.3) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();

      this.particles.push({
        position: this.position.clone(),
        velocity: direction.multiplyScalar(speed),
        size: 1 + Math.random() * 3,
        life: 0.5 + Math.random() * 1.5,
        age: 0,
        color: Math.random() > 0.5 ? 0xff6600 : 0xff3300,
      });
    }

    // Debris particles
    for (let i = 0; i < 10; i++) {
      const speed = 30 + Math.random() * 40;
      const direction = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2,
        (Math.random() - 0.5) * 2
      ).normalize();

      this.particles.push({
        position: this.position.clone(),
        velocity: direction.multiplyScalar(speed),
        size: 0.3 + Math.random() * 0.5,
        life: 1 + Math.random() * 1,
        age: 0,
        color: 0x333333,
        isDebris: true,
      });
    }
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.maxAge) {
      this.alive = false;
      return;
    }

    for (const p of this.particles) {
      p.age += dt;
      if (p.age > p.life) continue;

      if (p.isDebris) {
        p.velocity.y -= 15 * dt; // gravity for debris
      } else {
        p.velocity.multiplyScalar(1 - dt * 2); // fire decelerates
      }

      p.position.addScaledVector(p.velocity, dt);
    }
  }
}

class SonicBoomRing {
  constructor(scene, position, velocity) {
    this.scene = scene;
    this.age = 0;
    this.maxAge = 1.2;
    this.alive = true;

    const forward = velocity.clone().normalize();

    // Vapor cone ring - torus that expands outward
    const ringGeom = new THREE.TorusGeometry(1, 0.6, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeom, ringMat);
    this.ring.position.copy(position);
    // Orient ring perpendicular to flight direction
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, forward);
    this.ring.quaternion.copy(quat);
    this.ring.rotateX(Math.PI / 2);
    this.scene.add(this.ring);

    // Second ring slightly behind for depth
    const ring2Geom = new THREE.TorusGeometry(1, 0.3, 8, 48);
    const ring2Mat = new THREE.MeshBasicMaterial({
      color: 0xeeeeff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
    this.ring2.position.copy(position).addScaledVector(forward, -3);
    this.ring2.quaternion.copy(this.ring.quaternion);
    this.scene.add(this.ring2);

    // Vapor disc - flat disc that expands with the ring
    const discGeom = new THREE.CircleGeometry(1, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disc = new THREE.Mesh(discGeom, discMat);
    this.disc.position.copy(position);
    this.disc.quaternion.copy(this.ring.quaternion);
    this.scene.add(this.disc);
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.maxAge) {
      this.alive = false;
      this.dispose();
      return;
    }

    const t = this.age / this.maxAge;
    const easeOut = 1 - (1 - t) * (1 - t); // quadratic ease out

    // Ring expands rapidly
    const ringScale = 2 + easeOut * 80;
    const ringThickness = Math.max(0.1, 1 - t);
    this.ring.scale.set(ringScale, ringScale, ringThickness);
    this.ring.material.opacity = 0.6 * (1 - t);

    // Second ring expands slightly slower
    const ring2Scale = 1 + easeOut * 60;
    this.ring2.scale.set(ring2Scale, ring2Scale, ringThickness * 0.8);
    this.ring2.material.opacity = 0.35 * (1 - t);

    // Disc expands and fades quickly
    const discScale = 2 + easeOut * 50;
    this.disc.scale.set(discScale, discScale, 1);
    this.disc.material.opacity = 0.2 * Math.max(0, 1 - t * 2);
  }

  dispose() {
    this.scene.remove(this.ring);
    this.scene.remove(this.ring2);
    this.scene.remove(this.disc);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.ring2.geometry.dispose();
    this.ring2.material.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
  }
}

export class ExplosionSystem {
  constructor(scene) {
    this.scene = scene;
    this.explosions = [];
    this.sonicBooms = [];

    // Shared particle geometry/material for all explosions
    const maxParticles = 2000;
    this.maxParticles = maxParticles;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 3,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Flash light for explosions
    this.flashLight = new THREE.PointLight(0xff6600, 0, 200);
    this.scene.add(this.flashLight);
    this.flashTimer = 0;
  }

  spawn(position) {
    const explosion = new Explosion(position);
    this.explosions.push(explosion);

    // Flash
    this.flashLight.position.copy(position);
    this.flashLight.intensity = 5;
    this.flashTimer = 0.3;
  }

  spawnSmall(position) {
    const explosion = new Explosion(position, true);
    this.explosions.push(explosion);
  }

  spawnSonicBoom(position, velocity) {
    const boom = new SonicBoomRing(this.scene, position, velocity);
    this.sonicBooms.push(boom);
  }

  update(dt) {
    // Update sonic boom rings
    for (let i = this.sonicBooms.length - 1; i >= 0; i--) {
      this.sonicBooms[i].update(dt);
      if (!this.sonicBooms[i].alive) {
        this.sonicBooms.splice(i, 1);
      }
    }

    // Flash fade
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashLight.intensity = Math.max(0, this.flashTimer / 0.3 * 5);
    }

    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].update(dt);
      if (!this.explosions[i].alive) {
        this.explosions.splice(i, 1);
      }
    }

    // Flatten all particles into buffers
    const posAttr = this.points.geometry.attributes.position;
    const colAttr = this.points.geometry.attributes.color;
    const sizeAttr = this.points.geometry.attributes.size;

    let idx = 0;
    const color = new THREE.Color();

    for (const explosion of this.explosions) {
      for (const p of explosion.particles) {
        if (idx >= this.maxParticles) break;
        if (p.age > p.life) continue;

        const lifeRatio = p.age / p.life;

        posAttr.array[idx * 3] = p.position.x;
        posAttr.array[idx * 3 + 1] = p.position.y;
        posAttr.array[idx * 3 + 2] = p.position.z;

        color.set(p.color);
        if (!p.isDebris) {
          // Fade fire from orange to dark
          const fade = 1 - lifeRatio;
          colAttr.array[idx * 3] = color.r * fade;
          colAttr.array[idx * 3 + 1] = color.g * fade * 0.5;
          colAttr.array[idx * 3 + 2] = color.b * fade * 0.2;
        } else {
          colAttr.array[idx * 3] = 0.2;
          colAttr.array[idx * 3 + 1] = 0.2;
          colAttr.array[idx * 3 + 2] = 0.2;
        }

        sizeAttr.array[idx] = p.size * (1 - lifeRatio * 0.5);
        idx++;
      }
    }

    // Zero out remaining
    for (let i = idx; i < this.maxParticles; i++) {
      sizeAttr.array[i] = 0;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }

  reset() {
    this.explosions.length = 0;
    for (const boom of this.sonicBooms) {
      boom.dispose();
    }
    this.sonicBooms.length = 0;
    this.flashTimer = 0;
    this.flashLight.intensity = 0;
  }
}
