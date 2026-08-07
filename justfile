_default:
    @just --list --unsorted

# Start the hot-reload watcher (see README)
[group('dev')]
dev:
    node scripts/dev-server.mjs

# Run Firefox with the extension loaded, auto-reload on save
[group('dev')]
dev-ff:
    npx web-ext run --source-dir src

# Bump the manifest patch version; AMO refuses to re-sign the same version
[group('install')]
bump:
    node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('src/manifest.json'));const v=m.version.split('.');v[2]=String(+v[2]+1);m.version=v.join('.');fs.writeFileSync('src/manifest.json',JSON.stringify(m,null,2)+'\n');console.log('version -> '+m.version)"

# Upload the extension to AMO for signing, download the signed .xpi into web-ext-artifacts/
# approval-timeout: AMO approval sometimes outlasts the default wait, and a sign
# that dies before download burns the version number (0.1.6/0.1.7 died that way).
[group('install')]
sign:
    op run --env-file=op.env -- npx web-ext sign --source-dir src --artifacts-dir web-ext-artifacts --channel unlisted --ignore-files dev-seed.json --approval-timeout 1800000

# Install the newest signed .xpi into Firefox (opens the install prompt)
[group('install')]
install-xpi:
    open -a Firefox "$(ls -t web-ext-artifacts/*.xpi | head -1)"

# Install permanently into Firefox: bump -> sign -> install-xpi
[group('install')]
install-ff: bump sign install-xpi
