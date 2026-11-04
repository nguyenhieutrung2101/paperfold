import { Color, DataTexture, DoubleSide, MeshPhysicalMaterial, RGBAFormat, type Texture, Vector2 } from 'three';

export interface PaperLook {
  readonly front: string;
  readonly back: string;
  /** 0..1 how much light passes through (thin kami glows, card doesn't). */
  readonly translucency: number;
  readonly roughness: number;
  readonly fiberStrength: number;
}

export interface PaperMaterial {
  readonly material: MeshPhysicalMaterial;
  setLook(look: PaperLook): void;
  /**
   * The layer map (see layerTextures.ts), how strongly to draw it (0..1), and how high a ridge
   * an edge underneath presses up (mm; 0 turns ridges off, as for ideal paper).
   */
  setLayers(a: Texture | null, b: Texture | null, amount: number, ridgeMm: number): void;
  /** 0 normal light, 1 on the lightbox. */
  setLightbox(amount: number): void;
  dispose(): void;
}

const blank = () => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
  t.needsUpdate = true;
  return t;
};

/**
 * Two-sided paper: front and back colors chosen per fragment (gl_FrontFacing), a fiber
 * normal map, high roughness with a faint sheen, and cheap translucency: light arriving
 * from behind the surface adds a tinted back-light term, so thin paper glows a little and
 * hidden layers read as soft shadows when backlit (brief, section 4, "Material").
 *
 * The `glow` vertex attribute lights a face warm when the kernel says it's in the way.
 *
 * Reading the layers (Phase 2): on the side of the paper facing up, the layer map adds a soft
 * contact shadow just past every layer lying on it, a thin dark line on cut edges, a light rim
 * on folded edges, a faint ridge where an edge underneath presses through (a bump in the
 * normal, so it shows in raking light), and, thin paper being a little see-through, a single
 * layer over the mat reads a touch darker than a stack. The lightbox swaps the room's light for
 * light from below: each layer passes a fraction of it, so thick stacks go dark and hidden
 * flaps show as steps.
 * APPROXIMATION: the shadow width, line weights, ridge height and per-layer transmission are
 * tuned by eye, not measured (ADR-043).
 */
