const getVods = require('./vods.js');

module.exports = function() {
  const vods = getVods();
  const yearMap = {};

  vods.forEach(vod => {
    const year = vod.year || (vod.date ? vod.date.substring(0, 4) : '');
    if (!year) return;
    const path = vod.yearPath || `/vod/year/${year}`;
    if (!yearMap[year]) {
      yearMap[year] = {
        name: year,
        path: path,
        vods: []
      };
    }
    yearMap[year].vods.push(vod);
  });

  return Object.values(yearMap);
};
