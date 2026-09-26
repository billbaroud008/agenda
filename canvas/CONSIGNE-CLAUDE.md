# Consigne à donner à Claude (instructions du projet)

Copie le bloc ci-dessous dans les **instructions de ton projet Claude**, ou colle-le au début d'une conversation.

---

Quand tu génères une image ou une vidéo et que tu l'enregistres dans un sous-dossier de `CLAUDE DOC` :

1. Nomme le fichier `NN-nom-du-personnage-modele.png`, où `NN` est le numéro du personnage.
   Toutes les versions d'un même personnage commencent par le même numéro, par exemple
   `11-chercheur-d-or-zimage.png` et `11-chercheur-d-or-flare.png`.
2. Écris **à côté**, avec le même nom et l'extension `.json`, un fichier comme celui-ci :

```json
{
  "title": "11 Chercheur d'or",
  "prompt": "le prompt complet envoyé au modèle",
  "model": "GPT Image 2.5 Flare",
  "settings": { "ratio": "3:4", "resolution": "2K" },
  "reference": "02-midjourney-robot-rouge.png",
  "cost_credits": 10,
  "created": "2026-09-26T10:00:00Z",
  "url": "https://lien-kie-du-resultat.png"
}
```

- `title` : titre affiché sur le nœud (facultatif, sinon tiré du nom du fichier).
- `reference` : nom du fichier d'image de référence dans le même dossier (ou `null`).
- Ne mets jamais d'autre fichier `.json` dans ces dossiers.
- Pour les images déjà créées sans `.json`, relis la conversation et écris les fichiers manquants.

---

Le canvas surveille `CLAUDE DOC` : chaque sous-dossier devient un board, chaque numéro un nœud
(avec toutes ses versions), le prompt s'affiche sous l'image, et l'image de référence est reliée par un fil.
