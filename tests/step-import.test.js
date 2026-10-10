import test from 'node:test';
import assert from 'node:assert/strict';
import { responseJson, importStep } from '../frontend/src/step-import.js';
test('les erreurs du moteur STEP sont lisibles',async()=>{
  await assert.rejects(responseJson(new Response(JSON.stringify({error:'Fichier invalide'}),{status:400})),/Fichier invalide/);
  await assert.rejects(responseJson(new Response('<html>404</html>',{status:404})),/Démarrer SDC/);
});
test('sélection et taille du STEP contrôlées avant transfert',async()=>{
  await assert.rejects(importStep(null,'token',()=>{}),/Sélectionner/);
  await assert.rejects(importStep({name:'x.step',size:0},'token',()=>{}),/non vide/);
  await assert.rejects(importStep({name:'x.txt',size:10},'token',()=>{}),/STEP/);
});
