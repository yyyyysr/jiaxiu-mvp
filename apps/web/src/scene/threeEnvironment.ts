import * as THREE from "three"

import type { SeasonId } from "./types"

type SeasonPalette = {
  background: number
  water: number
  shore: number
  foliage: number
  particle: number
  ambientSky: number
  ambientGround: number
  ambientIntensity: number
  keyColor: number
  keyIntensity: number
  particleStyle: ParticleStyle
  effectStyle: EffectStyle
  effectColor: number
  waterSpeed: number
  vegetationSize: number
  vegetationOpacity: number
  splatTint: number
  splatOpacity: number
}

type ParticleStyle = {
  size: number
  opacity: number
  fallSpeed: number
  drift: number
  swayRate: number
  bob: number
}

type EffectStyle = {
  size: number
  opacity: number
  rise: number
  drift: number
  swayRate: number
}

const PALETTES: Record<SeasonId, SeasonPalette> = {
  spring: {
    background: 0xb9ced0, water: 0x769da0, shore: 0x98a68b, foliage: 0x78966b, particle: 0xd5e5e0,
    ambientSky: 0xe7f4e8, ambientGround: 0x52675a, ambientIntensity: 1.28, keyColor: 0xf6e9bf, keyIntensity: 1.08,
    particleStyle: { size: 0.05, opacity: 0.46, fallSpeed: 0.55, drift: 0.045, swayRate: 3.2, bob: 0.012 },
    effectStyle: { size: 0.03, opacity: 0.5, rise: -0.02, drift: 0.06, swayRate: 2.2 },
    effectColor: 0xf3c6da, waterSpeed: 0.9, vegetationSize: 0.26, vegetationOpacity: 0.5,
    splatTint: 0xf3fff3, splatOpacity: 0.97,
  },
  summer: {
    background: 0x8fb8c3, water: 0x4f8f94, shore: 0x668d67, foliage: 0x416f4d, particle: 0xc9e5e1,
    ambientSky: 0xd7f0ed, ambientGround: 0x315b56, ambientIntensity: 1.34, keyColor: 0xfff1c9, keyIntensity: 1.18,
    particleStyle: { size: 0.034, opacity: 0.1, fallSpeed: 0, drift: 0.09, swayRate: 0.48, bob: 0.04 },
    effectStyle: { size: 0.05, opacity: 0.85, rise: 0.16, drift: 0.12, swayRate: 0.8 },
    effectColor: 0xffe98a, waterSpeed: 1.18, vegetationSize: 0.3, vegetationOpacity: 0.58,
    splatTint: 0xf8fff3, splatOpacity: 1,
  },
  autumn: {
    background: 0xb6aa91, water: 0x70878a, shore: 0x9a7046, foliage: 0x87633e, particle: 0xdbbc7e,
    ambientSky: 0xffe1b6, ambientGround: 0x5f4a39, ambientIntensity: 1.18, keyColor: 0xffcf8f, keyIntensity: 1.14,
    particleStyle: { size: 0.065, opacity: 0.36, fallSpeed: 0.22, drift: 0.2, swayRate: 1.3, bob: 0.07 },
    effectStyle: { size: 0.05, opacity: 0.5, rise: -0.06, drift: 0.2, swayRate: 1.4 },
    effectColor: 0xe0a04f, waterSpeed: 0.85, vegetationSize: 0.24, vegetationOpacity: 0.42,
    splatTint: 0xfff4e0, splatOpacity: 0.98,
  },
  winter: {
    background: 0x929faa, water: 0x667d88, shore: 0x6b7671, foliage: 0x5c6661, particle: 0xdce7ec,
    ambientSky: 0xdceeff, ambientGround: 0x415159, ambientIntensity: 1.04, keyColor: 0xdceeff, keyIntensity: 0.78,
    particleStyle: { size: 0.09, opacity: 0.46, fallSpeed: 0.16, drift: 0.1, swayRate: 0.7, bob: 0.045 },
    effectStyle: { size: 0.05, opacity: 0.5, rise: -0.05, drift: 0.12, swayRate: 0.7 },
    effectColor: 0xd6e8f0, waterSpeed: 0.6, vegetationSize: 0.2, vegetationOpacity: 0.34,
    splatTint: 0xf0f7ff, splatOpacity: 0.94,
  },
}

