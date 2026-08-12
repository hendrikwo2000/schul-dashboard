# -*- coding: utf-8 -*-
"""Holt Stundenplan (WebUntis) und Aufgaben (IServ) und schickt sie an das
Dashboard.

Termine kommen NICHT mehr von hier. Sie holt das Dashboard seit dem
12.08.2026 direkt aus dem Google-Kalender des verknuepften Kontos - live statt
viertelstuendlich, und ohne dass eine geheime iCal-Adresse als Secret
herumliegen muss. Der iCal-Weg samt `fetch_calendar` ist deshalb ausgebaut.

Bis zum 12.08.2026 schrieb dieses Skript eine verschluesselte data/data.json
ins Repo, und die Seite entschluesselte sie im Browser. Seit dem Umzug auf
Cloudflare Pages geht der Weg ueber HTTPS an /api/daten: jeder Commit waere
dort ein Deploy, und das waren zuletzt rund 310 im Monat bei 500 erlaubten.
Die Verschluesselung ist damit weg - die Daten liegen hinter der Anmeldung,
und was nur der Server herausgibt, muss der Browser nicht verstecken.

Zugangsdaten kommen aus Umgebungsvariablen (lokal oder GitHub Secrets):
  UNTIS_USER, UNTIS_PASS   - WebUntis-Login (wie im Browser)
  ISERV_USER, ISERV_PASS   - IServ-Login (bea-portal.de)
  DASHBOARD_URL            - Ziel, z. B. https://schule.it-wolf.org
  DASHBOARD_TOKEN          - geteiltes Geheimnis, muss zum gleichnamigen
                             Secret auf dem Pages-Projekt passen

Zum Ausprobieren ohne Versand:  python scripts/fetch_data.py --datei out.json
"""

import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

TZ = ZoneInfo("Europe/Berlin")

UNTIS_SERVER = "https://hh5910.webuntis.com"
UNTIS_SCHOOL = "hh5910"
ISERV_BASE = "https://bea-portal.de"

DASHBOARD_URL_STANDARD = "https://schule.it-wolf.org"

# Drei Anlaeufe mit wachsender Pause. Deckt den Fall ab, dass Cloudflare oder
# das Netz des Runners kurz zickt - laenger zu warten lohnt nicht, in 15
# Minuten kommt der naechste Lauf ohnehin.
SENDE_VERSUCHE = 3
SENDE_PAUSE_SEK = 5


# ---------------------------------------------------------------- WebUntis

