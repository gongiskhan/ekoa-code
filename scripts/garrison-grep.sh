#!/usr/bin/env bash
# Garrison boundary grep gates (ch08 §8.5 rules 3 and 4, FIXED-7).
#  Rule 3: never import Garrison code — fail on case-insensitive `garrison` in any
#          package.json, lockfile, or .gitmodules (incl. the repo-root manifests).
#  Rule 4: never call Garrison as a service — fail on case-insensitive `garrison`
#          in any api/src/** or shared/** source file.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# Rule 3 — never DEPEND ON a Garrison package. Check dependency declarations (not arbitrary
# string occurrences — the enforcement scripts themselves name 'garrison'). Inspect every
# workspace package.json's dependency KEYS and every package-lock.json's package names, plus
# any .gitmodules content. Prune node_modules so third-party manifests don't false-positive.
for pj in $(find . -type d -name node_modules -prune -o -name package.json -type f -print); do
  if node -e '
    const j=require(process.argv[1]);
    const deps=Object.assign({},j.dependencies,j.devDependencies,j.peerDependencies,j.optionalDependencies);
    if(Object.keys(deps).some(k=>/garrison/i.test(k))) process.exit(1);
  ' "$pj" 2>/dev/null; then :; else
    echo "GARRISON GATE (rule 3) FAILED: a 'garrison' dependency in $pj (FIXED-7: never import Garrison code)."; fail=1
  fi
done
for lock in $(find . -type d -name node_modules -prune -o -name package-lock.json -type f -print); do
  if node -e '
    const j=require(process.argv[1]);
    const names=Object.keys(j.packages||{}).concat(Object.keys(j.dependencies||{}));
    if(names.some(n=>/(^|\/)garrison/i.test(n))) process.exit(1);
  ' "$lock" 2>/dev/null; then :; else
    echo "GARRISON GATE (rule 3) FAILED: a 'garrison' package in $lock (FIXED-7: never import Garrison code)."; fail=1
  fi
done
for gm in $(find . -type d -name node_modules -prune -o -name '.gitmodules' -type f -print); do
  if grep -iq 'garrison' "$gm" 2>/dev/null; then
    echo "GARRISON GATE (rule 3) FAILED: 'garrison' submodule in $gm (FIXED-7)."; fail=1
  fi
done

# Rule 4 — source files under api/src and shared/src, excluding *.test.* files
# (the '.' are escaped so 'latest.ts'/'attestation.ts' are NOT wrongly excluded).
if grep -riEln 'garrison' api/src shared/src 2>/dev/null | grep -vE '\.test\.'; then
  echo "GARRISON GATE (rule 4) FAILED: 'garrison' in api/src or shared/src (FIXED-7: never call Garrison as a service)."; fail=1
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "garrison grep gates: clean"