export function createPaperMaterial(look: PaperLook, normalMap: Texture, albedo: Texture): PaperMaterial {
  const blankA = blank();
  const blankB = blank();
  const uniforms = {
    uBackColor: { value: new Color(look.back) },
    uTranslucency: { value: look.translucency },
    uGlowColor: { value: new Color('#ff7a2f').multiplyScalar(0.55) },
    uLayerA: { value: blankA as Texture },
    uLayerB: { value: blankB as Texture },
    uLayerOn: { value: 0 },
    uRidgeMm: { value: 0 },
    uBevelMm: { value: 0.3 },
    uLightbox: { value: 0 },
    uLightColor: { value: new Color('#fff6e6').multiplyScalar(1.3) },
  };
  const material = new MeshPhysicalMaterial({
    color: new Color(look.front),
    roughness: look.roughness,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.85,
    sheenColor: new Color('#ffffff'),
    normalMap,
    normalScale: new Vector2(look.fiberStrength, look.fiberStrength),
    map: albedo,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;\nvarying vec2 vLayerUv;\nvarying float vUpY;')
      .replace(
        '#include <begin_vertex>',
        // The sheet coordinates (uv, before any texture repeat) and which way this point's front
        // side faces in the world.
        '#include <begin_vertex>\nvGlow = glow;\nvLayerUv = uv;\nvUpY = normalize( mat3( modelMatrix ) * objectNormal ).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uBackColor;
uniform float uTranslucency;
uniform vec3 uGlowColor;
uniform sampler2D uLayerA;
uniform sampler2D uLayerB;
uniform float uLayerOn;
uniform float uRidgeMm;
uniform float uBevelMm;
uniform float uLightbox;
uniform vec3 uLightColor;
varying float vGlow;
varying vec2 vLayerUv;
varying float vUpY;`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec4 diffuseColor = vec4( gl_FrontFacing ? diffuse : uBackColor, opacity );
  // The layer map describes the side facing up; fade it out as a face tips up (a flap in motion).
  float pfFacing = smoothstep( 0.55, 0.9, ( gl_FrontFacing ? 1.0 : -1.0 ) * vUpY );
  float pfUp = uLayerOn * pfFacing;
  vec4 pfA = texture2D( uLayerA, vLayerUv );
  vec4 pfB = texture2D( uLayerB, vLayerUv );
  // Contact shadow past the layers on top, a dark line on cut edges.
  diffuseColor.rgb *= 1.0 - pfUp * ( 0.55 * pfA.r + 0.3 * pfB.b );
  // A single layer over the mat lets a little of the mat through.
  diffuseColor.rgb *= 1.0 - pfUp * 0.14 * uTranslucency * ( 1.0 - clamp( pfB.r * 8.0, 0.0, 1.0 ) );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    // Ridges: the edges underneath push the sheet up by uRidgeMm. Folded edges round off by
    // uBevelMm. A bump in world units (Mikkelsen's surface-gradient bump, unnormalized), so it
    // looks the same at any zoom.
    vec2 dSTdx = dFdx( vLayerUv );
    vec2 dSTdy = dFdy( vLayerUv );
    vec2 hk = vec2( uRidgeMm, -uBevelMm ) * pfUp;
    float hll = dot( hk, texture2D( uLayerA, vLayerUv ).gb );
    float dBx = dot( hk, texture2D( uLayerA, vLayerUv + dSTdx ).gb ) - hll;
    float dBy = dot( hk, texture2D( uLayerA, vLayerUv + dSTdy ).gb ) - hll;
    vec3 sx = dFdx( -vViewPosition );
    vec3 sy = dFdy( -vViewPosition );
    vec3 r1 = cross( sy, normal );
    vec3 r2 = cross( normal, sx );
    float det = dot( sx, r1 ) * faceDirection;
    vec3 grad = sign( det ) * ( dBx * r1 + dBy * r2 );
    vec3 bumped = abs( det ) * normal - grad;
    if ( dot( bumped, bumped ) > 1e-12 ) normal = normalize( bumped );
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vGlow * uGlowColor;
// Folded edges are round: they catch the light.
totalEmissiveRadiance += pfUp * pfA.b * 0.08 * diffuseColor.rgb;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  // Back-lit transmission: light on the far side of the sheet shows through it.
  vec3 transl = vec3( 0.0 );
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    {
      float through = max( 0.0, -dot( normal, directionalLights[ i ].direction ) );
      transl += directionalLights[ i ].color * pow( through, 1.5 );
    }
  }
  #pragma unroll_loop_end
  reflectedLight.directDiffuse += transl * diffuseColor.rgb * uTranslucency;
}
#endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  // Lightbox: light from below, a fraction lost in every layer it passes.
  float layers = 1.0 + ( pfB.r + pfB.g ) * ( 255.0 / 32.0 ) * uLayerOn;
  float perLayer = mix( 0.45, 0.72, uTranslucency );
  vec3 through = uLightColor * pow( perLayer, layers - 1.0 ) * mix( vec3( 1.0 ), diffuseColor.rgb, 0.45 );
  vec3 boxed = mix( outgoingLight * 0.35, through + outgoingLight * 0.12, pfFacing );
  outgoingLight = mix( outgoingLight, boxed, uLightbox );
}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'paperfold-paper-v2';

  return {
    material,
    setLook(next) {
      material.color.set(next.front);
      uniforms.uBackColor.value.set(next.back);
      uniforms.uTranslucency.value = next.translucency;
      material.roughness = next.roughness;
      material.normalScale.set(next.fiberStrength, next.fiberStrength);
    },
    setLayers(a, b, amount, ridgeMm) {
      uniforms.uLayerA.value = a ?? blankA;
      uniforms.uLayerB.value = b ?? blankB;
      uniforms.uLayerOn.value = a && b ? amount : 0;
      uniforms.uRidgeMm.value = ridgeMm;
    },
    setLightbox(amount) {
      uniforms.uLightbox.value = amount;
    },
    dispose() {
      material.dispose();
      blankA.dispose();
      blankB.dispose();
    },
  };
}
