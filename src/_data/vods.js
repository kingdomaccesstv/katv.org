const fs = require('fs');
const path = require('path');

module.exports = function() {
  const dataDir = path.join(__dirname, 'vods');
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  const files = fs.readdirSync(dataDir);
  let allVods = [];

  files.forEach(file => {
    if (file.endsWith('.json')) {
      const filePath = path.join(dataDir, file);
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const vods = JSON.parse(fileContent);
        if (Array.isArray(vods)) {
          vods.forEach(vod => {
            if (!vod.teaserImage) {
              vod.teaserImage = '/assets/images/vod/vod-preview-image.jpg';
            }
          });
          allVods = allVods.concat(vods);
        }
      } catch (e) {
        console.error(`Error reading or parsing ${file}:`, e);
      }
    }
  });

  // Sort descending by date
  allVods.sort((a, b) => {
    const dateA = a.date ? new Date(a.date) : new Date(0);
    const dateB = b.date ? new Date(b.date) : new Date(0);
    return dateB - dateA;
  });

  return allVods;
};
