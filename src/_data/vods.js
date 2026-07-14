const fs = require('fs');
const path = require('path');

// Load categoryMap
const categoryMapPath = path.join(__dirname, 'categoryMap.json');
let categoryMap = {};
if (fs.existsSync(categoryMapPath)) {
  try {
    categoryMap = JSON.parse(fs.readFileSync(categoryMapPath, 'utf8'));
  } catch (e) {
    console.error('Error reading categoryMap.json:', e);
  }
}

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
          // Derive year from file name if possible, e.g. "2010.json" -> "2010"
          const yearFromFilename = path.basename(file, '.json');

          vods.forEach(vod => {
            if (!vod.teaserImage) {
              vod.teaserImage = '/assets/images/vod/vod-preview-image.jpg';
            }

            // Derive/normalize year and yearPath
            const derivedYear = vod.year || (vod.date ? vod.date.substring(0, 4) : '') || yearFromFilename;
            vod.year = derivedYear;
            vod.yearPath = vod.yearPath || `/vod/year/${derivedYear}`;

            // Dereference categories
            if (vod.categories && Array.isArray(vod.categories)) {
              vod.categories = vod.categories.map(cat => {
                if (typeof cat === 'string') {
                  const mapped = categoryMap[cat];
                  if (mapped) {
                    return {
                      name: mapped.name,
                      path: mapped.path
                    };
                  } else {
                    // Fallback to name/path from ID
                    return {
                      name: cat,
                      path: `/vod/${cat}`
                    };
                  }
                }
                return cat; // if already an object, leave as is
              });
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

