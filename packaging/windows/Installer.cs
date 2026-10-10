using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Windows.Forms;

internal static class Installer
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool test = args.Length == 2 && args[0] == "--extract-only";
        try
        {
            string destination;
            if (test) destination = Path.GetFullPath(args[1]);
            else
            {
                destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDC", "AssistantMontage3D");
                var choice = MessageBox.Show("Installer SDC Assistant Montage 3D 0.2.0 pour cet utilisateur ?\n\nDossier : " + destination + "\n\nUn raccourci sera créé sur le bureau.\nLe chargement STEP utilise FreeCAD, détecté s'il est déjà installé.\nChrome ou Edge avec WebGL2 est requis.", "Installation SDC", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (choice != DialogResult.OK) return 0;
                if (Directory.Exists(destination))
                {
                    if (MessageBox.Show("Une installation existe déjà. Mettre à jour ses fichiers applicatifs ?\nLes projets téléchargés restent dans leur dossier habituel.", "Mise à jour SDC", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
                }
            }
            string source = System.Reflection.Assembly.GetExecutingAssembly().Location;
            using (var file = File.OpenRead(source))
            {
                if (file.Length < 16) throw new Exception("Installateur incomplet.");
                file.Seek(-16, SeekOrigin.End);
                var reader = new BinaryReader(file);
                long count = reader.ReadInt64();
                if (Encoding.ASCII.GetString(reader.ReadBytes(8)) != "SDCZIP01" || count <= 0 || count > file.Length - 16 || count > int.MaxValue) throw new Exception("Archive d'installation absente ou invalide.");
                file.Seek(-16 - count, SeekOrigin.End);
                byte[] payload = reader.ReadBytes((int)count);
                using (var memory = new MemoryStream(payload))
                using (var archive = new ZipArchive(memory, ZipArchiveMode.Read))
                {
                    // Tous les chemins sont validés avant toute extraction.
                    string prefix = destination.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    foreach (var entry in archive.Entries)
                    {
                        string path = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new Exception("Chemin d'archive refusé.");
                    }
                    Directory.CreateDirectory(destination);
                    foreach (var entry in archive.Entries)
                    {
                        string path = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                        Directory.CreateDirectory(Path.GetDirectoryName(path));
                        entry.ExtractToFile(path, !test);
                    }
                }
            }
            if (!test)
            {
                // Raccourci Windows, sans script PowerShell ni modification du PATH.
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                dynamic shortcut = shell.CreateShortcut(Path.Combine(desktop, "SDC Assistant Montage 3D.lnk"));
                shortcut.TargetPath = Path.Combine(destination, "SDC_Montage_3D.exe");
                shortcut.WorkingDirectory = destination;
                shortcut.Description = "Consultation des assemblages SDC - WIP";
                shortcut.Save();
                if (FreeCADRuntime.Find() == null && MessageBox.Show("FreeCAD n'est pas détecté. Télécharger et lancer son installateur officiel maintenant ?\nUne connexion Internet et éventuellement une autorisation Windows seront nécessaires.", "Composant STEP", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                    System.Diagnostics.Process.Start(Path.Combine(destination, "Installer_FreeCAD.exe"));
                MessageBox.Show("Installation terminée.\n\nDouble-cliquer sur le raccourci du bureau ou sur Demarrer_SDC.bat.\nPour quitter : icône SDC près de l'horloge, puis Quitter SDC.", "SDC installé", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 0;
        }
        catch (Exception error)
        {
            if (test) File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1])), "erreur-installation.txt"), error.ToString());
            else MessageBox.Show(error.Message + "\n\nFermer l'application avant une mise à jour et réessayer.", "Installation interrompue", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
