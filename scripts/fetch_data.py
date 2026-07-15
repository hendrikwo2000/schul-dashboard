# -*- coding: utf-8 -*-
"""Holt Stundenplan (WebUntis) und Aufgaben (IServ) und schreibt data/data.json.

Zugangsdaten kommen aus Umgebungsvariablen (lokal oder GitHub Secrets):
  UNTIS_USER, UNTIS_PASS   - WebUntis-Login (wie im Browser)
  ISERV_USER, ISERV_PASS   - IServ-Login (bea-portal.de)
"""

import base64
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

TZ = ZoneInfo("Europe/Berlin")

UNTIS_SERVER = "https://hh5910.webuntis.com"
UNTIS_SCHOOL = "hh5910"
ISERV_BASE = "https://bea-portal.de"

OUT_FILE = Path(__file__).resolve().parent.parent / "data" / "data.json"


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


# -------------------------------------------------------- Google Kalender

def google_calendar_id(ics_url):
    """Kalender-ID aus der geheimen iCal-Adresse ziehen.

    .../calendar/ical/<kalender-id>/private-<key>/basic.ics
    """
    m = re.search(r"/calendar/ical/([^/]+)/", ics_url or "")
    return unquote(m.group(1)) if m else None


def google_event_url(ev, calendar_id, day, recurring_uids):
    """Link zum einzelnen Termin im Google Kalender.

    Google adressiert Termine ueber die "eid": base64 aus "<Termin-ID> <Kalender-ID>".
    Die Termin-ID steckt in der UID der iCal-Datei (vor dem @). Nur bei Terminen
    aus einer Serie haengt Google den Zeitstempel der Wiederholung mit "_" an --
    bei Einzelterminen wuerde ein Zeitstempel den Link kaputt machen. Achtung:
    recurring_ical_events setzt RECURRENCE-ID auf jedes Vorkommen, auch auf
    Einzeltermine; welche UID wirklich eine Serie ist, steht in recurring_uids.
    Ohne UID oder Kalender-ID gibt es keinen sicheren Link -> Tagesansicht.
    """
    day_url = f"https://calendar.google.com/calendar/r/day/{day.year}/{day.month}/{day.day}"

    uid = str(ev.get("UID", "") or "")
    event_id = uid.split("@")[0].strip()
    if not event_id or not calendar_id:
        return day_url

    recur = ev.get("RECURRENCE-ID") if uid in recurring_uids else None
    if recur is not None:
        rid = recur.dt
        if isinstance(rid, dt.datetime):
            if rid.tzinfo is None:
                rid = rid.replace(tzinfo=TZ)
            stamp = rid.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        else:
            stamp = rid.strftime("%Y%m%d")
        event_id = f"{event_id}_{stamp}"

    eid = base64.urlsafe_b64encode(
        f"{event_id} {calendar_id}".encode("utf-8")).decode().rstrip("=")
    return f"https://calendar.google.com/calendar/u/0/r/eventedit/{eid}"


