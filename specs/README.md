# Cahiers des charges — règles de rangement

**Version en vigueur : voir [`ACTUEL.json`](ACTUEL.json)** (aujourd'hui 1.3).

```
specs/
  ACTUEL.json        ← pointe vers la version en vigueur (seul fichier à changer lors d'une nouvelle version)
  INTEGRITE.json     ← empreintes SHA-256 des versions archivées (vérifiées par tests/specs.test.js)
  CHANGELOG.md       ← ce qui change d'une version à l'autre, et qui l'a décidé
  v1.2/              ← ARCHIVE figée (version d'origine, conçue avec Codex)
  v1.3/              ← version en vigueur : .json (fait foi pour les ids/statuts) + .md (lecture)
```

## Règles (humains, Codex, Claude Code)
1. **Une version archivée ne se modifie jamais et ne se supprime jamais.** `tests/specs.test.js` échoue si un octet change.
2. Faire évoluer le cahier des charges = **créer `specs/v1.4/`** (copie de la version en vigueur), modifier la copie,
   mettre à jour `ACTUEL.json`, ajouter la version précédente à `INTEGRITE.json`, écrire une entrée dans `CHANGELOG.md`.
3. Les identifiants d'exigence (`IMP-01`, `PER-03`…) sont **stables** : ne jamais renuméroter ; une exigence abandonnée
   passe au statut « abandonné » avec une note, elle n'est pas effacée.
4. Le statut « fait » exige une preuve (test ou essai documenté). Mettre à jour le statut dans le JSON **et** le tableau du `.md`.
5. Une décision de l'atelier (ajout, retrait d'une fonction) est notée dans `CHANGELOG.md` avec sa date.
