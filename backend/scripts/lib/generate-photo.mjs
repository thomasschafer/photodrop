/**
 * Procedural photo generation for local seeding.
 *
 * Synthesises landscape-style images at runtime so seeded feeds look roughly
 * like real photos without committing image files to the repository. Output is
 * PNG (an allowed upload type, see src/lib/fileValidation.ts) encoded with only
 * Node built-ins.
 */

import { deflateSync } from 'node:zlib';

import { createRandom, pick, randomBetween } from './random.mjs';

/** Matches the frontend compression targets in frontend/src/lib/imageCompression.ts. */
const FULL_SIZE_MAX_DIMENSION = 1920;
const THUMBNAIL_MAX_DIMENSION = 800;

const ASPECT_RATIOS = [
  { width: 3, height: 2 },
  { width: 2, height: 3 },
  { width: 1, height: 1 },
  { width: 4, height: 3 },
];

const PALETTES = [
  {
    name: 'dawn',
    skyTop: [58, 74, 130],
    skyHorizon: [244, 170, 122],
    light: [255, 226, 172],
    hills: [
      [92, 92, 124],
      [64, 66, 96],
      [38, 42, 66],
    ],
    stars: false,
  },
  {
    name: 'midday',
    skyTop: [56, 130, 208],
    skyHorizon: [182, 216, 238],
    light: [255, 250, 224],
    hills: [
      [124, 154, 126],
      [90, 122, 100],
      [58, 88, 70],
    ],
    stars: false,
  },
  {
    name: 'dusk',
    skyTop: [42, 40, 90],
    skyHorizon: [234, 110, 96],
    light: [255, 188, 130],
    hills: [
      [86, 62, 96],
      [58, 42, 72],
      [34, 26, 48],
    ],
    stars: false,
  },
  {
    name: 'overcast',
    skyTop: [146, 158, 170],
    skyHorizon: [208, 212, 214],
    light: [228, 230, 228],
    hills: [
      [116, 126, 122],
      [88, 98, 98],
      [62, 72, 74],
    ],
    stars: false,
  },
  {
    name: 'night',
    skyTop: [8, 12, 34],
    skyHorizon: [44, 58, 98],
    light: [228, 234, 246],
    hills: [
      [28, 34, 58],
      [18, 22, 42],
      [10, 14, 28],
    ],
    stars: true,
  },
];

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(t) {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function dimensionsFor(aspect, maxDimension) {
  const scale = maxDimension / Math.max(aspect.width, aspect.height);
  return {
    width: Math.round(aspect.width * scale),
    height: Math.round(aspect.height * scale),
  };
}

/**
 * Renders a synthetic landscape: gradient sky, a light source (sun or moon),
 * cloud bands, layered ridges, and optionally water reflecting everything above
 * the horizon.
 */
function renderScene(width, height, random) {
  const palette = pick(random, PALETTES);
  const horizonY = Math.round(height * randomBetween(random, 0.45, 0.68));
  const hasWater = random() < 0.45;

  const lightX = width * randomBetween(random, 0.12, 0.88);
  const lightY = horizonY * randomBetween(random, 0.18, 0.62);
  const lightRadius = Math.min(width, height) * randomBetween(random, 0.035, 0.075);
  const glowRadius = lightRadius * randomBetween(random, 4, 9);

  const cloudBands = Array.from({ length: Math.floor(randomBetween(random, 2, 5)) }, () => ({
    centreY: horizonY * randomBetween(random, 0.1, 0.9),
    thickness: horizonY * randomBetween(random, 0.03, 0.1),
    frequency: randomBetween(random, 1.5, 5) / width,
    phase: random() * Math.PI * 2,
    opacity: randomBetween(random, 0.12, 0.45),
  }));

  const stars = palette.stars
    ? Array.from({ length: Math.floor(randomBetween(random, 60, 160)) }, () => ({
        x: Math.floor(random() * width),
        y: Math.floor(random() * horizonY),
        brightness: randomBetween(random, 0.3, 1),
      }))
    : [];
  const starLookup = new Map(stars.map((star) => [star.y * width + star.x, star.brightness]));

  // Nearest ridge last so the pixel loop can take the first ridge it falls below.
  const ridges = palette.hills.map((colour, index) => {
    const depth = index / Math.max(palette.hills.length - 1, 1);
    return {
      colour,
      baseY: horizonY - height * randomBetween(random, 0.02, 0.12) * (1 - depth),
      amplitude: height * randomBetween(random, 0.015, 0.06) * (1 - depth * 0.5),
      frequency: randomBetween(random, 1, 3) / width,
      secondaryFrequency: randomBetween(random, 3, 8) / width,
      phase: random() * Math.PI * 2,
      secondaryPhase: random() * Math.PI * 2,
    };
  });

  const ridgeProfiles = ridges.map((ridge) => {
    const profile = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const primary = Math.sin(x * ridge.frequency * Math.PI * 2 + ridge.phase);
      const secondary =
        0.4 * Math.sin(x * ridge.secondaryFrequency * Math.PI * 2 + ridge.secondaryPhase);
      profile[x] = ridge.baseY + ridge.amplitude * (primary + secondary);
    }
    return profile;
  });

  const waterDarkness = randomBetween(random, 0.6, 0.8);
  const rippleAmplitude = width * randomBetween(random, 0.004, 0.012);
  const rippleFrequency = randomBetween(random, 6, 16) / height;

  const vignetteStrength = randomBetween(random, 0.15, 0.35);
  const centreX = width / 2;
  const centreY = height / 2;
  const maxRadiusSquared = centreX * centreX + centreY * centreY;

  const cloudDrift = cloudBands.map((band) => {
    const drift = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      drift[x] = 0.5 + 0.5 * Math.sin(x * band.frequency * Math.PI * 2 + band.phase);
    }
    return drift;
  });

  const data = new Uint8Array(width * height * 3);
  const colour = [0, 0, 0];
  const skyColour = [0, 0, 0];

  for (let y = 0; y < height; y += 1) {
    const skyBlend = smoothstep(y / horizonY);
    skyColour[0] = palette.skyTop[0] + (palette.skyHorizon[0] - palette.skyTop[0]) * skyBlend;
    skyColour[1] = palette.skyTop[1] + (palette.skyHorizon[1] - palette.skyTop[1]) * skyBlend;
    skyColour[2] = palette.skyTop[2] + (palette.skyHorizon[2] - palette.skyTop[2]) * skyBlend;

    const cloudFalloff = cloudBands.map((band) =>
      Math.exp(-(((y - band.centreY) / band.thickness) ** 2))
    );
    const distanceToCentreYSquared = (y - centreY) ** 2;

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;

      if (hasWater && y >= horizonY) {
        const ripple = rippleAmplitude * Math.sin(y * rippleFrequency * Math.PI * 2 + x * 0.01);
        const sourceX = clamp(Math.round(x + ripple), 0, width - 1);
        const sourceY = clamp(Math.round(2 * horizonY - y), 0, horizonY - 1);
        const sourceOffset = (sourceY * width + sourceX) * 3;
        const shimmer = 1 + 0.08 * Math.sin(y * rippleFrequency * Math.PI * 4 + x * 0.02);
        colour[0] = data[sourceOffset] * waterDarkness * shimmer;
        colour[1] = data[sourceOffset + 1] * waterDarkness * shimmer;
        colour[2] = data[sourceOffset + 2] * waterDarkness * shimmer;
      } else {
        let ridgeIndex = -1;
        for (let index = ridges.length - 1; index >= 0; index -= 1) {
          if (y >= ridgeProfiles[index][x]) {
            ridgeIndex = index;
            break;
          }
        }

        if (ridgeIndex >= 0) {
          const ridgeColour = ridges[ridgeIndex].colour;
          // Slight vertical shading so ridge faces are not flat fills.
          const shade = 1 - 0.15 * smoothstep((y - ridgeProfiles[ridgeIndex][x]) / height);
          colour[0] = ridgeColour[0] * shade;
          colour[1] = ridgeColour[1] * shade;
          colour[2] = ridgeColour[2] * shade;
        } else {
          colour[0] = skyColour[0];
          colour[1] = skyColour[1];
          colour[2] = skyColour[2];

          const starBrightness = starLookup.get(y * width + x);
          if (starBrightness !== undefined) {
            colour[0] += (255 - colour[0]) * starBrightness;
            colour[1] += (255 - colour[1]) * starBrightness;
            colour[2] += (255 - colour[2]) * starBrightness;
          }

          for (let index = 0; index < cloudBands.length; index += 1) {
            const band = cloudBands[index];
            const alpha = band.opacity * cloudFalloff[index] * cloudDrift[index][x];
            if (alpha > 0.002) {
              colour[0] += (palette.light[0] - colour[0]) * alpha;
              colour[1] += (palette.light[1] - colour[1]) * alpha;
              colour[2] += (palette.light[2] - colour[2]) * alpha;
            }
          }

          const distanceToLight = Math.hypot(x - lightX, y - lightY);
          if (distanceToLight < lightRadius) {
            colour[0] = palette.light[0];
            colour[1] = palette.light[1];
            colour[2] = palette.light[2];
          } else {
            const glow = Math.exp(-((distanceToLight - lightRadius) / glowRadius) * 2.5);
            colour[0] += (palette.light[0] - colour[0]) * glow;
            colour[1] += (palette.light[1] - colour[1]) * glow;
            colour[2] += (palette.light[2] - colour[2]) * glow;
          }
        }
      }

      const radiusSquared = (x - centreX) ** 2 + distanceToCentreYSquared;
      const vignette = 1 - vignetteStrength * (radiusSquared / maxRadiusSquared);
      data[offset] = clamp(Math.round(colour[0] * vignette), 0, 255);
      data[offset + 1] = clamp(Math.round(colour[1] * vignette), 0, 255);
      data[offset + 2] = clamp(Math.round(colour[2] * vignette), 0, 255);
    }
  }

  return { width, height, data, palette: palette.name };
}

