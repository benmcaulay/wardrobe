#!/usr/bin/env python3
"""
Index photos of one person from the macOS Photos library, as JSON on stdout.

Runs under the osxphotos-bundled Python, not the system one — see
`lib/server/photos-library.ts`, which locates it via `brew --prefix osxphotos`.

Why the Python API instead of the `osxphotos` CLI
-------------------------------------------------
`PhotoInfo.path_derivatives` gives the JPEG previews Photos has *already*
generated. Reading those in place means browsing costs nothing: no export, no
copy, no disk. The CLI's `--preview` writes files, and there is no
`--preview-only`, so the CLI route would export ~1800 originals to look at
thumbnails.

Emits one JSON array. Anything unreadable is reported rather than dropped, so
the caller can say why a photo is unavailable instead of rendering a broken
tile.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys


def smallest_derivative(photo) -> str | None:
    """
    The cheapest derivative to send to a browser.

    `path_derivatives` is ordered largest-first in osxphotos, so the last entry
    is the thumbnail. Grid tiles are ~200px; shipping the 2048px version would
    be ~20x the bytes for no visible gain.
    """
    try:
        derivatives = photo.path_derivatives or []
    except Exception:
        return None
    return derivatives[-1] if derivatives else None


def iso_date(value) -> str | None:
    if not isinstance(value, datetime.datetime):
        return None
    return value.isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person", action="append", default=[])
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--persons-only",
        action="store_true",
        help="Emit the library's named people and their photo counts, then exit.",
    )
    args = parser.parse_args()

    import osxphotos

    db = osxphotos.PhotosDB()

    if args.persons_only:
        # person_info carries the count; `persons` alone is just names.
        people = [
            {"name": p.name, "count": p.facecount}
            for p in db.person_info
            if p.name and p.name != "_UNKNOWN_"
        ]
        people.sort(key=lambda p: -p["count"])
        json.dump(people, sys.stdout)
        return 0

    # Date filtering is native to photos(); doing it here rather than in a
    # Python loop keeps the work inside osxphotos' own query.
    def parse_day(value, end_of_day=False):
        if not value:
            return None
        day = datetime.date.fromisoformat(value)
        time = datetime.time.max if end_of_day else datetime.time.min
        return datetime.datetime.combine(day, time)

    photos = db.photos(
        persons=args.person or None,
        movies=False,
        from_date=parse_day(args.from_date),
        to_date=parse_day(args.to_date, end_of_day=True),
    )

    out = []
    for photo in photos:
        # Screenshots are a shopping page, not a garment you own; hidden and
        # trashed were excluded on purpose by the user.
        if photo.intrash or photo.hidden or photo.screenshot:
            continue
        out.append(
            {
                "uuid": photo.uuid,
                "filename": photo.original_filename or photo.filename,
                "date": iso_date(photo.date),
                # `path` is None when iCloud has optimised the original away.
                # The derivative usually survives, so the tile still renders and
                # only the import has to deal with it.
                "path": photo.path,
                "derivative": smallest_derivative(photo),
                "persons": [p for p in (photo.persons or []) if p != "_UNKNOWN_"],
                "missing": bool(photo.ismissing) or not photo.path,
                "favorite": bool(photo.favorite),
            }
        )

    out.sort(key=lambda p: p["date"] or "", reverse=True)
    if args.limit and args.limit > 0:
        out = out[: args.limit]

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