def untis_rpc(session, method, params):
    resp = session.post(
        f"{UNTIS_SERVER}/WebUntis/jsonrpc.do",
        params={"school": UNTIS_SCHOOL},
        json={"id": "1", "jsonrpc": "2.0", "method": method, "params": params},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    if "error" in payload:
        raise RuntimeError(f"WebUntis {method}: {payload['error'].get('message')}")
    return payload.get("result")


def fmt_time(t):
    return f"{t // 100:02d}:{t % 100:02d}"


def fetch_untis_teachers_rest(session, person_id, monday):
    """Lehrerkuerzel ueber die interne Webview-API holen.

    Die JSON-RPC-Antwort enthaelt bei dieser Schule keine Lehrernamen; die
    Webansicht zeigt sie aber (z.B. "RomMa"). Diese API liefert genau diese
    Kuerzel. Rueckgabe: {(date_int, startTime_int): "Kuerzel, Kuerzel"}.
    """
    resp = session.get(
        f"{UNTIS_SERVER}/WebUntis/api/public/timetable/weekly/data",
        params={"elementType": 5, "elementId": person_id,
                "date": monday.isoformat()},
        headers={"Accept": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()["data"]["result"]["data"]

    names = {}
    for el in payload.get("elements", []):
        names[(el.get("type"), el.get("id"))] = (
            el.get("name") or el.get("displayname") or "")

    out = {}
    for period in payload.get("elementPeriods", {}).get(str(person_id), []):
        codes = [names.get((2, e.get("id")), "")
                 for e in period.get("elements", []) if e.get("type") == 2]
        codes = [c for c in codes if c]
        if codes:
            out[(period.get("date"), period.get("startTime"))] = ", ".join(codes)
    return out


def fetch_untis(user, password):
    """Stundenplan der aktuellen Woche (Mo-Sa) als Liste von Tagen."""
    session = requests.Session()
    login = untis_rpc(session, "authenticate",
                      {"user": user, "password": password, "client": "dashboard"})
    person_id = login["personId"]
    person_type = login.get("personType", 5)

    today = dt.datetime.now(TZ).date()
    monday = today - dt.timedelta(days=today.weekday())
    # Sonntags ist die laufende Woche durch -> die kommende zeigen, sonst
    # stuende den ganzen Sonntag die vergangene Woche im Dashboard
    if today.weekday() == 6:
        monday += dt.timedelta(days=7)
    saturday = monday + dt.timedelta(days=5)

    # WebUntis lehnt Abfragen ueber die Schuljahresgrenze hinweg ab -> Woche
    # auf das Schuljahr begrenzen, in dem sie liegt.
    try:
        years = untis_rpc(session, "getSchoolyears", {})
        spans = [(dt.datetime.strptime(str(y["startDate"]), "%Y%m%d").date(),
                  dt.datetime.strptime(str(y["endDate"]), "%Y%m%d").date())
                 for y in years or []]
        span = next((s for s in spans if s[0] <= today <= s[1]), None)
        if span is None:
            span = next((s for s in spans if s[0] <= saturday and s[1] >= monday), None)
        if span:
            monday = max(monday, span[0])
            saturday = min(saturday, span[1])
    except Exception:
        pass  # im Zweifel unveraendert abfragen

    result = untis_rpc(session, "getTimetable", {"options": {
        "element": {"id": person_id, "type": person_type},
        "startDate": int(monday.strftime("%Y%m%d")),
        "endDate": int(saturday.strftime("%Y%m%d")),
        "showSubstText": True,
        "showLsText": True,
        "showInfo": True,
        "subjectFields": ["name", "longname"],
        "roomFields": ["name"],
        "teacherFields": ["id", "name", "longname"],
        "klasseFields": ["name"],
    }})

    # Manche Schulen liefern im Stundenplan nur Lehrer-IDs ohne Namen ->
    # Namen ueber getTeachers nachschlagen (falls fuer Schueler erlaubt).
    def t_name(t):
        return t.get("longname") or t.get("name") or ""

    debug = {
        "te_sample": next((l.get("te") for l in result or [] if l.get("te")), None),
        "rest_teachers": None,
    }

    teacher_map = {}
    if any(not t_name(t) for lesson in result or [] for t in lesson.get("te") or []):
        try:
            for t in untis_rpc(session, "getTeachers", {}):
                teacher_map[t["id"]] = (" ".join(filter(None, [t.get("foreName"), t.get("longName")]))
                                        or t.get("name", ""))
        except Exception as exc:
            print(f"WebUntis getTeachers nicht verfuegbar: {exc}", file=sys.stderr)

    # Fallback: Lehrerkuerzel aus der Webview-API (liefert z.B. "RomMa")
    rest_map = {}
    try:
        rest_map = fetch_untis_teachers_rest(session, person_id, monday)
        debug["rest_teachers"] = len(rest_map)
    except Exception as exc:
        debug["rest_teachers"] = f"Fehler: {exc}"
        print(f"WebUntis Webview-API: {exc}", file=sys.stderr)

    try:
        untis_rpc(session, "logout", {})
    except Exception:
        pass

    days = {}
    for lesson in result or []:
        date = dt.datetime.strptime(str(lesson["date"]), "%Y%m%d").date()
        subjects = lesson.get("su") or []
        rooms = lesson.get("ro") or []
        teachers = lesson.get("te") or []
        info = " ".join(filter(None, [
            lesson.get("substText"), lesson.get("info"), lesson.get("lstext")]))
        teacher = ", ".join(filter(None, (
            t_name(t) or teacher_map.get(t.get("id"), "") for t in teachers)))
        if not teacher:
            teacher = rest_map.get((lesson["date"], lesson["startTime"]), "")
        days.setdefault(date.isoformat(), []).append({
            "start": fmt_time(lesson["startTime"]),
            "end": fmt_time(lesson["endTime"]),
            "subject": (subjects[0].get("longname") or subjects[0].get("name")) if subjects else "?",
            "subjectShort": subjects[0].get("name") if subjects else "?",
            "room": ", ".join(r.get("name", "") for r in rooms),
            "teacher": teacher,
            "code": lesson.get("code", ""),  # "" | "cancelled" | "irregular"
            "info": info.strip(),
        })

    day_list = []
    for date_str in sorted(days):
        lessons = sorted(days[date_str], key=lambda l: l["start"])
        day_list.append({"date": date_str, "lessons": lessons})
    # Tage ohne Unterricht fehlen in day_list; ohne den abgefragten Zeitraum
    # kann das Dashboard "frei" nicht von "nicht abgefragt" unterscheiden.
    return day_list, debug, (monday.isoformat(), saturday.isoformat())


# ------------------------------------------------------------------ IServ

DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?")


def parse_iserv_date(text):
    m = DATE_RE.search(text or "")
    if not m:
        return None
    d, mo, y, h, mi = m.groups()
    return f"{y}-{mo}-{d}T{h or '23'}:{mi or '59'}"


def complete_iserv_sso(session, resp):
    """IServ schickt eingeloggte Nutzer durch einen OpenID-Zwischenschritt.

    Im Browser laeuft der automatisch (JavaScript); ohne JS bleibt man auf
    einer Zwischenseite mit einem "klicken Sie hier"-Link. Diesem Link
    folgen wir hier manuell, bis wir auf der Zielseite ankommen.
    """
    for _ in range(4):
        if "/iserv/auth/auth" not in resp.url and "authentication/redirect" not in resp.text:
            return resp
        soup = BeautifulSoup(resp.text, "html.parser")
        link = soup.find("a", href=re.compile(r"authentication/redirect"))
        if link is None:
            return resp
        resp = session.get(requests.compat.urljoin(ISERV_BASE, link["href"]),
                           timeout=30)
    return resp


def fetch_iserv(user, password):
    """Offene Aufgaben aus dem IServ-Aufgabenmodul."""
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0 (Dashboard)"
    session.get(f"{ISERV_BASE}/iserv/auth/login", timeout=30)
    # Das Login-Formular postet auf die Login-Seite selbst (kein CSRF-Token)
    resp = session.post(
        f"{ISERV_BASE}/iserv/auth/login",
        data={"_username": user, "_password": password},
        timeout=30,
    )
    resp.raise_for_status()
    # Bei fehlgeschlagenem Login zeigt IServ wieder die Login-Seite an
    if "/auth/login" in resp.url or 'name="_password"' in resp.text:
        raise RuntimeError("IServ-Login fehlgeschlagen (Benutzername/Passwort pruefen)")
    resp = complete_iserv_sso(session, resp)

    link_re = re.compile(r"exercise/show/\d+")
    resp = session.get(
        f"{ISERV_BASE}/iserv/exercise",
        params={"filter[status]": "current"},
        timeout=30,
    )
    resp = complete_iserv_sso(session, resp)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    links = soup.find_all("a", href=link_re)
    if not links:
        # Fallback: Liste ohne Filter versuchen
        resp = complete_iserv_sso(session, session.get(f"{ISERV_BASE}/iserv/exercise", timeout=30))
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        links = soup.find_all("a", href=link_re)
    title = soup.title.get_text(strip=True) if soup.title else "?"
    print(f"IServ: {len(links)} Aufgaben-Links auf '{title}' ({resp.url})",
          file=sys.stderr)

    # Diagnose: welche Seite wurde geladen, welche Module gibt es?
    modules = sorted({
        (a.get_text(strip=True)[:30], a["href"][:80])
        for a in soup.find_all("a", href=True)
        if "/iserv/" in a["href"] and a.get_text(strip=True)
    })[:30]
    debug = {"url": str(resp.url), "title": title,
             "links": len(links), "modules": modules}

    tasks, seen = [], set()
    for link in links:
        url = requests.compat.urljoin(ISERV_BASE, link["href"])
        name = link.get_text(strip=True)
        if url in seen or not name:
            continue
        seen.add(url)
        row = link.find_parent("tr")
        cells = [c.get_text(" ", strip=True) for c in row.find_all("td")] if row else []
        dates = [d for d in (parse_iserv_date(c) for c in cells) if d]
        row_text = " ".join(cells).lower()
        tasks.append({
            "title": name,
            "url": url,
            "start": dates[0] if len(dates) > 1 else None,
            "due": dates[-1] if dates else None,
            "done": "erledigt" in row_text or "abgegeben" in row_text,
        })

    tasks.sort(key=lambda t: t["due"] or "9999")
    return tasks, debug


# ---------------------------------------------------------------- Abliefern

def sende_an_dashboard(data, url, token):
    """Den Datensatz an /api/daten schicken. True, wenn er angekommen ist.

    Wiederholt wird nur, was sich wiederholen laesst: Netzfehler und 5xx. Ein
    403 heisst falscher Token und wird beim zweiten Versuch auch nicht besser -
    dann lieber sofort laut scheitern, damit der Action-Lauf rot wird.
    """
    ziel = url.rstrip("/") + "/api/daten"
    for versuch in range(1, SENDE_VERSUCHE + 1):
        try:
            resp = requests.post(
                ziel,
                json=data,
                headers={"X-Dashboard-Token": token},
                timeout=30,
            )
        except requests.RequestException as exc:
            print(f"Versuch {versuch}/{SENDE_VERSUCHE} fehlgeschlagen: {exc}", file=sys.stderr)
        else:
            if resp.ok:
                print(f"Gesendet an {ziel}: {resp.text[:200]}")
                return True
            print(f"Versuch {versuch}/{SENDE_VERSUCHE}: HTTP {resp.status_code} - {resp.text[:300]}",
                  file=sys.stderr)
            if resp.status_code < 500:
                return False
        if versuch < SENDE_VERSUCHE:
            time.sleep(SENDE_PAUSE_SEK * versuch)
    return False


# ------------------------------------------------------------------- main

def main():
    data = {
        "updated": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "demo": False,
        "untis": {"ok": False, "error": None, "days": [], "from": None, "to": None},
        "iserv": {"ok": False, "error": None, "tasks": []},
    }

    untis_user = os.environ.get("UNTIS_USER")
    untis_pass = os.environ.get("UNTIS_PASS")
    if untis_user and untis_pass:
        try:
            (data["untis"]["days"], data["untis"]["debug"],
             (data["untis"]["from"], data["untis"]["to"])) = fetch_untis(untis_user, untis_pass)
            data["untis"]["ok"] = True
        except Exception as exc:  # noqa: BLE001
            data["untis"]["error"] = str(exc)
            print(f"WebUntis-Fehler: {exc}", file=sys.stderr)
    else:
        data["untis"]["error"] = "UNTIS_USER/UNTIS_PASS nicht gesetzt"

    iserv_user = os.environ.get("ISERV_USER")
    iserv_pass = os.environ.get("ISERV_PASS")
    if iserv_user and iserv_pass:
        try:
            data["iserv"]["tasks"], data["iserv"]["debug"] = fetch_iserv(iserv_user, iserv_pass)
            data["iserv"]["ok"] = True
        except Exception as exc:  # noqa: BLE001
            data["iserv"]["error"] = str(exc)
            print(f"IServ-Fehler: {exc}", file=sys.stderr)
    else:
        data["iserv"]["error"] = "ISERV_USER/ISERV_PASS nicht gesetzt"

    print(f"  WebUntis: {'OK' if data['untis']['ok'] else data['untis']['error']}")
    print(f"  IServ:    {'OK' if data['iserv']['ok'] else data['iserv']['error']}")

    # --datei schreibt statt zu senden - zum Ansehen, was herauskommt, ohne
    # den Live-Stand anzufassen.
    if "--datei" in sys.argv:
        ziel = Path(sys.argv[sys.argv.index("--datei") + 1])
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Geschrieben: {ziel}")
        return 0

    # Wenn KEINE der beiden Quellen geliefert hat, lieber gar nicht senden.
    # Sonst ersetzt ein Netzausfall im Runner einen brauchbaren Stand durch
    # lauter Fehlermeldungen - und im Dashboard sieht das aus, als waere heute
    # wirklich nichts los. Der alte Stand bleibt stehen und altert sichtbar;
    # ab drei Stunden warnt die Seite von selbst.
    if not (data["untis"]["ok"] or data["iserv"]["ok"]):
        print("Keine einzige Quelle hat geliefert - es wird nichts gesendet.", file=sys.stderr)
        return 1

    token = os.environ.get("DASHBOARD_TOKEN")
    if not token:
        print("DASHBOARD_TOKEN nicht gesetzt - es wird nichts gesendet.", file=sys.stderr)
        return 1

    url = os.environ.get("DASHBOARD_URL") or DASHBOARD_URL_STANDARD
    return 0 if sende_an_dashboard(data, url, token) else 1


if __name__ == "__main__":
    sys.exit(main())
