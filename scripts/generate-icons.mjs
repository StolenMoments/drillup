import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, sans-serif" font-size="280" font-weight="bold" fill="#38bdf8">D</text>
</svg>`;

mkdirSync("public/icons", { recursive: true });

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`icon-${size}.png 생성`);
}
