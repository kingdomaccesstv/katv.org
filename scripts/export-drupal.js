const fs = require('fs');
const path = require('path');
const http = require('https');
const url = require('url');

// We use native require for node-fetch if needed, or we can use standard http module for downloads.
// Since node-fetch is installed, we can require it.
const fetch = require('node-fetch');

const BASE_URL = 'https://katv.org';
const VOD_API_URL = `${BASE_URL}/jsonapi/node/vod?page[limit]=50&include=field_show_teaser_image.field_media_image,field_program_category,field_content_year`;
const PAGE_API_URL = `${BASE_URL}/jsonapi/node/page?page[limit]=50`;

// Ensure folders exist
const dataDir = path.join(__dirname, '../src/_data/vods');
const imageVodDir = path.join(__dirname, '../src/assets/images/vod');
const imageInlineDir = path.join(__dirname, '../src/assets/images/inline');
const pagesDir = path.join(__dirname, '../src/pages');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(imageVodDir, { recursive: true });
fs.mkdirSync(imageInlineDir, { recursive: true });
fs.mkdirSync(pagesDir, { recursive: true });

// Load categoryMap
const categoryMapPath = path.join(__dirname, '../src/_data/categoryMap.json');
let categoryMap = {};
let categoryMapModified = false;
if (fs.existsSync(categoryMapPath)) {
  try {
    categoryMap = JSON.parse(fs.readFileSync(categoryMapPath, 'utf8'));
  } catch (e) {
    console.error('Error reading categoryMap.json:', e);
  }
}

// Helper to map dynamic category objects to machine identifier strings, and auto-register new ones
function getCategoryMachineId(name, catAlias) {
  // Try to find existing mapped key
  for (const [id, mapped] of Object.entries(categoryMap)) {
    if (mapped.name === name) {
      return id;
    }
    const normPath = catAlias ? catAlias.replace(/\/+/, '/') : '';
    const normMappedPath = mapped.path ? mapped.path.replace(/\/+/, '/') : '';
    if (normPath && normPath === normMappedPath) {
      return id;
    }
  }

  // If not found, auto-generate machine ID (slug)
  const id = name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const finalPath = catAlias || `/vod/${id}`;
  categoryMap[id] = {
    name: name,
    path: finalPath
  };
  categoryMapModified = true;
  console.log(`Auto-registered new category: "${name}" as identifier "${id}" with path "${finalPath}"`);
  return id;
}

