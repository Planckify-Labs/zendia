import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
const OUT = process.argv[2];
const DARK = ["#fca7ea","#c3e88d","#c099ff","#82aaff","#ffc777","#4fd6be"];
const LIGHT = ["#b0307f","#476628","#7340cc","#2160c4","#7a5c14","#0b7461"];
const NIGHT = "#1a1b26", TWILIGHT = "#283457";
const f = v => +v.toFixed(2);
const polar = (r, d) => [512 + r*Math.cos(d*Math.PI/180), 512 + r*Math.sin(d*Math.PI/180)];
const arc = (r, a0, a1) => { const [x0,y0]=polar(r,a0),[x1,y1]=polar(r,a1); return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${f(x1)} ${f(y1)}`; };
// Zendia's mark: Zen's ring cut into the six vim modes (NORMAL's long arc on top, the other five
// even), and inside it the mascot (ZendiaMascot.sys.mjs) as one rounded silhouette, head and bolt
// antenna, winking: an open eye under a soft brow, a happy-arc wink, and a grin shaped like an N on
// its side. The face is cut out of the silhouette with a mask, so it is transparent wherever the
// mark sits. paint(i, attr) gives each part's paint, so the same shapes take colors or classes:
// i is the mode, and the mascot takes NORMAL's (0) as its body color.
const PARTS = JSON.parse(readFileSync(new URL("./logo-parts.json", import.meta.url)));
function mark(paint, id = "zendia-face") {
  const r = 300, sw = 86, gap = 10, span = 120, rest = 48, cap = sw / r * 180 / Math.PI;
  let a = -90 - span / 2, out = "";
  for (let i = 0; i < 6; i++) { const s = i ? rest : span;
    out += `<path d="${arc(r, a + (gap+cap)/2, a + s - (gap+cap)/2)}" fill="none" ${paint(i,"stroke")} stroke-width="${sw}" stroke-linecap="round"/>`; a += s; }
  return out + `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/>${PARTS.holes}</mask>`
    + `<g mask="url(#${id})" ${paint(0, "body")} stroke-linejoin="round">`
    + `<polygon points="${PARTS.head}" stroke-width="70"/>${PARTS.antennas.map(p => `<polygon points="${p}" stroke-width="31.5"/>`).join("")}</g>`;
}
const colored = pal => (i, attr) => attr == "body" ? `fill="${pal[i]}" stroke="${pal[i]}"` : `${attr}="${pal[i]}"`;
const css = pal => pal.map((c,i)=>`.s${i}{stroke:${c}}`).join("") + `.c{fill:${pal[0]};stroke:${pal[0]}}`;
const head = vb => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">`;
const tile = (bg, x=0, size=1024) => `${head("0 0 1024 1024")}<g transform="translate(${x} ${x}) scale(${size/1024})"><rect width="1024" height="1024" rx="232" fill="${bg}"/>${mark(colored(DARK))}</g></svg>`;
const files = {
  "logo.svg": tile(NIGHT),
  "logo-twilight.svg": tile(TWILIGHT),
  "logo-mac.svg": tile(NIGHT, 100, 824),
  "logo-mac-twilight.svg": tile(TWILIGHT, 100, 824),
  "mark.svg": `${head("150 150 724 724")}${mark(colored(DARK))}</svg>`,
  // The about dialog shows this on Zen's light or dark surface, so it follows the color scheme.
  "about-logo.svg": `${head("150 150 724 724")}<style>${css(DARK)}@media (prefers-color-scheme: light){${css(LIGHT)}}</style>${mark((i, attr) => `class="${attr == "body" ? "c" : "s" + i}"`)}</svg>`,
};
for (const [ch, bg] of [["release", NIGHT], ["twilight", TWILIGHT]]) {
  files[`visual-${ch}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1042 1046"><rect width="1042" height="1046" fill="${bg}"/><svg x="241" y="243" width="560" height="560" viewBox="150 150 724 724">${mark(colored(DARK))}</svg></svg>`;
  files[`watermark-${ch}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 314"><rect width="164" height="314" fill="${bg}"/><svg x="-40" y="-40" width="160" height="160" viewBox="150 150 724 724">${mark(colored(DARK))}</svg><text x="14" y="296" font-family="JetBrainsMono NF" font-weight="700" font-size="20" fill="#c8d3f5">zendia</text></svg>`;
}
for (const [n, s] of Object.entries(files)) writeFileSync(`${OUT}/${n}`, s);
