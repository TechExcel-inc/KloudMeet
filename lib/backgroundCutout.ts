/**
 * Camera backgrounds, the drawing side. MediaPipe's selfie model says roughly where the person is;
 * this file turns that into a clean edge and draws the picture. It takes the place of
 * @livekit/track-processors' own renderer, whose yes/no mask left a band of the real room around
 * the hair that flickered from frame to frame (real-meeting test, 2026-10-29):
 *
 * - it reads the model's confidence instead of the yes/no mask, and evens it out over a few frames;
 * - it pulls the edge onto the outline in the camera picture (a joint bilateral filter guided by
 *   the image), so a band of wall next to hair falls back to the background;
 * - blur leaves the person out of the blur, so their own colours don't glow around them.
 *
 * Every pass runs on the GPU in the WebGL2 context MediaPipe draws with, so frames stay there.
 * `@mediapipe/tasks-vision` comes in with @livekit/track-processors (same pinned version).
 */

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { ProcessorWrapper, VideoTransformer } from '@livekit/track-processors';
import type { VideoTransformerInitOptions } from '@livekit/track-processors';

export type BackgroundLook = { kind: 'blur'; radius: number } | { kind: 'image'; url: string };
export type CutoutAssets = { wasm: string; model: string };

/**
 * How the edge is found. `from`/`to`: confidence below `from` is background, above `to` the
 * person, a soft ramp between. `reach`: how far (camera pixels) the edge may move to meet the
 * outline in the picture. `colour`: how different two pixels may look and still count as alike.
 */
const EDGE = { from: 0.5, to: 0.8, reach: 32, colour: 0.1 };
type EdgeTuning = typeof EDGE;

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const VERTEX = `#version 300 es
in vec2 a_position;
uniform bool u_toScreen;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  // Textures here keep the picture's top row first; the canvas shows its first row at the bottom.
  if (u_toScreen) v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** Evens out the model's answer over frames: small changes are edge noise, big ones are movement. */
const TEMPORAL = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_confidence;
uniform sampler2D u_previous;
uniform bool u_first;
out vec4 o;
void main() {
  float now = texture(u_confidence, v_uv).r;
  float before = texture(u_previous, v_uv).r;
  float follow = u_first ? 1.0 : mix(0.45, 1.0, smoothstep(0.12, 0.45, abs(now - before)));
  o = vec4(mix(before, now, follow), 0.0, 0.0, 1.0);
}`;

/** Joint bilateral filter: averages the confidence only over pixels that look like this one. */
const REFINE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform sampler2D u_frame;
uniform vec2 u_step;
uniform float u_colour;
out vec4 o;
const int R = 4;
const float SPACE = 0.08;  // 1 / (2 * 2.5^2): spatial sigma of 2.5 taps
void main() {
  vec3 centre = texture(u_frame, v_uv).rgb;
  float sum = 0.0;
  float weights = 0.0;
  for (int y = -R; y <= R; y++) {
    for (int x = -R; x <= R; x++) {
      vec2 uv = v_uv + vec2(float(x), float(y)) * u_step;
      vec3 d = texture(u_frame, uv).rgb - centre;
      float w = exp(-float(x * x + y * y) * SPACE - dot(d, d) * u_colour);
      sum += w * texture(u_mask, uv).r;
      weights += w;
    }
  }
  o = vec4(sum / weights, 0.0, 0.0, 1.0);
}`;

/** Shrinks the picture for the blur, keeping only what is background (premultiplied). */
const WEIGH = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform vec2 u_texel;
uniform float u_from;
out vec4 o;
void main() {
  vec3 c = texture(u_frame, v_uv + vec2(-0.5, -0.5) * u_texel).rgb
         + texture(u_frame, v_uv + vec2(0.5, -0.5) * u_texel).rgb
         + texture(u_frame, v_uv + vec2(-0.5, 0.5) * u_texel).rgb
         + texture(u_frame, v_uv + vec2(0.5, 0.5) * u_texel).rgb;
  float keep = 1.0 - smoothstep(u_from - 0.2, u_from, texture(u_mask, v_uv).r);
  o = vec4(c * 0.25 * keep, keep);
}`;

const BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_direction;
uniform float u_sigma;
out vec4 o;
const int MAX_TAPS = 12;
void main() {
  int taps = int(min(float(MAX_TAPS), ceil(u_sigma * 2.0)));
  float k = 1.0 / (2.0 * u_sigma * u_sigma);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -MAX_TAPS; i <= MAX_TAPS; i++) {
    if (abs(i) > taps) continue;
    float w = exp(-float(i * i) * k);
    sum += texture(u_source, v_uv + float(i) * u_direction) * w;
    total += w;
  }
  o = sum / total;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform sampler2D u_scene;
uniform sampler2D u_blurred;
uniform bool u_blur;
uniform vec2 u_sceneScale;
uniform vec2 u_edge;
uniform bool u_showMask;
out vec4 o;
void main() {
  vec3 person = texture(u_frame, v_uv).rgb;
  float alpha = smoothstep(u_edge.x, u_edge.y, texture(u_mask, v_uv).r);
  if (u_showMask) {
    o = vec4(vec3(alpha), 1.0);
    return;
  }
  vec3 behind;
  if (u_blur) {
    vec4 b = texture(u_blurred, v_uv);
    behind = b.a > 0.002 ? b.rgb / b.a : person;
  } else {
    behind = texture(u_scene, (v_uv - 0.5) * u_sceneScale + 0.5).rgb;
  }
  o = vec4(mix(behind, person, alpha), 1.0);
}`;

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

type DevHooks = { __kmBackgroundShowMask?: boolean; __kmBackgroundTune?: Partial<EdgeTuning> };

/** Dev-only: `window.__kmBackgroundShowMask = true` draws the cut-out as black and white. */
function showMaskRequested(): boolean {
  return Boolean((globalThis as DevHooks).__kmBackgroundShowMask);
}

/** Dev-only: `window.__kmBackgroundTune = { reach: 24 }` tries other edge settings live. */
function edgeTuning(): EdgeTuning {
  const tune = (globalThis as DevHooks).__kmBackgroundTune;
  return tune ? { ...EDGE, ...tune } : EDGE;
}

class CutoutRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quad: WebGLBuffer;
  private readonly programs: Record<'temporal' | 'refine' | 'weigh' | 'blur' | 'composite', Program>;
  private readonly frame: WebGLTexture;
  private readonly scene: WebGLTexture;
  private readonly floatTargets: boolean;
  private readonly floatMaskLinear: boolean;
  private masks: Target[] = [];
  private refined?: Target;
  private small: Target[] = [];
  private width = 0;
  private height = 0;
  private current = 0;
  private hasMask = false;
  private look: BackgroundLook = { kind: 'blur', radius: 14 };
  private sceneSize = { width: 1, height: 1 };

  constructor(canvas: OffscreenCanvas | HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true }) as
      | WebGL2RenderingContext
      | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.floatTargets = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.floatMaskLinear = Boolean(gl.getExtension('OES_texture_float_linear'));

    this.vao = gl.createVertexArray()!;
    this.quad = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.programs = {
      temporal: this.link(TEMPORAL, ['u_confidence', 'u_previous', 'u_first']),
      refine: this.link(REFINE, ['u_mask', 'u_frame', 'u_step', 'u_colour']),
      weigh: this.link(WEIGH, ['u_frame', 'u_mask', 'u_texel', 'u_from']),
      blur: this.link(BLUR, ['u_source', 'u_direction', 'u_sigma']),
      composite: this.link(COMPOSITE, [
        'u_frame',
        'u_mask',
        'u_scene',
        'u_blurred',
        'u_blur',
        'u_sceneScale',
        'u_edge',
        'u_showMask',
      ]),
    };
    this.frame = this.texture();
    this.scene = this.texture();
  }

  setLook(look: BackgroundLook) {
    this.look = look;
  }

  setScene(image: ImageBitmap) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.scene);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.sceneSize = { width: image.width, height: image.height };
  }

  /** Takes the camera frame in; sizes everything to it. */
  uploadFrame(frame: VideoFrame) {
    const { gl } = this;
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    if (width !== this.width || height !== this.height) this.resize(width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** The model's person confidence for the frame just uploaded (MediaPipe's texture). */
  updateMask(confidence: WebGLTexture) {
    const { gl } = this;
    if (!this.refined) return;
    this.begin();
    const filter = this.floatMaskLinear ? gl.LINEAR : gl.NEAREST;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, confidence);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    const previous = this.masks[this.current];
    const next = this.masks[1 - this.current];
    const temporal = this.use('temporal', next);
    this.bind(temporal, 'u_confidence', 0, confidence);
    this.bind(temporal, 'u_previous', 1, previous.texture);
    gl.uniform1i(temporal.uniforms.u_first, this.hasMask ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.current = 1 - this.current;
    this.end();
    this.hasMask = true;
    this.refine();
  }

  /** True once a frame has been cut out: frames after it may reuse the cut-out. */
  get hasCutout(): boolean {
    return this.hasMask;
  }

  /**
   * Fits the latest cut-out to the frame just uploaded. Runs after every model pass, and alone on
   * frames the model skips (a busy computer), so the edge still follows the new picture.
   */
  refine() {
    const { gl } = this;
    if (!this.refined || !this.hasMask) return;
    this.begin();
    const edge = edgeTuning();
    const refine = this.use('refine', this.refined);
    this.bind(refine, 'u_mask', 0, this.masks[this.current].texture);
    this.bind(refine, 'u_frame', 1, this.frame);
    // Four taps each way, spaced so the outermost lands `reach` camera pixels out.
    gl.uniform2f(refine.uniforms.u_step, edge.reach / 4 / this.width, edge.reach / 4 / this.height);
    gl.uniform1f(refine.uniforms.u_colour, 1 / (2 * edge.colour * edge.colour));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.end();
  }

  /** Draws the frame onto the canvas. False until there is a mask: no frame goes out uncut. */
  draw(): boolean {
    const { gl } = this;
    if (!this.hasMask || !this.refined) return false;
    this.begin();
    const edge = edgeTuning();
    const blur = this.look.kind === 'blur';
    if (blur) {
      const [a, b] = this.small;
      const weigh = this.use('weigh', a);
      this.bind(weigh, 'u_frame', 0, this.frame);
      this.bind(weigh, 'u_mask', 1, this.refined.texture);
      gl.uniform2f(weigh.uniforms.u_texel, 1 / this.width, 1 / this.height);
      gl.uniform1f(weigh.uniforms.u_from, edge.from);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // The library's radius is in camera pixels; this blur runs at a quarter of that.
      const sigma = Math.max(1, (this.look.kind === 'blur' ? this.look.radius : 0) / 4);
      const pass = this.use('blur', b);
      this.bind(pass, 'u_source', 0, a.texture);
      gl.uniform2f(pass.uniforms.u_direction, 1 / a.width, 0);
      gl.uniform1f(pass.uniforms.u_sigma, sigma);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.use('blur', a);
      this.bind(pass, 'u_source', 0, b.texture);
      gl.uniform2f(pass.uniforms.u_direction, 0, 1 / a.height);
      gl.uniform1f(pass.uniforms.u_sigma, sigma);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const composite = this.use('composite', null);
    this.bind(composite, 'u_frame', 0, this.frame);
    this.bind(composite, 'u_mask', 1, this.refined.texture);
    this.bind(composite, 'u_scene', 2, this.scene);
    this.bind(composite, 'u_blurred', 3, this.small[0].texture);
    gl.uniform1i(composite.uniforms.u_blur, blur ? 1 : 0);
    const frameAspect = this.width / this.height;
    const sceneAspect = this.sceneSize.width / this.sceneSize.height;
    // Cover: the scene fills the frame, cropped on the long side.
    if (sceneAspect > frameAspect) gl.uniform2f(composite.uniforms.u_sceneScale, frameAspect / sceneAspect, 1);
    else gl.uniform2f(composite.uniforms.u_sceneScale, 1, sceneAspect / frameAspect);
    gl.uniform2f(composite.uniforms.u_edge, edge.from, edge.to);
    gl.uniform1i(composite.uniforms.u_showMask, showMaskRequested() ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.end();
    return true;
  }

  dispose() {
    const { gl } = this;
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    this.freeTargets();
    gl.deleteTexture(this.frame);
    gl.deleteTexture(this.scene);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }

  private resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.freeTargets();
    const halfW = Math.max(1, Math.round(width / 2));
    const halfH = Math.max(1, Math.round(height / 2));
    const quarterW = Math.max(1, Math.round(width / 4));
    const quarterH = Math.max(1, Math.round(height / 4));
    this.masks = [this.target(halfW, halfH, false), this.target(halfW, halfH, false)];
    this.refined = this.target(halfW, halfH, false);
    // Premultiplied blur needs more than 8 bits where little background is left to average.
    this.small = [this.target(quarterW, quarterH, true), this.target(quarterW, quarterH, true)];
    this.hasMask = false;
  }

  private freeTargets() {
    const { gl } = this;
    for (const t of [...this.masks, ...this.small, ...(this.refined ? [this.refined] : [])]) {
      gl.deleteFramebuffer(t.framebuffer);
      gl.deleteTexture(t.texture);
    }
    this.masks = [];
    this.small = [];
    this.refined = undefined;
  }

  private texture(): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private target(width: number, height: number, precise: boolean): Target {
    const { gl } = this;
    const texture = this.texture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (precise && this.floatTargets) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, framebuffer, width, height };
  }

  private link(fragment: string, names: string[]): Program {
    const { gl } = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Background shader failed to compile: ${log}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Background shader failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms: Program['uniforms'] = { u_toScreen: gl.getUniformLocation(program, 'u_toScreen') };
    for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }

  /** MediaPipe shares this context, so set every piece of state we rely on, every time. */
  private begin() {
    const { gl } = this;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
  }

  private end() {
    const { gl } = this;
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private use(name: keyof CutoutRenderer['programs'], target: Target | null): Program {
    const { gl } = this;
    const program = this.programs[name];
    gl.useProgram(program.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, target ? target.width : this.width, target ? target.height : this.height);
    gl.uniform1i(program.uniforms.u_toScreen, target ? 0 : 1);
    return program;
  }

  private bind(program: Program, name: string, unit: number, texture: WebGLTexture) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.uniforms[name], unit);
  }
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Background image ${url}: HTTP ${response.status}`);
  return createImageBitmap(await response.blob());
}