// Helper to download a file
function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    // If it's a relative URL, prepend BASE_URL
    const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${BASE_URL}${fileUrl}`;
    const parsedUrl = url.parse(fullUrl);
    
    // Check if file already exists to avoid redundant downloads
    if (fs.existsSync(destPath)) {
      resolve();
      return;
    }

    const file = fs.createWriteStream(destPath);
    const request = http.get(fullUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${fullUrl}: status code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// Helper to sanitize filenames
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// Parse Video ID and Source from HTML embeds
function parseVideoEmbed(vimeoHtml, archiveHtml, defaultSource = '') {
  let videoId = null;
  let videoSource = null;

  if (vimeoHtml && vimeoHtml.value) {
    const match = vimeoHtml.value.match(/vimeo\.com\/video\/([a-zA-Z0-9_-]+)/);
    if (match) {
      videoId = match[1];
      videoSource = 'vimeo';
    }
  }

  if (!videoId && archiveHtml && archiveHtml.value) {
    const match = archiveHtml.value.match(/archive\.org\/embed\/([a-zA-Z0-9_\-\.]+)/);
    if (match) {
      videoId = match[1];
      // strip any URL arguments from matching Archive.org ID
      if (videoId.indexOf('&') !== -1) {
        videoId = videoId.split('&')[0];
      }
      if (videoId.indexOf('?') !== -1) {
        videoId = videoId.split('?')[0];
      }
      videoSource = 'archive.org';
    }
  }

  // fallback to parse show id from embed
  if (!videoId) {
    videoSource = defaultSource || 'archive.org';
  }

  return { videoId, videoSource };
}

// Process a page of JSON:API VOD nodes
async function processVodPage(urlPath) {
  console.log(`Fetching VODs: ${urlPath}`);
  const response = await fetch(urlPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch VOD API: ${response.statusText}`);
  }
  const json = await response.json();
  
  if (!json.data || json.data.length === 0) {
    return null;
  }

  // Create lookup map of included entities
  const includedMap = {};
  if (json.included) {
    json.included.forEach((item) => {
      includedMap[`${item.type}:${item.id}`] = item;
    });
  }

  const vods = [];

  for (const node of json.data) {
    const attrs = node.attributes || {};
    const rels = node.relationships || {};

    const title = attrs.title;
    const nid = attrs.drupal_internal__nid;
    let pathAlias = attrs.path ? attrs.path.alias : null;
    if (!pathAlias || pathAlias === '/' || pathAlias === '') {
      pathAlias = `/vod/node/${nid}`;
    }
    const cablecastShowId = attrs.field_cablecast_show_id;
    const eventDate = attrs.field_event_date || attrs.created ? attrs.field_event_date || attrs.created.substring(0, 10) : null;
    const location = attrs.field_event_location;

    // Resolve Year taxonomy
    let yearName = '';
    let yearPath = '';
    if (rels.field_content_year && rels.field_content_year.data) {
      const yearTerm = includedMap[`taxonomy_term--content_year:${rels.field_content_year.data.id}`];
      if (yearTerm) {
        yearName = yearTerm.attributes.name;
        yearPath = yearTerm.attributes.path ? yearTerm.attributes.path.alias : '';
      }
    }

    // Resolve Categories taxonomy
    const categories = [];
    if (rels.field_program_category && rels.field_program_category.data) {
      const data = Array.isArray(rels.field_program_category.data) 
        ? rels.field_program_category.data 
        : [rels.field_program_category.data];
      
      data.forEach((catRef) => {
        const catTerm = includedMap[`taxonomy_term--program_category:${catRef.id}`];
        if (catTerm) {
          const catName = catTerm.attributes.name;
          const catAlias = catTerm.attributes.path ? catTerm.attributes.path.alias : '';
          const machineId = getCategoryMachineId(catName, catAlias);
          categories.push(machineId);
        }
      });
    }

    // Resolve Teaser Image
    let localImagePath = null;
    if (rels.field_show_teaser_image && rels.field_show_teaser_image.data) {
      const media = includedMap[`media--image:${rels.field_show_teaser_image.data.id}`];
      if (media && media.relationships.field_media_image && media.relationships.field_media_image.data) {
        const fileRef = media.relationships.field_media_image.data;
        const file = includedMap[`file--file:${fileRef.id}`];
        if (file && file.attributes.uri && file.attributes.uri.url) {
          const fileUrl = file.attributes.uri.url;
          const origFilename = file.attributes.filename || path.basename(fileUrl);
          const localFilename = sanitizeFilename(origFilename);
          
          const vodYear = yearName || (eventDate ? eventDate.substring(0, 4) : 'unknown');
          const destDir = path.join(imageVodDir, vodYear);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          const destPath = path.join(destDir, localFilename);
          
          try {
            console.log(`Downloading teaser image: ${fileUrl}`);
            await downloadFile(fileUrl, destPath);
            localImagePath = `/assets/images/vod/${vodYear}/${localFilename}`;
          } catch (err) {
            console.error(`Error downloading teaser image ${fileUrl}:`, err.message);
          }
        }
      }
    }

    // Resolve Video Source and Video ID
    const defaultSrc = attrs.field_video_embed_source || 'archive.org';
    const { videoId, videoSource } = parseVideoEmbed(
      attrs.field_embedded_vimeo,
      attrs.field_embedded_archivedotorg,
      defaultSrc
    );

    vods.push({
      title,
      path: pathAlias,
      cablecastShowId,
      date: eventDate,
      location,
      categories,
      teaserImage: localImagePath,
      videoSource: videoSource || defaultSrc,
      videoId: videoId || (cablecastShowId ? `katv-show-${cablecastShowId}` : ''),
      _exportYear: yearName || (eventDate ? eventDate.substring(0, 4) : 'unknown')
    });
  }

  // Group vods by year
  vods.forEach((vod) => {
    const year = vod._exportYear || 'unknown-date';
    const yearFilePath = path.join(dataDir, `${year}.json`);
    let yearData = [];
    if (fs.existsSync(yearFilePath)) {
      try {
        yearData = JSON.parse(fs.readFileSync(yearFilePath, 'utf8'));
      } catch (e) {
        yearData = [];
      }
    }

    // Clone the vod entry and delete the temporary _exportYear field
    const savedVod = { ...vod };
    delete savedVod._exportYear;

    // Avoid duplicates by path alias
    const existingIndex = yearData.findIndex(item => item.path === savedVod.path);
    if (existingIndex !== -1) {
      yearData[existingIndex] = savedVod;
    } else {
      yearData.push(savedVod);
    }

    fs.writeFileSync(yearFilePath, JSON.stringify(yearData, null, 2), 'utf8');
  });

  return json.links && json.links.next ? json.links.next.href : null;
}

