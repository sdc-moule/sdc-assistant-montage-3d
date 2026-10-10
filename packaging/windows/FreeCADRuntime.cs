using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;

internal static class FreeCADRuntime
{
    private static string Config { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDC", "freecad-python.txt"); } }
    private static bool Candidate(string python)
    {
        return File.Exists(python) && File.Exists(Path.Combine(Path.GetDirectoryName(python), "FreeCAD.pyd"));
    }
    internal static string Find()
    {
        if (File.Exists(Config))
        {
            string saved = File.ReadAllText(Config).Trim(); if (Candidate(saved)) return saved;
        }
        foreach (string root in new string[] {Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs")})
        {
            if (!Directory.Exists(root)) continue;
            string[] folders = Directory.GetDirectories(root, "FreeCAD*"); Array.Sort(folders); Array.Reverse(folders);
            foreach (string folder in folders)
            {
                string python = Path.Combine(folder, "bin", "python.exe"); if (Candidate(python)) return python;
            }
        }
        return null;
    }
    internal static string Choose()
    {
        if (Find() == null && MessageBox.Show("FreeCAD est nécessaire pour ouvrir les STEP.\n\nTélécharger et lancer l'installateur officiel FreeCAD ?\nUne connexion Internet sera nécessaire. Ensuite, redémarrer SDC.", "Moteur STEP FreeCAD", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
        {
            Process.Start(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Installer_FreeCAD.exe")); return null;
        }
        using (var picker = new OpenFileDialog())
        {
            picker.Title = "Sélectionner python.exe dans le dossier bin de FreeCAD";
            picker.Filter = "Python FreeCAD (python.exe)|python.exe";
            if (picker.ShowDialog() != DialogResult.OK) return null;
            if (!Candidate(picker.FileName)) throw new Exception("Ce dossier ne contient pas le moteur FreeCAD. Sélectionner FreeCAD\\bin\\python.exe.");
            Directory.CreateDirectory(Path.GetDirectoryName(Config)); File.WriteAllText(Config, picker.FileName);
            return picker.FileName;
        }
    }
}
