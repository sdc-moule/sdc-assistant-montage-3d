## Objet
<!-- Ce que la PR change, en français, comportement réel (pas les intentions). -->

## Exigences du cahier des charges concernées
<!-- ids de specs/v1.x (ex. PER-03, OUV-02) et nouveau statut -->
- [ ] Statuts mis à jour dans le `.json` **et** le tableau du `.md` de la version en vigueur
- [ ] Aucune archive `specs/v*/` modifiée ou supprimée
- [ ] Aucun fichier / fonction existante supprimée sans décision notée dans `specs/CHANGELOG.md`

## Vérifications
- [ ] `npm test`
- [ ] `npm run build:standalone`
- [ ] `python tests/e2e/standalone_e2e.py` sans ÉCHEC, captures relues
- [ ] Aucun STEP client committé