/** Box-filter downscale, mirroring how a client would derive a thumbnail. */
function downscale(image, maxDimension) {
  const scale = maxDimension / Math.max(image.width, image.height);
  if (scale >= 1) {
    return image;
  }

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const sourceTop = Math.floor((y * image.height) / height);
    const sourceBottom = Math.max(sourceTop + 1, Math.floor(((y + 1) * image.height) / height));

    for (let x = 0; x < width; x += 1) {
      const sourceLeft = Math.floor((x * image.width) / width);
      const sourceRight = Math.max(sourceLeft + 1, Math.floor(((x + 1) * image.width) / width));

      let red = 0;
      let green = 0;
      let blue = 0;
      let samples = 0;

      for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          const offset = (sourceY * image.width + sourceX) * 3;
          red += image.data[offset];
          green += image.data[offset + 1];
          blue += image.data[offset + 2];
          samples += 1;
        }
      }

      const offset = (y * width + x) * 3;
      data[offset] = Math.round(red / samples);
      data[offset + 1] = Math.round(green / samples);
      data[offset + 2] = Math.round(blue / samples);
    }
  }

  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodePng(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: truecolour RGB
  header.writeUInt8(0, 10); // compression method
  header.writeUInt8(0, 11); // filter method
  header.writeUInt8(0, 12); // interlace method

  const bytesPerRow = image.width * 3;
  const raw = Buffer.alloc((bytesPerRow + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 2; // "Up" filter compresses vertical gradients well
    for (let byte = 0; byte < bytesPerRow; byte += 1) {
      const current = image.data[y * bytesPerRow + byte];
      const above = y === 0 ? 0 : image.data[(y - 1) * bytesPerRow + byte];
      raw[rowStart + 1 + byte] = (current - above) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Generates a full-size photo and its matching thumbnail as PNG buffers.
 * The same seed always produces the same pair.
 */
export function generatePhoto(seed) {
  const random = createRandom(seed);
  const aspect = pick(random, ASPECT_RATIOS);
  const { width, height } = dimensionsFor(aspect, FULL_SIZE_MAX_DIMENSION);

  const fullSizeImage = renderScene(width, height, random);
  const thumbnailImage = downscale(fullSizeImage, THUMBNAIL_MAX_DIMENSION);

  return {
    palette: fullSizeImage.palette,
    width,
    height,
    fullSize: encodePng(fullSizeImage),
    thumbnail: encodePng(thumbnailImage),
  };
}
