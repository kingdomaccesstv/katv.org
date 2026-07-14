const { DateTime } = require("luxon");

module.exports = function(eleventyConfig) {
  // Pass through copy for assets
  eleventyConfig.addPassthroughCopy("src/assets");
  // If we downloaded any Drupal files directly or want to serve themes
  eleventyConfig.addPassthroughCopy("src/sites");
  // Pass through root favicon
  eleventyConfig.addPassthroughCopy("src/favicon.ico");
  // Pass through robots.txt
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // Date formatting filter
  eleventyConfig.addFilter("postDate", (dateObj) => {
    if (!dateObj) return "";
    let date;
    if (typeof dateObj === "string") {
      date = DateTime.fromISO(dateObj);
    } else {
      date = DateTime.fromJSDate(dateObj);
    }
    return date.toFormat("LLL d, yyyy");
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return "";
    let date;
    if (typeof dateObj === "string") {
      date = DateTime.fromISO(dateObj);
    } else {
      date = DateTime.fromJSDate(dateObj);
    }
    return date.toISODate();
  });

  // Limit filter
  eleventyConfig.addFilter("limit", function(arr, limit) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, limit);
  });

  // Category url helper
  eleventyConfig.addFilter("categoryUrl", function(catPath) {
    if (!catPath) return "#";
    return catPath.startsWith('/') ? catPath : `/${catPath}`;
  });

  // Pagination filters
  eleventyConfig.addFilter("pageRange", function(pageNumber, totalPages) {
    const blockSize = 10;
    const currentBlock = Math.floor(pageNumber / blockSize);
    const start = currentBlock * blockSize;
    const end = Math.min(start + blockSize, totalPages);
    
    const range = [];
    for (let i = start; i < end; i++) {
      range.push(i);
    }
    return range;
  });

  eleventyConfig.addFilter("nextBlockPage", function(pageNumber, totalPages) {
    const blockSize = 10;
    const currentBlock = Math.floor(pageNumber / blockSize);
    const nextStart = (currentBlock + 1) * blockSize;
    return nextStart < totalPages ? nextStart : null;
  });

  eleventyConfig.addFilter("prevBlockPage", function(pageNumber) {
    const blockSize = 10;
    const currentBlock = Math.floor(pageNumber / blockSize);
    const prevStart = (currentBlock - 1) * blockSize;
    return prevStart >= 0 ? prevStart : null;
  });

  // Configuration settings
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["html", "njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
};
