"""Convertisseurs DWG (tools/dxf_vers_dwg.py, tools/pdf_vers_dwg.py) — exigence DXF-10.

Les essais de conversion exigent LibreDWG (`dwgwrite` + `dwgread`, variable SDC_LIBREDWG ou PATH), ezdxf et pymupdf ;
sans eux ils sont SAUTÉS (signalés « skipped », jamais comptés comme réussis).
"""
import copy
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

RACINE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / 'tools'))
try:
    import ezdxf
    import dxf_vers_dwg
except ImportError:                                   # ezdxf absent
    ezdxf = dxf_vers_dwg = None
try:
    import pymupdf
except ImportError:
    pymupdf = None

OUTIL = bool(dxf_vers_dwg and dxf_vers_dwg.trouver_outil('dwgwrite') and dxf_vers_dwg.trouver_outil('dwgread'))
FIXTURE = RACINE / 'tests' / 'fixtures' / 'plan_app_r12.dxf'    # export de l'application (R12) : calques, tirets, Ø, flèche pleine


@unittest.skipUnless(dxf_vers_dwg, 'ezdxf absent')
class ControleTests(unittest.TestCase):
    def empreinte(self):
        return dxf_vers_dwg.empreinte_dxf(str(FIXTURE))

    def test_le_controle_detecte_chaque_sorte_d_ecart(self):
        a = self.empreinte()
        self.assertEqual(dxf_vers_dwg.comparer(a, a), [])
        c = copy.deepcopy(a); c['types']['CIRCLE'] = 0
        self.assertTrue(any('CIRCLE' in e for e in dxf_vers_dwg.comparer(a, c)))
        c = dict(a, calques=[x for x in a['calques'] if x != 'CACHES'])
        self.assertTrue(any('CACHES' in e for e in dxf_vers_dwg.comparer(a, c)))
        c = dict(a, textes=a['textes'][:-1])
        self.assertTrue(any('textes' in e for e in dxf_vers_dwg.comparer(a, c)))
        c = dict(a, pts=[(p[0] + 0.01, *p[1:]) for p in a['pts']])
        self.assertTrue(any('géométrie' in e for e in dxf_vers_dwg.comparer(a, c)))
        coul = dict(a['couleurs']); k = next(iter(coul)); coul[(k[0], 3, k[2])] = coul.pop(k)
        self.assertTrue(any('couleur' in e for e in dxf_vers_dwg.comparer(a, dict(a, couleurs=coul))))
        st = dict(a['styles']); st['CONTOURS'] = (1, 'dashed')
        self.assertTrue(any('CONTOURS' in e for e in dxf_vers_dwg.comparer(a, dict(a, styles=st))))

    def test_points_differents_tolere_l_arrondi_au_micron_mais_pas_un_vrai_ecart(self):
        pd = dxf_vers_dwg.points_differents
        self.assertEqual(pd([(751.795, 52.3875)], [(751.795, 52.3880)]), 0)         # cas réel : limite d'arrondi au micron
        self.assertEqual(pd([(1, 2), (1.0005, 2)], [(1, 2.0005), (1, 2)]), 0)       # ordre indifférent
        self.assertEqual(pd([(1, 2)], [(1.01, 2)]), 1)                              # 10 µm : écart réel
        self.assertEqual(pd([(1, 2), (1, 2)], [(1, 2)]), 1)                         # un point du DWG n'est utilisé qu'une fois
        self.assertEqual(pd([(5.0,)], [(5.0004,)]), 0); self.assertEqual(pd([(5.0,)], [(5.01,)]), 1)

    def test_polyligne_2d_r12_devient_lwpolyline_sans_perte(self):
        doc = ezdxf.readfile(str(FIXTURE))
        avant = [[tuple(v.dxf.location)[:2] for v in e.vertices] for e in doc.modelspace().query('POLYLINE')]
        self.assertEqual(len(avant), 2)
        self.assertEqual(dxf_vers_dwg.polylignes_legeres(doc), 2)
        self.assertEqual(len(doc.modelspace().query('POLYLINE')), 0)
        apres = [[p[:2] for p in e.get_points('xy')] for e in doc.modelspace().query('LWPOLYLINE')]
        self.assertEqual(sorted(map(list, avant)), sorted(apres))
        self.assertTrue(all(e.dxf.layer in ('CONTOURS', 'CACHES', 'CARTOUCHE') for e in doc.modelspace().query('LWPOLYLINE')))

    def test_outil_absent_message_en_francais(self):
        with mock.patch.dict(os.environ, {'SDC_LIBREDWG': '/inexistant', 'SDC_DWGWRITE': '/inexistant/dwgwrite', 'PATH': ''}):
            with mock.patch.object(dxf_vers_dwg, 'trouver_outil', return_value=None):
                with self.assertRaises(RuntimeError) as cm:
                    dxf_vers_dwg.convertir(str(FIXTURE), os.path.join(tempfile.gettempdir(), 'x.dwg'))
        self.assertIn('LibreDWG introuvable', str(cm.exception))


