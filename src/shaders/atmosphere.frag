uniform vec3 uSunDirection;
uniform float uSunIntensity;
varying vec3 vWorldPosition;
varying vec3 vNormal;

// Simplified Rayleigh scattering
vec3 rayleigh(float cosTheta) {
  // Rayleigh phase function
  float phase = 0.75 * (1.0 + cosTheta * cosTheta);

  // Scattering coefficients (wavelength dependent)
  vec3 betaR = vec3(5.8e-3, 1.35e-2, 3.31e-2); // RGB scattering

  return betaR * phase;
}

void main() {
  vec3 viewDir = normalize(vWorldPosition);
  float elevation = viewDir.y;

  // Sky color from Rayleigh-like scattering
  float cosTheta = dot(viewDir, uSunDirection);

  vec3 skyColor = vec3(0.3, 0.5, 0.9); // base blue
  vec3 scatter = rayleigh(cosTheta);

  // Altitude gradient
  float t = max(0.0, elevation);
  skyColor = mix(vec3(0.7, 0.75, 0.85), skyColor, pow(t, 0.4));

  // Sun contribution
  float sunDot = max(0.0, cosTheta);
  float sun = pow(sunDot, 256.0) * uSunIntensity;
  float sunGlow = pow(sunDot, 8.0) * 0.4 * uSunIntensity;

  vec3 sunColor = vec3(1.0, 0.9, 0.7);
  skyColor += sunColor * (sun + sunGlow);
  skyColor += scatter * uSunIntensity * 2.0;

  // Horizon haze
  float haze = 1.0 - abs(elevation);
  haze = pow(haze, 8.0);
  skyColor = mix(skyColor, vec3(0.8, 0.85, 0.9), haze * 0.5);

  gl_FragColor = vec4(skyColor, 1.0);
}
