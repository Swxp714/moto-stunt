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


if __name__ == '__main__':
    with socketserver.TCPServer(('127.0.0.1', PORT), NoCacheHandler) as httpd:
        print(f'MOTO STUNT dev server (no-cache) → http://127.0.0.1:{PORT}')
        httpd.serve_forever()
