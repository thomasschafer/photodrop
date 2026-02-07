#!/usr/bin/env node
/**
 * Generate Android notification icons from the launcher foreground icon
 * Notification icons must be white-on-transparent for proper display in the status bar
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Icon sizes for different densities (in pixels)
const sizes = {
  mdpi: 24,
  hdpi: 36,
  xhdpi: 48,
  xxhdpi: 72,
  xxxhdpi: 96,
};

// When run from frontend folder: node ../mobile/scripts/generate-notification-icon.js
const resDir = path.join(__dirname, '../android/app/src/main/res');
const sourceIcon = path.join(resDir, 'mipmap-xxxhdpi/ic_launcher_foreground.png');

// Allow overriding paths via environment
const actualResDir = process.env.RES_DIR || resDir;
const actualSourceIcon = process.env.SOURCE_ICON || sourceIcon;

async function generateNotificationIcons() {
  console.log('Generating notification icons...');

  // Check if source exists
  if (!fs.existsSync(sourceIcon)) {
    console.error('Source icon not found:', sourceIcon);
    process.exit(1);
  }

  for (const [density, size] of Object.entries(sizes)) {
    const outputDir = path.join(resDir, `drawable-${density}`);
    const outputPath = path.join(outputDir, 'ic_notification.png');

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert to white silhouette: extract alpha channel, make it white
    await sharp(sourceIcon)
      .resize(size, size)
      .ensureAlpha()
      // Extract just the shape and make it white
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        // Create a white version: where there's any opacity, make it white
        const newData = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 0) {
            newData[i] = 255;     // R - white
            newData[i + 1] = 255; // G - white
            newData[i + 2] = 255; // B - white
            newData[i + 3] = alpha; // Keep original alpha
          }
        }
        return sharp(newData, {
          raw: { width: info.width, height: info.height, channels: 4 }
        }).png().toFile(outputPath);
      });

    console.log(`  Created ${density}: ${outputPath}`);
  }

  // Also create one in the base drawable folder
  const baseOutputDir = path.join(resDir, 'drawable');
  const baseOutputPath = path.join(baseOutputDir, 'ic_notification.png');
  
  await sharp(sourceIcon)
    .resize(sizes.mdpi, sizes.mdpi)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const newData = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha > 0) {
          newData[i] = 255;
          newData[i + 1] = 255;
          newData[i + 2] = 255;
          newData[i + 3] = alpha;
        }
      }
      return sharp(newData, {
        raw: { width: info.width, height: info.height, channels: 4 }
      }).png().toFile(baseOutputPath);
    });

  console.log(`  Created base: ${baseOutputPath}`);
  console.log('Done!');
}

generateNotificationIcons().catch(console.error);
