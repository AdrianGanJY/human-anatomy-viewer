import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { placeLabels } from '../app/annotate/place.ts';

export function benchmark() {
  const viewport = { w: 1200, h: 900 };
  const anchors = Array.from({ length: 60 }, (_, i) => ({
    id: `anchor-${i}`, x: 65 + (i % 10) * 118, y: 80 + Math.floor(i / 10) * 145, r: 12 + i % 9,
  }));
  const labels = Array.from({ length: 200 }, (_, i) => ({
    id: `label-${i}`, target: anchors[i % 60].id, w: 48 + i % 43, h: 16 + i % 7, priority: i % 5,
  }));
  // Warm JIT separately; report the median duration of seven complete placements.
  for (let i = 0; i < 3; i++) placeLabels(viewport, anchors, labels);
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    const placed = placeLabels(viewport, anchors, labels);
    samples.push(performance.now() - start);
    if (placed.length !== 200) throw new Error('Incomplete placement');
  }
  return samples.sort((a, b) => a - b)[3];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const ms = benchmark();
  console.log(`${ms.toFixed(3)} ms`);
  if (ms >= 50) process.exitCode = 1;
}
