#!/usr/bin/env python3
"""Convertit un plan DXF (export de l'application, ou tout DXF 2D) en DWG AutoCAD R2000 (AC1015).

Usage : python tools/dxf_vers_dwg.py plan.dxf [sortie.dwg] [--version r2000|r2004|r2010] [--dwgwrite CHEMIN]
Dépendances : pip install ezdxf, et le programme libre LibreDWG (`dwgwrite`, `dwgread`) — voir docs/standalone.md.
Le programme est cherché dans : --dwgwrite, variable SDC_DWGWRITE, dossier de la variable SDC_LIBREDWG,
tools/bin/, puis le PATH.

- Le DXF est d'abord relu et réécrit PROPREMENT en R2000 par ezdxf (un DXF R12 de l'application passe ainsi en R2000),
  puis converti par `dwgwrite`. Calques, couleurs, types de trait, textes (Ø, °), polylignes, cercles, arcs, SOLID sont conservés.
- CONTRÔLE automatique : le DWG produit est relu par `dwgread` et comparé au DXF (nombre d'entités par type, noms de calques,
  textes). Un écart est affiché et le code de sortie est 2. Ce contrôle ne remplace pas l'ouverture dans la CAO de l'atelier.
- Le fichier DXF source n'est jamais modifié. DWG = produit par LibreDWG (écriture « expérimentale » selon ses auteurs) :
  à OUVRIR et VÉRIFIER dans la CAO avant tout usage, jamais validé seul pour la fabrication.
"""
import argparse, collections, contextlib, json, os, shutil, subprocess, sys, tempfile
import ezdxf

TYPES_COMPTES = ('LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT', 'SOLID', 'POINT', 'ELLIPSE', 'SPLINE')
VERSIONS = {'r2000': 'R2000', 'r2004': 'R2004', 'r2010': 'R2010'}


def trouver_outil(nom, explicite=None):
    """Chemin du programme LibreDWG `nom` ('dwgwrite' / 'dwgread') ou None."""
    exe = nom + ('.exe' if os.name == 'nt' else '')
    candidats = []
    if explicite:
        candidats.append(explicite if os.path.basename(explicite).lower().startswith(nom) else os.path.join(explicite, exe))
    if os.environ.get('SDC_' + nom.upper()):
        candidats.append(os.environ['SDC_' + nom.upper()])
    if os.environ.get('SDC_LIBREDWG'):
        candidats += [os.path.join(os.environ['SDC_LIBREDWG'], exe), os.path.join(os.environ['SDC_LIBREDWG'], 'bin', exe)]
    candidats.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bin', exe))
    for c in candidats:
        if c and os.path.isfile(c):
            return c
    return shutil.which(nom)


def message_outil_absent():
    return ("Programme LibreDWG introuvable (dwgwrite). Installer LibreDWG puis indiquer son dossier avec la variable SDC_LIBREDWG, "
            "ou --dwgwrite CHEMIN, ou le copier dans tools/bin/. Voir docs/standalone.md, section « Convertisseur DWG ».")


TOL = 0.001   # mm : écart toléré entre le DXF et le DWG relu


def q(p):
    """Point (x, y) en flottants arrondis à 0,1 µm (comparaison DXF ↔ DWG relu, voir points_differents)."""
    return (round(float(p[0]), 4), round(float(p[1]), 4))


def points_differents(pa, pb, tol=TOL):
    """Nombre de points (ou de grandeurs seules : rayon, hauteur) de `pa` sans équivalent à `tol` près (écart maximal sur
    chaque coordonnée) dans `pb` ; chaque point de `pb` n'est utilisé qu'une fois. Évite les faux écarts d'arrondi."""
    cle = lambda p: tuple(int(round(v / tol)) for v in p)
    grille = collections.defaultdict(list)
    for p in pb:
        grille[cle(p)].append(p)
    manquants = 0
    for p in pa:
        k = cle(p)
        voisins = [(k[0] + d,) for d in (0, -1, 1)] if len(k) == 1 else [(k[0] + dx, k[1] + dy) for dx in (0, -1, 1) for dy in (0, -1, 1)]
        trouve = False
        for v in voisins:
            for i, c in enumerate(grille.get(v, ())):
                if len(c) == len(p) and all(abs(x - y) <= tol + 1e-9 for x, y in zip(p, c)):
                    del grille[v][i]; trouve = True
                    break
            if trouve:
                break
        if not trouve:
            manquants += 1
    return manquants


