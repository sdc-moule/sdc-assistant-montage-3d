"""Serveur atelier standard Python : import STEP, conversion isolée, bibliothèque locale."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import subprocess
import sys
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

MAX_UPLOAD = 512 * 1024 * 1024
ID_PATTERN = re.compile(r'^[0-9a-f]{32}$')


class WorkshopServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, web_root, workspace, token):
        super().__init__(address, Handler)
        self.web_root = Path(web_root).resolve()
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.token = token
        self.jobs = {}
        self.lock = threading.Lock()
        self.busy = threading.Lock()
        self.process = None
        self.stopping = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.origin = f'http://127.0.0.1:{self.server_address[1]}'

    def update(self, job, **changes):
        with self.lock:
            job.update(changes)
            path = self.workspace / job['id'] / 'job.json'
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(path)
            self.jobs[job['id']] = dict(job)

    def convert(self, job):
        try:
            folder = self.workspace / job['id']
            self.update(job, state='converting', message='Lecture STEP et contrôle géométrique…')
            with (folder / 'conversion.log').open('wb') as log:
                process = subprocess.Popen([sys.executable, '-m', 'sdc_converter.convert_step',
                                         str(folder / job['source_file']), str(folder / 'converted')],
                                        stdout=log, stderr=subprocess.STDOUT)
                with self.lock:
                    self.process = process
                    if self.stopping.is_set(): process.kill()
                try:
                    code = process.wait(timeout=1800)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
                    raise RuntimeError('La conversion a dépassé 30 minutes.')
                finally:
                    with self.lock: self.process = None
            if self.stopping.is_set(): raise RuntimeError('Conversion interrompue à la fermeture de SDC ; source inchangée.')
            if code != 0:
                diagnostic = (folder / 'conversion.log').read_text(encoding='utf-8', errors='replace')[-5000:]
                raise RuntimeError('Conversion STEP arrêtée. ' + diagnostic)
            metadata = json.loads((folder / 'converted/assembly.json').read_text(encoding='utf-8'))
            self.update(job, state='ready', message='STEP converti.',
                        occurrence_count=len(metadata['occurrences']),
                        metadata_url=f"/api/projects/{job['id']}/assembly.json",
                        glb_url=f"/api/projects/{job['id']}/assembly.glb")
        except Exception as error:
            self.update(job, state='failed', message=str(error))
        finally:
            self.busy.release()

    def projects(self):
        result = []
        for folder in self.workspace.iterdir():
            if ID_PATTERN.fullmatch(folder.name) and (folder / 'job.json').is_file():
                try:
                    job = json.loads((folder / 'job.json').read_text(encoding='utf-8'))
                    if job['state'] == 'ready': result.append(job)
                except (OSError, ValueError, KeyError): pass
        return sorted(result, key=lambda job: job['created_at'], reverse=True)

    def server_close(self):
        self.executor.shutdown(wait=True)
        super().server_close()

    def stop_conversions(self):
        self.stopping.set()
        with self.lock:
            if self.process is not None and self.process.poll() is None: self.process.kill()
        self.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = 'SDC/0.2.0'
    def log_message(self, *_):
        pass  # Pas de chemins ou de noms de pièces envoyés dans une télémétrie.

    def reply(self, status, body, content_type='application/json; charset=utf-8', head=False):
        if not isinstance(body, bytes): body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if not head: self.wfile.write(body)

    def trusted_host(self):
        expected = f'127.0.0.1:{self.server.server_address[1]}'
        if self.headers.get('Host') != expected:
            self.reply(403, {'error': 'Hôte local invalide.'})
            return False
        return True

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        if not self.trusted_host(): return
        route = unquote(urlsplit(self.path).path)
        if route == '/__sdc_health__':
            return self.reply(200, b'SDC-MONTAGE-3D-0.2.0', 'text/plain', head)
        if route == '/api/environment':
            return self.reply(200, {'step_import': True, 'token': self.server.token, 'version': '0.2.0'}, head=head)
        if route == '/api/projects':
            return self.reply(200, {'projects': self.server.projects()}, head=head)
        match = re.fullmatch(r'/api/jobs/([0-9a-f]{32})', route)
        if match:
            with self.server.lock: job = self.server.jobs.get(match[1])
            return self.reply(200 if job else 404, job or {'error': 'Conversion inconnue.'}, head=head)
        match = re.fullmatch(r'/api/projects/([0-9a-f]{32})/(assembly\.json|assembly\.glb)', route)
        if match:
            path = self.server.workspace / match[1] / 'converted' / match[2]
        elif route.startswith('/api/'):
            return self.reply(404, {'error': 'Route inconnue.'}, head=head)
        else:
            if '\\' in route or '\x00' in route or ':' in route:
                return self.reply(403, {'error': 'Chemin refusé.'}, head=head)
            path = (self.server.web_root / ('index.html' if route == '/' else route.lstrip('/'))).resolve()
            if self.server.web_root not in path.parents:
                return self.reply(403, {'error': 'Chemin refusé.'}, head=head)
        if not path.is_file(): return self.reply(404, {'error': 'Fichier introuvable.'}, head=head)
        content_type = {'.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary'}.get(path.suffix, mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
        return self.reply(200, path.read_bytes(), content_type, head)

    def do_POST(self):
        if not self.trusted_host(): return
        if self.headers.get('Origin') != self.server.origin or not hmac.compare_digest(self.headers.get('X-SDC-Token', ''), self.server.token):
            return self.reply(403, {'error': 'Requête non autorisée depuis cette page.'})
        parsed = urlsplit(self.path)
        if parsed.path == '/api/shutdown':
            self.reply(202, {'message': 'Arrêt local demandé.'})
            threading.Thread(target=self.server.stop_conversions, daemon=True).start()
            return
        if parsed.path != '/api/import-step': return self.reply(404, {'error': 'Route inconnue.'})
        filename = parse_qs(parsed.query).get('name', ['assemblage.step'])[0]
        # Le nom original est une information ; il ne sert jamais de chemin système.
        if not filename.lower().endswith(('.step', '.stp')) or len(filename) > 255:
            return self.reply(400, {'error': 'Choisir un fichier STEP ou STP.'})
        try: length = int(self.headers.get('Content-Length', '0'))
        except ValueError: return self.reply(400, {'error': 'Taille de fichier invalide.'})
        if length <= 0 or length > MAX_UPLOAD: return self.reply(413, {'error': 'Fichier vide ou supérieur à 512 Mo.'})
        if self.headers.get('Transfer-Encoding'): return self.reply(400, {'error': 'Transfert non pris en charge.'})
        if not self.server.busy.acquire(blocking=False): return self.reply(409, {'error': 'Une conversion est déjà en cours.'})
        submitted = False
        released = False
        try:
            identity = uuid.uuid4().hex
            folder = self.server.workspace / identity
            folder.mkdir()
            source = folder / 'source.step'
            self.connection.settimeout(60)
            with source.open('wb') as target:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk: raise ValueError('Transfert du STEP interrompu.')
                    target.write(chunk); remaining -= len(chunk)
            with source.open('rb') as stream:
                if b'ISO-10303-21' not in stream.read(4096): raise ValueError('Le fichier ne possède pas un en-tête STEP valide.')
            job = {'id': identity, 'source_name': filename, 'source_file': source.name,
                   'created_at': datetime.now(timezone.utc).isoformat(), 'state': 'queued', 'message': 'Conversion en attente…'}
            self.server.update(job)
            self.server.executor.submit(self.server.convert, job)
            submitted = True
            return self.reply(202, job)
        except Exception as error:
            self.server.busy.release()
            released = True
            return self.reply(400, {'error': str(error)})
        finally:
            if not submitted and not released: self.server.busy.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--port', type=int, default=18740)
    parser.add_argument('--ready-file')
    args = parser.parse_args()
    server = WorkshopServer(('127.0.0.1', args.port), args.root, args.workspace, uuid.uuid4().hex)
    if args.ready_file: Path(args.ready_file).write_text(server.origin, encoding='utf-8')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__': main()
