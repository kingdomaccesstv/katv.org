const getVods = require('./vods.js');

module.exports = function() {
  const vods = getVods();
  const categoryMap = {};

  vods.forEach(vod => {
    if (vod.categories && Array.isArray(vod.categories)) {
      vod.categories.forEach(cat => {
        const key = cat.path || cat.name;
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

  return Object.values(categoryMap);
};