const SEASON_TRANSITION_MS = 1600
const PARTICLE_MIN_Y = 0.15
const PARTICLE_VERTICAL_SPAN = 5.6
const FULL_TURN = Math.PI * 2

export type EnvironmentHandle = {
  setSeason: (season: SeasonId, at?: number) => void
  setReducedMotion: (reducedMotion: boolean, at?: number) => void
  update: (now: number) => void
  dispose: () => void
}

function lerpColour(from: number, to: number, progress: number): number {
  const source = new THREE.Color(from)
  source.lerp(new THREE.Color(to), progress)
  return source.getHex()
}

function easeInOut(progress: number): number {
  return progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2
}

function lerpNumber(from: number, to: number, progress: number): number {
  return THREE.MathUtils.lerp(from, to, progress)
}

function interpolateParticleStyle(from: ParticleStyle, to: ParticleStyle, progress: number): ParticleStyle {
  return {
    size: lerpNumber(from.size, to.size, progress),
    opacity: lerpNumber(from.opacity, to.opacity, progress),
    fallSpeed: lerpNumber(from.fallSpeed, to.fallSpeed, progress),
    drift: lerpNumber(from.drift, to.drift, progress),
    swayRate: lerpNumber(from.swayRate, to.swayRate, progress),
    bob: lerpNumber(from.bob, to.bob, progress),
  }
}

function interpolateEffectStyle(from: EffectStyle, to: EffectStyle, progress: number): EffectStyle {
  return {
    size: lerpNumber(from.size, to.size, progress),
    opacity: lerpNumber(from.opacity, to.opacity, progress),
    rise: lerpNumber(from.rise, to.rise, progress),
    drift: lerpNumber(from.drift, to.drift, progress),
    swayRate: lerpNumber(from.swayRate, to.swayRate, progress),
  }
}

function interpolatePalette(from: SeasonPalette, to: SeasonPalette, progress: number): SeasonPalette {
  return {
    background: lerpColour(from.background, to.background, progress),
    water: lerpColour(from.water, to.water, progress),
    shore: lerpColour(from.shore, to.shore, progress),
    foliage: lerpColour(from.foliage, to.foliage, progress),
    particle: lerpColour(from.particle, to.particle, progress),
    ambientSky: lerpColour(from.ambientSky, to.ambientSky, progress),
    ambientGround: lerpColour(from.ambientGround, to.ambientGround, progress),
    ambientIntensity: lerpNumber(from.ambientIntensity, to.ambientIntensity, progress),
    keyColor: lerpColour(from.keyColor, to.keyColor, progress),
    keyIntensity: lerpNumber(from.keyIntensity, to.keyIntensity, progress),
    particleStyle: interpolateParticleStyle(from.particleStyle, to.particleStyle, progress),
    effectStyle: interpolateEffectStyle(from.effectStyle, to.effectStyle, progress),
    effectColor: lerpColour(from.effectColor, to.effectColor, progress),
    waterSpeed: lerpNumber(from.waterSpeed, to.waterSpeed, progress),
    vegetationSize: lerpNumber(from.vegetationSize, to.vegetationSize, progress),
    vegetationOpacity: lerpNumber(from.vegetationOpacity, to.vegetationOpacity, progress),
    splatTint: lerpColour(from.splatTint, to.splatTint, progress),
    splatOpacity: lerpNumber(from.splatOpacity, to.splatOpacity, progress),
  }
}

function disposeMaterial(material: THREE.Material): void {
  Object.values(material).forEach((value) => {
    if (value && typeof value === "object" && "isTexture" in value && value.isTexture) (value as THREE.Texture).dispose()
  })
  material.dispose()
}

