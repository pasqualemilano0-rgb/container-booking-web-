"""Publish only newer vessel snapshots after concurrent main-branch changes.

The fetchers already validated the incoming public data. This helper runs *after*
fetching latest origin/main and reapplying candidates. It never edits other files
or accepts a snapshot with missing rows/timestamps.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SNAPSHOTS=("sct.json","tfg_schedule.json","conateco.json")


def timestamp(value):
    if not isinstance(value,str) or not value.strip():
        return None
    try:
        date=datetime.fromisoformat(value.replace("Z","+00:00"))
        return date.astimezone(timezone.utc) if date.tzinfo else None
    except ValueError:
        return None


def accept_newer(name, incoming, current):
    """Return a safe newer candidate, or None if remote data wins."""
    if not isinstance(incoming,dict) or not isinstance(incoming.get("rows"),list):
        return None
    if not incoming["rows"]:
        return None
    new_time=timestamp(incoming.get("acquired_at"))
    if not new_time:
        return None
    if not isinstance(current,dict):
        current={}
    old_rows=current.get("rows") if isinstance(current.get("rows"),list) else []
    old_time=timestamp(current.get("acquired_at") or current.get("updated_at"))
    if old_time and new_time<=old_time:
        return None
    if name=="tfg_schedule.json":
        new_source=timestamp(incoming.get("source_updated_at"))
        old_source=timestamp(current.get("source_updated_at"))
        if old_source and (not new_source or new_source<old_source):
            return None
    if len(old_rows)>=4 and len(incoming["rows"])<max(2,len(old_rows)//2):
        return None
    ready=dict(incoming)
    if name=="sct.json":
        if incoming["rows"]==old_rows and current.get("data_changed_at"):
            ready["data_changed_at"]=current["data_changed_at"]
        elif incoming["rows"]!=old_rows:
            ready["data_changed_at"]=incoming["acquired_at"]
        ready["updated_at"]=incoming["acquired_at"]
    return ready


def apply_candidates(candidate_dir,working_dir=ROOT):
    candidate_dir=Path(candidate_dir)
    working_dir=Path(working_dir)
    changed=[]
    for name in SNAPSHOTS:
        incoming_path=candidate_dir/"data"/name
        current_path=working_dir/"data"/name
        if not incoming_path.is_file():
            continue
        try:
            incoming=json.loads(incoming_path.read_text(encoding="utf-8"))
            current=json.loads(current_path.read_text(encoding="utf-8")) if current_path.is_file() else {}
        except (OSError,ValueError):
            print("Invalid snapshot, leaving remote data unchanged:",name,flush=True)
            continue
        newer=accept_newer(name,incoming,current)
        if newer is None:
            print("Keeping more recent or safer remote snapshot:",name,flush=True)
            continue
        if newer==current:
            continue
        current_path.parent.mkdir(parents=True,exist_ok=True)
        current_path.write_text(json.dumps(newer,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        changed.append(name)
        print("Applying newly acquired snapshot:",name,flush=True)
    return changed


if __name__=="__main__":
    if len(sys.argv)!=2:
        raise SystemExit("Usage: python -m scripts.publish_snapshots CANDIDATE_DIRECTORY")
    print("Updated:",", ".join(apply_candidates(sys.argv[1])) or "none")
