import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/plugins';
import { TileCachePlugin } from './TileCachePlugin.js';

/**
 * MapManager - Loads and manages Cesium Ion 3D Tiles (Google Photorealistic)
 * for real-world city maps. Converts ECEF tile coordinates to a local Three.js
 * Y-up coordinate system anchored at a configurable GPS reference point.
 *
 * All tile-loading logic is client-side (Cesium Ion free tier, $0 server cost).
 * Does NOT use the CesiumJS library -- only 3d-tiles-renderer for Three.js.
 */

// WGS84 constants
const WGS84_A = 6378137.0;           // Semi-major axis (meters)
const WGS84_E2 = 0.00669437999014;   // First eccentricity squared

/**
 * Convert geodetic (lat, lon, alt) to ECEF (x, y, z).
 */
function geodeticToECEF(latDeg, lonDeg, alt) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  return new THREE.Vector3(
    (N + alt) * cosLat * cosLon,
    (N + alt) * cosLat * sinLon,
    (N * (1 - WGS84_E2) + alt) * sinLat
  );
}

/**
 * Build a 4x4 matrix that transforms ECEF coordinates to a local
 * East-North-Up (ENU) frame centered at the anchor, then rotates
 * to Three.js convention (Y-up, -Z forward ~ North).
 */
function buildECEFToLocalMatrix(latDeg, lonDeg, alt) {
  const anchorECEF = geodeticToECEF(latDeg, lonDeg, alt);

  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  // ENU -> Three.js: X=East, Y=Up, Z=-North
  // Rotation (ECEF -> local) is transpose of local-axes-in-ECEF
  //   Row 0 (local X = East):    -sinLon,        cosLon,         0
  //   Row 1 (local Y = Up):       cosLat*cosLon,  cosLat*sinLon,  sinLat
  //   Row 2 (local Z = -North):   sinLat*cosLon,  sinLat*sinLon, -cosLat

  const rotMatrix = new THREE.Matrix4();
  rotMatrix.set(
    -sinLon,         cosLon,          0,       0,
    cosLat * cosLon, cosLat * sinLon, sinLat,  0,
    sinLat * cosLon, sinLat * sinLon, -cosLat, 0,
    0,               0,               0,       1
  );

  const translationMatrix = new THREE.Matrix4();
  translationMatrix.makeTranslation(-anchorECEF.x, -anchorECEF.y, -anchorECEF.z);

  const result = new THREE.Matrix4();
  result.multiplyMatrices(rotMatrix, translationMatrix);
  return result;
}

