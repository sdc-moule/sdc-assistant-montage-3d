"""Entrée du lanceur Windows, utilisant le Python intégré de FreeCAD."""
import os
from pathlib import Path
import sys

backend = str(Path(__file__).resolve().parent)
sys.path.insert(0, backend)
os.environ['PYTHONPATH'] = backend
os.environ['PYTHONUTF8'] = '1'

from sdc_converter.server import main

if __name__ == '__main__':
    main()