function makeSoftParticleMap(): THREE.DataTexture {
  const size = 24
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x / (size - 1) - 0.5, y / (size - 1) - 0.5) * 2
      const alpha = THREE.MathUtils.clamp(1 - distance, 0, 1) ** 1.8
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

function makeParticlePositions(): Float32Array {
  const positions = new Float32Array(64 * 3)
  for (let index = 0; index < 64; index += 1) {
    const seed = index * 0.61803398875
    const side = index % 2 === 0 ? -1 : 1
    positions[index * 3] = side * (3.1 + ((seed * 11) % 1) * 5.6)
    positions[index * 3 + 1] = 0.15 + ((seed * 17) % 1) * 5.6
    positions[index * 3 + 2] = -4.4 - ((seed * 7) % 1) * 4.8
  }
  return positions
}

function makeEffectPositions(count = 40): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const seed = index * 0.754877666
    positions[index * 3] = (seed % 1) * 11 - 5.5
    positions[index * 3 + 1] = 0.2 + ((seed * 13) % 1) * 5.2
    positions[index * 3 + 2] = -4.2 - ((seed * 7) % 1) * 4.6
  }
  return positions
}

function makeRaindropTexture(): THREE.DataTexture {
  // A thin, blue, downward-pointing teardrop: rounded below, tapering to a point above.
  const size = 20
  const data = new Uint8Array(size * size * 4)
  const centerX = size / 2
  const maxHalfWidth = size * 0.13
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    const halfWidth = maxHalfWidth * Math.pow(Math.sin(Math.PI * Math.min(v, 0.92)), 0.6)
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - centerX)
      let alpha = 0
      if (dx <= halfWidth && halfWidth > 0.001) {
        alpha = THREE.MathUtils.clamp(1 - Math.pow(dx / halfWidth, 2), 0, 1)
      }
      const offset = (y * size + x) * 4
      data[offset] = 190
      data[offset + 1] = 214
      data[offset + 2] = 240
      data[offset + 3] = Math.round(alpha * 235)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

