# Kingdom Access TV (katv.org)

This repository contains the source code for the static website of **Kingdom Access TV (KATV)**, built using the [Eleventy (11ty)](https://www.11ty.dev/) static site generator.

---

## Section 1: Technical & Backend Architecture

### The Stack

- **Static Site Generator**: [Eleventy (11ty) v2](https://www.11ty.dev/)
- **Templating Engine**: Nunjucks (`.njk`) and HTML
- **Utility Libraries**: `luxon` (date formatting), `node-fetch` (API fetching)
- **Data Source**: Local JSON files (VOD content) and static HTML files in this repository.

### How the Site Works

Eleventy builds the site by compiling templates in the `src` directory with dynamic data from the `src/_data` directory. The output is a highly performant, SEO-optimized static site generated inside the `_site` directory.

- **`eleventy.config.js`**: Defines the Eleventy configuration, including asset passthroughs (`assets`, `sites` themes, favicon, `robots.txt`), custom date formatting filters (`postDate`, `isoDate`), and pagination utilities.
- **Dynamic Collections & Mappings**:
  - `src/_data/categoryMap.json`: Centralized registry mapping category machine identifiers (like `sports`) to their display names (`Local Sports`) and paths (`/vod/sports`).
  - `src/_data/vods.js`: Scans the `src/_data/vods/` folder for year-based JSON files, parses and merges them, defaults missing teaser images to a placeholder, sorts all videos by date descending, dynamically resolves category machine IDs from `categoryMap.json` to full objects, and automatically derives the `year` and `yearPath` properties.
  - `src/_data/years.js`: Automatically groups all VOD items by their year to build the year listing collection.
  - `src/_data/categories.js`: Dynamically extracts unique categories from the `categories` array of all VOD items to build category pages.
  - `src/_data/nestedCategories.js`: Structures categories hierarchically (parent and child nested layout) by reading the relationship definitions from `src/_data/categoryHierarchy.json`.
- **Page Generation**:
  - Individual VOD pages are generated dynamically via `src/vod-page.njk` using Eleventy's pagination feature (size `1`, resolving values from the `vods` collection) to output pages at `{{ vod.path }}/index.html`.
  - Category and Year collection landing pages are generated in the same way via `src/vod-categories.njk` and `src/vod-years.njk` respectively.

To run the development server locally:

```bash
npm run start
```

To compile a production build of the static site:

```bash
npm run build
```

To validate all VOD JSON files for schema and syntax compliance:

```bash
npm run validate-vods
```

### VOD Data Quality Control (Git Pre-Commit Hook)

To ensure the integrity of the VOD database, the repository is equipped with an automated pre-commit hook:

- **Validation Rules**: Run via `scripts/validate-vods.js` to verify that VOD JSON files contain the correct structure and exact set of fields, that paths start with `/vod/`, categories exist in `categoryMap.json`, and the dates and video sources are valid.
- **Git Hook Integration**: When committing changes, the pre-commit hook runs the validator _only on changed/staged VOD JSON files_. If any errors are found, the commit will be blocked and the errors will be listed.
- **Setup**: The hook is installed in `.git/hooks/pre-commit` automatically during `npm install` (using `scripts/install-hook.js` configured in the `prepare-hooks` lifecycle script).

---

## Section 2: Adding and Managing Content

All content is managed directly within the local files of this repository.

---

### 1. Adding a New VOD (Video on Demand) Item

1. Navigate to `src/_data/vods/` and open the JSON file corresponding to the video's year (e.g., `2026.json`). If the file does not exist, create it as a new array: `[]`.
2. Insert a new video object into the JSON array. The object must conform to this schema:
   ```json
   {
     "title": "Title of Your Video Program",
     "path": "/vod/sports/my-soccer-game-2026",
     "date": "2026-10-15",
     "location": "St. Johnsbury Academy",
     "categories": ["sports"],
     "teaserImage": "/assets/images/vod/2026/my-soccer-teaser.jpg",
     "videoSource": "vimeo",
     "videoId": "123456789"
   }
   ```

   - **`categories`**: Array of machine identifier strings (like `"sports"`, `"sjlifb"`) defined in `src/_data/categoryMap.json`. Year properties (`year` and `yearPath`) are omitted since they are automatically derived from the `date` property at build time.
   - **`path`**: The URL path where the video will live (must start with `/vod/`).
   - **`teaserImage`**: Path to a teaser image. If set to `null` or omitted, it defaults to the site's fallback placeholder (`/assets/images/vod/vod-preview-image.jpg`). Put custom images in `src/assets/images/vod/{year}/`.
   - **`videoSource`**: Must be one of: `"vimeo"`, `"youtube"`, `"archive.org"`, or `"cablecast"`.
   - **`videoId`**: The unique identifier of the video on that platform (e.g. Vimeo numeric ID, YouTube string ID, or Archive.org identifier).
3. Save the file and run `npm run start` to verify the page builds correctly at `http://localhost:8080/vod/sports/my-soccer-game-2026/`.

---

### 2. Adding or Modifying Categories

Categories are collected dynamically from the VOD files. If a category is assigned to a VOD item, it will automatically show up. However, parent-child nesting is governed by the category hierarchy configuration.

1. Open `src/_data/categoryMap.json` and define your category machine identifier:
   ```json
   "my-new-sport": {
     "name": "My New Sport Category",
     "path": "/vod/sports/my-new-sport"
   }
   ```
2. Open `src/_data/categoryHierarchy.json`. Locate or add a parent category key and list the category's display name in the children array:
   ```json
   {
     "Local Sports": [
       "Rotary Basketball",
       "SJA vs LI Football",
       "My New Sport Category"
     ]
   }
   ```
3. Assign the machine identifier string to your VOD items in `src/_data/vods/{year}.json` within their `categories` array:
   ```json
   "categories": [
     "my-new-sport"
   ]
   ```

---

### 3. Adding a New Year

Years are also compiled automatically from the VOD files.

1. Create a new file in `src/_data/vods/` named after the year (e.g., `2027.json`).
2. Initialize it with an empty array `[]` or add a VOD item.
3. The year list, navigation links, and dynamic year layout `/vod/year/{year}/` will automatically generate on the next build.
