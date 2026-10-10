"""Génère un assemblage STEP synthétique « BCR + plaque refroidie » pour les essais.

Aucune donnée client. Nécessite OCP (pip install cadquery-ocp-novtk) ou le Python FreeCAD
avec OCP disponible. Usage : python tools/make_test_step.py tests/fixtures/bcr_synthetique.step
"""
import sys
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Trsf, gp_Vec
from OCP.TopLoc import TopLoc_Location
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDataStd import TDataStd_Name
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.Interface import Interface_Static

def box(x0, y0, z0, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0, z0), dx, dy, dz).Shape()

def cyl(p, d, r, h):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*p), gp_Dir(*d)), r, h).Shape()

def cut(shape, *tools):
    for t in tools:
        op = BRepAlgoAPI_Cut(shape, t); op.Build(); shape = op.Shape()
    return shape

def fuse(a, b):
    op = BRepAlgoAPI_Fuse(a, b); op.Build(); return op.Shape()

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
parts = []  # (nom, forme, couleur, [translations])

# Plaque de fixation : 300 x 250 x 30, z 0..30, 4 lamages de vis.
pf = box(-150, -125, 0, 300, 250, 30)
for sx in (-1, 1):
    for sy in (-1, 1):
        pf = cut(pf, cyl((sx*125, sy*100, -1), Z, 5.5, 32), cyl((sx*125, sy*100, 19), Z, 9, 12))
parts.append(("PLAQUE_FIXATION_INFERIEURE", pf, (0.55, 0.62, 0.70), [(0, 0, 0)]))

# Plaque porte-empreinte refroidie : z 30..70. Boucle de refroidissement Ø8.
pe = box(-150, -125, 30, 300, 250, 40)
zc = 50
pe = cut(pe,
         cyl((-160, -60, zc), X, 4, 290),      # canal X percé depuis -X, débouchant côté -X
         cyl((-160, 60, zc), X, 4, 290),
         cyl((100, -135, zc), Y, 4, 200),      # traverse Y percée depuis -Y
         cyl((-120, -60, 29), Z, 4, 21.5 + 0), # entrée verticale depuis le dessous
         cyl((-120, 60, 29), Z, 4, 21.5))      # sortie verticale
for sx in (-1, 1):
    for sy in (-1, 1):
        pe = cut(pe, cyl((sx*125, sy*100, 29), Z, 5, 42))
pe = cut(pe, cyl((0, 0, 29), Z, 12, 42))       # passage busette centrale
parts.append(("PLAQUE_PORTE_EMPREINTE", pe, (0.62, 0.70, 0.62), [(0, 0, 0)]))

# Obturateurs de canaux (bouchons) aux entrées percées.
obt = cyl((0, 0, 0), X, 4, 12)
parts.append(("OBTURATEUR_D8", obt, (0.85, 0.55, 0.15), [(-150, -60, zc), (-150, 60, zc)]))
obty = cyl((0, 0, 0), Y, 4, 12)
parts.append(("OBTURATEUR_D8_Y", obty, (0.85, 0.55, 0.15), [(100, -125, zc)]))

# Collecteur (BCR) : barre 220 x 60 x 40 z 80..120, canal principal Ø10 + entrée + 2 sorties.
col = box(-110, -30, 80, 220, 60, 40)
col = cut(col,
          cyl((-115, 0, 100), X, 5, 230),       # canal principal traversant
          cyl((0, 0, 121), (0, 0, -1), 5, 21.5),  # entrée centrale depuis le dessus
          cyl((-70, 0, 79), Z, 5, 21.5),        # sortie busette gauche
          cyl((70, 0, 79), Z, 5, 21.5))         # sortie busette droite
parts.append(("COLLECTEUR_BCR", col, (0.80, 0.35, 0.30), [(0, 0, 0)]))
obc = cyl((0, 0, 0), X, 5, 15)
parts.append(("OBTURATEUR_COLLECTEUR_D10", obc, (0.85, 0.55, 0.15), [(-110, 0, 100), (95, 0, 100)]))

# Busettes : tube Ø20 / alésage Ø6, longueur 50, sous le collecteur.
bus = cut(cyl((0, 0, 0), (0, 0, -1), 10, 50), cyl((0, 0, 1), (0, 0, -1), 3, 52))
parts.append(("BUSETTE_D20", bus, (0.75, 0.75, 0.45), [(-70, 0, 80), (70, 0, 80)]))

# Buse d'injection centrale au-dessus.
buse = cut(cyl((0, 0, 120), Z, 15, 30), cyl((0, 0, 119), Z, 2.5, 32))
parts.append(("BUSE_INJECTION", buse, (0.70, 0.70, 0.75), [(0, 0, 0)]))

# Vis CHC M10 x 40 (forme simplifiée), 4 instances identiques.
vis = fuse(cyl((0, 0, 0), Z, 5, 40), cyl((0, 0, 40), Z, 8, 10))
parts.append(("VIS_CHC_M10x40", vis, (0.20, 0.20, 0.22), [(sx*125, sy*100, 70 - 40 - 10 + 10) for sx in (-1, 1) for sy in (-1, 1)]))

doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
from OCP.TopoDS import TopoDS_Compound
from OCP.BRep import BRep_Builder
asm = st.NewShape()
TDataStd_Name.Set_s(asm, TCollection_ExtendedString("BCR_SYNTHETIQUE_ESSAI"))
for name, shape, color, places in parts:
    lab = st.AddShape(shape, False)
    TDataStd_Name.Set_s(lab, TCollection_ExtendedString(name))
    ct.SetColor(lab, Quantity_Color(*color, Quantity_TOC_RGB), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    for t in places:
        tr = gp_Trsf(); tr.SetTranslation(gp_Vec(*t))
        st.AddComponent(asm, lab, TopLoc_Location(tr))
st.UpdateAssemblies()
Interface_Static.SetCVal_s("write.step.schema", "AP214")
w = STEPCAFControl_Writer(); w.SetColorMode(True); w.SetNameMode(True)
w.Transfer(doc, STEPControl_AsIs)
out = sys.argv[1] if len(sys.argv) > 1 else "bcr_synthetique.step"
assert int(w.Write(out)) == 1, "Écriture STEP échouée"
print("écrit", out)
