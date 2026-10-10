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
    pg.add_init_script("delete window.showSaveFilePicker")  # téléchargements directs pendant l'essai
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
    # retirer une face (clic au centre de la vue sur une pièce) puis remettre
    pg.click("#rail button[data-mode=explorer]"); pg.click("#skel-only") if S("S.skelOnly") else None
    pg.evaluate("() => { const S = window.__SDC__.S; S.skelShow = false; }")
    pg.click("[data-view=top]"); time.sleep(0.3)
    pg.click("#faces-btn")
    box = pg.locator("#viewport canvas").bounding_box()
    pg.mouse.click(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.5); time.sleep(0.3)
    check(sum(len(v) for v in S("S.hiddenFaces").values()) == 1, "retirer une face d'une pièce")
    pg.screenshot(path=str(OUT / "5_face_retiree.png"))
    pg.click("#faces-btn"); pg.click("#faces-reset")
    check(sum(len(v) for v in S("S.hiddenFaces").values()) == 0, "remettre les faces")
    # scène : mémoriser, exporter en PNG, recharger depuis le PNG
    pg.click("#rail button[data-mode=eclate]"); pg.fill("#ex-amount", "60"); pg.dispatch_event("#ex-amount", "input")
    pg.click("#scene-btn")
    check(S("S.views.length") == 1 and S("S.views[0].state.ex.amount") == 60, "scène mémorisée avec l'éclaté")
    with pg.expect_download() as d:
        pg.click("#export-btn"); pg.click("[data-export=png]")
    png = OUT / "scene.png"; d.value.save_as(png)
    pg.fill("#ex-amount", "0"); pg.dispatch_event("#ex-amount", "input")
    pg.set_input_files("#load-project", str(png)); time.sleep(0.5)
    check(S("S.ex.amount") == 60, "scène restaurée depuis le PNG")
    pg.fill("#ex-amount", "0"); pg.dispatch_event("#ex-amount", "input")
    # ouverture paramétrée : rotation du collecteur autour de l'axe de la buse (cylindre Ø30), puis retour exact
    pg.click("[data-view=iso]"); time.sleep(0.3)
    pg.click("#rail button[data-mode=eclate]")
    pg.click("#op-type button[data-op=rotation]")
    pg.click("#op-pick")
    pt = pg.evaluate("() => { const T = window.__SDC__.THREE; const q = window.__SDC__.project(new T.Vector3(10.6, -10.6, 137)); return [q.x, q.y]; }")
    r = pg.locator("#overlay").bounding_box()
    pg.mouse.click(r["x"] + pt[0], r["y"] + pt[1]); time.sleep(0.3)
    hinge = S("S.hinge && S.hinge.label")
    check(bool(hinge) and "Ø30" in hinge, f"axe de charnière pris sur le cylindre de la buse ({hinge})")
    pg.evaluate("() => window.__SDC__.select(['O006'])")
    pg.fill("#op-angle", "90"); pg.click("#op-add"); time.sleep(0.3)
    size = pg.evaluate("() => { const b = window.__SDC__.partBox('O006'); return [b[3]-b[0], b[4]-b[1]]; }")
    check(abs(size[0] - 60) < 1 and abs(size[1] - 220) < 1, f"collecteur tourné de 90° autour de l'axe ({size[0]:.1f} × {size[1]:.1f})")
    pg.screenshot(path=str(OUT / "6_rotation.png"))
    pg.fill("#op-amount", "0"); pg.dispatch_event("#op-amount", "input")
    check(S("Math.max(...[...S.objs.values()].map(o => o.grp.position.length() + Math.abs(1 - Math.abs(o.grp.quaternion.w))))") == 0, "fermé : retour exact (position et orientation)")
    pg.evaluate("() => { window.__SDC__.S.moves = []; }")
    # sélection par fenêtre
    pg.click("#s-clear") if pg.is_visible("#s-clear") else None
    pg.click("#boxsel")
    v = pg.locator("#viewport").bounding_box()
    pg.mouse.move(v["x"] + 5, v["y"] + 5); pg.mouse.down(); pg.mouse.move(v["x"] + v["width"] * 0.5, v["y"] + v["height"] * 0.5, steps=5); pg.mouse.move(v["x"] + v["width"] - 5, v["y"] + v["height"] - 5, steps=5); pg.mouse.up()
    n_all = S("S.sel.size")
    check(n_all == 15, f"fenêtre gauche → droite sur toute la vue : {n_all} pièces")
    pg.click("#s-clear")
    cx, cy = v["x"] + v["width"] * 0.5, v["y"] + v["height"] * 0.5
    pg.mouse.move(cx + 30, cy - 30); pg.mouse.down(); pg.mouse.move(cx - 30, cy + 30, steps=5); pg.mouse.up()
    n_cross = S("S.sel.size")
    check(0 < n_cross < 15, f"fenêtre droite → gauche (pièces touchées) : {n_cross} pièces")
    pg.click("#boxsel"); pg.click("#s-clear") if pg.is_visible("#s-clear") else None
    # cotation : Ø d'un cylindre, distance entre deux faces planes parallèles
    pg.click("[data-view=iso]"); time.sleep(0.3)
    pg.evaluate("() => { window.__SDC__.S.cotes = []; }")
    pg.click("#measure")
    r = pg.locator("#overlay").bounding_box()
    def click3d(x, y, z):
        q = pg.evaluate(f"() => {{ const T = window.__SDC__.THREE; const q = window.__SDC__.project(new T.Vector3({x}, {y}, {z})); return [q.x, q.y]; }}")
        pg.mouse.click(r["x"] + q[0], r["y"] + q[1]); time.sleep(0.3)
    click3d(10.6, -10.6, 137)
    txt = S("S.cotes.map(c => c.text)")
    check(any(t.startswith("Ø30,0") for t in txt), f"cotation Ø sur la buse ({txt})")
    pg.evaluate("() => { window.__SDC__.S.cotes = []; window.__SDC__.S.cote.pending = null; }")
    click3d(-100, -80, 70); click3d(60, -20, 120)
    txt = S("S.cotes.map(c => c.text)")
    check(txt == ["50,00"], f"cotation entre deux faces parallèles = 50 ({txt})")
    pg.screenshot(path=str(OUT / "7_cotes.png"))
    pg.click("#cotes-vis"); check(S("S.cotesVisible") is False, "masquer les cotes"); pg.click("#cotes-vis")
    pg.click("#measure")
    # coupe : contour des pièces coupées
    pg.evaluate("() => { const A = window.__SDC__; A.S.cuts.y = { on: true, pos: 0, flip: true }; A.setMode('coupe'); }"); time.sleep(0.5)
    nseg = S("[...S.objs.values()].filter(o => o.capSets?.y?.contour.visible).length")
    check(nseg >= 5, f"contours de coupe calculés ({nseg} pièces)")
    pg.screenshot(path=str(OUT / "8_coupe_contours.png"))
    pg.evaluate("() => { const A = window.__SDC__; A.S.cuts.y.on = false; A.setMode('explorer'); }")
    # panneaux : réduire, détacher, remettre
    pg.click("#panel-left .pc-fold"); time.sleep(0.2)
    check("collapsed" in pg.get_attribute("#panel-left", "class"), "réduire le panneau gauche")
    pg.click("#panel-left .pc-strip"); pg.click("#panel-right .pc-float"); time.sleep(0.2)
    check("floating" in pg.get_attribute("#panel-right", "class"), "détacher le panneau droit")
    time.sleep(1.5); pg.screenshot(path=str(OUT / "9_panneau_flottant.png"))
    pg.click("#panel-right .pc-float")
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
    # ---- pilotage par commandes JSON (onglet Commande, window.SDC) — PIL-01 à PIL-04
    import json
    pg.on("dialog", lambda d: d.accept())  # « Les accepter ? » : l'opérateur confirme les écritures
    run = lambda j, **o: pg.evaluate("([j, o]) => window.SDC.executer(j, o)", [j if isinstance(j, str) else json.dumps(j), o])
    check(pg.evaluate("() => typeof window.SDC.executer === 'function' && window.SDC.version === 1"), "window.SDC disponible (format 1)")
    r = run({"commandes": [{"cmd": "etat"}, {"cmd": "nomenclature"}]})
    check(r["ok"] and r["resultats"][0]["donnees"]["occurrences"] == 15 and r["resultats"][1]["donnees"]["total"] == 9, "commandes de lecture : état et nomenclature (9 repères)")
    nvis = lambda: S("Object.values(S.items).filter(i => i.visible).length")
    ncol = S("S.parts.filter(p => /collect/i.test(p.name)).length")
    r = run({"commandes": [{"cmd": "isoler", "cible": {"nom": "collecteur"}}]})
    check(r["ok"] and nvis() == ncol and ncol >= 1, f"isoler par nom : {nvis()} pièce(s) visible(s)")
    run({"cmd": "annuler"}); check(nvis() == 15, "annuler l'isolation par commande")
    r = run({"commandes": [{"cmd": "masquer", "cible": "tout"}, {"cmd": "tout_afficher"}, {"cmd": "opacite", "cible": {"nom": "collecteur"}, "opacite_pct": 30}]})
    check(r["ok"] and S("S.items['O006'].opacity") == 0.3, "opacité 30 % sur le collecteur")
    run({"cmd": "tout_afficher"})
    r = run({"cmd": "coupe", "plan": "XZ", "position_mm": 0})
    check(r["ok"] and S("S.cuts.y.on") is True and S("S.cuts.y.pos") == 0, "coupe XZ à 0 mm")
    r = run({"cmd": "coupe", "plan": "XZ", "position_mm": 99999})
    check(not r["ok"] and "encombrement" in r["resultats"][0]["erreur"], "coupe hors encombrement refusée")
    run({"cmd": "coupes_retirer"}); check(S("S.cuts.y.on") is False, "coupes retirées")
    r = run({"cmd": "eclater", "pct": 80, "direction": "z"})
    check(r["ok"] and S("S.ex.amount") == 80, "éclaté 80 % par commande")
    run({"cmd": "eclater", "pct": 0})
    check(S("Math.max(...[...S.objs.values()].map(o => o.grp.position.length()))") == 0, "éclaté 0 % par commande : retour exact")
    rep = pg.evaluate("() => { const S = window.__SDC__.S; const hit = [...S.cyl].find(([id, c]) => [...c.holes, ...c.bosses].some(h => Math.abs(h.diameter - 30) < 0.11)); return S.rowOf.get(hit[0]).repere; }")
    r = run({"commandes": [{"cmd": "groupe_mobile", "type": "rotation", "cible": {"nom": "collecteur"}, "axe_cylindre": {"repere": rep, "diametre_mm": 30}, "angle_deg": 90}, {"cmd": "ouverture", "pct": 100}]})
    check(r["ok"], "groupe mobile en rotation sur l'axe du cylindre Ø30 : " + (r["resultats"][0].get("erreur") or "ok"))
    size = pg.evaluate("() => { const b = window.__SDC__.partBox('O006'); return [b[3]-b[0], b[4]-b[1]]; }")
    check(abs(size[0] - 60) < 1 and abs(size[1] - 220) < 1, f"collecteur tourné de 90° par commande ({size[0]:.1f} × {size[1]:.1f})")
    pg.screenshot(path=str(OUT / "10_commande_rotation.png"))
    run({"cmd": "ouverture", "pct": 0})
    check(S("Math.max(...[...S.objs.values()].map(o => o.grp.position.length() + Math.abs(1 - Math.abs(o.grp.quaternion.w))))") == 0, "ouverture 0 % par commande : retour exact (position et orientation)")
    run({"cmd": "groupes_mobiles_supprimer"})
    r = run({"commandes": [{"cmd": "circuits", "seuls": True, "reseau": "R1", "cadrer": True}, {"cmd": "lister_reseaux"}, {"cmd": "fiche_percages", "reseau": "R1"}]})
    check(r["ok"] and S("S.skelOnly") is True and S("S.selNet") == "R1" and r["resultats"][2]["donnees"]["total"] >= 1, "circuits seuls + fiche des perçages du réseau R1")
    pg.screenshot(path=str(OUT / "11_commande_circuits.png"))
    run({"cmd": "circuits", "seuls": False, "reseau": "aucun"})
    n0 = S("S.comments.length")
    lot = {"commandes": [{"cmd": "commentaire_ajouter", "cible": {"nom": "collecteur"}, "texte": "Vérifier le serrage au montage", "type": "montage"}]}
    r = run(lot)
    check(not r["ok"] and S("S.comments.length") == n0, "écriture refusée sans confirmation (API programmatique)")
    r = run(lot, confirmer="operateur")
    check(r["ok"] and S("S.comments.length") == n0 + 1, "écriture acceptée après confirmation de l'opérateur")
    run({"cmd": "repere_valider", "repere": 1}, confirmer="operateur")
    check(S("S.rowNotes[1].statut") == "validé", "validation d'un repère après confirmation")
    run({"cmd": "masquer", "cible": {"nom": "plaque"}}); check(nvis() < 15, "masquer par nom")
    r = run({"cmd": "retour_avant_commande"})
    check(r["ok"] and nvis() == 15, "retour à l'affichage d'avant la commande")
    r = run({"commandes": [{"cmd": "verifier_collisions"}]})
    check(not r["ok"] and "hors périmètre" in r["erreurs"][0]["erreur"], "collisions : refusé (hors périmètre)")
    r = run({"commandes": [{"cmd": "isoler", "cible": [1]}, {"cmd": "isolr"}]})
    check(not r["ok"] and r["executees"] == 0 and nvis() == 15, "lot invalide : rien n'est exécuté")
    ctxt = pg.evaluate("() => window.SDC.contexte()")
    check("N'invente jamais" in ctxt and "## Nomenclature" in ctxt and "VIS_CHC" in ctxt, "contexte pour l'IA : règles + nomenclature réelle")
    # même chose par l'interface : onglet Commande, coller, exécuter
    pg.click("#rail button[data-mode=commande]")
    pg.fill("#cmd-input", '```json\n{"sdc":1,"commandes":[{"cmd":"isoler","cible":{"nom":"collecteur"}},{"cmd":"vue","nom":"iso"}]}\n```')
    pg.click("#cmd-run"); time.sleep(0.5)
    check(pg.locator("#cmd-log .cmd-line.ok").count() >= 2 and nvis() == ncol, "onglet Commande : JSON collé (bloc ```json) exécuté")
    pg.screenshot(path=str(OUT / "12_onglet_commande.png"))
    pg.click("#cmd-back"); time.sleep(0.3)
    check(nvis() == 15, "bouton « Avant la commande »")
    pg.fill("#cmd-input", '{"commandes":[{"cmd":"isoler","cible":[99]}]}'); pg.click("#cmd-run"); time.sleep(0.4)
    check(pg.locator("#cmd-log .cmd-line.ko").count() >= 1, "onglet Commande : erreur affichée en rouge (repère inexistant)")
    pg.click("#rail button[data-mode=explorer]")
    check(not errors, "aucune erreur JavaScript" + (f" : {errors[:3]}" if errors else ""))
    b.close()
sys.exit(1 if failures else 0)
