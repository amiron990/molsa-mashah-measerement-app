"""
מצפן רשויות מקומיות — בדיקה מקומית של החלוקות השמורות, בלי הגיליון ובלי סיסמת הניהול.

Serves the site at http://127.0.0.1:8771 and answers the saved-division calls of
dashboard.html itself, from a JSON file, the way tools/apps-script/Manage.gs answers them from
the «חלוקות שמורות» tab: the same requests, the same answers and the same error codes
(exists, missing, name, login). Nothing reaches the live sheet: dashboard.html is served with a
small script that sends its Apps Script calls here instead, and a yellow label on the page says so.

    python tools/local_divisions.py                    # then open http://127.0.0.1:8771/dashboard.html
    python tools/local_divisions.py --port 8772 --file C:/somewhere/divisions.json

Logging in takes any name and any password, except the password "wrong", which is refused the
way a wrong password is, to try that path. The server listens on this computer only
(127.0.0.1), since it lets anyone save. Stop it with Ctrl+C.
"""
import argparse
import datetime
import http.server
import json
import os
import sys
import threading
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'tools', 'local-divisions.json')  # git ignores it
NAME_MAX = 100    # DIV_NAME_MAX in Manage.gs and NAME_MAX in dashboard.js
CELL_MAX = 50000  # DIV_CELL_MAX: what one sheet cell holds
DELAY = 0.4       # seconds per call, so the page's waiting states show; the live script is slower
REFUSED = 'wrong'
EXTRA_SCRIPT = ''  # tests put a script here, to run after the page's own

LIVE = 'script.google.com'
# Before the page's scripts: its calls to the live script come here, and a label says so.
REDIRECT = """<script>
/* tools/local_divisions.py: the page's calls to the Apps Script go to this computer, not to the sheet */
(function () {
  var f = window.fetch.bind(window), b = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  window.fetch = function (u, o) { return String(u && u.url || u).indexOf('%s') >= 0 ? f('/local-api', o) : f(u, o); };
  navigator.sendBeacon = function (u, d) { return String(u).indexOf('%s') >= 0 ? true : !!b && b(u, d); };
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('div');
    s.textContent = 'בדיקה מקומית: החלוקות נשמרות בקובץ במחשב הזה, לא בגיליון. כל סיסמה עובדת, חוץ מ-wrong';
    s.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:70;max-width:calc(100vw - 24px);padding:6px 12px;' +
      'border-radius:8px;background:#F8BE3E;color:#1A1A2E;font:600 12.5px Heebo,system-ui,sans-serif;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none';
    document.body.appendChild(s);
  });
})();
</script>""" % (LIVE, LIVE)

lock = threading.Lock()


def say(*parts):
    print(datetime.datetime.now().strftime('[%H:%M:%S]'), *parts, flush=True)


# ---------- the file: a list of rows, one per division, as the sheet's tab holds them ----------

class BrokenFile(Exception):
    pass


def load():
    if not os.path.exists(STORE):
        return []
    try:
        with open(STORE, encoding='utf-8') as f:
            rows = json.load(f)
    except ValueError as e:
        raise BrokenFile(f'הקובץ {STORE} אינו JSON תקין ({e}). תקנו או מחקו אותו.')
    if not isinstance(rows, list):
        raise BrokenFile(f'בקובץ {STORE} צריכה להיות רשימה.')
    return [r for r in rows if isinstance(r, dict)]


def store(rows):
    tmp = STORE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STORE)


def text(v):
    return '' if v is None else str(v)


def compact(v):  # as JSON.stringify writes it into a cell
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def summary(r):  # a division without its settings: what the list shows and searches
    return {
        'name': text(r.get('name')).strip(),
        'columns': r.get('columns') if isinstance(r.get('columns'), list) else [],
        'labels': r.get('labels') if isinstance(r.get('labels'), dict) else {},
        'savedBy': r.get('savedBy'),
        'savedAt': r.get('savedAt'),
    }


# ---------- the calls: mListDivisions, mGetDivision, mSaveDivision, mDeleteDivision ----------

def name_problem(name):
    if not name:
        return 'צריך לתת לחלוקה שם.'
    if '\r' in name or '\n' in name:
        return 'השם לא יכול לכלול מעבר שורה.'
    if name.startswith('='):
        return 'השם לא יכול להתחיל בסימן =.'
    if len(name) > NAME_MAX:
        return f'השם ארוך מדי: עד {NAME_MAX} תווים.'
    return ''


def list_divisions():
    return {'ok': True, 'divisions': [summary(r) for r in load() if text(r.get('name')).strip()]}


def get_division(name):
    key = text(name).strip()
    for r in load():
        if text(r.get('name')).strip() != key:
            continue
        if not isinstance(r.get('config'), dict):
            return {'ok': False, 'code': 'broken', 'error': 'ההגדרות של החלוקה הזאת בגיליון אינן תקינות.'}
        return {'ok': True, 'division': summary(r) | {'config': r['config']}}
    return {'ok': False, 'code': 'missing', 'error': 'החלוקה הזאת כבר לא ברשימה.'}