def empreinte_dxf(chemin):
    """Résumé comparable : entités par type (espace objet + définitions de blocs), calques utilisés, textes."""
    doc = ezdxf.readfile(chemin)
    ents = list(doc.modelspace())
    for blk in doc.blocks:
        if not blk.name.startswith('*'):          # *Model_Space / *Paper_Space / *D… : espaces, pas des blocs
            ents += list(blk)
    types = collections.Counter(e.dxftype() for e in ents if e.dxftype() in TYPES_COMPTES)
    calques = sorted({e.dxf.layer for e in ents})
    textes = sorted(e.dxf.text.strip() for e in ents if e.dxftype() == 'TEXT' and e.dxf.text.strip())
    pts, couleurs = [], collections.Counter()
    for e in ents:
        t = e.dxftype()
        if t not in TYPES_COMPTES:
            continue
        couleurs[(e.dxf.layer, e.dxf.get('color', 256), str(e.dxf.get('linetype', 'BYLAYER')).lower())] += 1
        if t == 'LINE':
            pts += [q(e.dxf.start), q(e.dxf.end)]
        elif t == 'LWPOLYLINE':
            pts += [q(p) for p in e.get_points('xy')]
        elif t == 'POLYLINE':
            pts += [q(v.dxf.location) for v in e.vertices]
        elif t in ('CIRCLE', 'ARC'):
            pts += [q(e.dxf.center), (round(e.dxf.radius, 4),)]
        elif t == 'TEXT':
            pts += [q(e.dxf.insert), (round(e.dxf.height, 4),)]
        elif t == 'SOLID':
            pts += [q(e.dxf.vtx0), q(e.dxf.vtx1), q(e.dxf.vtx2)]
    styles = {l.dxf.name: (l.dxf.get('color', 7), str(l.dxf.get('linetype', 'Continuous')).lower()) for l in doc.layers if l.dxf.name in calques}
    return {'types': dict(types), 'calques': calques, 'textes': textes, 'pts': pts, 'couleurs': dict(couleurs), 'styles': styles}


