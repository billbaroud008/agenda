#!/bin/bash
# Génère images.js à partir du contenu du dossier images/
cd "$(dirname "$0")"
{
  echo "window.ILLUSTRATIONS = ["
  find images -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.svg' \) | sort | while read -r f; do
    name=$(basename "$f"); title="${name%.*}"; title="${title//[-_]/ }"
    printf '  { src: "%s", title: "%s" },\n' "$f" "$title"
  done
  echo "];"
} > images.js
echo "images.js : $(grep -c src images.js) illustration(s)"
