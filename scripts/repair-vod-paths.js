const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../src/_data/vods');
if (!fs.existsSync(dataDir)) {
  console.log('No VOD data directory found.');
  process.exit(0);
}

const files = fs.readdirSync(dataDir);
let fixedCount = 0;

files.forEach(file => {
  if (file.endsWith('.json')) {
    const filePath = path.join(dataDir, file);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const vods = JSON.parse(fileContent);
      let changed = false;

      if (Array.isArray(vods)) {
        vods.forEach(vod => {
          if (!vod.path || vod.path === '/' || vod.path === '') {
            const nid = vod.nid || Math.floor(Math.random() * 100000);
            vod.path = `/vod/node/${nid}`;
            changed = true;
            fixedCount++;
          }
        });

        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(vods, null, 2), 'utf8');
        }
      }
    } catch (e) {
      console.error(`Error repairing ${file}:`, e);
    }
  }
});

console.log(`Repaired ${fixedCount} VOD paths.`);
