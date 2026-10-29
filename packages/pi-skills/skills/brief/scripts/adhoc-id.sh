#!/usr/bin/env bash
# Print the next free synthetic work item id: ADHOC-<YYYYMMDD><NN> (NN = 01..99).
# Same format as `accord bootstrap --adhoc` (accord-core work-items/synthetic.ts).
# An id is taken when `.tasks/<ID>.json` or `docs/dev/<ID>/` exists in the current directory.
# Exit codes: 0 printed an id, 1 no free id today.

set -euo pipefail

stamp="$(date +%Y%m%d)"
for sequence in $(seq 1 99); do
  candidate="$(printf 'ADHOC-%s%02d' "$stamp" "$sequence")"
  if [[ ! -e ".tasks/${candidate}.json" && ! -e "docs/dev/${candidate}" ]]; then
    echo "$candidate"
    exit 0
  fi
done

echo "adhoc-id: no free ADHOC-${stamp}NN id left today" >&2
exit 1
