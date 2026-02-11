/**
 * TileCachePlugin - Persistent Cache API layer for 3D tile fetches.
 *
 * Intercepts all tile HTTP requests via the 3d-tiles-renderer plugin system,
 * storing responses in the browser's Cache API. Cached tiles survive page
 * reloads and map switches, dramatically reducing Cesium Ion API calls
 * when going back and forth between NYC / Paris or reloading the page.
 *
 * The plugin is registered BEFORE CesiumIonAuthPlugin so its fetchData()
 * runs first. On cache hit it returns instantly. On cache miss it delegates
 * to a wrapped inner fetch function (provided at construction) that handles
 * authentication, then caches the response before returning it.
 */

const CACHE_NAME = 'dogfight-3dtiles-v1';

// Max age for cached tiles: 7 days. Tile geometry doesn't change often.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Strip volatile query parameters (auth tokens, sessions, versions that
 * change per-session) to produce a stable cache key from a tile URL.
 * We keep the base URL + path so the same tile from the same Cesium
 * asset always hits the same cache entry.
 */
function getCacheKey(url) {
  try {
    const u = new URL(url);
    // Remove auth/session params that change every session
    u.searchParams.delete('key');
    u.searchParams.delete('session');
    u.searchParams.delete('token');
    // Keep 'v' (version) - it changes only when the asset is republished
    return u.toString();
  } catch {
    return url;
  }
}

export class TileCachePlugin {
  constructor() {
    this.name = 'TILE_CACHE_PLUGIN';
    // Lower priority number = earlier in plugin array = runs first in invokeOnePlugin.
    // CesiumIonAuthPlugin defaults to priority 0.
    // We use -1 so our fetchData is called before theirs.
    this.priority = -1;

    this._cache = null;
    this._cacheReady = false;
    this._tiles = null;   // TilesRenderer reference
    this._stats = { hits: 0, misses: 0, errors: 0 };
    this._initCache();
  }

  async _initCache() {
    try {
      this._cache = await caches.open(CACHE_NAME);
      this._cacheReady = true;

      // Prune stale entries on startup (non-blocking)
      this._pruneStale();
    } catch (e) {
      console.warn('[TileCachePlugin] Cache API not available:', e.message);
      this._cacheReady = false;
    }
  }

  /** Called by TilesRenderer when the plugin is registered. */
  init(tiles) {
    this._tiles = tiles;
  }

  /** Called by TilesRenderer when the plugin is unregistered. */
  dispose() {
    this._tiles = null;
  }

  /**
   * fetchData hook — intercepted by the plugin system.
   * Returns a Response on cache hit, or null to let the next plugin handle it.
   * On cache miss we ALSO return null so CesiumIonAuthPlugin does the
   * authenticated fetch. We then cache the result in processFetchResult().
   *
   * HOWEVER: invokeOnePlugin only calls the first non-null result.
   * If we return null, we can't intercept the response later.
   *
   * So instead: on cache miss, we call the authenticated fetch ourselves
   * by delegating to the remaining plugins, cache the result, and return it.
   */
  async fetchData(url, options) {
    if (!this._cacheReady || !this._cache) {
      // Cache not available, let the next plugin handle it
      return null;
    }

    const cacheKey = getCacheKey(url);

    // --- Cache HIT ---
    try {
      const cached = await this._cache.match(cacheKey);
      if (cached) {
        // Check age via a custom header we store
        const storedAt = cached.headers.get('x-tile-cached-at');
        if (storedAt) {
          const age = Date.now() - parseInt(storedAt, 10);
          if (age > MAX_AGE_MS) {
            // Stale — delete and fall through to miss
            await this._cache.delete(cacheKey);
          } else {
            this._stats.hits++;
            return cached;
          }
        } else {
          // No timestamp header — use it anyway (legacy entry)
          this._stats.hits++;
          return cached;
        }
      }
    } catch {
      // Cache read error — fall through to network
    }

    // --- Cache MISS: delegate to the next plugin (auth) ---
    this._stats.misses++;

    // We need to call the authenticated fetch from CesiumIonAuthPlugin.
    // Use invokeOnePlugin, skipping ourselves by temporarily removing
    // our fetchData. This is the cleanest approach without coupling
    // to CesiumIonAuthPlugin internals.
    const savedFetchData = this.fetchData;
    this.fetchData = null;

    let response;
    try {
      response = await this._tiles.invokeOnePlugin(
        plugin => plugin.fetchData && plugin.fetchData(url, options)
      );

      // If no plugin handled it, use default fetch
      if (!response) {
        response = await fetch(url, options);
      }
    } finally {
      this.fetchData = savedFetchData;
    }

    // --- Store in cache (non-blocking, don't await) ---
    if (response && response.ok) {
      this._cacheResponse(cacheKey, response.clone());
    }

    return response;
  }

  async _cacheResponse(cacheKey, response) {
    try {
      // We need to create a new Response with our custom timestamp header
      // because we can't modify the original response headers.
      const body = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set('x-tile-cached-at', Date.now().toString());

      const cacheable = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      await this._cache.put(cacheKey, cacheable);
    } catch {
      this._stats.errors++;
    }
  }

  /** Remove entries older than MAX_AGE_MS. Runs once on init. */
  async _pruneStale() {
    if (!this._cache) return;
    try {
      const keys = await this._cache.keys();
      let pruned = 0;
      for (const request of keys) {
        const res = await this._cache.match(request);
        if (res) {
          const storedAt = res.headers.get('x-tile-cached-at');
          if (storedAt && (Date.now() - parseInt(storedAt, 10)) > MAX_AGE_MS) {
            await this._cache.delete(request);
            pruned++;
          }
        }
      }
      if (pruned > 0) {
        console.log(`[TileCachePlugin] Pruned ${pruned} stale cache entries`);
      }
    } catch {
      // Non-critical
    }
  }

  /** Get cache statistics. */
  getStats() {
    return { ...this._stats };
  }
}
