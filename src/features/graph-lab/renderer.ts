import type { Camera, GraphData, GraphRenderer } from "./types";

const vertexShaderHeader = `#version 300 es
precision highp float;

vec2 toClip(vec2 world, vec3 camera, vec2 viewport) {
  vec2 screen = world * camera.z + camera.xy;
  return vec2(screen.x / viewport.x * 2.0 - 1.0, 1.0 - screen.y / viewport.y * 2.0);
}
`;

const edgeVertexShader = `${vertexShaderHeader}
layout(location = 0) in vec2 point;
layout(location = 1) in vec3 color;
uniform vec2 viewport;
uniform vec3 camera;
out vec3 edgeColor;
void main() {
  edgeColor = color;
  gl_Position = vec4(toClip(point, camera, viewport), 0.0, 1.0);
}`;

const edgeFragmentShader = `#version 300 es
precision mediump float;
in vec3 edgeColor;
out vec4 outputColor;
void main() { outputColor = vec4(edgeColor, 0.84); }`;

const nodeVertexShader = `${vertexShaderHeader}
layout(location = 0) in vec2 corner;
layout(location = 1) in vec2 center;
layout(location = 2) in float radius;
layout(location = 3) in vec3 color;
uniform vec2 viewport;
uniform vec3 camera;
out vec2 localPosition;
out vec3 nodeColor;
void main() {
  localPosition = corner;
  nodeColor = color;
  vec2 world = center + corner * radius;
  gl_Position = vec4(toClip(world, camera, viewport), 0.0, 1.0);
}`;

