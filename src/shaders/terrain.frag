varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vElevation;

uniform vec3 uSunDirection;
uniform float uWaterLevel;

// Multi-layer terrain texturing
vec3 getTerrainColor(float elevation, vec3 normal) {
  // Slope factor
  float slope = 1.0 - normal.y;

  // Water
  vec3 waterColor = vec3(0.1, 0.3, 0.6);
  // Sand/beach
  vec3 sandColor = vec3(0.76, 0.7, 0.5);
  // Grass
  vec3 grassColor = vec3(0.2, 0.45, 0.1);
  // Forest
  vec3 forestColor = vec3(0.1, 0.3, 0.08);
  // Rock
  vec3 rockColor = vec3(0.45, 0.42, 0.38);
  // Snow
  vec3 snowColor = vec3(0.9, 0.9, 0.95);

  vec3 color;

  if (elevation < 0.02) {
    color = mix(waterColor, sandColor, smoothstep(0.0, 0.02, elevation));
  } else if (elevation < 0.1) {
    color = mix(sandColor, grassColor, smoothstep(0.02, 0.1, elevation));
  } else if (elevation < 0.3) {
    color = mix(grassColor, forestColor, smoothstep(0.1, 0.3, elevation));
  } else if (elevation < 0.6) {
    color = mix(forestColor, rockColor, smoothstep(0.3, 0.6, elevation));
  } else {
    color = mix(rockColor, snowColor, smoothstep(0.6, 0.85, elevation));
  }

  // Steep slopes become rocky
  if (slope > 0.3) {
    color = mix(color, rockColor, smoothstep(0.3, 0.6, slope));
  }

  return color;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 color = getTerrainColor(vElevation, normal);

  // Diffuse lighting
  float diffuse = max(0.0, dot(normal, uSunDirection));
  float ambient = 0.3;

  vec3 lighting = vec3(ambient + diffuse * 0.7);

  // Slight warm tint from sun
  lighting += vec3(0.1, 0.05, 0.0) * diffuse;

  color *= lighting;

  // Distance fog
  float dist = length(vWorldPosition - cameraPosition);
  float fogFactor = 1.0 - exp(-dist * 0.00008);
  vec3 fogColor = vec3(0.6, 0.7, 0.8);
  color = mix(color, fogColor, fogFactor);

  gl_FragColor = vec4(color, 1.0);
}
