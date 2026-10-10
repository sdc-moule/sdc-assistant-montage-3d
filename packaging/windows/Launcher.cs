using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool test = args.Length == 2 && args[0] == "--test-server";
        Process server = null;
        string serverUrl = null;
        string app = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            if (!File.Exists(Path.Combine(app, "app", "index.html"))) throw new Exception("Le dossier app est absent. Extraire tout le paquet ou réinstaller.");
            bool first;
            using (var mutex = new Mutex(true, "Local\\SDC_Montage3D_v2_" + Environment.UserName, out first))
            {
                string url = "http://127.0.0.1:18740/";
                if (!test && !first)
                {
                    if (!Healthy(url)) throw new Exception("SDC démarre déjà ; réessayer dans quelques secondes.");
                    Process.Start(url); return 0;
                }
                string python = FreeCADRuntime.Find();
                if (python == null)
                {
                    if (test) throw new Exception("FreeCAD avec Python intégré introuvable.");
                    python = FreeCADRuntime.Choose();
                    if (python == null) return 1;
                }
                string data = test ? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1])), "server-data") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDC", "Montage3DData");
                Directory.CreateDirectory(data);
                string ready = test ? Path.GetFullPath(args[1]) : Path.Combine(data, "ready-" + Guid.NewGuid().ToString("N") + ".txt");
                var info = new ProcessStartInfo(python);
                info.UseShellExecute = false; info.CreateNoWindow = true;
                info.WorkingDirectory = app;
                info.Arguments = Quote(Path.Combine(app, "backend", "start_workshop.py")) + " --root " + Quote(Path.Combine(app, "app")) + " --workspace " + Quote(Path.Combine(data, "projects")) + " --port " + (test ? "0" : "18740") + " --ready-file " + Quote(ready);
                server = Process.Start(info);
                for (int i = 0; i < 150 && !File.Exists(ready); i++)
                {
                    if (server.HasExited) throw new Exception("Le serveur n'a pas démarré. Port 18740 occupé ou Python FreeCAD incompatible.");
                    Thread.Sleep(100);
                }
                if (!File.Exists(ready)) throw new Exception("Le serveur n'a pas répondu en 15 secondes.");
                url = File.ReadAllText(ready).Trim();
                serverUrl = url;
                if (!Healthy(url)) throw new Exception("Le serveur SDC ne répond pas correctement.");
                if (test) server.WaitForExit();
                else using (var icon = new NotifyIcon())
                {
                    icon.Icon = SystemIcons.Application; icon.Text = "SDC Assistant Montage 3D";
                    var menu = new ContextMenuStrip();
                    menu.Items.Add("Ouvrir SDC", null, delegate { Process.Start(url); });
                    menu.Items.Add("Configurer FreeCAD", null, delegate {
                        try { FreeCADRuntime.Choose(); MessageBox.Show("Quitter puis redémarrer SDC pour appliquer le choix.", "Configuration FreeCAD"); }
                        catch (Exception error) { MessageBox.Show(error.Message, "Configuration interrompue"); }
                    });
                    menu.Items.Add("Quitter SDC", null, delegate { Application.Exit(); });
                    icon.ContextMenuStrip = menu;
                    icon.DoubleClick += delegate { Process.Start(url); };
                    icon.Visible = true; Process.Start(url);
                    Application.Run(); icon.Visible = false;
                }
                if (first) mutex.ReleaseMutex();
            }
            return 0;
        }
        catch (Exception error)
        {
            if (test) File.WriteAllText(args[1], "ERREUR : " + error.Message);
            else MessageBox.Show(error.Message, "Démarrage SDC interrompu", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            if (server != null && !server.HasExited)
            {
                if (serverUrl != null) StopServer(serverUrl);
                if (!server.WaitForExit(10000)) { server.Kill(); server.WaitForExit(5000); }
            }
            if (server != null) server.Dispose();
        }
    }
    private static string Quote(string path) { return "\"" + path + "\""; }
    private static void StopServer(string url)
    {
        try
        {
            string origin = url.TrimEnd('/');
            var query = WebRequest.Create(origin + "/api/environment"); query.Timeout = 3000;
            string token;
            using (var response = query.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                token = (string)new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd())["token"];
            var stop = WebRequest.Create(origin + "/api/shutdown"); stop.Method = "POST"; stop.ContentLength = 0; stop.Timeout = 3000;
            stop.Headers["Origin"] = origin; stop.Headers["X-SDC-Token"] = token;
            using (stop.GetResponse()) { }
        }
        catch { }
    }
    private static bool Healthy(string url)
    {
        try
        {
            var request = WebRequest.Create(url.TrimEnd('/') + "/__sdc_health__"); request.Timeout = 3000;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd() == "SDC-MONTAGE-3D-0.2.0";
        }
        catch { return false; }
    }
}
