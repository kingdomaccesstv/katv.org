const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const VODS_DIR = path.join(__dirname, '../src/_data/vods');
const CATEGORY_MAP_PATH = path.join(__dirname, '../src/_data/categoryMap.json');

// Allowed video sources
const ALLOWED_VIDEO_SOURCES = new Set(['vimeo', 'archive.org', 'youtube', 'cablecast']);

// Load Category Map
let categoryMapKeys = new Set();
if (fs.existsSync(CATEGORY_MAP_PATH)) {
  try {
    const categoryMap = JSON.parse(fs.readFileSync(CATEGORY_MAP_PATH, 'utf8'));
    categoryMapKeys = new Set(Object.keys(categoryMap));
  } catch (err) {
    console.error(`Warning: Failed to load/parse categoryMap.json: ${err.message}`);
  }
} else {
  console.error('Warning: categoryMap.json not found at expected path.');
}

// Helper to check if a date is valid
function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-based
  const day = parseInt(parts[2], 10);
  
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
}

// Get the files to validate
function getFilesToValidate() {
  const args = process.argv.slice(2);
  const showAll = args.includes('--all');
  
  if (showAll) {
    if (!fs.existsSync(VODS_DIR)) {
      return [];
    }
    return fs.readdirSync(VODS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(VODS_DIR, f));
  }

  // Otherwise, default to --staged (changed files in git)
  try {
    const gitDiff = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return gitDiff.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('src/_data/vods/') && line.endsWith('.json'))
      .map(line => path.resolve(line));
  } catch (err) {
    console.error('Error running git diff. Defaulting to all files.');
    if (!fs.existsSync(VODS_DIR)) {
      return [];
    }
    return fs.readdirSync(VODS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(VODS_DIR, f));
  }
}

// Validate a single VOD entry
function validateEntry(entry, index, filename) {
  const errors = [];
  const requiredKeys = new Set([
    'title', 'path', 'cablecastShowId', 'date', 'location', 
    'categories', 'teaserImage', 'videoSource', 'videoId'
  ]);

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [`Entry at index ${index} is not an object`];
  }

  // Check for missing keys
  for (const key of requiredKeys) {
    if (!(key in entry)) {
      errors.push(`Missing required key: "${key}"`);
    }
  }

  // Check for unexpected extra keys
  for (const key of Object.keys(entry)) {
    if (!requiredKeys.has(key)) {
      errors.push(`Unexpected extra key: "${key}"`);
    }
  }

  if (errors.length > 0) {
    return errors;
  }

  // 1. Title validation
  if (typeof entry.title !== 'string' || entry.title.trim() === '') {
    errors.push(`"title" must be a non-empty string (got: ${JSON.stringify(entry.title)})`);
  }

  // 2. Path validation
  if (typeof entry.path !== 'string' || !entry.path.startsWith('/vod/')) {
    errors.push(`"path" must start with "/vod/" (got: ${JSON.stringify(entry.path)})`);
  }

  // 3. Cablecast Show ID validation
  if (entry.cablecastShowId !== null) {
    if (typeof entry.cablecastShowId !== 'number' || !Number.isInteger(entry.cablecastShowId) || entry.cablecastShowId < 0) {
      errors.push(`"cablecastShowId" must be a non-negative integer or null (got: ${JSON.stringify(entry.cablecastShowId)})`);
    }
  }

  // 4. Date validation
  if (typeof entry.date !== 'string' || !isValidDate(entry.date)) {
    errors.push(`"date" must be a valid date in YYYY-MM-DD format (got: ${JSON.stringify(entry.date)})`);
  }

  // 5. Location validation
  if (typeof entry.location !== 'string') {
    errors.push(`"location" must be a string (got: ${JSON.stringify(entry.location)})`);
  }

  // 6. Categories validation
  if (!Array.isArray(entry.categories)) {
    errors.push(`"categories" must be an array (got: ${JSON.stringify(entry.categories)})`);
  } else {
    entry.categories.forEach((cat, catIdx) => {
      if (typeof cat !== 'string' || cat.trim() === '') {
        errors.push(`category at index ${catIdx} must be a non-empty string`);
      } else if (categoryMapKeys.size > 0 && !categoryMapKeys.has(cat)) {
        errors.push(`category "${cat}" at index ${catIdx} is not defined in categoryMap.json`);
      }
    });
  }

  // 7. Teaser Image validation
  if (entry.teaserImage !== null) {
    if (typeof entry.teaserImage !== 'string' || entry.teaserImage.trim() === '') {
      errors.push(`"teaserImage" must be a non-empty string or null (got: ${JSON.stringify(entry.teaserImage)})`);
    }
  }

  // 8. Video Source validation
  if (typeof entry.videoSource !== 'string' || !ALLOWED_VIDEO_SOURCES.has(entry.videoSource)) {
    const allowedList = Array.from(ALLOWED_VIDEO_SOURCES).join(', ');
    errors.push(`"videoSource" must be one of: [${allowedList}] (got: ${JSON.stringify(entry.videoSource)})`);
  }

  // 9. Video ID validation
  if (typeof entry.videoId !== 'string' || entry.videoId.trim() === '') {
    errors.push(`"videoId" must be a non-empty string (got: ${JSON.stringify(entry.videoId)})`);
  }

  return errors;
}

// Main execution
function main() {
  const files = getFilesToValidate();
  if (files.length === 0) {
    console.log('No changed VOD JSON files to validate.');
    process.exit(0);
  }

  let totalErrors = 0;
  console.log(`Validating ${files.length} VOD JSON file(s)...`);

  files.forEach(filePath => {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      let vods;
      try {
        vods = JSON.parse(content);
      } catch (err) {
        console.error(`\x1b[31m[ERROR]\x1b[0m ${relativePath}: Invalid JSON syntax - ${err.message}`);
        totalErrors++;
        return;
      }

      if (!Array.isArray(vods)) {
        console.error(`\x1b[31m[ERROR]\x1b[0m ${relativePath}: File root must be a JSON array`);
        totalErrors++;
        return;
      }

      let fileHasErrors = false;
      vods.forEach((entry, index) => {
        const errors = validateEntry(entry, index, relativePath);
        if (errors.length > 0) {
          fileHasErrors = true;
          totalErrors += errors.length;
          const displayTitle = entry.title || `Entry #${index}`;
          console.error(`\x1b[31m[ERROR]\x1b[0m ${relativePath} (item index ${index}, "${displayTitle}"):`);
          errors.forEach(err => console.error(`  - ${err}`));
        }
      });

      if (!fileHasErrors) {
        console.log(`\x1b[32m[PASS]\x1b[0m ${relativePath}`);
      }
    } catch (err) {
      console.error(`\x1b[31m[ERROR]\x1b[0m ${relativePath}: Failed to read file - ${err.message}`);
      totalErrors++;
    }
  });

  if (totalErrors > 0) {
    console.error(`\n\x1b[31mValidation failed with ${totalErrors} error(s).\x1b[0m`);
    process.exit(1);
  }

  console.log('\n\x1b[32mAll VOD JSON files passed validation successfully.\x1b[0m');
  process.exit(0);
}

main();