const nodeFragmentShader = `#version 300 es
precision mediump float;
in vec2 localPosition;
in vec3 nodeColor;
out vec4 outputColor;
void main() {
  float distanceFromEdge = 1.0 - length(localPosition);
  float alpha = smoothstep(0.0, fwidth(distanceFromEdge), distanceFromEdge);
  if (alpha <= 0.0) discard;
  outputColor = vec4(nodeColor, alpha);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a WebGL program.");
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function colorComponents(value = "#94a3b8") {
  const normalized = value.startsWith("#") ? value.slice(1) : value;
  const parsed = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized.slice(0, 6), 16);
  return [((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255] as const;
}

function cssColorComponents(value: string) {
  if (value.startsWith("#")) return colorComponents(value);
  const sample = document.createElement("canvas");
  sample.width = 1;
  sample.height = 1;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return colorComponents("#17171a");
  context.fillStyle = "#17171a";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255] as const;
}

function arrowScreenLength(scale: number) {
  return Math.min(9, Math.max(3, 6 * Math.sqrt(scale)));
}

class WebGlGraphRenderer implements GraphRenderer {
  readonly kind = "WebGL 2" as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly edgeProgram: WebGLProgram;
  private readonly nodeProgram: WebGLProgram;
  private readonly edgeBuffer: WebGLBuffer;
  private readonly arrowBuffer: WebGLBuffer;
  private readonly edgeColorBuffer: WebGLBuffer;
  private readonly arrowColorBuffer: WebGLBuffer;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly positionBuffer: WebGLBuffer;
  private readonly radiusBuffer: WebGLBuffer;
  private readonly colorBuffer: WebGLBuffer;
  private readonly edgePositions: Float32Array;
  private readonly arrowPositions: Float32Array;
  private readonly clearColor: readonly [number, number, number];
  private readonly edgeIndices: Uint32Array;
  private readonly nodeRadii: Float32Array;
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement, data: GraphData, nodeIndex: Map<string, number>, backgroundColor: string) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL 2 is not available.");
    this.gl = gl;
    this.edgeProgram = createProgram(gl, edgeVertexShader, edgeFragmentShader);
    this.nodeProgram = createProgram(gl, nodeVertexShader, nodeFragmentShader);
    const buffers = Array.from({ length: 8 }, () => gl.createBuffer());
    if (buffers.some((buffer) => !buffer)) throw new Error("Unable to allocate WebGL buffers.");
    [
      this.edgeBuffer,
      this.arrowBuffer,
      this.edgeColorBuffer,
      this.arrowColorBuffer,
      this.cornerBuffer,
      this.positionBuffer,
      this.radiusBuffer,
      this.colorBuffer,
    ] = buffers as WebGLBuffer[];
    this.clearColor = cssColorComponents(backgroundColor);

    this.edgeIndices = new Uint32Array(data.edges.length * 2);
    data.edges.forEach((edge, index) => {
      this.edgeIndices[index * 2] = nodeIndex.get(edge.source) ?? 0;
      this.edgeIndices[index * 2 + 1] = nodeIndex.get(edge.target) ?? 0;
    });
    this.edgePositions = new Float32Array(data.edges.length * 4);
    this.arrowPositions = new Float32Array(data.edges.length * 6);
    const edgeColors = new Float32Array(data.edges.length * 6);
    const arrowColors = new Float32Array(data.edges.length * 9);
    data.edges.forEach((edge, index) => {
      const color = colorComponents(edge.color);
      edgeColors.set(color, index * 6);
      edgeColors.set(color, index * 6 + 3);
      arrowColors.set(color, index * 9);
      arrowColors.set(color, index * 9 + 3);
      arrowColors.set(color, index * 9 + 6);
    });
    this.nodeRadii = new Float32Array(data.nodes.map((node) => node.radius ?? 7));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.nodes.length * 2 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.radiusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.nodeRadii, gl.STATIC_DRAW);
    const colors = new Float32Array(data.nodes.length * 3);
    data.nodes.forEach((node, index) => colors.set(colorComponents(node.color), index * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.edgePositions.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.arrowPositions.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edgeColors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arrowColors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(positions: Float32Array, camera: Camera) {
    const gl = this.gl;
    gl.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let edgeIndex = 0; edgeIndex < this.edgeIndices.length / 2; edgeIndex += 1) {
      const source = this.edgeIndices[edgeIndex * 2];
      const target = this.edgeIndices[edgeIndex * 2 + 1];
      const sourceX = positions[source * 2];
      const sourceY = positions[source * 2 + 1];
      const targetX = positions[target * 2];
      const targetY = positions[target * 2 + 1];
      const deltaX = targetX - sourceX;
      const deltaY = targetY - sourceY;
      const distance = Math.hypot(deltaX, deltaY) || 1;
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      const sourceInset = this.nodeRadii[source] + 2 / camera.scale;
      const targetInset = this.nodeRadii[target] + 2 / camera.scale;
      const availableLength = Math.max(0, distance - sourceInset - targetInset);
      const arrowLength = Math.min(arrowScreenLength(camera.scale) / camera.scale, availableLength * 0.5);
      const arrowWidth = arrowLength * 0.52;
      const tipX = targetX - unitX * targetInset;
      const tipY = targetY - unitY * targetInset;
      const baseX = tipX - unitX * arrowLength;
      const baseY = tipY - unitY * arrowLength;
      const startX = sourceX + unitX * sourceInset;
      const startY = sourceY + unitY * sourceInset;
      const edgeOffset = edgeIndex * 4;
      this.edgePositions[edgeOffset] = startX;
      this.edgePositions[edgeOffset + 1] = startY;
      this.edgePositions[edgeOffset + 2] = baseX;
      this.edgePositions[edgeOffset + 3] = baseY;
      const arrowOffset = edgeIndex * 6;
      this.arrowPositions[arrowOffset] = tipX;
      this.arrowPositions[arrowOffset + 1] = tipY;
      this.arrowPositions[arrowOffset + 2] = baseX - unitY * arrowWidth;
      this.arrowPositions[arrowOffset + 3] = baseY + unitX * arrowWidth;
      this.arrowPositions[arrowOffset + 4] = baseX + unitY * arrowWidth;
      this.arrowPositions[arrowOffset + 5] = baseY - unitX * arrowWidth;
    }

    gl.useProgram(this.edgeProgram);
    this.setCameraUniforms(this.edgeProgram, camera);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.edgePositions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeColorBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 0);
    gl.drawArrays(gl.LINES, 0, this.edgePositions.length / 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.arrowPositions);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowColorBuffer);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.arrowPositions.length / 2);

    gl.useProgram(this.nodeProgram);
    this.setCameraUniforms(this.nodeProgram, camera);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.radiusBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, positions.length / 2);
  }

  private setCameraUniforms(program: WebGLProgram, camera: Camera) {
    const viewport = this.gl.getUniformLocation(program, "viewport");
    const cameraUniform = this.gl.getUniformLocation(program, "camera");
    this.gl.uniform2f(viewport, this.width, this.height);
    this.gl.uniform3f(cameraUniform, camera.x, camera.y, camera.scale);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this.edgeProgram);
    gl.deleteProgram(this.nodeProgram);
    [
      this.edgeBuffer,
      this.arrowBuffer,
      this.edgeColorBuffer,
      this.arrowColorBuffer,
      this.cornerBuffer,
      this.positionBuffer,
      this.radiusBuffer,
      this.colorBuffer,
    ]
      .forEach((buffer) => gl.deleteBuffer(buffer));
  }
}

class CanvasGraphRenderer implements GraphRenderer {
  readonly kind = "Canvas 2D" as const;
  private readonly context: CanvasRenderingContext2D;
  private ratio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly data: GraphData,
    private readonly nodeIndex: Map<string, number>,
    private readonly backgroundColor: string,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is not available.");
    this.context = context;
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.ratio = pixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
  }

  render(positions: Float32Array, camera: Camera) {
    const context = this.context;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.backgroundColor;
    context.fillRect(0, 0, this.canvas.width / this.ratio, this.canvas.height / this.ratio);
    for (const edge of this.data.edges) {
      const source = this.nodeIndex.get(edge.source) ?? 0;
      const target = this.nodeIndex.get(edge.target) ?? 0;
      const sourceX = positions[source * 2] * camera.scale + camera.x;
      const sourceY = positions[source * 2 + 1] * camera.scale + camera.y;
      const targetX = positions[target * 2] * camera.scale + camera.x;
      const targetY = positions[target * 2 + 1] * camera.scale + camera.y;
      const deltaX = targetX - sourceX;
      const deltaY = targetY - sourceY;
      const distance = Math.hypot(deltaX, deltaY) || 1;
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      const sourceInset = Math.max(2, (this.data.nodes[source].radius ?? 7) * camera.scale) + 2;
      const targetInset = Math.max(2, (this.data.nodes[target].radius ?? 7) * camera.scale) + 2;
      const availableLength = Math.max(0, distance - sourceInset - targetInset);
      const arrowLength = Math.min(arrowScreenLength(camera.scale), availableLength * 0.5);
      const arrowWidth = arrowLength * 0.52;
      const tipX = targetX - unitX * targetInset;
      const tipY = targetY - unitY * targetInset;
      const baseX = tipX - unitX * arrowLength;
      const baseY = tipY - unitY * arrowLength;
      const color = edge.color ?? "#94a3b8";
      context.globalAlpha = 0.82;
      context.lineWidth = 1.25;
      context.strokeStyle = color;
      context.beginPath();
      context.moveTo(sourceX + unitX * sourceInset, sourceY + unitY * sourceInset);
      context.lineTo(baseX, baseY);
      context.stroke();
      context.globalAlpha = 0.94;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(baseX - unitY * arrowWidth, baseY + unitX * arrowWidth);
      context.lineTo(baseX + unitY * arrowWidth, baseY - unitX * arrowWidth);
      context.closePath();
      context.fill();
    }
    context.globalAlpha = 1;
    this.data.nodes.forEach((node, index) => {
      context.beginPath();
      context.fillStyle = node.color ?? "#94a3b8";
      context.arc(
        positions[index * 2] * camera.scale + camera.x,
        positions[index * 2 + 1] * camera.scale + camera.y,
        Math.max(2, (node.radius ?? 7) * camera.scale),
        0,
        Math.PI * 2,
      );
      context.fill();
    });
  }

  destroy() {}
}

export function createGraphRenderer(
  canvas: HTMLCanvasElement,
  data: GraphData,
  nodeIndex: Map<string, number>,
  backgroundColor: string,
): GraphRenderer {
  try {
    return new WebGlGraphRenderer(canvas, data, nodeIndex, backgroundColor);
  } catch (error) {
    console.info("Graph is using its compatibility renderer.", error);
    return new CanvasGraphRenderer(canvas, data, nodeIndex, backgroundColor);
  }
}