@unittest.skipUnless(OUTIL and ezdxf, 'LibreDWG (dwgwrite/dwgread) ou ezdxf absent')
class ConversionTests(unittest.TestCase):
    def test_dxf_de_l_application_vers_dwg_r2000(self):
        src = FIXTURE.read_bytes()
        with tempfile.TemporaryDirectory() as t:
            sortie = os.path.join(t, 'plan.dwg')
            dwg, cr, ecarts = dxf_vers_dwg.convertir(str(FIXTURE), sortie)
            self.assertEqual(ecarts, [], ecarts)
            self.assertEqual(pathlib.Path(dwg).read_bytes()[:6], b'AC1015')
            lecteur = dxf_vers_dwg.trouver_outil('dwgread')
            relu = dxf_vers_dwg.empreinte_dwg(dwg, lecteur)
            self.assertEqual(relu['types'].get('CIRCLE'), 1)
            self.assertEqual(relu['types'].get('LWPOLYLINE'), 2)           # POLYLINE R12 → LWPOLYLINE
            self.assertEqual(relu['types'].get('SOLID'), 1)                # pointe de flèche pleine
            self.assertIn('ANNOTATIONS', relu['calques'])
            self.assertIn('Ø 8 H7 à vérifier', relu['textes'])             # Ø, à, é conservés
            self.assertEqual(relu['styles']['CACHES'][1], 'continuous')
            self.assertTrue(any(k[2] == 'dashed' for k in relu['couleurs']))   # arêtes cachées en tirets
        self.assertEqual(FIXTURE.read_bytes(), src, 'le DXF source n’est pas modifié')

    def test_versions_de_sortie(self):
        for v, magique in (('r2000', b'AC1015'), ('r2004', b'AC1018'), ('r2010', b'AC1024')):
            with tempfile.TemporaryDirectory() as t:
                dwg, cr, ecarts = dxf_vers_dwg.convertir(str(FIXTURE), os.path.join(t, 'p.dwg'), version=v)
                self.assertEqual(pathlib.Path(dwg).read_bytes()[:6], magique, v)
                self.assertEqual(ecarts, [], (v, ecarts))

    def test_echec_propre_sur_fichier_invalide(self):
        with tempfile.TemporaryDirectory() as t:
            vide = os.path.join(t, 'vide.dxf'); pathlib.Path(vide).write_text('pas un dxf')
            with self.assertRaises(Exception):
                dxf_vers_dwg.convertir(vide, os.path.join(t, 'v.dwg'))
            self.assertFalse(os.path.exists(os.path.join(t, 'v.dwg')), 'aucun DWG à moitié écrit')


