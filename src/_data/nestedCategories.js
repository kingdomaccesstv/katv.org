const getVods = require('./vods.js');
const fs = require('fs');
const path = require('path');

module.exports = function() {
  const vods = getVods();
  const categoryMap = {};

  // 1. Gather all active categories from VOD files
  vods.forEach(vod => {
    if (vod.categories && Array.isArray(vod.categories)) {
      vod.categories.forEach(cat => {
        const key = cat.name;
        if (!key) return;
        if (!categoryMap[key]) {
          categoryMap[key] = {
            name: cat.name,
            path: cat.path,
            vods: []
          };
        }
        categoryMap[key].vods.push(vod);
      });
    }
  });

  // 2. Load hierarchy
  const hierarchyPath = path.join(__dirname, 'categoryHierarchy.json');
  let hierarchy = {};
  if (fs.existsSync(hierarchyPath)) {
    try {
      hierarchy = JSON.parse(fs.readFileSync(hierarchyPath, 'utf8'));
    } catch (e) {
      console.error('Error reading categoryHierarchy.json:', e);
    }
  }

  // 3. Structure into parent and child objects
  const parentsList = [];
  const processedChildren = new Set();

  // Find all children and map them to their parent name
  const parentOf = {};
  Object.keys(hierarchy).forEach(parentName => {
    hierarchy[parentName].forEach(childName => {
      parentOf[childName] = parentName;
      processedChildren.add(childName);
    });
  });

  // Build the structured list
  const activeNames = Object.keys(categoryMap);
  
  // Create parent slots
  activeNames.forEach(name => {
    if (!processedChildren.has(name)) {
      const catObj = categoryMap[name];
      catObj.children = [];
      parentsList.push(catObj);
    }
  });

  // Place children under their parents
  activeNames.forEach(name => {
    if (processedChildren.has(name)) {
      const parentName = parentOf[name];
      let parentObj = parentsList.find(p => p.name === parentName);
      
      if (!parentObj) {
        // Fallback: If the parent category is not in active VODs directly but the child is,
        // create the parent category placeholder so its child can render under it.
        const parentAlias = `/vod/${parentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        parentObj = {
          name: parentName,
          path: parentAlias,
          vods: [],
          children: []
        };
        categoryMap[parentName] = parentObj;
        parentsList.push(parentObj);
      }
      
      parentObj.children.push(categoryMap[name]);
    }
  });

  // Sort parents alphabetically, and children alphabetically under them
  parentsList.sort((a, b) => a.name.localeCompare(b.name));
  parentsList.forEach(parent => {
    if (parent.children) {
      parent.children.sort((a, b) => a.name.localeCompare(b.name));
    }
  });

  return parentsList;
};
