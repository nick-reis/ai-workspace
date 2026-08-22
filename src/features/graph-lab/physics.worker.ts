/// <reference lib="webworker" />

type PhysicsSettings = {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
};

type InitMessage = { type: "init"; positions: ArrayBuffer; edges: ArrayBuffer; nodeCount: number; settings: PhysicsSettings };
type WorkerMessage =
  | InitMessage
  | { type: "configure"; settings: PhysicsSettings }
  | { type: "restart" }
  | { type: "pin"; index: number; x: number; y: number; fixed: boolean }
  | { type: "recycle"; buffer: ArrayBuffer };

const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.6;
const CENTER_POSITION_RATIO = 0.15;

let centerForce = 0.08;
let repelForce = 34;
let linkForce = 0.45;
let linkDistance = 72;

let x = new Float32Array(0);
let y = new Float32Array(0);
let vx = new Float32Array(0);
let vy = new Float32Array(0);
let fx = new Float32Array(0);
let fy = new Float32Array(0);
let fixed = new Uint8Array(0);
let degree = new Uint32Array(0);
let edges = new Uint32Array(0);
let alpha = 1;
let active = false;
let timerRunning = false;
let settledFrames = 0;
let tickCount = 0;
let lastLoopTime = 0;
const recycledBuffers: ArrayBuffer[] = [];

let treeCapacity = 0;
let treeCount = 0;
let child = new Int32Array(0);
let body = new Int32Array(0);
let mass = new Float32Array(0);
let centerX = new Float32Array(0);
let centerY = new Float32Array(0);
let minX = new Float32Array(0);
let minY = new Float32Array(0);
let cellSize = new Float32Array(0);

function allocateTree(nodeCount: number) {
  treeCapacity = Math.max(16, nodeCount * 8);
  child = new Int32Array(treeCapacity * 4);
  body = new Int32Array(treeCapacity);
  mass = new Float32Array(treeCapacity);
  centerX = new Float32Array(treeCapacity);
  centerY = new Float32Array(treeCapacity);
  minX = new Float32Array(treeCapacity);
  minY = new Float32Array(treeCapacity);
  cellSize = new Float32Array(treeCapacity);
}

function createCell(left: number, top: number, size: number) {
  if (treeCount >= treeCapacity) return -1;
  const index = treeCount++;
  const offset = index * 4;
  child[offset] = -1;
  child[offset + 1] = -1;
  child[offset + 2] = -1;
  child[offset + 3] = -1;
  body[index] = -1;
  mass[index] = 0;
  centerX[index] = 0;
  centerY[index] = 0;
  minX[index] = left;
  minY[index] = top;
  cellSize[index] = size;
  return index;
}

function quadrant(cellIndex: number, bodyIndex: number) {
  const half = cellSize[cellIndex] * 0.5;
  return (x[bodyIndex] >= minX[cellIndex] + half ? 1 : 0)
    + (y[bodyIndex] >= minY[cellIndex] + half ? 2 : 0);
}

function subdivide(cellIndex: number) {
  const half = cellSize[cellIndex] * 0.5;
  const left = minX[cellIndex];
  const top = minY[cellIndex];
  const offset = cellIndex * 4;
  child[offset] = createCell(left, top, half);
  child[offset + 1] = createCell(left + half, top, half);
  child[offset + 2] = createCell(left, top + half, half);
  child[offset + 3] = createCell(left + half, top + half, half);
}

function insertBody(cellIndex: number, bodyIndex: number) {
  if (cellIndex < 0) return;
  const firstChild = child[cellIndex * 4];
  const existingBody = body[cellIndex];
  if (firstChild < 0 && existingBody < 0) {
    body[cellIndex] = bodyIndex;
    return;
  }
  if (firstChild < 0) {
    if (cellSize[cellIndex] < 0.01 || treeCount + 4 >= treeCapacity) return;
    subdivide(cellIndex);
    body[cellIndex] = -1;
    insertBody(child[cellIndex * 4 + quadrant(cellIndex, existingBody)], existingBody);
  }
  insertBody(child[cellIndex * 4 + quadrant(cellIndex, bodyIndex)], bodyIndex);
}

