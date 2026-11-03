import { Color, DoubleSide, MeshPhysicalMaterial, type Texture, Vector2 } from 'three';

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
  dispose(): void;
}

/**
 * Two-sided paper: front and back colors chosen per fragment (gl_FrontFacing), a fiber
 * normal map, high roughness with a faint sheen, and cheap translucency: light arriving
 * from behind the surface adds a tinted back-light term, so thin paper glows a little and
 * hidden layers read as soft shadows when backlit (brief, section 4, "Material").
 *
 * The `glow` vertex attribute lights a face warm when the kernel says it's in the way.
 */
export function createPaperMaterial(look: PaperLook, normalMap: Texture, albedo: Texture): PaperMaterial {
  const uniforms = {
    uBackColor: { value: new Color(look.back) },
    uTranslucency: { value: look.translucency },
    uGlowColor: { value: new Color('#ff7a2f').multiplyScalar(0.55) },
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
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uBackColor;\nuniform float uTranslucency;\nuniform vec3 uGlowColor;\nvarying float vGlow;',
      )
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( gl_FrontFacing ? diffuse : uBackColor, opacity );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uGlowColor;')
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
      );
  };
  material.customProgramCacheKey = () => 'paperfold-paper-v1';

  return {
    material,
    setLook(next) {
      material.color.set(next.front);
      uniforms.uBackColor.value.set(next.back);
      uniforms.uTranslucency.value = next.translucency;
      material.roughness = next.roughness;
      material.normalScale.set(next.fiberStrength, next.fiberStrength);
    },
    dispose() {
      material.dispose();
    },
  };
}