/**
 * A busy computer runs the model on every 2nd or 3rd frame instead of letting the video stutter.
 * The background never switches off on its own: that would show the room.
 */
const MODEL_BUDGET_MS = 22; // per frame at 30 fps, leaving room for drawing and encoding
const MODEL_WARM_UP = 10; // the first runs compile shaders and are much slower
// Runs to wait after a change: quick to ease off when busy, slow to speed back up (no see-saw).
const MODEL_SETTLE_UP = 30;
const MODEL_SETTLE_DOWN = 150;

class CutoutTransformer extends VideoTransformer<BackgroundLook> {
  private segmenter?: ImageSegmenter;
  private modelEvery = 1;
  private modelRuns = 0;
  private modelMs = 0;
  private modelChangedAt = 0;
  private frameCount = 0;
  private renderer?: CutoutRenderer;
  private look: BackgroundLook;
  private scene?: { url: string; image: ImageBitmap };
  private readonly assets: CutoutAssets;

  constructor(look: BackgroundLook, assets: CutoutAssets) {
    super();
    this.look = look;
    this.assets = assets;
  }

  // Not super.init(): it would build the library's own renderer on this canvas as well.
  async init({ outputCanvas, inputElement }: VideoTransformerInitOptions) {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas;
    this.inputVideo = inputElement;
    try {
      this.renderer = new CutoutRenderer(outputCanvas);
      const files = await FilesetResolver.forVisionTasks(this.assets.wasm);
      this.segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: this.assets.model, delegate: 'GPU' },
        canvas: outputCanvas,
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      await this.update(this.look);
    } catch (error) {
      await this.destroy();
      throw error;
    }
    this.isDisabled = false;
  }

  async restart(options: VideoTransformerInitOptions) {
    await this.destroy();
    await this.init(options);
  }

  async destroy() {
    this.isDisabled = true;
    this.segmenter?.close();
    this.segmenter = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.scene?.image.close();
    this.scene = undefined;
    this.canvas = undefined;
  }

  async update(look: BackgroundLook) {
    if (look.kind === 'image' && this.scene?.url !== look.url) {
      const image = await loadImage(look.url);
      this.scene?.image.close();
      this.scene = { url: look.url, image };
      this.renderer?.setScene(image);
    } else if (look.kind === 'image' && this.scene) {
      this.renderer?.setScene(this.scene.image);
    }
    this.look = look;
    this.renderer?.setLook(look);
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    const { segmenter, renderer, canvas } = this;
    try {
      // Dropped, never passed through: the raw room must not reach the meeting.
      if (this.isDisabled || !segmenter || !renderer || !canvas || frame.codedWidth === 0) return;
      renderer.uploadFrame(frame);
      if (!renderer.hasCutout || this.frameCount++ % this.modelEvery === 0) {
        const started = performance.now();
        segmenter.segmentForVideo(frame, started, (result) => {
          const confidence = result.confidenceMasks?.[0];
          if (confidence) renderer.updateMask(confidence.getAsWebGLTexture());
          result.close();
        });
        this.noteModelTime(performance.now() - started);
      } else {
        renderer.refine();
      }
      if (renderer.draw()) {
        controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }));
      }
    } catch (error) {
      console.warn('[KloudMeet] Camera background frame failed', error);
    } finally {
      frame.close();
    }
  }

  private noteModelTime(ms: number) {
    this.modelRuns++;
    if (this.modelRuns <= MODEL_WARM_UP) return;
    this.modelMs = this.modelMs === 0 ? ms : this.modelMs * 0.92 + ms * 0.08;
    const before = this.modelEvery;
    const settled = this.modelRuns - this.modelChangedAt;
    if (this.modelMs > MODEL_BUDGET_MS * this.modelEvery && this.modelEvery < 3) {
      if (settled > MODEL_SETTLE_UP) this.modelEvery++;
    } else if (this.modelEvery > 1 && this.modelMs < MODEL_BUDGET_MS * 0.7 * (this.modelEvery - 1)) {
      if (settled > MODEL_SETTLE_DOWN) this.modelEvery--;
    }
    if (this.modelEvery !== before) {
      this.modelChangedAt = this.modelRuns;
      console.info(
        `[KloudMeet] Camera background: model takes ${Math.round(this.modelMs)} ms, now on every ${this.modelEvery === 1 ? '' : `${this.modelEvery}${this.modelEvery === 2 ? 'nd' : 'rd'} `}frame`,
      );
    }
  }
}

/** A LiveKit processor around the cut-out; `switchTo` changes the look without a restart. */
export class BackgroundPipeline extends ProcessorWrapper<BackgroundLook, CutoutTransformer> {
  switchTo(look: BackgroundLook) {
    return this.updateTransformerOptions(look);
  }
}

export function createBackgroundPipeline(look: BackgroundLook, assets: CutoutAssets): BackgroundPipeline {
  return new BackgroundPipeline(new CutoutTransformer(look, assets), 'kloud-background-cutout');
}