function aggregate(cellIndex: number): number {
  const storedBody = body[cellIndex];
  if (storedBody >= 0) {
    mass[cellIndex] = 1;
    centerX[cellIndex] = x[storedBody];
    centerY[cellIndex] = y[storedBody];
    return 1;
  }
  let totalMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  const offset = cellIndex * 4;
  for (let index = 0; index < 4; index += 1) {
    const childIndex = child[offset + index];
    if (childIndex < 0) continue;
    const childMass = aggregate(childIndex);
    totalMass += childMass;
    weightedX += centerX[childIndex] * childMass;
    weightedY += centerY[childIndex] * childMass;
  }
  mass[cellIndex] = totalMass;
  if (totalMass > 0) {
    centerX[cellIndex] = weightedX / totalMass;
    centerY[cellIndex] = weightedY / totalMass;
  }
  return totalMass;
}

function buildTree() {
  if (!x.length) return -1;
  let left = x[0];
  let right = x[0];
  let top = y[0];
  let bottom = y[0];
  for (let index = 1; index < x.length; index += 1) {
    left = Math.min(left, x[index]);
    right = Math.max(right, x[index]);
    top = Math.min(top, y[index]);
    bottom = Math.max(bottom, y[index]);
  }
  const size = Math.max(1, right - left, bottom - top) * 1.01;
  treeCount = 0;
  const root = createCell(left - size * 0.005, top - size * 0.005, size);
  for (let index = 0; index < x.length; index += 1) insertBody(root, index);
  aggregate(root);
  return root;
}

function addManyBodyForce(bodyIndex: number, cellIndex: number) {
  if (cellIndex < 0 || mass[cellIndex] === 0) return;
  const storedBody = body[cellIndex];
  if (storedBody === bodyIndex) return;
  const dx = x[bodyIndex] - centerX[cellIndex];
  const dy = y[bodyIndex] - centerY[cellIndex];
  const distanceSquared = dx * dx + dy * dy + 36;
  const farEnough = storedBody >= 0 || cellSize[cellIndex] / Math.sqrt(distanceSquared) < 0.81;
  if (farEnough) {
    const strength = repelForce * mass[cellIndex] * alpha / distanceSquared;
    fx[bodyIndex] += dx * strength;
    fy[bodyIndex] += dy * strength;
    return;
  }
  const offset = cellIndex * 4;
  for (let index = 0; index < 4; index += 1) addManyBodyForce(bodyIndex, child[offset + index]);
}

function applyLinkForces() {
  for (let index = 0; index < edges.length; index += 2) {
    const source = edges[index];
    const target = edges[index + 1];
    const dx = x[target] + vx[target] - x[source] - vx[source];
    const dy = y[target] + vy[target] - y[source] - vy[source];
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const degreeSum = Math.max(1, degree[source] + degree[target]);
    const bias = degree[source] / degreeSum;
    const degreeStrength = 1 / Math.max(1, Math.min(degree[source], degree[target]));
    const force = ((distance - linkDistance) / distance) * linkForce * degreeStrength * alpha;
    const forceX = dx * force;
    const forceY = dy * force;
    fx[source] += forceX * (1 - bias);
    fy[source] += forceY * (1 - bias);
    fx[target] -= forceX * bias;
    fy[target] -= forceY * bias;
  }
}

function recenterPositions(deltaFrames: number) {
  if (!x.length) return;
  let averageX = 0;
  let averageY = 0;
  for (let index = 0; index < x.length; index += 1) {
    averageX += x[index];
    averageY += y[index];
  }
  const centeringAmount = 1 - Math.pow(1 - centerForce, deltaFrames);
  averageX = averageX / x.length * centeringAmount;
  averageY = averageY / y.length * centeringAmount;
  for (let index = 0; index < x.length; index += 1) {
    if (fixed[index]) continue;
    x[index] -= averageX;
    y[index] -= averageY;
  }
}

function simulationStep(deltaFrames = 1) {
  alpha *= Math.pow(1 - ALPHA_DECAY, deltaFrames);
  fx.fill(0);
  fy.fill(0);
  const root = buildTree();
  for (let index = 0; index < x.length; index += 1) addManyBodyForce(index, root);
  applyLinkForces();
  recenterPositions(deltaFrames);

  let energy = 0;
  const maximumSpeed = 0.2 + alpha * 7.8;
  const escapeLimit = Math.max(1_000, Math.sqrt(x.length) * 180);
  const velocityMultiplier = Math.pow(VELOCITY_DECAY, deltaFrames);
  for (let index = 0; index < x.length; index += 1) {
    if (fixed[index]) continue;
    fx[index] -= x[index] * centerForce * CENTER_POSITION_RATIO * alpha;
    fy[index] -= y[index] * centerForce * CENTER_POSITION_RATIO * alpha;
    vx[index] = (vx[index] + fx[index] * deltaFrames) * velocityMultiplier;
    vy[index] = (vy[index] + fy[index] * deltaFrames) * velocityMultiplier;
    const speed = Math.hypot(vx[index], vy[index]);
    if (speed > maximumSpeed) {
      vx[index] = vx[index] / speed * maximumSpeed;
      vy[index] = vy[index] / speed * maximumSpeed;
    }
    x[index] += vx[index] * deltaFrames;
    y[index] += vy[index] * deltaFrames;
    const distance = Math.hypot(x[index], y[index]);
    if (distance > escapeLimit) {
      x[index] = x[index] / distance * escapeLimit;
      y[index] = y[index] / distance * escapeLimit;
      vx[index] = 0;
      vy[index] = 0;
    }
    energy += vx[index] * vx[index] + vy[index] * vy[index];
  }
  return energy / Math.max(1, x.length);
}

