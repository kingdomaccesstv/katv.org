const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const fetch = require('node-fetch');

// Configuration Paths
const VODS_DIR = path.join(__dirname, '../src/_data/vods');
const IMAGES_BASE_DIR = path.join(__dirname, '../src/assets/images/vod');
const SRC_DIR = path.join(__dirname, '../src');

// Helper to wait/sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to sanitize path into filename
function getFilenameFromPath(vodPath) {
  let cleanPath = vodPath.replace(/^\/vod\//, ''); // Remove leading /vod/
  cleanPath = cleanPath.replace(/\/$/, '');        // Remove trailing /
  const sanitized = cleanPath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_\-]/g, '_');
  return `${sanitized}.jpg`;
}

// Balanced brace parser to extract JSON playerConfig from HTML
function extractBalancedJSON(str, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let quoteChar = '';

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (char === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return str.substring(startIndex, i + 1);
      }
    }
  }
  return null;
}

// Resolve stream URL and duration for Vimeo
async function resolveVimeo(videoId) {
  const url = `https://player.vimeo.com/video/${videoId}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://katv.org/',
      'Origin': 'https://katv.org'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Vimeo player page. Status: ${response.status}`);
  }

  const html = await response.text();
  
  let index = html.indexOf('window.playerConfig =');
  if (index === -1) {
    index = html.indexOf('var config =');
  }

  if (index === -1) {
    throw new Error("Could not find player config in Vimeo page HTML.");
  }

  const openBraceIndex = html.indexOf('{', index);
  if (openBraceIndex === -1) {
    throw new Error("Could not find opening brace of player config.");
  }

  const jsonStr = extractBalancedJSON(html, openBraceIndex);
  if (!jsonStr) {
    throw new Error("Could not extract balanced JSON player config.");
  }

  const config = JSON.parse(jsonStr);
  const duration = config.video ? config.video.duration : null;
  if (!duration) {
    throw new Error("Could not determine Vimeo video duration from config.");
  }

  const files = config.request ? config.request.files : null;
  if (!files) {
    throw new Error("No files property found in Vimeo player configuration.");
  }

  let streamUrl = null;

  if (files.progressive && files.progressive.length > 0) {
    // Prefer progressive MP4 if available (sort highest resolution first)
    const sorted = [...files.progressive].sort((a, b) => b.width - a.width);
    streamUrl = sorted[0].url;
  } else {
    const hls = files.hls;
    if (hls && hls.cdns) {
      const cdnName = hls.default_cdn || Object.keys(hls.cdns)[0];
      const cdn = hls.cdns[cdnName];
      if (cdn && cdn.url) {
        streamUrl = cdn.url;
      }
    }
  }

  if (!streamUrl) {
    throw new Error("No progressive or HLS streams found in Vimeo player config.");
  }

  return { streamUrl, duration };
}

// Resolve stream URL and duration for Archive.org
async function resolveArchive(videoId) {
  const url = `https://archive.org/metadata/${videoId}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Archive.org metadata. Status: ${response.status}`);
  }

  const data = await response.json();
  if (!data.files || data.files.length === 0) {
    throw new Error("No files found in Archive.org metadata.");
  }

  // Filter for MP4 files
  const mp4Files = data.files.filter(f => f.name.endsWith('.mp4'));
  if (mp4Files.length === 0) {
    throw new Error("No MP4 files found for this Archive.org video.");
  }

  // Prefer original source if available
  let selectedFile = mp4Files.find(f => f.source === 'original');
  if (!selectedFile) {
    selectedFile = mp4Files[0];
  }

  // Extract duration
  let duration = parseFloat(selectedFile.length);
  if (isNaN(duration) || duration <= 0) {
    const withLen = mp4Files.find(f => f.length && parseFloat(f.length) > 0);
    if (withLen) {
      duration = parseFloat(withLen.length);
    } else {
      duration = 600; // Fallback to 10 minutes if not found
    }
  }

  const streamUrl = `https://archive.org/download/${videoId}/${selectedFile.name}`;
  return { streamUrl, duration };
}

