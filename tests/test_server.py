import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from sdc_converter.server import WorkshopServer
from test_step import App, make_fixture


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.web = self.folder / 'web'; self.web.mkdir(); (self.web / 'index.html').write_text('<html>SDC</html>')
        self.server = WorkshopServer(('127.0.0.1', 0), self.web, self.folder / 'projects', 'test-token')
        self.url = self.server.origin
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def request(self, path, body=None, **headers):
        request = Request(self.url + path, data=body, headers=headers)
        return urlopen(request, timeout=10)

    def test_static_and_upload_guards(self):
        with self.request('/') as response: self.assertEqual(response.read(), b'<html>SDC</html>')
        with self.request('/api/environment') as response: self.assertTrue(json.load(response)['step_import'])
        for path in ['/../outside', '/%2e%2e/outside', '/x%5coutside']:
            with self.assertRaises(HTTPError) as error: self.request(path)
            self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError) as error: self.request('/api/import-step?name=test.step', b'bad')
        self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/import-step?name=test.step', b'bad', Origin=self.url, **{'X-SDC-Token':'test-token'})
        self.assertEqual(error.exception.code, 400)
        self.assertFalse(self.server.busy.locked())
        with self.assertRaises(HTTPError) as error: self.request('/', Host='example.com')
        self.assertEqual(error.exception.code, 403)

    @unittest.skipIf(App is None, 'FreeCAD requis pour le cycle upload/conversion')
    def test_step_upload_conversion_library_and_source_integrity(self):
        source = self.folder / 'assembly.step'; make_fixture(source)
        before = source.read_bytes()
        with self.request('/api/import-step?name=Assemblage%20test.step', before, Origin=self.url, **{'X-SDC-Token':'test-token'}) as response:
            self.assertEqual(response.status, 202); job = json.load(response)
        for _ in range(300):
            with self.request('/api/jobs/' + job['id']) as response: job = json.load(response)
            if job['state'] in ['ready','failed']: break
            time.sleep(.1)
        self.assertEqual(job['state'], 'ready', job['message'])
        with self.request(job['metadata_url']) as response: self.assertEqual(len(json.load(response)['occurrences']), 3)
        with self.request(job['glb_url']) as response: self.assertEqual(response.read(4), b'glTF')
        with self.request('/api/projects') as response: self.assertEqual(json.load(response)['projects'][0]['source_name'], 'Assemblage test.step')
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual((self.server.workspace / job['id'] / 'source.step').read_bytes(), before)
        restarted = WorkshopServer(('127.0.0.1',0), self.web, self.server.workspace, 'new-token')
        try: self.assertEqual(restarted.projects()[0]['id'], job['id'])
        finally: restarted.server_close()
