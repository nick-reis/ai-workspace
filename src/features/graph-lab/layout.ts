const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const INITIAL_RADIUS = 10;

export function makeInitialPositions(count: number) {
  const positions = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const radius = INITIAL_RADIUS * Math.sqrt(index + 0.5);
    const angle = index * GOLDEN_ANGLE;
    positions[index * 2] = Math.cos(angle) * radius;
    positions[index * 2 + 1] = Math.sin(angle) * radius;
  }
  return positions;
}