// Run ffmpeg to grab a scaled screenshot
function captureFrame(streamUrl, timestamp, outPath) {
  // Ensure output directory exists
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // We place -ss BEFORE -i for rapid seeking on remote stream inputs.
  // We use -update 1 and -frames:v 1 to write a single image output.
  const cmd = `ffmpeg -y -ss ${timestamp} -i "${streamUrl}" -frames:v 1 -update 1 -vf "scale=960:540" -q:v 2 "${outPath}"`;
  
  try {
    // Execute silently, suppress stdout/stderr unless there's an error
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (err) {
    console.error(`FFmpeg error executing command: ${cmd}`);
    console.error(err.message);
    return false;
  }
}

// Command Usage printing
function printUsage() {
  console.log(`
Usage: node scripts/generate-thumbnails.js [options]

Options:
  --all             Process all VOD entries with missing thumbnails.
  --limit <number>  Limit the maximum number of thumbnails to generate.
  --delay <ms>      Delay in milliseconds between requests (default: 3000ms).
  --year <year>     Only scan the specified year VOD JSON file (e.g. 2026).
  --overwrite       Overwrite existing thumbnail files on disk if they exist.
  --dry-run         List the VOD entries with missing thumbnails without downloading.
  --help            Show this help menu.
`);
}

// Parse Command Line Arguments
function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const args = [];
  
  // Normalize equal-separated arguments, e.g. --year=2010 -> --year, 2010
  for (const arg of rawArgs) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const idx = arg.indexOf('=');
      args.push(arg.substring(0, idx));
      args.push(arg.substring(idx + 1));
    } else {
      args.push(arg);
    }
  }

  const options = {
    all: false,
    limit: Infinity,
    delay: 3000,
    year: null,
    overwrite: false,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--all':
        options.all = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        if (isNaN(options.limit) || options.limit <= 0) {
          console.error("Error: --limit requires a positive integer.");
          process.exit(1);
        }
        break;
      case '--delay':
        options.delay = parseInt(args[++i], 10);
        if (isNaN(options.delay) || options.delay < 0) {
          console.error("Error: --delay requires a non-negative integer.");
          process.exit(1);
        }
        break;
      case '--year':
        options.year = args[++i];
        break;
      case '--overwrite':
        options.overwrite = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (!options.all && options.limit === Infinity && !options.dryRun) {
    console.log("Warning: You did not specify --all or --limit. Running in --dry-run mode by default.");
    options.dryRun = true;
  }

  if (!fs.existsSync(VODS_DIR)) {
    console.error(`Error: VODs data directory not found at: ${VODS_DIR}`);
    process.exit(1);
  }

  // Get JSON files to process
  let jsonFiles = fs.readdirSync(VODS_DIR).filter(f => f.endsWith('.json'));
  if (options.year) {
    const filename = `${options.year}.json`;
    if (!jsonFiles.includes(filename)) {
      console.error(`Error: Year JSON file not found: ${filename}`);
      process.exit(1);
    }
    jsonFiles = [filename];
  }

  // Sort files descending (newer years first)
  jsonFiles.sort((a, b) => b.localeCompare(a));

  console.log(`Scanning VOD data files in ${VODS_DIR}...`);

  // Find all VODs with missing thumbnails
  const missingQueue = [];

  for (const file of jsonFiles) {
    const filePath = path.join(VODS_DIR, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(content)) continue;

      content.forEach((vod, index) => {
        let isMissing = false;
        let imageRelativePath = '';

        if (!vod.teaserImage || vod.teaserImage.trim() === '') {
          isMissing = true;
        } else {
          // If teaserImage is specified, verify it exists on disk
          imageRelativePath = vod.teaserImage;
          const fullDiskPath = path.join(SRC_DIR, imageRelativePath);
          if (!fs.existsSync(fullDiskPath)) {
            isMissing = true;
          }
        }

        if (isMissing) {
          const year = vod.year || (vod.date ? vod.date.substring(0, 4) : 'unknown');
          let finalImageRelPath = imageRelativePath;
          
          if (!finalImageRelPath) {
            // Generate filename based on path
            const filename = getFilenameFromPath(vod.path || `/vod/node/${Math.floor(Math.random() * 100000)}`);
            finalImageRelPath = `/assets/images/vod/${year}/${filename}`;
          }

          missingQueue.push({
            yearFile: file,
            index,
            title: vod.title,
            videoSource: vod.videoSource,
            videoId: vod.videoId,
            path: vod.path,
            teaserImage: finalImageRelPath,
            year
          });
        }
      });
    } catch (err) {
      console.error(`Error scanning file ${file}: ${err.message}`);
    }
  }

  console.log(`Found ${missingQueue.length} VOD entries with missing/broken thumbnails.`);

  if (missingQueue.length === 0) {
    console.log("All VOD entries have valid thumbnails. Nothing to do!");
    process.exit(0);
  }

  if (options.dryRun) {
    console.log("\n=== DRY RUN MODE ===");
    console.log("List of missing thumbnails (showing up to 50):");
    missingQueue.slice(0, 50).forEach(item => {
      console.log(`- [${item.videoSource}] ${item.title} (Year: ${item.year}, File: ${item.yearFile}, Index: ${item.index})`);
      console.log(`  Target Path: ${item.teaserImage}`);
    });
    if (missingQueue.length > 50) {
      console.log(`  ... and ${missingQueue.length - 50} more entries.`);
    }
    process.exit(0);
  }

  // Determine how many items to process
  const processLimit = Math.min(options.limit, missingQueue.length);
  console.log(`\nStarting thumbnail generation for ${processLimit} items...`);

  let successCount = 0;
  let failCount = 0;

  // Track modified entries by year file to save them all at once at the end
  const fileUpdates = {};

  for (let i = 0; i < processLimit; i++) {
    const item = missingQueue[i];
    console.log(`\n[${i + 1}/${processLimit}] Processing: "${item.title}"`);
    console.log(`  Source: ${item.videoSource} | ID: ${item.videoId}`);

    const targetDiskPath = path.join(SRC_DIR, item.teaserImage);

    // Skip downloading if the file exists and overwrite is false
    if (fs.existsSync(targetDiskPath) && !options.overwrite) {
      console.log(`  File already exists on disk at ${item.teaserImage} and --overwrite was not set. Skipping.`);
      // Still count it as update in the JSON if not already set
      if (!fileUpdates[item.yearFile]) {
        fileUpdates[item.yearFile] = JSON.parse(fs.readFileSync(path.join(VODS_DIR, item.yearFile), 'utf8'));
      }
      fileUpdates[item.yearFile][item.index].teaserImage = item.teaserImage;
      successCount++;
      continue;
    }

    try {
      let streamUrl = '';
      let duration = 0;

      if (item.videoSource === 'vimeo') {
        console.log(`  Resolving Vimeo video streams...`);
        const res = await resolveVimeo(item.videoId);
        streamUrl = res.streamUrl;
        duration = res.duration;
      } else if (item.videoSource === 'archive.org') {
        console.log(`  Resolving Archive.org video metadata...`);
        const res = await resolveArchive(item.videoId);
        streamUrl = res.streamUrl;
        duration = res.duration;
      } else {
        throw new Error(`Unsupported video source: ${item.videoSource}`);
      }

      // Pick random time between 15% and 85% of video
      const minTime = Math.floor(duration * 0.15);
      const maxTime = Math.floor(duration * 0.85);
      const randomTimestamp = minTime + Math.floor(Math.random() * (maxTime - minTime || 1));

      console.log(`  Video duration: ${duration}s. Seeking to random timestamp: ${randomTimestamp}s...`);

      // Capture frame
      const ok = captureFrame(streamUrl, randomTimestamp, targetDiskPath);
      if (ok) {
        console.log(`  \x1b[32mSuccess!\x1b[0m Thumbnail saved to ${item.teaserImage}`);
        
        // Stage update
        if (!fileUpdates[item.yearFile]) {
          fileUpdates[item.yearFile] = JSON.parse(fs.readFileSync(path.join(VODS_DIR, item.yearFile), 'utf8'));
        }
        fileUpdates[item.yearFile][item.index].teaserImage = item.teaserImage;
        successCount++;
      } else {
        throw new Error("ffmpeg execution failed.");
      }
    } catch (err) {
      console.error(`  \x1b[31mFailed to process entry:\x1b[0m ${err.message}`);
      failCount++;
    }

    // Apply delay between requests if not the last item
    if (i < processLimit - 1 && options.delay > 0) {
      console.log(`  Waiting ${options.delay}ms to respect rate limits...`);
      await sleep(options.delay);
    }
  }

  // Save all modified files
  const updatedFiles = Object.keys(fileUpdates);
  if (updatedFiles.length > 0) {
    console.log(`\nSaving updates to VOD files...`);
    updatedFiles.forEach(file => {
      const filePath = path.join(VODS_DIR, file);
      fs.writeFileSync(filePath, JSON.stringify(fileUpdates[file], null, 2), 'utf8');
      console.log(`  Updated ${file}`);
    });
  }

  console.log(`\n=== PROCESS COMPLETED ===`);
  console.log(`Successfully processed: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`=========================`);
}

main();
