const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../src/_data/vods');
const oldImageDir = path.join(__dirname, '../src/assets/images/teaser');
const newImageBaseDir = path.join(__dirname, '../src/assets/images/vod');

if (!fs.existsSync(dataDir)) {
  console.log("No VODs directory found. Exiting.");
  process.exit(0);
}

// Ensure new base image dir exists
if (!fs.existsSync(newImageBaseDir)) {
  fs.mkdirSync(newImageBaseDir, { recursive: true });
}

const files = fs.readdirSync(dataDir);
let movedCount = 0;

files.forEach(file => {
  if (file.endsWith('.json')) {
    const filePath = path.join(dataDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const vods = JSON.parse(content);
      let changed = false;

      if (Array.isArray(vods)) {
        vods.forEach(vod => {
          if (vod.teaserImage && vod.teaserImage.startsWith('/assets/images/teaser/')) {
            // Get original filename
            const filename = path.basename(vod.teaserImage);
            const sourcePath = path.join(oldImageDir, filename);

            if (fs.existsSync(sourcePath)) {
              // Get year
              const year = vod.year || (vod.date ? vod.date.substring(0, 4) : 'unknown');
              const targetDir = path.join(newImageBaseDir, year);
              
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }

              const targetPath = path.join(targetDir, filename);
              
              // Move file
              fs.renameSync(sourcePath, targetPath);
              
              // Update JSON property
              vod.teaserImage = `/assets/images/vod/${year}/${filename}`;
              changed = true;
              movedCount++;
            } else {
              // If file is missing from source but we already moved it or it is a broken reference, 
              // check if it exists in target already and update path anyway
              const year = vod.year || (vod.date ? vod.date.substring(0, 4) : 'unknown');
              const targetPath = path.join(newImageBaseDir, year, filename);
              if (fs.existsSync(targetPath)) {
                vod.teaserImage = `/assets/images/vod/${year}/${filename}`;
                changed = true;
              }
            }
          }
        });

        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(vods, null, 2), 'utf8');
        }
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
});

console.log(`Successfully migrated ${movedCount} VOD teaser images to nested year directories.`);

// Clean up old directory if empty
try {
  if (fs.existsSync(oldImageDir)) {
    const oldFiles = fs.readdirSync(oldImageDir);
    if (oldFiles.length === 0) {
      fs.rmdirSync(oldImageDir);
      console.log("Deleted old empty teaser directory.");
    } else {
      console.log(`Old teaser directory contains ${oldFiles.length} remaining files.`);
    }
  }
} catch (err) {
  console.error("Error removing old teaser folder:", err.message);
}
