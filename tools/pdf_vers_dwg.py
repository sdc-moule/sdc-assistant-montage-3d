#!/usr/bin/env python3
"""Convertit la première page (ou la page demandée) d'un plan PDF VECTORIEL en DWG AutoCAD (R2000 par défaut).

Usage : python tools/pdf_vers_dwg.py plan.pdf [sortie.dwg] [--page N] [--echelle K] [--version r2000|r2004|r2010] [--dwgwrite CHEMIN] [--garder-dxf]
Dépendances : pip install pymupdf ezdxf, et LibreDWG (`dwgwrite`, `dwgread`) — voir docs/standalone.md.

Même lecture du PDF que tools/pdf_vers_dxf.py (polylignes par calque couleur/épaisseur/tirets, textes avec rotation,
mm PAPIER, images et remplissages non repris, PDF scanné non convertible), puis conversion DXF → DWG et contrôle du DWG
relu (voir tools/dxf_vers_dwg.py). `--garder-dxf` conserve le DXF intermédiaire à côté du DWG.
Le PDF source n'est jamais modifié. DWG à OUVRIR et VÉRIFIER dans la CAO ; cotes = cotes papier à diviser par l'échelle de la vue.
"""
import argparse, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_vers_dxf, dxf_vers_dwg


def convertir(pdf, sortie=None, page=1, echelle=1.0, version='r2000', dwgwrite=None, garder_dxf=False):
    """PDF → DWG. Retourne (chemin_dwg, compte_rendu, ecarts)."""
    sortie = sortie or os.path.splitext(pdf)[0] + '.dwg'
    with tempfile.TemporaryDirectory(prefix='sdc-pdf-dwg-') as tmp:
        dxf = os.path.join(tmp, 'plan.dxf')
        cr_pdf = pdf_vers_dxf.convertir(pdf, dxf, page, echelle, version='R2000', setup=False)
        dwg, cr_dwg, ecarts = dxf_vers_dwg.convertir(dxf, sortie, version, dwgwrite)
        if garder_dxf:
            import shutil
            shutil.copyfile(dxf, os.path.splitext(sortie)[0] + '.dxf')
    return dwg, cr_pdf.split(' : ', 1)[1] + '\n' + cr_dwg, ecarts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('dwg', nargs='?')
    ap.add_argument('--page', type=int, default=1); ap.add_argument('--echelle', type=float, default=1.0)
    ap.add_argument('--version', default='r2000', choices=sorted(dxf_vers_dwg.VERSIONS))
    ap.add_argument('--dwgwrite', help='chemin de dwgwrite (ou du dossier de LibreDWG)')
    ap.add_argument('--garder-dxf', action='store_true')
    a = ap.parse_args()
    try:
        dwg, cr, ecarts = convertir(a.pdf, a.dwg, a.page, a.echelle, a.version, a.dwgwrite, a.garder_dxf)
    except RuntimeError as e:
        print('ÉCHEC :', e, file=sys.stderr); return 1
    print(cr)
    if ecarts:
        print('ÉCART au contrôle (le DWG ne doit pas être utilisé tel quel) :', *ecarts, sep='\n  - ')
        return 2
    print('Contrôle : DWG relu = DXF (types d’entités, calques, textes, géométrie à 0,001 mm, couleurs, types de trait). À ouvrir dans la CAO avant usage.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
