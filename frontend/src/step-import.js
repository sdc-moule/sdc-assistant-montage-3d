export async function responseJson(response) {
  let value;
  try { value = await response.json(); } catch { throw new Error('Le moteur STEP ne répond pas. Démarrer SDC avec Demarrer_SDC.bat.'); }
  if (!response.ok) throw new Error(value.error ?? value.message ?? 'Erreur du moteur STEP.');
  return value;
}

export async function importStep(file, token, progress) {
  if (!file || !/\.(step|stp)$/i.test(file.name)) throw new Error('Sélectionner un fichier STEP ou STP.');
  if (file.size === 0 || file.size > 512 * 1024 * 1024) throw new Error('Le STEP doit être non vide et inférieur à 512 Mo.');
  progress('Transmission du STEP au moteur local…');
  let job = await responseJson(await fetch(`/api/import-step?name=${encodeURIComponent(file.name)}`, {method:'POST', headers:{'Content-Type':'application/octet-stream', 'X-SDC-Token':token}, body:file}));
  const deadline = Date.now() + 31 * 60 * 1000;
  while (job.state !== 'ready' && job.state !== 'failed') {
    if (Date.now() > deadline) throw new Error('La conversion est trop longue. Vérifier le moteur et les fichiers récemment importés.');
    progress(job.message);
    await new Promise(resolve => setTimeout(resolve, 700));
    job = await responseJson(await fetch(`/api/jobs/${job.id}`));
  }
  if (job.state === 'failed') throw new Error(job.message);
  return job;
}
