interface Stat {
  count: number;
  total: number;
  max: number;
}

const stats: Record<string, Stat> = {};

function record(name: string, dur: number): void {
  const s = (stats[name] ??= { count: 0, total: 0, max: 0 });
  s.count++;
  s.total += dur;
  if (dur > s.max) {
    s.max = dur;
  }
}

export function timeStart(): number {
  return performance.now();
}

export function timeEnd(name: string, start: number): void {
  const dur = performance.now() - start;
  record(name, dur);
  performance.measure(`pdf:${name}`, { start, end: performance.now() });
}

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = timeStart();
  try {
    return await fn();
  } finally {
    timeEnd(name, start);
  }
}

function dump(): void {
  const rows = Object.entries(stats)
    .map(([name, s]) => ({
      name,
      count: s.count,
      totalMs: +s.total.toFixed(1),
      avgMs: +(s.total / s.count).toFixed(2),
      maxMs: +s.max.toFixed(1),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  console.table(rows);
}

function reset(): void {
  for (const k of Object.keys(stats)) {
    delete stats[k];
  }
}

function nodes(): number {
  let count = 0;
  for (const el of document.querySelectorAll('.pdf-page')) {
    count += el.getElementsByTagName('*').length;
  }
  return count;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __pdfPerf: unknown }).__pdfPerf = {
    dump,
    reset,
    nodes,
    stats,
  };
}
