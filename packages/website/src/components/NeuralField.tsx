import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Brand-token colors, hardcoded for WebGL (no CSS var access in shaders).
const NODE_COLOR = 0x1c2738; // primary ink
const LINE_COLOR = 0x2f3e46; // accent-navy
const PULSE_COLOR = 0x6ffbbe; // mint accent

const RADIUS = 2.2;
const DETAIL = 1; // icosphere subdivisions: 0=12, 1=42, 2=162 nodes
const PULSE_COUNT = 7;
const JITTER = 0.08; // tangential nudge along the sphere surface (~5°), not machined

type Vec3 = [number, number, number];
interface Edge {
  a: number;
  b: number;
}

function normalize([x, y, z]: Vec3): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * A geodesic icosphere: vertices are an even, symmetric subdivision of an
 * icosahedron, edges are the triangle sides. Deliberate structure, centered
 * on the origin, no randomness.
 */
function buildIcosphere(detail: number): { verts: Vec3[]; edges: Edge[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: Vec3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as Vec3[]
  ).map(normalize);

  let faces: Vec3[] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const midCache = new Map<string, number>();
  const midpoint = (i: number, j: number): number => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    const cached = midCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const p = verts[i];
    const q = verts[j];
    const m = normalize([
      (p[0] + q[0]) / 2,
      (p[1] + q[1]) / 2,
      (p[2] + q[2]) / 2,
    ]);
    const idx = verts.length;
    verts.push(m);
    midCache.set(key, idx);
    return idx;
  };

  for (let s = 0; s < detail; s++) {
    const next: Vec3[] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const edgeSet = new Set<string>();
  const edges: Edge[] = [];
  for (const [a, b, c] of faces) {
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ a: i, b: j });
      }
    }
  }

  return { verts, edges };
}