function makeSnowflakeTexture(): THREE.DataTexture {
  // A six-armed crystal: thin radiating arms with a small branch near each midpoint.
  const size = 48
  const data = new Uint8Array(size * size * 4)
  const center = size / 2
  const maxRadius = size * 0.46
  const armWidth = size * 0.04
  const sector = Math.PI / 3
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const radius = Math.hypot(dx, dy)
      let alpha = 0
      if (radius <= maxRadius) {
        const angle = Math.atan2(dy, dx)
        const within = ((angle % sector) + sector) % sector
        const distanceToArm = Math.min(within, sector - within)
        if (radius * Math.sin(distanceToArm) < armWidth) alpha = 1
        // short branch radiating to the midpoint gap, around 65% of the radius
        const branchGap = Math.abs(within - sector / 2)
        if (radius > maxRadius * 0.5 && radius < maxRadius * 0.82 && branchGap < 0.24 && radius * Math.sin(branchGap) < armWidth * 0.9) {
          alpha = 1
        }
      }
      const offset = (y * size + x) * 4
      data[offset] = 235
      data[offset + 1] = 244
      data[offset + 2] = 254
      data[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

function makeLeafTexture(): THREE.DataTexture {
  // A red maple-like leaf: a five-lobed silhouette with a darker central vein.
  const size = 32
  const data = new Uint8Array(size * size * 4)
  const center = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const radius = Math.hypot(dx, dy) / (size / 2)
      const angle = Math.atan2(dy, dx)
      const lobes = 0.55 + 0.45 * Math.cos(angle * 5)
      let alpha = 0
      let lobe = 0
      if (radius <= lobes && radius < 1) {
        alpha = 1
        lobe = 0.5 + 0.5 * Math.cos(angle * 5)
      }
      const vein = Math.abs(dx) < size * 0.035 && radius < 0.9
      const offset = (y * size + x) * 4
      if (alpha < 0.03) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 0
        continue
      }
      // soft edge
      alpha *= THREE.MathUtils.clamp((lobes - radius) / 0.12, 0, 1)
      const shade = 0.6 + 0.4 * lobe
      data[offset] = Math.round(210 * shade)
      data[offset + 1] = Math.round(74 * (vein ? 0.5 : shade))
      data[offset + 2] = Math.round(38 * shade)
      data[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

export function createThreeEnvironment(
  scene: THREE.Scene,
  splat: { recolor: THREE.Color; opacity: number },
  reducedMotion: boolean,
  initialSeason: SeasonId,
): EnvironmentHandle {
  const root = new THREE.Group()
  root.name = "jiaxiu-context-only-environment"
  scene.add(root)

  const waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0.2,
    uniforms: {
      waterColor: { value: new THREE.Color(PALETTES[initialSeason].water) },
      rippleColor: { value: new THREE.Color(PALETTES[initialSeason].shore) },
      time: { value: 0 },
      flow: { value: PALETTES[initialSeason].waterSpeed },
    },
    vertexShader: `
      uniform float time;
      uniform float flow;
      varying vec2 vUv;
      varying float wave;
      void main() {
        vUv = uv;
        vec3 displaced = position;
        wave = sin(position.x * 0.74 + time * flow * 0.00062) * sin(position.y * 0.42 - time * flow * 0.00038);
        displaced.z += wave * 0.035;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 waterColor;
      uniform vec3 rippleColor;
      uniform float time;
      uniform float flow;
      varying vec2 vUv;
      varying float wave;
      void main() {
        float edge = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.72, 1.0, vUv.x));
        edge *= smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float ripple = 0.5 + 0.5 * sin(vUv.x * 28.0 + vUv.y * 9.0 + time * flow * 0.0005 + wave * 2.0);
        float glint = smoothstep(0.82, 1.0, ripple);
        vec3 color = mix(waterColor, rippleColor, glint * 0.18);
        gl_FragColor = vec4(color, edge * (0.105 + glint * 0.07));
      }
    `,
  })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(34, 22, 48, 28), waterMaterial)
  water.name = "jiaxiu-context-water"
  water.rotation.x = -Math.PI / 2
  water.position.set(0, -0.28, -4.8)
  water.renderOrder = -4
  root.add(water)

  const shoreMaterials = [
    new THREE.LineBasicMaterial({ color: PALETTES[initialSeason].shore, transparent: true, opacity: 0.24, depthWrite: false }),
    new THREE.LineBasicMaterial({ color: PALETTES[initialSeason].shore, transparent: true, opacity: 0.2, depthWrite: false }),
  ]
  const shoreContours = [
    [new THREE.Vector3(-15, -0.13, -6.1), new THREE.Vector3(-11.2, -0.08, -5.45), new THREE.Vector3(-7.4, -0.2, -5.9), new THREE.Vector3(-4.8, -0.16, -5.55)],
    [new THREE.Vector3(4.9, -0.16, -5.55), new THREE.Vector3(7.7, -0.22, -5.96), new THREE.Vector3(11.4, -0.08, -5.4), new THREE.Vector3(15, -0.14, -6.05)],
  ]
  shoreContours.forEach((points, index) => {
    const contour = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), shoreMaterials[index])
    contour.name = `jiaxiu-context-shore-${index === 0 ? "left" : "right"}`
    contour.renderOrder = -3
    root.add(contour)
  })

  const bridgeMaterial = new THREE.LineBasicMaterial({
    color: PALETTES[initialSeason].shore,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  })
  const bridgeCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-10.4, 0.12, -1.8),
    new THREE.Vector3(-6.6, 0.82, -2.5),
    new THREE.Vector3(-3.15, 0.16, -1.05),
  )
  const bridgeCue = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(bridgeCurve.getPoints(36)),
    bridgeMaterial,
  )
  bridgeCue.name = "jiaxiu-context-fuyu-bridge-cue"
  bridgeCue.userData = { role: "direction-cue", evidenceBoundary: "interpretive-context" }
  bridgeCue.renderOrder = -2
  root.add(bridgeCue)

  const gardenCue = new THREE.Group()
  gardenCue.name = "jiaxiu-context-cuiwei-garden-cue"
  gardenCue.userData = { role: "direction-cue", evidenceBoundary: "interpretive-context" }
  const gardenMaterial = new THREE.LineBasicMaterial({
    color: PALETTES[initialSeason].foliage,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  })
  const gardenPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(4.2, 0.12, -3.15),
    new THREE.Vector3(5.25, 0.42, -3.75),
    new THREE.Vector3(6.55, 0.18, -3.28),
    new THREE.Vector3(7.8, 0.5, -4.05),
    new THREE.Vector3(9.1, 0.16, -3.35),
  ])
  gardenCue.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(gardenPath.getPoints(42)), gardenMaterial))
  const gardenMarkersMaterial = new THREE.PointsMaterial({
    color: PALETTES[initialSeason].foliage,
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    map: makeSoftParticleMap(),
  })
  const gardenMarkers = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(4.55, 0.42, -3.24),
      new THREE.Vector3(5.72, 0.64, -3.72),
      new THREE.Vector3(6.86, 0.46, -3.42),
      new THREE.Vector3(8.15, 0.7, -3.82),
      new THREE.Vector3(8.72, 0.38, -3.48),
    ]),
    gardenMarkersMaterial,
  )
  gardenCue.add(gardenMarkers)
  gardenCue.renderOrder = -2
  root.add(gardenCue)

  const vegetationGeometry = new THREE.BufferGeometry()
  const vegetationPositions = new Float32Array([
    -7, 0.35, -3.1, -6.4, 0.55, -3.7, -5.7, 0.3, -3.4, -4.9, 0.66, -3.9,
    5.3, 0.38, -3.6, 6.1, 0.7, -3.4, 6.8, 0.32, -3.9, 7.6, 0.52, -3.2,
  ])
  vegetationGeometry.setAttribute("position", new THREE.BufferAttribute(vegetationPositions, 3))
  const vegetationMaterial = new THREE.PointsMaterial({
    color: PALETTES[initialSeason].foliage,
    size: 0.22,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    alphaTest: 0.04,
    map: makeSoftParticleMap(),
  })
  const vegetation = new THREE.Points(vegetationGeometry, vegetationMaterial)
  vegetation.name = "jiaxiu-context-vegetation"
  vegetation.renderOrder = -2
  root.add(vegetation)

  const particlesGeometry = new THREE.BufferGeometry()
  const particleBasePositions = makeParticlePositions()
  particlesGeometry.setAttribute("position", new THREE.BufferAttribute(particleBasePositions.slice(), 3))
  const particlesMaterial = new THREE.PointsMaterial({
    color: PALETTES[initialSeason].particle,
    size: PALETTES[initialSeason].particleStyle.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: reducedMotion ? 0 : PALETTES[initialSeason].particleStyle.opacity,
    depthWrite: false,
    alphaTest: 0.04,
    map: makeSoftParticleMap(),
  })
  const particles = new THREE.Points(particlesGeometry, particlesMaterial)
  particles.name = "jiaxiu-context-particles"
  particles.renderOrder = -1
  root.add(particles)

  const effectBasePositions = makeEffectPositions()
  const effectGeometry = new THREE.BufferGeometry()
  effectGeometry.setAttribute("position", new THREE.BufferAttribute(effectBasePositions.slice(), 3))
  const effectMaterial = new THREE.PointsMaterial({
    color: PALETTES[initialSeason].effectColor,
    size: PALETTES[initialSeason].effectStyle.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: reducedMotion ? 0 : PALETTES[initialSeason].effectStyle.opacity,
    depthWrite: false,
    alphaTest: 0.04,
    blending: THREE.AdditiveBlending,
    map: makeSoftParticleMap(),
  })
  const effect = new THREE.Points(effectGeometry, effectMaterial)
  effect.name = "jiaxiu-context-season-effect"
  effect.renderOrder = -1
  root.add(effect)

  // Realistic weather: each season is drawn with a recognizable sprite shape that
  // falls downward (with a slight wind sway) rather than as plain round particles.
  const rainTexture = makeRaindropTexture()
  const snowflakeTexture = makeSnowflakeTexture()
  const leafTexture = makeLeafTexture()
  const softTexture = makeSoftParticleMap()
  const PARTICLES_MAPS: Record<SeasonId, THREE.Texture> = {
    spring: rainTexture,
    summer: softTexture,
    autumn: leafTexture,
    winter: snowflakeTexture,
  }
  const EFFECT_MAPS: Record<SeasonId, THREE.Texture> = {
    spring: softTexture,
    summer: softTexture,
    autumn: leafTexture,
    winter: snowflakeTexture,
  }
  particlesMaterial.map = PARTICLES_MAPS[initialSeason]
  particlesMaterial.needsUpdate = true
  effectMaterial.map = EFFECT_MAPS[initialSeason]
  effectMaterial.needsUpdate = true

  const ambient = new THREE.HemisphereLight(
    PALETTES[initialSeason].ambientSky,
    PALETTES[initialSeason].ambientGround,
    PALETTES[initialSeason].ambientIntensity,
  )
  ambient.name = "jiaxiu-context-ambient"
  const key = new THREE.DirectionalLight(PALETTES[initialSeason].keyColor, PALETTES[initialSeason].keyIntensity)
  key.name = "jiaxiu-context-key"
  key.position.set(-4, 8, 6)
  root.add(ambient, key)

  let disposed = false
  let motionReduced = reducedMotion
  let activeSeason = initialSeason
  let start = performance.now()
  let startPalette = PALETTES[initialSeason]
  let particleLastUpdate = start
  let particleFallPhase = 0
  let particleSwayPhase = 0
  let effectLastUpdate = start
  let effectPhase = 0
  let effectVerticalPhase = 0

  const applyPalette = (progress: number) => {
    const palette = interpolatePalette(startPalette, PALETTES[activeSeason], progress)
    scene.background = new THREE.Color(palette.background)
    waterMaterial.uniforms.waterColor.value.setHex(palette.water)
    waterMaterial.uniforms.rippleColor.value.setHex(palette.shore)
    waterMaterial.uniforms.flow.value = palette.waterSpeed
    shoreMaterials.forEach((material) => material.color.setHex(palette.shore))
    bridgeMaterial.color.setHex(palette.shore)
    gardenMaterial.color.setHex(palette.foliage)
    gardenMarkersMaterial.color.setHex(palette.foliage)
    vegetationMaterial.color.setHex(palette.foliage)
    vegetationMaterial.size = palette.vegetationSize
    vegetationMaterial.opacity = palette.vegetationOpacity
    particlesMaterial.color.setHex(palette.particle)
    particlesMaterial.size = palette.particleStyle.size
    particlesMaterial.opacity = motionReduced ? 0 : palette.particleStyle.opacity
    particlesMaterial.map = PARTICLES_MAPS[activeSeason]
    particlesMaterial.needsUpdate = true
    effectMaterial.color.setHex(palette.effectColor)
    effectMaterial.size = palette.effectStyle.size
    effectMaterial.opacity = motionReduced ? 0 : palette.effectStyle.opacity
    effectMaterial.map = EFFECT_MAPS[activeSeason]
    effectMaterial.needsUpdate = true
    ambient.color.setHex(palette.ambientSky)
    ambient.groundColor.setHex(palette.ambientGround)
    ambient.intensity = palette.ambientIntensity
    key.color.setHex(palette.keyColor)
    key.intensity = palette.keyIntensity
    splat.recolor.setHex(palette.splatTint)
    splat.opacity = palette.splatOpacity
    return palette
  }
  applyPalette(1)

  const updateParticles = (now: number, style: ParticleStyle) => {
    const deltaSeconds = Math.max(0, (now - particleLastUpdate) / 1000)
    particleLastUpdate = now
    if (motionReduced) return
    particleFallPhase = (particleFallPhase + deltaSeconds * style.fallSpeed) % PARTICLE_VERTICAL_SPAN
    particleSwayPhase = (particleSwayPhase + deltaSeconds * style.swayRate) % FULL_TURN
    const positions = particlesGeometry.getAttribute("position") as THREE.BufferAttribute
    // These are restrained contextual cues, not a physical weather simulation.
    for (let index = 0; index < positions.count; index += 1) {
      const offset = index * 3
      const phase = index * 0.61803398875
      const sway = particleSwayPhase + phase
      const localY = particleBasePositions[offset + 1] - PARTICLE_MIN_Y - particleFallPhase
      const wrappedY = PARTICLE_MIN_Y + ((localY % PARTICLE_VERTICAL_SPAN) + PARTICLE_VERTICAL_SPAN) % PARTICLE_VERTICAL_SPAN
      positions.setX(index, particleBasePositions[offset] + Math.sin(sway) * style.drift)
      positions.setY(index, wrappedY + Math.sin(sway * 0.7) * style.bob)
      positions.setZ(index, particleBasePositions[offset + 2] + Math.cos(sway) * style.drift * 0.45)
    }
    positions.needsUpdate = true
  }

  const updateEffect = (now: number, style: EffectStyle) => {
    const deltaSeconds = Math.max(0, (now - effectLastUpdate) / 1000)
    effectLastUpdate = now
    if (motionReduced) return
    effectPhase = (effectPhase + deltaSeconds * style.swayRate) % FULL_TURN
    effectVerticalPhase = (effectVerticalPhase + deltaSeconds * style.rise * 8) % PARTICLE_VERTICAL_SPAN
    const positions = effectGeometry.getAttribute("position") as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const offset = index * 3
      const sway = effectPhase + index * 0.754877666
      const vertical = effectBasePositions[offset + 1] + effectVerticalPhase
      const wrapped = PARTICLE_MIN_Y + (((vertical - PARTICLE_MIN_Y) % PARTICLE_VERTICAL_SPAN) + PARTICLE_VERTICAL_SPAN) % PARTICLE_VERTICAL_SPAN
      positions.setX(index, effectBasePositions[offset] + Math.sin(sway) * style.drift + Math.cos(index * 1.7) * style.drift * 0.4)
      positions.setY(index, wrapped + Math.sin(sway * 0.6) * 0.02)
      positions.setZ(index, effectBasePositions[offset + 2] + Math.cos(sway) * style.drift * 0.5)
    }
    positions.needsUpdate = true
  }

  return {
    setSeason(season, at = performance.now()) {
      if (disposed || season === activeSeason) return
      if (motionReduced) {
        activeSeason = season
        startPalette = PALETTES[season]
        start = at
        applyPalette(1)
        return
      }
      const currentProgress = Math.min(1, Math.max(0, (at - start) / SEASON_TRANSITION_MS))
      startPalette = interpolatePalette(startPalette, PALETTES[activeSeason], easeInOut(currentProgress))
      activeSeason = season
      start = at
    },
    setReducedMotion(next, at = performance.now()) {
      if (disposed || next === motionReduced) return
      motionReduced = next
      startPalette = PALETTES[activeSeason]
      start = at
      particleLastUpdate = at
      effectLastUpdate = at
      effectVerticalPhase = 0
      applyPalette(1)
    },
    update(now) {
      if (disposed) return
      const raw = Math.min(1, Math.max(0, (now - start) / SEASON_TRANSITION_MS))
      const palette = applyPalette(easeInOut(raw))
      waterMaterial.uniforms.time.value = now
      updateParticles(now, palette.particleStyle)
      updateEffect(now, palette.effectStyle)
    },
    dispose() {
      if (disposed) return
      disposed = true
      scene.remove(root)
      root.traverse((node) => {
        const object = node as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
        object.geometry?.dispose()
        if (Array.isArray(object.material)) object.material.forEach(disposeMaterial)
        else if (object.material) disposeMaterial(object.material)
      })
    },
  }
}
