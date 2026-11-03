"""Keep GitHub vessel updates from overwriting newer terminal snapshots."""
import json
import tempfile
import unittest
from pathlib import Path
from scripts.publish_snapshots import accept_newer,apply_candidates


def feed(t,rows,source=None):
    return {"acquired_at":t,"rows":rows,"source_updated_at":source,
            "updated_at":t,"data_changed_at":t}


class PublishSnapshotsTests(unittest.TestCase):
    def test_older_arrival_cannot_overwrite_newer_remote(self):
        remote=feed("2026-10-31T13:10:00+00:00",[{"vessel":"LATEST"}])
        incoming=feed("2026-10-31T13:09:00+00:00",[{"vessel":"OLD"}])
        self.assertIsNone(accept_newer("sct.json",incoming,remote))

    def test_remote_sct_change_timestamp_kept_for_same_rows(self):
        remote=feed("2026-10-31T13:10:00+00:00",[{"vessel":"SAME"}])
        remote["data_changed_at"]="2026-10-29T10:00:00+00:00"
        incoming=feed("2026-10-31T13:11:00+00:00",[{"vessel":"SAME"}])
        ready=accept_newer("sct.json",incoming,remote)
        self.assertEqual(ready["data_changed_at"],remote["data_changed_at"])

    def test_newer_sct_rows_mark_change_at_acquisition(self):
        remote=feed("2026-10-31T13:10:00+00:00",[{"vessel":"A"}])
        incoming=feed("2026-10-31T13:11:00+00:00",[{"vessel":"B"}])
        ready=accept_newer("sct.json",incoming,remote)
        self.assertEqual(ready["data_changed_at"],incoming["acquired_at"])

    def test_tfg_older_source_update_never_wins(self):
        remote=feed("2026-10-31T13:10:00+00:00",[{"vessel":"X"}],
                    "2026-10-31T14:00:00+01:00")
        incoming=feed("2026-10-31T13:11:00+00:00",[{"vessel":"Y"}],
                      "2026-10-31T13:30:00+01:00")
        self.assertIsNone(accept_newer("tfg_schedule.json",incoming,remote))

    def test_empty_and_damaged_snapshots_are_rejected(self):
        remote=feed("2026-10-31T13:10:00+00:00",[{"vessel":"A"}])
        self.assertIsNone(accept_newer("conateco.json",{"rows":[]},remote))
        self.assertIsNone(accept_newer("conateco.json",{"rows":[1]},remote))

    def test_apply_changes_only_allowed_data_path(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)
            candidate=p/"incoming"
            current=p/"site"
            (candidate/"data").mkdir(parents=True)
            (current/"data").mkdir(parents=True)
            old=feed("2026-10-31T13:10:00+00:00",[{"vessel":"A"}])
            new=feed("2026-10-31T13:15:00+00:00",[{"vessel":"B"}])
            (current/"data"/"conateco.json").write_text(json.dumps(old),encoding="utf-8")
            (candidate/"data"/"conateco.json").write_text(json.dumps(new),encoding="utf-8")
            changed=apply_candidates(candidate,current)
            self.assertEqual(changed,["conateco.json"])
            self.assertEqual(json.loads((current/"data"/"conateco.json").read_text())["rows"],new["rows"])


if __name__=="__main__":
    unittest.main()
