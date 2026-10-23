#!/usr/bin/env bash
# Removes the encrypted files listed by test-accounts-cleanup.sql (one storage key per line), only under $STORAGE_DIR/blobs.
set -euo pipefail
list="$1"; root="${STORAGE_DIR:?}/blobs"; n=0; missing=0
while IFS= read -r k; do
  [[ "$k" =~ ^(w|u)/[0-9a-f-]{36}/[0-9a-f-]{36}$ ]] || { echo "refused key: $k" >&2; exit 1; }
  if [ -f "$root/$k" ]; then rm -f -- "$root/$k"; n=$((n+1)); else missing=$((missing+1)); fi
done < "$list"
find "$root" -mindepth 2 -type d -empty -delete 2>/dev/null || true
echo "removed $n files, $missing already absent"