/** Soft radial dot used as the sprite for both nodes and pulses. */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export default function NeuralField() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const { verts, edges } = buildIcosphere(DETAIL);
    // Stable pseudo-random offset per node+axis, in [-1, 1].
    const offset = (i: number, k: number) => {
      const s = Math.sin((i + 1) * 127.1 + k * 311.7) * 43758.5453;
      return (s - Math.floor(s)) * 2 - 1;
    };
    const nodes = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => {
      // Nudge the unit direction, then renormalize: the point slides across the
      // sphere's surface but stays at RADIUS, so the silhouette stays round.
      const dir = normalize([
        v[0] + offset(i, 0) * JITTER,
        v[1] + offset(i, 1) * JITTER,
        v[2] + offset(i, 2) * JITTER,
      ]);
      nodes[i * 3] = dir[0] * RADIUS;
      nodes[i * 3 + 1] = dir[1] * RADIUS;
      nodes[i * 3 + 2] = dir[2] * RADIUS;
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5.0); // closer, so the sphere overflows the frame
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'pan-y';

    const dot = makeDotTexture();
    const group = new THREE.Group();
    group.rotation.set(0.5, 0.4, 0); // a flattering resting angle
    // Anchor the sphere off-center so it bleeds out of frame; it still spins
    // around its own center (the pivot), only a portion stays in view.
    group.position.set(1.35, -1.35, 0);
    scene.add(group);

    // Nodes
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodes, 3));
    const nodeMat = new THREE.PointsMaterial({
      color: NODE_COLOR,
      size: 0.16,
      map: dot,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    group.add(new THREE.Points(nodeGeo, nodeMat));

    // Edges
    const linePos = new Float32Array(edges.length * 6);
    edges.forEach((e, k) => {
      linePos[k * 6] = nodes[e.a * 3];
      linePos[k * 6 + 1] = nodes[e.a * 3 + 1];
      linePos[k * 6 + 2] = nodes[e.a * 3 + 2];
      linePos[k * 6 + 3] = nodes[e.b * 3];
      linePos[k * 6 + 4] = nodes[e.b * 3 + 1];
      linePos[k * 6 + 5] = nodes[e.b * 3 + 2];
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: LINE_COLOR,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    group.add(new THREE.LineSegments(lineGeo, lineMat));

    // Signal pulses travelling along edges
    const pulsePos = new Float32Array(PULSE_COUNT * 3);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    const pulseMat = new THREE.PointsMaterial({
      color: PULSE_COLOR,
      size: 0.26,
      map: dot,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    group.add(new THREE.Points(pulseGeo, pulseMat));

    const pulses = Array.from({ length: PULSE_COUNT }, (_, i) => ({
      edge: edges.length ? (i * 13) % edges.length : 0,
      t: (i / PULSE_COUNT) % 1,
      speed: 0.005 + (i % 4) * 0.0018,
    }));

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    function updatePulses() {
      if (!edges.length) {
        return;
      }
      for (let i = 0; i < PULSE_COUNT; i++) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) {
          p.t = 0;
          p.edge = (p.edge + 7 + i) % edges.length;
          p.speed = 0.005 + (i % 4) * 0.0018;
        }
        const e = edges[p.edge];
        a.set(nodes[e.a * 3], nodes[e.a * 3 + 1], nodes[e.a * 3 + 2]);
        b.set(nodes[e.b * 3], nodes[e.b * 3 + 1], nodes[e.b * 3 + 2]);
        tmp.copy(a).lerp(b, p.t);
        pulsePos[i * 3] = tmp.x;
        pulsePos[i * 3 + 1] = tmp.y;
        pulsePos[i * 3 + 2] = tmp.z;
      }
      pulseGeo.attributes.position.needsUpdate = true;
    }

    // Interaction: drag to rotate with inertia, idle auto-spin, pointer tilt.
    // Rotation only, never translation, so the object stays centered.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let velX = 0;
    let velY = 0;
    const AUTO = 0.0018;
    let tiltX = 0;
    let tiltY = 0;
    let tiltTargetX = 0;
    let tiltTargetY = 0;

    function onDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.style.cursor = 'grabbing';
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      tiltTargetY = (((e.clientX - rect.left) / rect.width) * 2 - 1) * 0.18;
      tiltTargetX = (((e.clientY - rect.top) / rect.height) * 2 - 1) * 0.18;
      if (dragging) {
        velY = (e.clientX - lastX) * 0.006;
        velX = (e.clientY - lastY) * 0.006;
        group.rotation.y += velY;
        group.rotation.x += velX;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
    function onUp(e: PointerEvent) {
      dragging = false;
      renderer.domElement.style.cursor = 'grab';
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released
      }
    }

    if (!reduceMotion) {
      renderer.domElement.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    function resize() {
      const w = mount?.clientWidth ?? 0;
      const h = mount?.clientHeight ?? 0;
      if (!w || !h) {
        return;
      }
      // updateStyle=false: keep the CSS size at 100% (set above) while the
      // drawing buffer matches w*h*pixelRatio, so it renders crisp, not scaled.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    let running = true;
    function frame() {
      if (!running) {
        return;
      }
      if (!dragging) {
        velY += (AUTO - velY) * 0.04;
        velX += (0 - velX) * 0.06;
        group.rotation.y += velY;
        group.rotation.x += velX;
      }
      // settle the drag tumble back toward the resting tilt
      group.rotation.x += (0.5 - group.rotation.x) * 0.012;

      tiltX += (tiltTargetX - tiltX) * 0.05;
      tiltY += (tiltTargetY - tiltY) * 0.05;

      const prevX = group.rotation.x;
      const prevY = group.rotation.y;
      group.rotation.x = prevX + tiltX;
      group.rotation.y = prevY + tiltY;
      updatePulses();
      renderer.render(scene, camera);
      group.rotation.x = prevX;
      group.rotation.y = prevY;

      raf = requestAnimationFrame(frame);
    }

    function dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      nodeGeo.dispose();
      lineGeo.dispose();
      pulseGeo.dispose();
      nodeMat.dispose();
      lineMat.dispose();
      pulseMat.dispose();
      dot.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount!.removeChild(renderer.domElement);
      }
    }

    if (reduceMotion) {
      renderer.render(scene, camera);
      return dispose;
    }

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        maskImage: 'radial-gradient(closest-side, #000 80%, transparent 100%)',
        WebkitMaskImage:
          'radial-gradient(closest-side, #000 80%, transparent 100%)',
      }}
      aria-hidden="true"
    />
  );
}
