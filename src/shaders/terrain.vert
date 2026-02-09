varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vElevation;

uniform float uMaxHeight;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vElevation = position.y / uMaxHeight;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