def empreinte_dwg(chemin, dwgread):
    """Même résumé, relu dans le DWG par `dwgread` (JSON) : toutes les entités, calque retrouvé par sa référence."""
    r = subprocess.run([dwgread, '-O', 'json', chemin], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if not r.stdout:
        raise RuntimeError('dwgread a échoué : ' + (r.stderr or '')[-300:])
    objs = json.loads(r.stdout)['OBJECTS']
    nom_calque = {o['handle'][-1]: o.get('name') for o in objs if o.get('object') == 'LAYER' and 'handle' in o}
    nom_ltype = {o['handle'][-1]: str(o.get('name')).lower() for o in objs if o.get('object') == 'LTYPE' and 'handle' in o}
    styles = {o.get('name'): (o['color'].get('index', 7) if isinstance(o.get('color'), dict) else o.get('color', 7), nom_ltype.get(o['ltype'][-1], '?') if o.get('ltype') else '?') for o in objs if o.get('object') == 'LAYER'}
    types, calques, textes, pts, couleurs = collections.Counter(), set(), [], [], collections.Counter()
    for o in objs:
        t = o.get('entity')
        if t not in TYPES_COMPTES:
            continue
        types[t] += 1
        ref = o.get('layer')
        nom = nom_calque.get(ref[-1]) if isinstance(ref, list) and ref else None
        if nom:
            calques.add(nom)
        fl = o.get('ltype_flags', 0)
        lt = {0: 'bylayer', 1: 'byblock', 2: 'continuous'}.get(fl) or (nom_ltype.get(o['ltype'][-1], '?') if o.get('ltype') else '?')
        coul = o.get('color', 256)
        coul = coul.get('index', 256) if isinstance(coul, dict) else coul      # R2004+ : {index, rgb, …}
        couleurs[(nom, coul, lt)] += 1
        if t == 'TEXT':
            if str(o.get('text_value', '')).strip():
                textes.append(str(o['text_value']).strip())
            pts += [q(o['ins_pt']), (round(o['height'], 4),)]
        elif t == 'LINE':
            pts += [q(o['start']), q(o['end'])]
        elif t == 'LWPOLYLINE':
            pts += [q(p) for p in o.get('points', [])]
        elif t in ('CIRCLE', 'ARC'):
            pts += [q(o['center']), (round(o['radius'], 4),)]
        elif t == 'SOLID':
            pts += [q(o['corner1']), q(o['corner2']), q(o['corner3'])]
    return {'types': dict(types), 'calques': sorted(calques), 'textes': sorted(textes), 'pts': pts, 'couleurs': dict(couleurs), 'styles': {k: v for k, v in styles.items() if k in calques}}


def polylignes_legeres(doc):
    """POLYLINE 2D (export R12 de l'application) → LWPOLYLINE : LibreDWG perd les POLYLINE 2D à l'écriture du DWG.
    Points, fermeture, bulges, calque, couleur et type de trait conservés. Retourne le nombre converti."""
    n = 0
    if doc.dxfversion < 'AC1015':                  # LWPOLYLINE exige R2000 au moins
        doc.dxfversion = 'AC1015'
    for sp in [doc.modelspace()] + [b for b in doc.blocks if not b.name.startswith('*')]:
        for e in list(sp.query('POLYLINE')):
            if not e.is_2d_polyline:
                continue
            pts = [(v.dxf.location.x, v.dxf.location.y, v.dxf.get('bulge', 0.0)) for v in e.vertices]
            attr = {k: e.dxf.get(k) for k in ('layer', 'color', 'linetype', 'true_color', 'ltscale') if e.dxf.hasattr(k)}
            sp.add_lwpolyline(pts, format='xyb', close=e.is_closed, dxfattribs=attr)
            sp.delete_entity(e); n += 1
    return n


def comparer(a, b):
    """Liste des écarts entre l'empreinte du DXF (a) et celle du DWG relu (b)."""
    ecarts = []
    ta, tb = a['types'], b['types']
    # R12 : POLYLINE (2D) devient LWPOLYLINE en R2000+ chez certains écrivains — on compare les deux ensemble.
    fusion = lambda d: {**{k: v for k, v in d.items() if k not in ('POLYLINE', 'LWPOLYLINE')}, 'POLY': d.get('POLYLINE', 0) + d.get('LWPOLYLINE', 0)}
    fa, fb = fusion(ta), fusion(tb)
    for k in sorted(set(fa) | set(fb)):
        if fa.get(k, 0) != fb.get(k, 0):
            ecarts.append(f'entités {k} : DXF {fa.get(k, 0)}, DWG relu {fb.get(k, 0)}')
    manquants = [c for c in a['calques'] if c not in b['calques']]
    if manquants:
        ecarts.append('calques absents du DWG : ' + ', '.join(manquants))
    if a['textes'] != b['textes']:
        ecarts.append(f"textes différents : DXF {a['textes']} / DWG {b['textes']}")
    if len(a['pts']) != len(b['pts']) or points_differents(a['pts'], b['pts']):
        ecarts.append(f"géométrie différente : {points_differents(a['pts'], b['pts'])} points du DXF sans équivalent dans le DWG relu "
                      f"({len(a['pts'])} au DXF, {len(b['pts'])} au DWG ; tolérance {TOL} mm)")
    for nom, st in a['styles'].items():
        if b['styles'].get(nom) != st:
            ecarts.append(f"calque {nom} : couleur/type de trait {st} au DXF, {b['styles'].get(nom)} au DWG relu")
    ca, cb = dict(a['couleurs']), dict(b['couleurs'])
    if ca != cb:
        ecarts.append('couleur ou type de trait par entité différents (calque, couleur ACI, type de trait)')
    return ecarts


@contextlib.contextmanager
def dossier_temp(prefix):
    """Dossier temporaire dont le chemin est en ASCII : dwgwrite / dwgread sous Windows n'ouvrent pas les chemins accentués
    (ex. C:\\Users\\Chrïstophe\\AppData\\Local\\Temp) ; repli sur <lecteur système>\\Temp."""
    base = tempfile.gettempdir()
    if not base.isascii():
        base = os.path.join(os.environ.get('SystemDrive', 'C:') + os.sep, 'Temp')
        os.makedirs(base, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=prefix, dir=base) as t:
        yield t


def convertir(dxf, sortie=None, version='r2000', dwgwrite=None, dwgread=None, controle=True):
    """DXF → DWG. Retourne (chemin_dwg, compte_rendu, ecarts). Lève RuntimeError si la conversion échoue."""
    ecrit = trouver_outil('dwgwrite', dwgwrite)
    if not ecrit:
        raise RuntimeError(message_outil_absent())
    sortie = sortie or os.path.splitext(dxf)[0] + '.dwg'
    ver = VERSIONS.get(version.lower())
    if not ver:
        raise RuntimeError('Version inconnue : ' + version + ' (r2000, r2004 ou r2010)')
    ecarts = []
    with dossier_temp('sdc-dwg-') as tmp:
        doc = ezdxf.readfile(dxf)
        doc.dxfversion = 'AC1015'              # DXF intermédiaire R2000 : dwgwrite lit mal les chaînes d'un DXF >= R2007
        polylignes_legeres(doc)
        inter = os.path.join(tmp, 'entree.dxf')
        doc.saveas(inter)
        sortie_tmp = os.path.join(tmp, 'sortie.dwg')
        cmd = [ecrit, '-y', '--as', version.lower(), '-o', sortie_tmp, inter]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if not os.path.isfile(sortie_tmp) or os.path.getsize(sortie_tmp) < 1000:
            raise RuntimeError('dwgwrite a échoué : ' + ((r.stderr or '') + (r.stdout or ''))[-400:])
        avert = [l for l in ((r.stderr or '') + (r.stdout or '')).splitlines() if l.startswith('ERROR')]
        if controle:                           # relu depuis le chemin temporaire (ASCII), avant la copie finale
            lecteur = trouver_outil('dwgread', dwgread or os.path.dirname(ecrit))
            ecarts = comparer(empreinte_dxf(dxf), empreinte_dwg(sortie_tmp, lecteur)) if lecteur else ['contrôle impossible : dwgread introuvable']
        shutil.copyfile(sortie_tmp, sortie)
    with open(sortie, 'rb') as f:
        magique = f.read(6).decode('ascii', 'replace')
    cr = f'{sortie} : DWG {magique} ({os.path.getsize(sortie)} octets)'
    if avert:
        cr += f' — {len(avert)} avertissement(s) LibreDWG'
    return sortie, cr, ecarts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dxf'); ap.add_argument('dwg', nargs='?')
    ap.add_argument('--version', default='r2000', choices=sorted(VERSIONS))
    ap.add_argument('--dwgwrite', help='chemin de dwgwrite (ou du dossier de LibreDWG)')
    ap.add_argument('--sans-controle', action='store_true', help='ne pas relire le DWG pour le comparer au DXF')
    a = ap.parse_args()
    try:
        sortie, cr, ecarts = convertir(a.dxf, a.dwg, a.version, a.dwgwrite, controle=not a.sans_controle)
    except RuntimeError as e:
        print('ÉCHEC :', e, file=sys.stderr); return 1
    print(cr)
    if ecarts:
        print('ÉCART au contrôle (le DWG ne doit pas être utilisé tel quel) :', *ecarts, sep='\n  - ')
        return 2
    if not a.sans_controle:
        print('Contrôle : DWG relu = DXF (types d’entités, calques, textes, géométrie à 0,001 mm, couleurs, types de trait). À ouvrir dans la CAO avant usage.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