function publish(energy: number) {
  const requiredBytes = x.length * 2 * Float32Array.BYTES_PER_ELEMENT;
  const reusableIndex = recycledBuffers.findIndex((buffer) => buffer.byteLength === requiredBytes);
  const buffer = reusableIndex >= 0 ? recycledBuffers.splice(reusableIndex, 1)[0] : new ArrayBuffer(requiredBytes);
  const positions = new Float32Array(buffer);
  for (let index = 0; index < x.length; index += 1) {
    positions[index * 2] = x[index];
    positions[index * 2 + 1] = y[index];
  }
  self.postMessage({ type: "positions", buffer, energy, alpha }, [buffer]);
}

function schedule() {
  if (timerRunning) return;
  timerRunning = true;
  setTimeout(runLoop, 16);
}

function restart(heat: number) {
  alpha = Math.max(alpha, heat);
  if (!active) lastLoopTime = performance.now();
  active = true;
  settledFrames = 0;
  schedule();
}

function applySettings(settings: PhysicsSettings) {
  centerForce = Math.min(0.2, Math.max(0, settings.centerForce));
  repelForce = Math.min(100, Math.max(0, settings.repelForce));
  linkForce = Math.min(1, Math.max(0, settings.linkForce));
  linkDistance = Math.min(200, Math.max(24, settings.linkDistance));
}

function runLoop() {
  timerRunning = false;
  if (!active) return;
  const now = performance.now();
  const deltaFrames = Math.min(2, Math.max(0.25, (now - lastLoopTime) / (1_000 / 60)));
  lastLoopTime = now;
  const energy = simulationStep(deltaFrames);
  tickCount += 1;
  if (tickCount % 2 === 0) publish(energy);
  settledFrames = alpha < 0.0025 && energy < 0.0005 ? settledFrames + deltaFrames : 0;
  active = settledFrames < 20;
  if (active) schedule();
  else publish(energy);
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    applySettings(message.settings);
    const initial = new Float32Array(message.positions);
    x = new Float32Array(message.nodeCount);
    y = new Float32Array(message.nodeCount);
    vx = new Float32Array(message.nodeCount);
    vy = new Float32Array(message.nodeCount);
    fx = new Float32Array(message.nodeCount);
    fy = new Float32Array(message.nodeCount);
    fixed = new Uint8Array(message.nodeCount);
    degree = new Uint32Array(message.nodeCount);
    for (let index = 0; index < message.nodeCount; index += 1) {
      x[index] = initial[index * 2];
      y[index] = initial[index * 2 + 1];
    }
    edges = new Uint32Array(message.edges);
    for (let index = 0; index < edges.length; index += 2) {
      degree[edges[index]] += 1;
      degree[edges[index + 1]] += 1;
    }
    allocateTree(message.nodeCount);
    alpha = 1;
    let energy = 0;
    const warmupIterations = Math.max(35, Math.min(160, Math.floor(30_000 / Math.max(1, message.nodeCount))));
    for (let index = 0; index < warmupIterations; index += 1) energy = simulationStep();
    publish(energy);
    restart(0.02);
    return;
  }
  if (message.type === "configure") {
    applySettings(message.settings);
    restart(0.3);
    return;
  }
  if (message.type === "restart") {
    restart(0.18);
    return;
  }
  if (message.type === "pin") {
    if (message.index < 0 || message.index >= x.length) return;
    x[message.index] = message.x;
    y[message.index] = message.y;
    vx[message.index] = 0;
    vy[message.index] = 0;
    fixed[message.index] = message.fixed ? 1 : 0;
    restart(message.fixed ? 0.08 : 0.035);
    return;
  }
  recycledBuffers.push(message.buffer);
};

export {};
