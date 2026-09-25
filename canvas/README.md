# Canvas IA

Canvas infini à nœuds (React Flow) pour générer images et vidéos via **KIE.ai**. Tout est sauvegardé dans le navigateur (IndexedDB).

## Lancer

```bash
cd canvas
npm install
npm run dev      # http://localhost:5173
```

Au premier lancement, colle ta clé API KIE (⚙). Elle reste dans le navigateur.

> Utilise `npm run dev` : le serveur local relaie les appels KIE et les téléchargements (évite les blocages CORS).
> `npm run build` produit une version statique, qui appelle KIE directement.

## Nœuds

| Nœud | Rôle |
|---|---|
| **Image** | Prompt + modèle (Nano Banana, Nano Banana Pro, Seedream 4) + format. ▶ génère, ⧉ duplique (prompt, réglages et liens entrants). Images reliées en entrée = références (mode édition). Historique des versions sous l'aperçu. |
| **Import** | Glisser-déposer une image (sur le nœud ou n'importe où sur le canvas). |
| **Vidéo** | Seedance 2.5 et 2 Mini (premier/dernier frame ou multi-référence : 30 / 9 images), Seedance Lite/Pro, Minimax Hailuo 02 Standard/Pro. 0 image = texte→vidéo, 1 image = premier frame, 2 images = premier + dernier frame (⇄ pour inverser). |
| **Note** | Texte libre, redimensionnable. |

Suppr / Retour arrière supprime la sélection. `⋯` ouvre un champ JSON pour ajouter des paramètres KIE bruts.

## Fonctionnement

- Génération : `createTask` puis vérification régulière (`recordInfo`) jusqu'au résultat. Les tâches reprennent après rechargement de la page.
- Les résultats sont **téléchargés immédiatement** en local (les URL KIE expirent).
- Les images locales utilisées en entrée sont uploadées chez KIE (URL réutilisée 2 jours).
- Coût estimé affiché avant de lancer ; solde de crédits dans la barre du haut.
- Plusieurs boards (un par projet), export/import `.json` (médias inclus). Le bouton Exporter passe en jaune après 7 jours sans export : IndexedDB peut être vidé par le navigateur.

## Ajouter / corriger un modèle

Tout est dans `src/models.js` : identifiant KIE, construction des paramètres, coût. Les paramètres et tarifs ont été écrits d'après la doc KIE connue ; **vérifie-les sur [docs.kie.ai](https://docs.kie.ai) et [kie.ai/pricing](https://kie.ai/pricing)** avant de te fier aux coûts.

## Plus tard

Upscale, suppression de fond, lipsync, nœud audio, groupes colorés, batch par groupe.
