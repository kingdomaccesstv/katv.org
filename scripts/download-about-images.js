const fs = require('fs');
const path = require('path');
const https = require('https');

const aboutFilePath = path.join(__dirname, '../src/pages/about.html');
const destDir = path.join(__dirname, '../src/assets/images/inline');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

if (!fs.existsSync(aboutFilePath)) {
  console.error("about.html not found!");
  process.exit(1);
}

let content = fs.readFileSync(aboutFilePath, 'utf8');

// Find all matches for /sites/default/files/...
const regex = /\/sites\/default\/files\/([^"\s?]+)(\?[^"]*)?/g;
let match;
const downloads = [];

while ((match = regex.exec(content)) !== null) {
  const relativeUrl = match[0]; // e.g. /sites/default/files/styles/...staff-2023-jd.jpg?itok=...
  const urlPath = match[0].split('?')[0]; // strip query string
  const filename = path.basename(urlPath);
  
  const downloadUrl = `https://katv.org${relativeUrl}`;
  const destPath = path.join(destDir, filename);
  
  downloads.push({
    relativeUrl,
    downloadUrl,
    filename,
    destPath
  });
}

if (downloads.length === 0) {
  console.log("No images to download.");
  process.exit(0);
}

// Function to download a file
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Handle redirect
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Download files sequentially and update about.html
(async function() {
  for (const item of downloads) {
    try {
      console.log(`Downloading ${item.downloadUrl} to ${item.destPath}...`);
      await download(item.downloadUrl, item.destPath);
      console.log(`Downloaded ${item.filename}`);
      
      // Update HTML content
      content = content.replace(item.relativeUrl, `/assets/images/inline/${item.filename}`);
    } catch (err) {
      console.error(`Error downloading ${item.filename}:`, err.message);
    }
  }
  
  fs.writeFileSync(aboutFilePath, content, 'utf8');
  console.log("Updated about.html with local image paths.");
})();