def fetch_calendar(ics_url):
    """Termine von heute bis in 7 Tagen aus der geheimen iCal-Adresse.

    Mehrtaegige Termine (z.B. Ferien) werden auf einzelne Tage aufgeteilt,
    damit sie an jedem betroffenen Tag auftauchen und nicht nur am ersten.
    """
    import icalendar
    import recurring_ical_events

    resp = requests.get(ics_url, timeout=30)
    resp.raise_for_status()
    cal = icalendar.Calendar.from_ical(resp.content)
    calendar_id = google_calendar_id(ics_url)
    recurring_uids = {str(c.get("UID", "")) for c in cal.walk("VEVENT") if c.get("RRULE")}

    first_day = dt.datetime.now(TZ).date()
    last_day = first_day + dt.timedelta(days=7)

    events = []
    for ev in recurring_ical_events.of(cal).between(first_day, last_day + dt.timedelta(days=1)):
        dtstart = ev.get("DTSTART").dt
        dtend = ev.get("DTEND").dt if ev.get("DTEND") else None
        allday = not isinstance(dtstart, dt.datetime)

        if allday:
            starts_on = dtstart
            # DTEND ist bei ganztaegigen Terminen exklusiv (Tag NACH dem letzten)
            ends_on = (dtend - dt.timedelta(days=1)) if dtend else starts_on
            start_str = end_str = ""
        else:
            local_start = dtstart.astimezone(TZ)
            local_end = dtend.astimezone(TZ) if isinstance(dtend, dt.datetime) else None
            starts_on = local_start.date()
            ends_on = local_end.date() if local_end else starts_on
            # Ein Termin, der um Mitternacht endet, gehoert noch zum Vortag
            if local_end and local_end.time() == dt.time(0, 0) and ends_on > starts_on:
                ends_on -= dt.timedelta(days=1)
            start_str = local_start.strftime("%H:%M")
            end_str = local_end.strftime("%H:%M") if local_end else ""

        if ends_on < starts_on:
            ends_on = starts_on
        span = (ends_on - starts_on).days + 1

        day = max(starts_on, first_day)
        while day <= min(ends_on, last_day):
            events.append({
                "date": day.isoformat(),
                # Uhrzeiten nur am tatsaechlichen Anfangs-/Endtag zeigen
                "start": start_str if day == starts_on else "",
                "end": end_str if day == ends_on else "",
                "allday": allday,
                "title": str(ev.get("SUMMARY", "")),
                "location": str(ev.get("LOCATION", "") or ""),
                "url": google_event_url(ev, calendar_id, day, recurring_uids),
                "until": ends_on.isoformat() if span > 1 else None,
                "spanDays": span,
            })
            day += dt.timedelta(days=1)

    events.sort(key=lambda x: (x["date"], x["start"] or "", x["title"]))
    return events


# --------------------------------------------------------- Verschluesselung

def encrypt_payload(data, password):
    """Gesamten Datensatz mit AES-256-GCM verschluesseln (Schluessel per
    PBKDF2 aus dem Passwort). Das Dashboard entschluesselt im Browser."""
    import base64
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    iterations = 250_000
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=iterations).derive(password.encode("utf-8"))
    ciphertext = AESGCM(key).encrypt(
        iv, json.dumps(data, ensure_ascii=False).encode("utf-8"), None)

    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return {"encrypted": True, "v": 1, "iterations": iterations,
            "salt": b64(salt), "iv": b64(iv), "data": b64(ciphertext)}


# ------------------------------------------------------------------- main

def main():
    data = {
        "updated": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "demo": False,
        "untis": {"ok": False, "error": None, "days": [], "from": None, "to": None},
        "iserv": {"ok": False, "error": None, "tasks": []},
        "calendar": {"ok": False, "error": None, "events": []},
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

    password = os.environ.get("DASHBOARD_PASS")
    ics_url = os.environ.get("ICAL_URL")
    if ics_url and not password:
        # Sicherheitsnetz: private Termine niemals unverschluesselt ins Repo
        data["calendar"]["error"] = "DASHBOARD_PASS nicht gesetzt - Kalender wird nicht unverschluesselt veroeffentlicht"
    elif ics_url:
        try:
            data["calendar"]["events"] = fetch_calendar(ics_url)
            data["calendar"]["ok"] = True
        except Exception as exc:  # noqa: BLE001
            data["calendar"]["error"] = str(exc)
            print(f"Kalender-Fehler: {exc}", file=sys.stderr)
    else:
        data["calendar"]["error"] = "ICAL_URL nicht gesetzt"

    out = encrypt_payload(data, password) if password else data

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    print(f"Geschrieben: {OUT_FILE} ({'verschluesselt' if password else 'unverschluesselt'})")
    print(f"  WebUntis: {'OK' if data['untis']['ok'] else data['untis']['error']}")
    print(f"  IServ:    {'OK' if data['iserv']['ok'] else data['iserv']['error']}")
    print(f"  Kalender: {'OK, ' + str(len(data['calendar']['events'])) + ' Termine' if data['calendar']['ok'] else data['calendar']['error']}")


if __name__ == "__main__":
    main()
