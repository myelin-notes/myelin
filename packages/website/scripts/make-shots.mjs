// Regenerates the placeholder product screenshots in ../public/canvas.
// These are MOCK app windows built from the app's real design tokens and fonts,
// not real captures. Run from anywhere: `node scripts/make-shots.mjs`
// (needs Playwright + the msedge channel installed locally).
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const OUT = fileURLToPath(new URL('../public/canvas', import.meta.url));
const font = (p) => new URL(`file:///${repo.replace(/\\/g, '/')}/${p}`).href;

const FONTS = `
  @font-face { font-family:'Newsreader'; src:url('${font('packages/ui/fonts/Newsreader.ttf')}'); font-weight:200 800; }
  @font-face { font-family:'Newsreader'; font-style:italic; src:url('${font('packages/ui/fonts/Newsreader-Italic.ttf')}'); font-weight:200 800; }
  @font-face { font-family:'Hanken Grotesk'; src:url('${font('packages/ui/fonts/HankenGrotesk.ttf')}'); font-weight:100 900; }
  @font-face { font-family:'JetBrains Mono'; src:url('${font('packages/ui/fonts/JetBrainsMono.ttf')}'); font-weight:100 800; }
  @font-face { font-family:'Caveat'; src:url('${font('packages/website/public/fonts/Caveat.woff2')}'); font-weight:400 700; }
`;
void here;

// Design tokens (from packages/ui/theme.css light palette)
const T = {
  page: '#f7f9fb', card: '#ffffff', ink: '#191c1e', muted: '#5b6677',
  navy: '#1c2738', accent: '#6ffbbe', accentText: '#005236',
  tag: '#d0e1fb', tagText: '#54647a', amber: 'rgba(251,191,36,0.45)',
  border: 'rgba(195,199,202,0.5)', divider: 'rgba(195,199,202,0.3)',
  red: '#e03e3e', hand: '#2f3e46',
};

const base = (w, inner) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Hanken Grotesk',sans-serif;padding:90px;background:transparent;display:inline-block;}
  ${FONTS}
  .win{width:${w}px;background:${T.card};border:1px solid ${T.border};border-radius:16px;
    box-shadow:0 40px 80px -32px rgba(28,39,56,0.35),0 8px 24px -12px rgba(28,39,56,0.18);overflow:hidden;}
  .bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid ${T.divider};background:rgba(247,249,251,0.6);}
  .dot{width:11px;height:11px;border-radius:50%;}
  .fname{font-size:12.5px;color:${T.muted};margin-left:8px;display:flex;align-items:center;gap:6px;}
  .grid{background-image:radial-gradient(rgba(164,168,172,0.35) 1px,transparent 1px);background-size:22px 22px;}