export class MapManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} anchorConfig - { lat, lon, alt?, spawnAlt?, label? }
   */
  constructor(scene, camera, renderer, anchorConfig) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.anchorConfig = anchorConfig;

    this.tilesRenderer = null;
    this.ready = false;
    this.preloaded = false;
    this.raycaster = new THREE.Raycaster();
    this.worldScale = 1.0;

    // Preload tracking
    this._preloadResolve = null;
    this._tilesLoadedCount = 0;
    this._preloadMinTiles = 40;      // Min tiles before we consider it preloaded
    this._preloadTimeout = 12000;    // Max wait ms for preload

    this._init();
  }

  _init() {
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
    if (!token) {
      console.error('[MapManager] Missing VITE_CESIUM_ION_TOKEN in .env');
      return;
    }

    const { lat, lon, alt = 0 } = this.anchorConfig;

    this.tilesRenderer = new TilesRenderer();

    // Persistent tile cache — reduces Cesium Ion API calls on reload / map switch
    this.tileCachePlugin = new TileCachePlugin();
    this.tilesRenderer.registerPlugin(this.tileCachePlugin);

    // Google Photorealistic 3D Tiles via Cesium Ion
    this.tilesRenderer.registerPlugin(new CesiumIonAuthPlugin({
      apiToken: token,
      assetId: '2275207',
      autoRefreshToken: true,
    }));

    // Performance tuning
    this.tilesRenderer.errorTarget = 12;
    this.tilesRenderer.maxDepth = Infinity;
    this.tilesRenderer.loadSiblings = true;
    this.tilesRenderer.displayActiveTiles = false;
    this.tilesRenderer.autoDisableRendererCulling = true;
    this.tilesRenderer.downloadQueue.maxJobs = 10;
    this.tilesRenderer.parseQueue.maxJobs = 3;

    // Camera for LOD
    this.tilesRenderer.setCamera(this.camera);
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);

    // ECEF -> local transform
    const ecefToLocal = buildECEFToLocalMatrix(lat, lon, alt);
    this.tilesRenderer.group.matrixAutoUpdate = false;

    const scaleMatrix = new THREE.Matrix4().makeScale(
      this.worldScale, this.worldScale, this.worldScale
    );
    const finalMatrix = new THREE.Matrix4();
    finalMatrix.multiplyMatrices(scaleMatrix, ecefToLocal);
    this.tilesRenderer.group.matrix.copy(finalMatrix);
    this.tilesRenderer.group.matrixWorldNeedsUpdate = true;

    this.tilesRenderer.group.frustumCulled = false;

    // Exclude from GTAO pass
    this.tilesRenderer.group.userData.excludeAO = true;
    this.tilesRenderer.addEventListener('load-model', (event) => {
      const tileScene = event.scene;
      if (tileScene) {
        tileScene.userData.excludeAO = true;
        tileScene.traverse((child) => {
          child.userData.excludeAO = true;
        });
      }
      this._tilesLoadedCount++;
      this._checkPreloadDone();
    });

    this.scene.add(this.tilesRenderer.group);

    this.tilesRenderer.addEventListener('load-root-tileset', () => {
      const label = this.anchorConfig.label || 'city';
      console.log(`[MapManager] Root tileset loaded - ${label} 3D tiles active`);
      this.ready = true;
    });

    this.tilesRenderer.addEventListener('load-error', (event) => {
      console.warn('[MapManager] Tile load error:', event);
    });
  }

  /**
   * Preload tiles around spawn position. Returns a promise that resolves
   * once enough tiles are loaded (or timeout is reached).
   * @param {number} spawnAlt - altitude to place the warmup camera at
   * @returns {Promise<void>}
   */
  preload(spawnAlt = 800) {
    if (!this.tilesRenderer) return Promise.resolve();

    return new Promise((resolve) => {
      this._preloadResolve = resolve;

      // Position camera at spawn point looking down and around,
      // so the tile LOD system loads surrounding geometry.
      const savedPos = this.camera.position.clone();
      const savedQuat = this.camera.quaternion.clone();

      // Place camera at spawn altitude looking down at a ~45 deg angle
      this.camera.position.set(0, spawnAlt, 0);
      this.camera.lookAt(0, 0, -500);
      this.camera.updateMatrixWorld(true);

      // Pump update loop to trigger tile downloads
      let elapsed = 0;
      const interval = 100; // ms between pumps
      const pumpTimer = setInterval(() => {
        elapsed += interval;
        this.camera.updateMatrixWorld(true);
        this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
        this.tilesRenderer.update();

        // Slowly rotate the view to load tiles in all directions
        const angle = (elapsed / this._preloadTimeout) * Math.PI * 2;
        this.camera.position.set(
          Math.sin(angle) * 200,
          spawnAlt,
          Math.cos(angle) * 200
        );
        this.camera.lookAt(Math.sin(angle) * 500, spawnAlt * 0.3, Math.cos(angle) * 500);
        this.camera.updateMatrixWorld(true);

        if (elapsed >= this._preloadTimeout) {
          clearInterval(pumpTimer);
          // Restore camera
          this.camera.position.copy(savedPos);
          this.camera.quaternion.copy(savedQuat);
          this.camera.updateMatrixWorld(true);
          this.preloaded = true;
          if (this._preloadResolve) {
            this._preloadResolve();
            this._preloadResolve = null;
          }
        }
      }, interval);

      // Store so we can cancel on dispose
      this._preloadTimer = pumpTimer;
    });
  }

  _checkPreloadDone() {
    if (this._tilesLoadedCount >= this._preloadMinTiles && this._preloadResolve) {
      this.preloaded = true;
      if (this._preloadTimer) {
        clearInterval(this._preloadTimer);
        this._preloadTimer = null;
      }
      // Small extra delay to let GPU finish uploading
      setTimeout(() => {
        if (this._preloadResolve) {
          this._preloadResolve();
          this._preloadResolve = null;
        }
      }, 300);
    }
  }

  /**
   * Call every frame from the game loop.
   */
  update() {
    if (!this.tilesRenderer) return;
    this.camera.updateMatrixWorld();
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    this.tilesRenderer.update();
  }

  /**
   * Get the ground/building height at a given local position using raycasting.
   */
  getHeightAt(x, z) {
    if (!this.tilesRenderer || !this.ready) return 0;

    this.raycaster.set(
      new THREE.Vector3(x, 5000, z),
      new THREE.Vector3(0, -1, 0)
    );
    this.raycaster.firstHitOnly = true;

    const intersects = [];
    this.tilesRenderer.raycast(this.raycaster, intersects);

    if (intersects.length > 0) {
      return intersects[0].point.y;
    }
    return 0;
  }

  /**
   * Check collision against 3D tile geometry.
   */
  checkCollision(position) {
    if (!this.tilesRenderer || !this.ready) return false;
    const height = this.getHeightAt(position.x, position.z);
    return position.y < height + 10;
  }

  /**
   * Check building collision (same as checkCollision for 3D tiles).
   */
  checkBuildingCollision(position) {
    return this.checkCollision(position);
  }

  dispose() {
    if (this._preloadTimer) {
      clearInterval(this._preloadTimer);
      this._preloadTimer = null;
    }
    if (this._preloadResolve) {
      this._preloadResolve();
      this._preloadResolve = null;
    }
    // Log cache stats before disposing
    if (this.tileCachePlugin) {
      const stats = this.tileCachePlugin.getStats();
      console.log(`[MapManager] Tile cache stats — hits: ${stats.hits}, misses: ${stats.misses}, errors: ${stats.errors}`);
      this.tileCachePlugin = null;
    }
    if (this.tilesRenderer) {
      this.tilesRenderer.dispose();
      this.tilesRenderer = null;
    }
    this.ready = false;
    this.preloaded = false;
  }
}
