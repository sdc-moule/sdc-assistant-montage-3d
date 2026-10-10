import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssembly, buildBom, csv, makeProject, validateProject } from '../frontend/src/project.js';
const item = id => ({ id, name:'Plaque', dimensions_mm:[10,20,5], reference:'P1', reference_confirmed:false });
const assembly = { schema_version:'1.0', units:'mm', assembly_id:'A', source_sha256:'hash', occurrences:[item('1'),item('2')] };
test('les références ambiguës restent distinctes', () => { assert.equal(buildBom(assembly.occurrences).length,2); const rows=buildBom(assembly.occurrences.map(x=>({...x,reference_confirmed:true}))); assert.equal(rows.length,1); assert.equal(rows[0].quantity,2); });
test('les identifiants dupliqués et dimensions invalides sont refusés', () => { assert.throws(()=>validateAssembly({...assembly,occurrences:[item('1'),item('1')]})); assert.throws(()=>validateAssembly({...assembly,occurrences:[{...item('1'),dimensions_mm:[NaN,2,3]}]})); });
test('projet restaurable seulement sur la même source et occurrences',()=> { const project=makeProject(assembly,{explode:0,section:'',sectionPosition:50,inverse:false,items:{}},{position:[1,2,3],target:[0,0,0]}); assert.equal(validateProject(project,assembly),project); assert.throws(()=>validateProject({...project,source_sha256:'other'},assembly)); assert.throws(()=>validateProject({...project,occurrence_ids:['1','1']},assembly)); });
test('CSV protège séparateurs et formules de tableur',()=> { const output=csv([{...item('1'),name:'=1+2;"test"',repere:1,quantity:1}]); assert.ok(output.includes("'=1+2;\"\"test\"\"")); });
