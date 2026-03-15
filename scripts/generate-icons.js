"use strict";
const sharp = require("sharp");
const path  = require("path");

const src   = path.join(__dirname, "../icons/icon.svg");
const sizes = [16, 48, 96, 128];

(async () => {
  for (const size of sizes) {
    const dest = path.join(__dirname, `../icons/icon-${size}.png`);
    await sharp(src).resize(size, size).png().toFile(dest);
    console.log(`Generated ${dest}`);
  }
})().catch(err => { console.error(err); process.exit(1); });