def save_division(d, overwrite, who):
    d = d if isinstance(d, dict) else {}
    name = text(d.get('name')).strip()
    bad = name_problem(name)
    if bad:
        return {'ok': False, 'code': 'name', 'error': bad}
    config = d.get('config')
    if not isinstance(config, dict) or not isinstance(config.get('levels'), list):
        return {'ok': False, 'error': 'חסרות הגדרות החלוקה.'}
    columns = d['columns'] if isinstance(d.get('columns'), list) else \
        [lv.get('column') if isinstance(lv, dict) else None for lv in config['levels']]
    labels = d['labels'] if isinstance(d.get('labels'), dict) else {}
    row = {
        'name': name, 'columns': columns, 'labels': labels, 'config': config, 'savedBy': who,
        'savedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
    }
    if any(len(v if isinstance(v, str) else compact(v)) > CELL_MAX for v in row.values()):
        return {'ok': False, 'error': 'החלוקה גדולה מדי לשמירה בגיליון.'}
    rows = load()
    at = next((i for i, r in enumerate(rows) if text(r.get('name')).strip() == name), None)
    if at is not None and not overwrite:
        return {'ok': False, 'code': 'exists', 'error': 'כבר יש חלוקה בשם הזה.'}
    if at is None:
        rows.append(row)
    else:
        rows[at] = row
    store(rows)
    say('החלפת חלוקה' if at is not None else 'שמירת חלוקה', f'"{name}"', '—', who)
    return {'ok': True, 'division': summary(row)}


def delete_division(name, who):
    key = text(name).strip()
    rows = load()
    keep = [r for r in rows if not key or text(r.get('name')).strip() != key]
    if not key or len(keep) == len(rows):
        return {'ok': False, 'code': 'missing', 'error': 'החלוקה הזאת כבר לא ברשימה.'}
    store(keep)
    say('מחיקת חלוקה', f'"{key}"', '—', who)
    return {'ok': True, 'deleted': key}


def api(b):
    action = b.get('action')
    if not action:
        return {'ok': True}  # the workshop's answers: dropped here, never sent on
    try:
        if action == 'divisions':
            return list_divisions()
        if action == 'division':
            return get_division(b.get('name'))
        if action in ('saveDivision', 'deleteDivision'):
            # manageApi checks the password before anything else
            if text(b.get('pass')) in ('', REFUSED):
                return {'ok': False, 'code': 'login', 'error': 'סיסמת ניהול שגויה.'}
            who = text(b.get('who')).strip() or 'לא ידוע'
            with lock:  # as the script's lock: the check for the name and the write are one step
                if action == 'saveDivision':
                    return save_division(b.get('division'), b.get('overwrite') is True, who)
                return delete_division(b.get('name'), who)
        return {'ok': False, 'error': f'לא זמין בבדיקה המקומית: {action}'}
    except BrokenFile as e:
        say('שגיאה:', e)
        return {'ok': False, 'error': str(e)}


# ---------- the server ----------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # edits to the page show on reload
        super().end_headers()

    def log_message(self, *a):
        pass  # the division calls say what they did

    def send(self, code, ctype, data):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path != '/dashboard.html':
            return super().do_GET()
        with open(os.path.join(ROOT, 'dashboard.html'), encoding='utf-8') as f:
            page = f.read()
        page = page.replace('<head>', '<head>' + REDIRECT, 1)
        if EXTRA_SCRIPT:
            page = page.replace('</body>', '<script>' + EXTRA_SCRIPT + '</script></body>', 1)
        self.send(200, 'text/html; charset=utf-8', page.encode('utf-8'))

    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path != '/local-api':
            return self.send(404, 'text/plain; charset=utf-8', b'not found')
        raw = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        try:
            body = json.loads(raw.decode('utf-8'))
        except ValueError:
            body = None
        time.sleep(DELAY)
        out = api(body) if isinstance(body, dict) else {'ok': False, 'error': 'בקשה לא תקינה'}
        self.send(200, 'application/json; charset=utf-8', json.dumps(out, ensure_ascii=False).encode('utf-8'))


def main(argv=None):
    global STORE
    p = argparse.ArgumentParser(description='בדיקה מקומית של החלוקות השמורות, בלי הגיליון.')
    p.add_argument('--port', type=int, default=8771)
    p.add_argument('--file', default=STORE, help='קובץ ה-JSON של החלוקות (ברירת מחדל: tools/local-divisions.json)')
    a = p.parse_args(argv)
    STORE = os.path.abspath(a.file)
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    say(f'http://127.0.0.1:{a.port}/dashboard.html')
    say('החלוקות נשמרות ב-', STORE)
    say('לעצירה: Ctrl+C')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
