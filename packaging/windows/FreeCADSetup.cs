using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class FreeCADSetup
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool inspect = args.Length == 2 && args[0] == "--check-release";
        try
        {
            if (!inspect && FreeCADRuntime.Find() != null)
            {
                MessageBox.Show("Une installation FreeCAD est déjà détectée. Aucune installation supplémentaire n'est nécessaire.", "FreeCAD disponible"); return 0;
            }
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var client = new WebClient())
            {
                client.Headers[HttpRequestHeader.UserAgent] = "SDC-Montage3D-Setup";
                var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(client.DownloadString("https://api.github.com/repos/FreeCAD/FreeCAD/releases/latest"));
                Dictionary<string, object> selected = null;
                foreach (Dictionary<string, object> asset in (System.Collections.IEnumerable)release["assets"])
                {
                    string name = (string)asset["name"];
                    if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && name.IndexOf("Windows", StringComparison.OrdinalIgnoreCase) >= 0 && name.IndexOf("x86_64", StringComparison.OrdinalIgnoreCase) >= 0) { selected = asset; break; }
                }
                if (selected == null) throw new Exception("Installateur Windows x64 introuvable dans la version officielle.");
                string link = (string)selected["browser_download_url"];
                string digest = selected.ContainsKey("digest") ? selected["digest"] as string : null;
                if (!link.StartsWith("https://github.com/FreeCAD/FreeCAD/releases/download/") || digest == null || !digest.StartsWith("sha256:")) throw new Exception("Lien ou empreinte officielle manquante. Utiliser la page officielle FreeCAD.");
                if (inspect)
                {
                    File.WriteAllText(args[1], new JavaScriptSerializer().Serialize(new { name = selected["name"], sha256 = digest, url = link }));
                    return 0;
                }
                string nameOnly = Path.GetFileName((string)selected["name"]);
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDC", "Installers");
                Directory.CreateDirectory(directory);
                string target = Path.Combine(directory, nameOnly);
                using (var form = new Form())
                {
                    form.Text = "Téléchargement officiel FreeCAD"; form.Width = 500; form.Height = 140;
                    var label = new Label(); label.Dock = DockStyle.Top; label.Height = 45; label.Text = "Téléchargement de " + nameOnly + "\nFermer pour annuler.";
                    var bar = new ProgressBar(); bar.Dock = DockStyle.Top; form.Controls.Add(bar); form.Controls.Add(label);
                    Exception failure = null; bool completed = false;
                    client.DownloadProgressChanged += delegate(object sender, DownloadProgressChangedEventArgs e) { bar.Value = e.ProgressPercentage; };
                    client.DownloadFileCompleted += delegate(object sender, System.ComponentModel.AsyncCompletedEventArgs e) { failure = e.Error; completed = !e.Cancelled && e.Error == null; form.Close(); };
                    form.Shown += delegate { client.DownloadFileAsync(new Uri(link), target); };
                    Application.Run(form);
                    if (!completed) { client.CancelAsync(); if (failure != null) throw failure; return 1; }
                }
                using (var file = File.OpenRead(target))
                using (var hash = SHA256.Create())
                {
                    string actual = BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
                    if (actual != digest.Substring(7).ToLowerInvariant()) throw new Exception("L'empreinte du téléchargement ne correspond pas à la publication officielle.");
                }
                Process.Start(target);
                MessageBox.Show("L'installateur officiel FreeCAD a été lancé.\nTerminer l'installation, puis démarrer SDC.\nAucun module Python supplémentaire n'est nécessaire.", "FreeCAD");
            }
            return 0;
        }
        catch (Exception error)
        {
            if (inspect) { File.WriteAllText(args[1], "ERREUR : " + error.Message); return 1; }
            MessageBox.Show(error.Message + "\n\nTéléchargement manuel : https://github.com/FreeCAD/FreeCAD/releases/latest", "Installation FreeCAD interrompue", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
