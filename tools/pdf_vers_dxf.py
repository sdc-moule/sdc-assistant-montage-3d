#!/usr/bin/env python3
"""Convertit la première page (ou la page demandée) d'un plan PDF VECTORIEL en DXF 2D.

Usage : python tools/pdf_vers_dxf.py plan.pdf [sortie.dxf] [--page N] [--echelle K]
Dépendances : pip install pymupdf ezdxf

- Tracés (traits, courbes déjà segmentées par le PDF) → LWPOLYLINE, un calque par couleur et type de trait.
- Textes → TEXT (position, hauteur et rotation conservées).
- Unité du DXF : mm PAPIER (1 pt = 25,4/72 mm). Les vues d'un plan ont chacune leur échelle (4:1, 40:1…) :
  les cotes mesurées sur le DXF sont des cotes papier, à diviser par l'échelle de la vue. `--echelle K` multiplie tout.
- Images (vue 3D ombrée, logo) et remplissages pleins (flèches) ne sont pas repris : seuls les traits le sont.
- Un PDF scanné (image seule) ne contient aucun tracé : la conversion est alors impossible sans vectorisation.
Fichier source en lecture seule.
"""
import argparse, math, sys
import pymupdf, ezdxf

PT = 25.4 / 72.0

def classe(col, largeur, pointille):
    """Nom de calque lisible depuis la couleur et l'épaisseur du trait."""
    r, g, b = (round(c) if c is not None else 0 for c in (col or (0, 0, 0)))
    if col and abs(col[0] - col[1]) < .02 and abs(col[1] - col[2]) < .02 and col[0] > .3:
        base = 'GRIS'
    elif (r, g, b) == (0, 0, 1) or (col and col[2] > .8 and col[0] < .2):
        base = 'COTES_BLEU'
    elif (r, g, b) == (1, 0, 0):
        base = 'AXES_ROUGE'
    elif (r, g, b) == (0, 0, 0):
        base = 'NOIR_EPAIS' if (largeur or 0) >= 1.2 else 'NOIR_FIN'
    else:
        base = 'COULEUR_%02X%02X%02X' % tuple(int(round(c * 255)) for c in (col or (0, 0, 0)))
    return base + ('_TIRETS' if pointille else '')

def aci(col):
    return ezdxf.colors.rgb2int(tuple(int(round(c * 255)) for c in (col or (0, 0, 0))))

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('dxf', nargs='?')
    ap.add_argument('--page', type=int, default=1); ap.add_argument('--echelle', type=float, default=1.0)
    a = ap.parse_args()
    sortie = a.dxf or a.pdf.rsplit('.', 1)[0] + '.dxf'
    page = pymupdf.open(a.pdf)[a.page - 1]
    H, k = page.rect.height, PT * a.echelle
    W = page.rect.width * k
    X = lambda p: (p.x * k, (H - p.y) * k)
    H *= 1  # hauteur en points ; les coordonnées DXF sont en mm (× k)

    doc = ezdxf.new('R2010', setup=True); doc.units = 4; msp = doc.modelspace()
    calques = {}
    def calque(nom, col, pointille):
        if nom not in calques:
            doc.layers.add(nom, true_color=aci(col), linetype='DASHED' if pointille else 'Continuous'); calques[nom] = 0
        calques[nom] += 1
        return nom

    n_poly = n_txt = n_fill = 0
    for p in page.get_drawings():
        if p.get('type') in ('f',) or (p.get('color') is None):  # remplissage seul : flèches, glyphes — ignoré
            n_fill += 1; continue
        pointille = bool(p.get('dashes') and p['dashes'] not in ('[] 0', '[ ] 0'))
        nom = calque(classe(p['color'], p.get('width'), pointille), p['color'], pointille)
        pts = []
        def vider():
            nonlocal pts, n_poly
            # Chemins de rognage démesurés (hors page) présents dans certains PDF : ignorés.
            if len(pts) >= 2 and all(-0.02 * W <= x <= 1.02 * W and -0.02 * H * k <= y <= 1.02 * H * k for x, y in pts):
                msp.add_lwpolyline(pts, dxfattribs={'layer': nom}); n_poly += 1
            pts = []
        for it in p['items']:
            if it[0] == 'l':
                A, B = X(it[1]), X(it[2])
                if pts and math.dist(pts[-1], A) < 1e-6: pts.append(B)
                else: vider(); pts = [A, B]
            elif it[0] == 'c':   # Bézier cubique → 12 segments
                P = [X(q) for q in it[1:5]]
                if not pts or math.dist(pts[-1], P[0]) > 1e-6: vider(); pts = [P[0]]
                for i in range(1, 13):
                    t = i / 12; u = 1 - t
                    pts.append((u**3*P[0][0] + 3*u*u*t*P[1][0] + 3*u*t*t*P[2][0] + t**3*P[3][0], u**3*P[0][1] + 3*u*u*t*P[1][1] + 3*u*t*t*P[2][1] + t**3*P[3][1]))
            elif it[0] == 're':
                r = it[1]; vider(); pts = [X(r.tl), X(r.tr), X(r.br), X(r.bl), X(r.tl)]; vider()
            elif it[0] == 'qu':
                q = it[1]; vider(); pts = [X(q.ul), X(q.ur), X(q.lr), X(q.ll), X(q.ul)]; vider()
        vider()

    doc.layers.add('TEXTE', color=7)
    for blk in page.get_text('dict')['blocks']:
        for ln in blk.get('lines', []):
            dx, dy = ln['dir']; rot = math.degrees(math.atan2(-dy, dx))
            for sp in ln['spans']:
                t = sp['text'].strip()
                if not t: continue
                o = X(pymupdf.Point(*sp['origin']))
                msp.add_text(t, height=sp['size'] * k * 0.72, rotation=rot, dxfattribs={'layer': 'TEXTE', 'insert': o}); n_txt += 1

    doc.saveas(sortie)
    print(f'{sortie} : {n_poly} polylignes, {n_txt} textes, {len(calques)} calques, {n_fill} remplissages/images ignorés — unité mm papier')

if __name__ == '__main__':
    sys.exit(main())
