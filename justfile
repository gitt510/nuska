# Start the hot-reload watcher (see README)
dev:
    node scripts/dev-server.mjs

# Run Firefox with the extension loaded, auto-reload on save
dev-ff:
    npx web-ext run --source-dir .

# Bump the manifest patch version (AMO refuses to re-sign the same version)
bump:
    node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json'));const v=m.version.split('.');v[2]=String(+v[2]+1);m.version=v.join('.');fs.writeFileSync('manifest.json',JSON.stringify(m,null,2)+'\n');console.log('version -> '+m.version)"

# Sign an unlisted build on AMO; credentials resolved from 1Password at run time
sign:
    op run --env-file=op.env -- npx web-ext sign --channel unlisted --ignore-files 'scripts/**' justfile README.md op.env

# Open the newest signed .xpi in Firefox
open-xpi:
    open -a Firefox "$(ls -t web-ext-artifacts/*.xpi | head -1)"

# Permanent install into Firefox: bump -> sign -> open
install-ff: bump sign open-xpi
