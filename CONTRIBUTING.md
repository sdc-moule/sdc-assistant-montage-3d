# Contribuer

Travailler sur une branche et ouvrir une pull request décrivant le comportement réel, les tests et les limites. Conserver les spécifications originales. Ne pas committer de STEP client, sorties locales, secrets, .env ou données d’autres projets.

Exécuter `npm ci`, `npm test`, `npm run build`. Pour Python, depuis la racine :

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend'
py -3.12 -m unittest discover -s tests -p 'test_*.py'
```

L’interface, les messages et les rapports destinés aux opérateurs restent en français. Signaler les inconnues sans déduction présentée comme validée. Toute géométrie de conception de moule reste soumise aux règles SDC et à validation humaine ; ce visualisateur ne délivre aucune validation de fabrication.
