#!/bin/bash
# Double-clic : copie les images du dossier « Siemens illustration » de CLAUDE DOC,
# régénère la galerie et l'ouvre.
cd "$(dirname "$0")"
BASE="$HOME/Documents/CLAUDE DOC"
SRC=$(find "$BASE" -maxdepth 1 -type d -iname '*siem*' | head -1)
if [ -z "$SRC" ]; then
  echo "Dossier Siemens introuvable dans $BASE"; read -p "Entrée pour fermer"; exit 1
fi
echo "Import depuis : $SRC"
find "$SRC" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.svg' \) -exec cp {} images/ \;
./build.sh
open index.html
