#!/usr/bin/env python3
# Stremio Big Picture: loopback-only static server for the UI and doctor samples.
# SPDX-License-Identifier: GPL-2.0-only
"""Serve a directory on 127.0.0.1, with Range support (mpv seeks in media files).

--mount NAME=DIR serves another directory under /NAME/. Requests can never resolve
outside the directory they map to, even through symlinks.

With --report FILE, POST /report appends one line per request to FILE. The doctor
uses this to receive results from the page running inside the Stremio shell.
"""

import argparse
import mimetypes
import os
import re
import shutil
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

MAX_REPORT_BYTES = 1024 * 1024
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
EXTRA_TYPES = {".wasm": "application/wasm", ".mkv": "video/x-matroska", ".js": "text/javascript"}


class Handler(BaseHTTPRequestHandler):
    root = ""
    mounts = {}
    report_path = None
    server_version = "stremio-bigpicture"
    sys_version = ""

    def log_message(self, format, *args):
        pass

    def resolve(self):
        relative = unquote(urlsplit(self.path).path).lstrip("/")
        name, _, rest = relative.partition("/")
        root = self.mounts.get(name)
        if root is None:
            root, rest = self.root, relative
        path = os.path.realpath(os.path.join(root, rest))
        if path != root and not path.startswith(root + os.sep):
            return None
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        return path if os.path.isfile(path) else None

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if self.report_path is None or urlsplit(self.path).path != "/report" or length > MAX_REPORT_BYTES:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        body = self.rfile.read(length).decode("utf-8", "replace").replace("\n", " ")
        with open(self.report_path, "a", encoding="utf-8") as report:
            report.write(body + "\n")
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_HEAD(self):
        self.send_file(head=True)

    def do_GET(self):
        self.send_file(head=False)

    def send_file(self, head):
        path = self.resolve()
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        size = os.path.getsize(path)
        start, end = 0, size - 1
        status = HTTPStatus.OK
        match = RANGE_RE.match(self.headers.get("Range") or "")
        if match and (match[1] or match[2]):
            if match[1]:
                start = int(match[1])
                end = min(int(match[2]), size - 1) if match[2] else size - 1
            else:
                start = max(size - int(match[2]), 0)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT

        extension = os.path.splitext(path)[1].lower()
        content_type = EXTRA_TYPES.get(extension) or mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head:
            return
        with open(path, "rb") as source:
            source.seek(start)
            remaining = end - start + 1
            try:
                while remaining > 0:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--port", type=int, default=18470)
    parser.add_argument("--mount", action="append", default=[], metavar="NAME=DIR")
    parser.add_argument("--report")
    args = parser.parse_args()

    Handler.root = os.path.realpath(args.root)
    Handler.mounts = {name: os.path.realpath(path) for name, path in (mount.split("=", 1) for mount in args.mount)}
    Handler.report_path = args.report
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        print(f"Cannot listen on 127.0.0.1:{args.port}: {error}", file=sys.stderr)
        return 1
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
