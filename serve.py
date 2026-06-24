#!/usr/bin/env python3
"""MOTO STUNT dev server — serves files with no-cache so code edits always reload."""
import http.server
import socketserver

PORT = 8123


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), NoCacheHandler) as httpd:
        print(f'MOTO STUNT dev server (no-cache, threaded) → http://127.0.0.1:{PORT}')
        httpd.serve_forever()