</style></head><body><div class="win">${inner}</div></body></html>`;

const dots = `<span class="dot" style="background:#f0654f"></span><span class="dot" style="background:#f6bd3b"></span><span class="dot" style="background:#61c454"></span>`;

const toolRail = `
  <div style="position:absolute;left:14px;top:70px;display:flex;flex-direction:column;gap:6px;
    background:${T.card};border:1px solid ${T.divider};border-radius:12px;padding:7px 6px;box-shadow:0 8px 24px -14px rgba(28,39,56,0.25);">
    ${['M4 3l7 16 2-7 7-2z','M4 16l9-9 3 3-9 9-3 1z','M5 15l7-7 4 4-7 7z','M6 6h9v9H6z','M4 12h14','M8 4v14']
      .map((d,i)=>`<div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${i===1?T.navy:'transparent'};">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="${i===1?'#fff':T.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></div>`).join('')}
  </div>`;

const mocks = [];

// 1. NOTE EDITOR — the money shot: handwriting + type + math + diagram in one note
mocks.push({ name: 'shot-note', w: 940, html: base(940, `
  <div class="bar">${dots}<span class="fname">📄 Lecture 12 · Attention.mcanvas</span>
    <span style="margin-left:auto;display:flex;gap:6px;">
      <span style="background:${T.tag};color:${T.tagText};font-size:10.5px;padding:2px 9px;border-radius:999px;">ml</span>
      <span style="background:${T.tag};color:${T.tagText};font-size:10.5px;padding:2px 9px;border-radius:999px;">seminar</span></span></div>
  <div class="grid" style="position:relative;height:560px;">
    ${toolRail}
    <div style="position:absolute;left:96px;top:44px;width:470px;background:${T.card};border:1px solid ${T.divider};border-radius:12px;padding:26px 28px;box-shadow:0 18px 40px -28px rgba(28,39,56,0.25);">
      <div style="font-family:'Newsreader';font-size:27px;color:${T.ink};margin-bottom:12px;">Self-attention</div>
      <div style="font-size:14.5px;line-height:1.65;color:#33383c;">Every token looks at every other token and decides what to <span style="background:${T.amber};padding:1px 3px;border-radius:3px;">pay attention to</span>. The weights are learned, not fixed.</div>
      <div style="margin-top:16px;background:rgba(242,244,246,0.9);border-radius:8px;padding:12px 14px;font-family:'JetBrains Mono';font-size:13px;color:${T.navy};">
        Attention(Q,K,V) = softmax(<span style="color:${T.red};">QKᵀ</span>/√d)·V</div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
        <div style="border:1.5px solid ${T.navy};border-radius:8px;padding:8px 12px;font-size:12.5px;">query</div>
        <svg width="46" height="20"><path d="M2 10h38" stroke="${T.navy}" stroke-width="1.6" fill="none"/><path d="M34 5l7 5-7 5" stroke="${T.navy}" stroke-width="1.6" fill="none"/></svg>
        <div style="border:1.5px solid ${T.navy};border-radius:8px;padding:8px 12px;font-size:12.5px;">keys</div>
      </div>
    </div>
    <div style="position:absolute;left:600px;top:70px;font-family:'Caveat';font-size:27px;color:${T.hand};transform:rotate(-4deg);line-height:1.1;">this is the<br>whole trick →</div>
    <svg style="position:absolute;left:560px;top:150px;" width="60" height="60"><path d="M52 8 C30 12, 14 26, 10 46" stroke="${T.red}" stroke-width="2.4" fill="none"/><path d="M4 38l6 10 10-4" stroke="${T.red}" stroke-width="2.4" fill="none"/></svg>
    <div style="position:absolute;left:610px;top:230px;font-family:'Caveat';font-size:24px;color:${T.accentText};transform:rotate(2deg);">softmax = &ldquo;how much&rdquo;</div>
    <svg style="position:absolute;left:150px;top:430px;" width="300" height="90"><path d="M6 40 C60 10, 120 70, 180 30 S 280 40, 296 34" stroke="${T.red}" stroke-width="3" fill="none" stroke-linecap="round"/></svg>
    <div style="position:absolute;left:150px;top:470px;font-family:'Caveat';font-size:23px;color:${T.hand};">revisit before the exam</div>
  </div>`) });

// 2. GRAPH VIEW
const nodes = [
  { x: 380, y: 90, r: 46, label: 'attention', hot: true },
  { x: 180, y: 180, r: 34, label: 'softmax' },
  { x: 560, y: 200, r: 40, label: 'transformers' },
  { x: 300, y: 300, r: 30, label: 'lecture 12' },
  { x: 620, y: 340, r: 30, label: 'RNNs' },
  { x: 120, y: 320, r: 26, label: 'embeddings' },
  { x: 470, y: 380, r: 30, label: 'BERT' },
];
const edges = [[0,1],[0,2],[0,3],[2,4],[2,6],[1,5],[3,5],[2,3],[3,6]];
mocks.push({ name: 'shot-graph', w: 760, html: base(760, `
  <div class="bar">${dots}<span class="fname">🕸 Graph · 128 notes</span>
    <span style="margin-left:auto;font-size:11px;color:${T.muted};">force layout</span></div>
  <div class="grid" style="position:relative;height:470px;background:#fbfcfd;">
    <svg style="position:absolute;inset:0;" width="760" height="470">
      ${edges.map(([a,b])=>`<line x1="${nodes[a].x}" y1="${nodes[a].y}" x2="${nodes[b].x}" y2="${nodes[b].y}" stroke="rgba(95,110,125,0.4)" stroke-width="1.4"/>`).join('')}
      ${nodes.map(n=>`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.hot?T.accent:'#fff'}" stroke="${n.hot?T.accentText:T.navy}" stroke-width="1.8"/>`).join('')}
      ${nodes.map(n=>`<text x="${n.x}" y="${n.y+4}" text-anchor="middle" font-family="Hanken Grotesk" font-size="${Math.max(11,n.r/3)}" fill="${n.hot?T.accentText:T.navy}">${n.label}</text>`).join('')}
    </svg>
  </div>`) });

// 3. LIBRARY
const cards = [
  { t: 'Attention paper notes', tags: ['ml','paper'], c: '#eef4ff' },
  { t: 'Thesis outline', tags: ['thesis'], c: '#eafaf1' },
  { t: 'Reading list', tags: ['inbox'], c: '#fff7e8' },
  { t: 'Lecture 12', tags: ['ml','seminar'], c: '#fff' },
  { t: 'Whiteboard dump', tags: ['ideas'], c: '#f4efff' },
  { t: 'Meeting · advisor', tags: ['meeting'], c: '#fff' },
];
mocks.push({ name: 'shot-library', w: 860, html: base(860, `
  <div class="bar">${dots}<span class="fname">📚 My Workspace</span>
    <span style="margin-left:auto;background:rgba(242,244,246,0.9);border-radius:8px;font-size:12px;color:${T.muted};padding:5px 12px;">⌕ semantic search…</span></div>
  <div style="display:flex;height:500px;">
    <div style="width:180px;border-right:1px solid ${T.divider};padding:16px 14px;font-size:13px;color:${T.muted};background:#f6f8fa;">
      ${['Research','Thesis','Inbox','Seminars','Ideas','Archive'].map((f,i)=>`<div style="padding:7px 9px;border-radius:7px;margin-bottom:2px;${i===0?`background:${T.tag};color:${T.navy};`:''}">▸ ${f}</div>`).join('')}
    </div>
    <div style="flex:1;padding:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
      ${cards.map(c=>`<div style="background:${T.card};border:1px solid ${T.divider};border-radius:12px;overflow:hidden;box-shadow:0 10px 24px -18px rgba(28,39,56,0.25);">
        <div style="height:96px;background:${c.c};background-image:radial-gradient(rgba(164,168,172,0.35) 1px,transparent 1px);background-size:14px 14px;position:relative;">
          <svg style="position:absolute;left:14px;top:26px;" width="130" height="50"><path d="M4 30 C30 6, 60 44, 90 20 S 120 28, 128 24" stroke="${T.hand}" stroke-width="2" fill="none"/></svg></div>
        <div style="padding:11px 13px;">
          <div style="font-family:'Newsreader';font-size:15px;color:${T.ink};margin-bottom:7px;">${c.t}</div>
          <div style="display:flex;gap:5px;">${c.tags.map(t=>`<span style="background:${T.tag};color:${T.tagText};font-size:10px;padding:2px 8px;border-radius:999px;">${t}</span>`).join('')}</div>
        </div></div>`).join('')}
    </div>
  </div>`) });

// 4. PDF ANNOTATION
mocks.push({ name: 'shot-pdf', w: 680, html: base(680, `
  <div class="bar">${dots}<span class="fname">📕 Attention Is All You Need.pdf · p.3</span>
    <span style="margin-left:auto;font-size:11px;color:${T.muted};">pen · highlight</span></div>
  <div style="position:relative;height:720px;background:#fff;padding:44px 52px;font-family:Georgia,serif;color:#1a1a1a;">
    <div style="text-align:center;font-size:21px;font-weight:700;margin-bottom:6px;">Attention Is All You Need</div>
    <div style="text-align:center;font-size:11px;color:#666;margin-bottom:18px;">Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser, Polosukhin</div>
    <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:.1em;margin-bottom:8px;">ABSTRACT</div>
    <div style="font-size:12.5px;line-height:1.7;text-align:justify;margin:0 14px 18px;">The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the <span style="background:${T.amber};">Transformer, based solely on attention</span> mechanisms, dispensing with recurrence and convolutions entirely.</div>
    <div style="columns:2;column-gap:24px;font-size:11px;line-height:1.65;text-align:justify;">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:6px;">1&nbsp;&nbsp;Introduction</div>
      <p style="margin-bottom:10px;">Recurrent models factor computation along symbol positions, precluding parallelization within training examples.</p>
      <p style="margin-bottom:10px;">Attention mechanisms allow modeling of dependencies without regard to their distance in the sequence.</p>
      <p>The Transformer reaches a new state of the art after training for as little as twelve hours.</p>
    </div>
    <svg style="position:absolute;left:150px;top:196px;" width="330" height="46"><ellipse cx="165" cy="23" rx="160" ry="18" stroke="${T.red}" stroke-width="2.4" fill="none"/></svg>
    <div style="position:absolute;left:64px;top:250px;font-family:'Caveat';font-size:24px;color:${T.red};transform:rotate(-3deg);">the core claim!</div>
    <svg style="position:absolute;left:150px;top:250px;" width="60" height="40"><path d="M52 6 C30 10, 12 20, 6 34" stroke="${T.red}" stroke-width="2" fill="none"/><path d="M2 26l4 9 9-2" stroke="${T.red}" stroke-width="2" fill="none"/></svg>
    <div style="position:absolute;right:40px;bottom:150px;font-family:'Caveat';font-size:23px;color:${T.hand};transform:rotate(2deg);">cf. lecture 12</div>
  </div>`) });

// 5. SEARCH
const results = [
  { t: 'Lecture 12 · Attention', s: 'every token looks at every other token and decides what to <b>pay attention</b> to', tag: 'ml', score: '0.94' },
  { t: 'Attention paper notes', s: 'dispensing with recurrence entirely; the model <b>scales</b> with sequence length squared', tag: 'paper', score: '0.89' },
  { t: 'Thesis outline', s: 'chapter 3 compares <b>attention</b> variants and their memory cost', tag: 'thesis', score: '0.71' },
];
mocks.push({ name: 'shot-search', w: 740, html: base(740, `
  <div class="bar">${dots}<span class="fname">⌕ Search</span></div>
  <div style="padding:20px 22px;background:#fbfcfd;height:470px;">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
      <div style="flex:1;background:${T.card};border:1px solid ${T.divider};border-radius:10px;padding:11px 14px;font-size:14.5px;color:${T.ink};">how does attention scale?</div>
      <div style="background:${T.navy};color:#fff;border-radius:999px;font-size:12px;padding:8px 14px;">Semantic</div>
    </div>
    <div style="font-size:11.5px;color:${T.muted};margin-bottom:14px;display:flex;align-items:center;gap:6px;">
      <span style="width:7px;height:7px;border-radius:50%;background:${T.accent};display:inline-block;"></span>
      embedding model running on your device · 128 notes searched</div>
    ${results.map(r=>`<div style="background:${T.card};border:1px solid ${T.divider};border-radius:11px;padding:13px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span style="font-family:'Newsreader';font-size:15.5px;color:${T.ink};">${r.t}</span>
        <span style="background:${T.tag};color:${T.tagText};font-size:10px;padding:2px 8px;border-radius:999px;">${r.tag}</span>
        <span style="margin-left:auto;font-size:11px;color:${T.accentText};font-family:'JetBrains Mono';">${r.score}</span></div>
      <div style="font-size:13px;line-height:1.5;color:${T.muted};">${r.s.replace(/<b>/g,`<b style="color:${T.ink};background:${T.amber};padding:0 2px;border-radius:2px;">`)}</div>
    </div>`).join('')}
  </div>`) });

// Sticky notes (baked tilt, no shadow-heavy frame)
const sticky = (w, h, bg, rot, lines, color) => `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box;}${FONTS}
  body{padding:44px;background:transparent;display:inline-block;}
  .s{width:${w}px;height:${h}px;background:${bg};border-radius:4px;transform:rotate(${rot}deg);
    box-shadow:0 18px 34px -18px rgba(28,39,56,0.4);padding:22px 22px;font-family:'Caveat';font-size:27px;color:${color||T.hand};line-height:1.2;}
</style></head><body><div class="s">${lines}</div></body></html>`;

const stickies = [
  { name: 'sticky-amber', w: 240, h: 190, html: sticky(240,190,'#ffe08a',-3,'ship the<br>web demo ✱<br><span style="font-size:20px;color:#8a6d1a;">then sleep</span>') },
  { name: 'sticky-mint', w: 210, h: 170, html: sticky(210,170,'#b6f5d8',2.5,'link this →<br>[[lecture 12]]', '#0a5c3d') },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const m of [...mocks, ...stickies]) {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setViewportSize({ width: (m.w || 260) + 120, height: 1400 });
  await page.setContent(m.html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const el = await page.$('body');
  await el.screenshot({ path: `${OUT}/${m.name}.png`, omitBackground: true });
  await page.close();
  console.log('wrote', m.name);
}
await browser.close();