// Process a normal Drupal page
async function processPage(node) {
  const attrs = node.attributes || {};
  const title = attrs.title;
  let pathAlias = attrs.path ? attrs.path.alias : null;
  const body = attrs.body ? attrs.body.processed : '';

  if (!pathAlias) {
    pathAlias = `/node/${attrs.drupal_internal__nid}`;
  }

  // Scan body HTML for inline images and download them
  let updatedBody = body;
  const imgRegex = /src="(\/sites\/default\/files\/([^"\s?]+)(\?[^"]*)?)"/g;
  let match;
  while ((match = imgRegex.exec(body)) !== null) {
    const fullImgUrl = match[1];
    let rawFilename = match[2];
    const imgFilename = sanitizeFilename(path.basename(rawFilename));
    const destPath = path.join(imageInlineDir, imgFilename);

    try {
      console.log(`Downloading inline image: ${fullImgUrl}`);
      await downloadFile(fullImgUrl, destPath);
      updatedBody = updatedBody.replace(fullImgUrl, `/assets/images/inline/${imgFilename}`);
    } catch (err) {
      console.error(`Error downloading inline image ${fullImgUrl}:`, err.message);
    }
  }

  // Clean alias for file system path
  let relativeFilePath = pathAlias;
  if (relativeFilePath.startsWith('/')) {
    relativeFilePath = relativeFilePath.substring(1);
  }
  if (!relativeFilePath || relativeFilePath === '') {
    relativeFilePath = 'index';
  }

  // If path contains subdirectories, make sure they exist
  const fullPagePath = path.join(pagesDir, `${relativeFilePath}.html`);
  const pageParentDir = path.dirname(fullPagePath);
  fs.mkdirSync(pageParentDir, { recursive: true });

  // Output page with standard 11ty front matter
  const frontMatter = `---
layout: layouts/page.njk
title: "${title.replace(/"/g, '\\"')}"
permalink: "${pathAlias}/"
---
${updatedBody}
`;

  fs.writeFileSync(fullPagePath, frontMatter, 'utf8');
  console.log(`Exported page: ${pathAlias} to ${fullPagePath}`);
}

async function run() {
  console.log('--- Starting Drupal Export ---');
  
  // 1. Crawl all pages
  try {
    console.log('Fetching normal pages...');
    const pageResponse = await fetch(PAGE_API_URL);
    if (pageResponse.ok) {
      const pageJson = await pageResponse.json();
      if (pageJson.data) {
        for (const pageNode of pageJson.data) {
          await processPage(pageNode);
        }
      }
    }
  } catch (err) {
    console.error('Error fetching normal pages:', err.message);
  }

  // 1.5. Fetch category taxonomy hierarchy and write to categoryHierarchy.json
  try {
    console.log('Fetching category taxonomy terms...');
    let catUrl = `${BASE_URL}/jsonapi/taxonomy_term/program_category?page[limit]=50`;
    const terms = [];
    while (catUrl) {
      const res = await fetch(catUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch categories: ${res.statusText}`);
      }
      const json = await res.json();
      terms.push(...json.data);
      catUrl = json.links && json.links.next ? json.links.next.href : null;
    }

    const termMap = {};
    terms.forEach(term => {
      const parentRef = term.relationships.parent && term.relationships.parent.data && term.relationships.parent.data[0];
      const parentId = (parentRef && parentRef.id !== 'virtual') ? parentRef.id : null;
      termMap[term.id] = {
        name: term.attributes.name,
        parentId: parentId
      };
    });

    const hierarchy = {};
    Object.values(termMap).forEach(term => {
      if (term.parentId) {
        const parent = termMap[term.parentId];
        if (parent) {
          if (!hierarchy[parent.name]) {
            hierarchy[parent.name] = [];
          }
          hierarchy[parent.name].push(term.name);
        }
      }
    });

    const hierarchyFilePath = path.join(__dirname, '../src/_data/categoryHierarchy.json');
    fs.writeFileSync(hierarchyFilePath, JSON.stringify(hierarchy, null, 2), 'utf8');
    console.log(`Saved category hierarchy to ${hierarchyFilePath}`);
  } catch (err) {
    console.error('Error exporting category hierarchy:', err.message);
  }

  // 2. Crawl all VODs with pagination
  let nextUrl = VOD_API_URL;
  while (nextUrl) {
    try {
      nextUrl = await processVodPage(nextUrl);
    } catch (err) {
      console.error('Error processing VOD page:', err.message);
      // Wait a moment and retry once if failed
      console.log('Retrying page processing in 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        nextUrl = await processVodPage(nextUrl);
      } catch (retryErr) {
        console.error('Retry failed, stopping VOD export:', retryErr.message);
        break;
      }
    }
  }

  if (categoryMapModified) {
    try {
      fs.writeFileSync(categoryMapPath, JSON.stringify(categoryMap, null, 2) + '\n', 'utf8');
      console.log(`Updated categoryMap.json with new categories.`);
    } catch (e) {
      console.error('Error writing categoryMap.json:', e);
    }
  }

  console.log('--- Drupal Export Completed Successfully ---');
}

run().catch((err) => {
  console.error('Fatal error in export script:', err);
});
