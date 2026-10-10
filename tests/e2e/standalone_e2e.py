"""Essai navigateur de l'application autonome (Chromium headless, rendu logiciel).

Prérequis : pip install playwright && python -m playwright install chromium
Usage : npm run build:standalone && python tests/e2e/standalone_e2e.py [dossier_captures]
Échoue (code 1) si une vérification ne passe pas ou si la page lève une erreur JavaScript.
"""
import pathlib, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = ROOT / "dist-standalone" / (sys.argv[2] if len(sys.argv) > 2 else "SDC_Montage_3D.html")
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "dist-standalone" / "captures")
OUT.mkdir(parents=True, exist_ok=True)
failures = []
def check(cond, msg):
    print(("OK   " if cond else "ÉCHEC ") + msg)
    if not cond: failures.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    # Version légère : le CDN est servi depuis node_modules (essai sans Internet, mêmes fichiers).
    dist = ROOT / "node_modules" / "occt-import-js" / "dist"
    pg.route("https://cdn.jsdelivr.net/npm/occt-import-js@*/dist/*", lambda r: r.fulfill(path=str(dist / r.request.url.rsplit("/", 1)[1]), headers={"Access-Control-Allow-Origin": "*"}))
    pg.goto(HTML.as_uri())
    pg.click("#demo2")
    pg.wait_for_function("window.__SDC__ && window.__SDC__.S.drill && document.getElementById('busy').hidden", timeout=120000)
    S = lambda js: pg.evaluate(f"() => {{ const S = window.__SDC__.S; return {js}; }}")
    check(S("S.parts.length") == 15, "15 occurrences lues dans le STEP de démonstration")
    check(S("S.bom.length") == 9, "9 repères de nomenclature")
    nets = S("S.drill.networks.map(n => [n.kind, n.suggestion, n.features.length])")
    check(["circuit", "distribution matière", 7] in nets, "réseau de distribution matière (7 perçages)")
    check(["circuit", "refroidissement ?", 5] in nets, "circuit de refroidissement proposé (5 perçages)")
    pg.screenshot(path=str(OUT / "1_explorer.png"))
    # éclaté puis retour exact
    pg.click("#rail button[data-mode=eclate]")
    for v in ("80", "0"):
        pg.fill("#ex-amount", v); pg.dispatch_event("#ex-amount", "input")
        if v == "80": pg.screenshot(path=str(OUT / "2_eclate.png"))
    check(S("Math.max(...[...S.objs.values()].map(o => o.grp.position.length()))") == 0, "retour exact à la position d'origine après éclaté")
    # isolation + transparence + annuler
    pg.evaluate("() => window.__SDC__.select(['O006'])")
    pg.click("#s-isolate")
    check(S("Object.values(S.items).filter(i => i.visible).length") == 1, "isoler une pièce")
    pg.click("#undo")
    check(S("Object.values(S.items).filter(i => i.visible).length") == 15, "annuler l'isolation")
    # coupe XZ
    pg.click("#rail button[data-mode=coupe]")
    pg.click("#planes .plane:nth-child(1) header .btn.toggle")
    check(S("S.cuts.y.on") is True, "coupe XZ activée")
    pg.screenshot(path=str(OUT / "3_coupe.png"))
    pg.click("#cut-reset")
    # circuits seuls
    pg.click("#rail button[data-mode=percages]")
    pg.click("#skel-only")
    pg.click("#net-list .row.net >> nth=0")
    pg.screenshot(path=str(OUT / "4_circuits.png"))
    check(S("S.selNet") == "R1", "sélection d'un réseau")
    # commentaire + persistance locale
    pg.click("#rail button[data-mode=notes]")
    pg.evaluate("() => window.__SDC__.select(['O006'])")
    pg.fill("#c-text", "Contrôler les obturateurs avant montage")
    pg.click("#c-add"); time.sleep(0.8)
    pg.reload(); pg.click("#demo2")
    pg.wait_for_function("window.__SDC__ && window.__SDC__.S.drill && document.getElementById('busy').hidden", timeout=120000)
    check(S("S.comments.length") == 1, "commentaire restauré à la réouverture du même fichier")
    # ouverture d'un STEP zippé
    import zipfile, tempfile
    zp = pathlib.Path(tempfile.mkdtemp()) / "bcr.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z: z.write(ROOT / "tests" / "fixtures" / "bcr_synthetique.step", "bcr_synthetique.step")
    pg.set_input_files("#file", str(zp))
    pg.wait_for_function("window.__SDC__.S.fileName === 'bcr_synthetique.step' && document.getElementById('busy').hidden", timeout=120000)
    check(S("S.parts.length") == 15, "ouverture d'un STEP zippé")
    check(not errors, "aucune erreur JavaScript" + (f" : {errors[:3]}" if errors else ""))
    b.close()
sys.exit(1 if failures else 0)
