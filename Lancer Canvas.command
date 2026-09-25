#!/bin/bash
# Double-clic : met à jour le canvas, le lance et ouvre le navigateur.
# Pour l'arrêter : fermer cette fenêtre (ou Ctrl + C).

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")" || exit 1

# Déjà lancé ? On ouvre juste la page.
if lsof -i :5173 -sTCP:LISTEN >/dev/null 2>&1; then
  open "http://localhost:5173"
  exit 0
fi

echo "Mise à jour…"
git pull --quiet || echo "(mise à jour impossible, on lance la version actuelle)"

cd canvas || exit 1
if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Installation des dépendances…"
  npm install --silent && touch node_modules
fi

echo "Canvas IA lancé sur http://localhost:5173 — ferme cette fenêtre pour l'arrêter."
npm run dev -- --port 5173 --strictPort --open
