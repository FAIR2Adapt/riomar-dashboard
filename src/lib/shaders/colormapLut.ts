import {
  applyColormapShaders,
  availableColormaps,
  colormapShaders,
  type TColorMap,
} from "./colormapShaders";

/* Builds a CPU-side RGB lookup table for any of the GLSL colormaps by rendering
   the exact same shader code to a tiny offscreen WebGL texture and reading the
   pixels back. This lets non-WebGL renderers (e.g. the MapLibre HEALPix view,
   which colors GeoJSON in JS) use colormaps identical to the 3D globe without
   duplicating the colormap definitions. */

const LUT_SIZE = 256;

// Cache the compiled program / context and per-colormap LUTs across calls.
let glContext: WebGLRenderingContext | null = null;
let glProgram: WebGLProgram | null = null;
let colormapUniform: WebGLUniformLocation | null = null;
const lutCache = new Map<TColorMap, Uint8ClampedArray>();

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Colormap LUT shader compile failed: ${info}`);
  }
  return shader;
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexSource = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }`;
  // normalized_value runs 0..1 across the LUT_SIZE-wide viewport; applyColormap
  // shaders dispatches on the `colormap` int uniform and writes gl_FragColor.rgb.
  const fragmentSource = `
    precision highp float;
    uniform int colormap;
    ${colormapShaders}
    void main() {
      float normalized_value = (gl_FragCoord.x - 0.5) / ${(LUT_SIZE - 1).toFixed(1)};
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      ${applyColormapShaders}
    }`;

  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(
    program,
    compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `Colormap LUT program link failed: ${gl.getProgramInfoLog(program)}`
    );
  }
  return program;
}

function setupQuad(gl: WebGLRenderingContext, program: WebGLProgram): void {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const positionLoc = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
}

function initGl(): boolean {
  if (glContext && glProgram) {
    return true;
  }
  const canvas = document.createElement("canvas");
  canvas.width = LUT_SIZE;
  canvas.height = 1;
  const gl =
    canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) {
    return false;
  }
  const realGl = gl as WebGLRenderingContext;
  const program = buildProgram(realGl);
  realGl.useProgram(program);
  setupQuad(realGl, program);

  glContext = realGl;
  glProgram = program;
  colormapUniform = realGl.getUniformLocation(program, "colormap");
  return true;
}

function renderLut(colormapId: number): Uint8ClampedArray {
  const gl = glContext!;
  gl.viewport(0, 0, LUT_SIZE, 1);
  gl.uniform1i(colormapUniform, colormapId);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const pixels = new Uint8Array(LUT_SIZE * 4);
  gl.readPixels(0, 0, LUT_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    lut[i * 3] = pixels[i * 4];
    lut[i * 3 + 1] = pixels[i * 4 + 1];
    lut[i * 3 + 2] = pixels[i * 4 + 2];
  }
  return lut;
}

/* Returns a 256*3 RGB lookup table (Uint8ClampedArray) for the given colormap,
   or null if WebGL is unavailable. Index i corresponds to normalized value
   i/255. Results are cached per colormap. */
export function getColormapLut(name: TColorMap): Uint8ClampedArray | null {
  const cached = lutCache.get(name);
  if (cached) {
    return cached;
  }
  if (!initGl()) {
    return null;
  }
  const lut = renderLut(availableColormaps[name]);
  lutCache.set(name, lut);
  return lut;
}