@unittest.skipUnless(OUTIL and ezdxf and pymupdf, 'LibreDWG, ezdxf ou pymupdf absent')
class PdfVersDwgTests(unittest.TestCase):
    def test_plan_pdf_vectoriel_vers_dwg(self):
        import pdf_vers_dwg
        with tempfile.TemporaryDirectory() as t:
            pdf = os.path.join(t, 'plan.pdf')
            d = pymupdf.open(); p = d.new_page(width=595, height=842); s = p.new_shape()
            s.draw_rect(pymupdf.Rect(100, 100, 300, 200)); s.finish(color=(0, 0, 0), width=1.5)
            s.draw_line((100, 300), (400, 300)); s.finish(color=(0, 0, 1), width=0.5)
            s.draw_line((100, 320), (400, 320)); s.finish(color=(0, 0, 0), width=0.5, dashes='[3 2] 0')
            s.draw_circle((250, 500), 40); s.finish(color=(1, 0, 0), width=0.5); s.commit()
            p.insert_text((120, 150), 'Ø12 H7 ° test', fontsize=10); d.save(pdf)
            avant = pathlib.Path(pdf).read_bytes()
            dwg, cr, ecarts = pdf_vers_dwg.convertir(pdf, os.path.join(t, 'plan.dwg'), garder_dxf=True)
            self.assertEqual(ecarts, [], ecarts)
            self.assertEqual(pathlib.Path(dwg).read_bytes()[:6], b'AC1015')
            self.assertTrue(os.path.isfile(os.path.join(t, 'plan.dxf')), '--garder-dxf')
            relu = dxf_vers_dwg.empreinte_dwg(dwg, dxf_vers_dwg.trouver_outil('dwgread'))
            self.assertEqual(relu['types'].get('LWPOLYLINE'), 4)
            self.assertEqual(relu['textes'], ['Ø12 H7 ° test'])
            self.assertEqual({'NOIR_EPAIS', 'COTES_BLEU', 'NOIR_FIN_TIRETS', 'AXES_ROUGE', 'TEXTE'} - set(relu['calques']), set())
            # couleurs de calque : bleu → ACI 5, rouge → ACI 1 (pas de couleur vraie en R2000, ACI le plus proche)
            self.assertEqual(relu['styles']['COTES_BLEU'][0], 5)
            self.assertEqual(relu['styles']['AXES_ROUGE'][0], 1)
            self.assertEqual(relu['styles']['NOIR_FIN_TIRETS'][1], 'dashed')
            # 1 pt PDF = 25,4/72 mm : le rectangle 200 × 100 pt mesure 70,556 × 35,278 mm
            xs = sorted({round(p_[0], 1) for p_ in relu['pts'] if len(p_) == 2})
            self.assertIn(round(100 * 25.4 / 72, 1), xs); self.assertIn(round(300 * 25.4 / 72, 1), xs)
            self.assertEqual(pathlib.Path(pdf).read_bytes(), avant, 'le PDF source n’est pas modifié')

    def test_sortie_par_defaut_a_cote_du_pdf_et_dxf_existant_inchange(self):
        """pdf_vers_dxf garde son comportement par défaut (R2010, couleur vraie) après l'ajout de convertir()."""
        import pdf_vers_dxf
        with tempfile.TemporaryDirectory() as t:
            pdf = os.path.join(t, 'a.pdf'); d = pymupdf.open(); p = d.new_page(width=200, height=200)
            s = p.new_shape(); s.draw_line((10, 10), (100, 10)); s.finish(color=(1, 0, 0), width=0.5); s.commit(); d.save(pdf)
            pdf_vers_dxf.convertir(pdf, os.path.join(t, 'a.dxf'))
            doc = ezdxf.readfile(os.path.join(t, 'a.dxf'))
            self.assertEqual(doc.dxfversion, 'AC1024')
            self.assertEqual(doc.layers.get('AXES_ROUGE').dxf.get('true_color'), 0xFF0000)


if __name__ == '__main__':
    unittest.main()
