const fs = require('fs');
const path = require('path');

const hookSource = `#!/bin/sh
# Pre-commit hook to validate changed VOD JSON files.
# Installed by scripts/install-hook.js

echo "Running pre-commit VOD JSON validation..."
node scripts/validate-vods.js --staged
`;

function main() {
  const gitDir = path.join(__dirname, '../.git');
  
  if (!fs.existsSync(gitDir)) {
    console.log('No .git directory found. Skipping pre-commit hook installation.');
    process.exit(0);
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  
  try {
    fs.writeFileSync(hookPath, hookSource, { encoding: 'utf8', mode: 0o755 });
    
    // Explicitly chmod it just in case writeFileSync mode flags don't apply correctly on some environments
    try {
      fs.chmodSync(hookPath, '755');
    } catch (err) {
      // Ignore chmod errors on environments where it is not supported
    }

    console.log('Successfully installed git pre-commit hook.');
  } catch (err) {
    console.error(`Failed to write pre-commit hook: ${err.message}`);
    process.exit(1);
  }
}

main();
