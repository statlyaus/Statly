/**
 * Cuts the home hero's two cut-outs into paper layers for the puppet motion in
 * `src/components/aflTradesHome/marketHero.css`: the leaper, his catching arm and the crouching man
 * from `high-mark.webp`, and five raised arms from `traders.webp`. Each arm layer reaches a little
 * below its cut line and the base keeps those pixels, so a small rotation shows no seam.
 * Pivots in the CSS are these polygons' joint points as shares of the image.
 *
 * Run: node Scripts/design/slice-market-hero.mjs
 */
import fs from 'node:fs';
import sharp from 'sharp';
const M = 'public/Assets/stories/market';
const OUT = `${M}/layers`;
fs.mkdirSync(OUT, { recursive: true });
const pts = (a) => a.map((p) => p.join(',')).join(' ');
const svg = (w, h, polys, extra = '') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${polys.map((p) => `<polygon points="${pts(p)}" fill="#fff"/>`).join('')}${extra}</svg>`
  );
async function layer(src, name, mask, mode) {
  const img = sharp(src).ensureAlpha();
  const buf = await img
    .composite([{ input: mask, blend: mode }])
    .webp({ quality: 84, alphaQuality: 90, effort: 6 })
    .toBuffer();
  fs.writeFileSync(`${OUT}/${name}.webp`, buf);
  console.log(name, buf.length);
}
// ---- high mark 848x1264
const W1 = 848,
  H1 = 1264,
  mark = `${M}/high-mark.webp`;
const crouch = [
  [220, 695],
  [350, 695],
  [400, 752],
  [548, 752],
  [548, 900],
  [585, 1000],
  [585, 1264],
  [220, 1264],
];
const leg = [
  [350, 688],
  [510, 700],
  [565, 780],
  [650, 830],
  [600, 885],
  [545, 858],
  [495, 835],
  [455, 805],
  [410, 760],
  [352, 735],
];
const arm = [
  [292, 0],
  [428, 0],
  [428, 108],
  [370, 162],
  [370, 250],
  [404, 318],
  [408, 350],
  [326, 350],
  [300, 200],
  [294, 150],
];
const armCut = 322;
// base: crouching man (everything inside crouch poly)
await layer(mark, 'mark-base', svg(W1, H1, [crouch]), 'dest-in');
// leaper: (outside crouch OR inside leg) minus arm above cut
const leaperMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W1}" height="${H1}"><defs><clipPath id="c"><rect width="${W1}" height="${armCut}"/></clipPath></defs><rect width="${W1}" height="${H1}" fill="#fff"/><polygon points="${pts(crouch)}" fill="#000"/><polygon points="${pts(leg)}" fill="#fff"/><polygon clip-path="url(#c)" points="${pts(arm)}" fill="#000"/></svg>`
);
// use luminance->alpha: build alpha mask via raw
async function lumLayer(src, name, maskSvg, w, h) {
  const a = await sharp(maskSvg).flatten({ background: '#000' }).extractChannel(0).raw().toBuffer();
  const { data } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Math.round((data[i * 4 + 3] * a[i]) / 255);
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 84, alphaQuality: 90, effort: 6 })
    .toBuffer();
  fs.writeFileSync(`${OUT}/${name}.webp`, buf);
  console.log(name, buf.length);
}
await lumLayer(mark, 'mark-leaper', leaperMask, W1, H1);
await layer(mark, 'mark-arm', svg(W1, H1, [arm]), 'dest-in');
// ---- traders 1264x848
const W2 = 1264,
  H2 = 848,
  tr = `${M}/traders.webp`;
const arms = {
  a: {
    cut: 300,
    p: [
      [158, 318],
      [284, 318],
      [294, 250],
      [300, 100],
      [302, 25],
      [255, 25],
      [178, 105],
      [158, 200],
    ],
  },
  b: {
    cut: 288,
    p: [
      [290, 306],
      [382, 306],
      [382, 205],
      [428, 125],
      [422, 55],
      [360, 55],
      [318, 128],
      [294, 200],
    ],
  },
  c: {
    cut: 282,
    p: [
      [458, 300],
      [556, 300],
      [562, 200],
      [564, 118],
      [534, 55],
      [478, 25],
      [456, 80],
      [456, 180],
    ],
  },
  d: {
    cut: 214,
    p: [
      [670, 230],
      [748, 230],
      [762, 172],
      [824, 112],
      [820, 40],
      [752, 40],
      [712, 88],
      [672, 160],
    ],
  },
  e: {
    cut: 292,
    p: [
      [926, 118],
      [1012, 122],
      [1052, 196],
      [1080, 248],
      [1084, 312],
      [1006, 312],
      [982, 242],
      [930, 192],
    ],
  },
};
const removeAll = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}"><rect width="${W2}" height="${H2}" fill="#fff"/>${Object.values(
    arms
  )
    .map(
      (r, i) =>
        `<clipPath id="c${i}"><rect width="${W2}" height="${r.cut}"/></clipPath><polygon clip-path="url(#c${i})" points="${pts(r.p)}" fill="#000"/>`
    )
    .join('')}</svg>`
);
await lumLayer(tr, 'traders-base', removeAll, W2, H2);
for (const [k, r] of Object.entries(arms))
  await layer(tr, `traders-arm-${k}`, svg(W2, H2, [r.p]), 'dest-in');
