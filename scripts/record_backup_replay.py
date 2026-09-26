"""Records a real baseline-vs-upgraded replay to frontend/public/backup-replay.json.

The demo falls back to this file if the backend is unreachable. It is a
recording of the same simulator and scripted driver the live app uses, not
hand-made data. Re-run it after changing the simulator or the suite:

    cd backend && venv/bin/python ../scripts/record_backup_replay.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.ml import risk  # noqa: E402
from app.placeholder_sim import TRACK_PRESETS  # noqa: E402
from app.schemas import UpgradeConfig  # noqa: E402
from app.stress import evaluation as ev  # noqa: E402


def main() -> None:
    evaluation = ev.evaluate_all("heldout", use_cache=False, parallel=True)
    configs = evaluation["groups"]["telemetry"]["configs"]
    by_key = {c["key"]: c for c in configs}
    baseline = by_key["baseline"]
    passing = [c for c in sorted(configs, key=lambda c: c["cost_cad"]) if c["passed"] and c["key"] != "baseline"]
    upgraded = passing[0] if passing else by_key["local_fallback"]

    upgraded_by_id = {t["test_id"]: t for t in upgraded["tests"]}
    fixed = [t for t in baseline["tests"] if not t["passed"] and upgraded_by_id[t["test_id"]]["passed"]]
    failed = [t for t in baseline["tests"] if not t["passed"]]
    pool = fixed or failed or baseline["tests"]
    chosen = min(pool, key=lambda t: t["min_clearance_m"])

    payload = ev.replay(chosen["test_id"], UpgradeConfig(), UpgradeConfig.model_validate(upgraded["upgrades"]))
    risk.annotate_replay(payload)
    # Embed the track so the replay renders with no backend at all.
    payload["track_profile"] = TRACK_PRESETS[payload["test"]["track"]].model_dump()
    out = ROOT / "frontend" / "public" / "backup-replay.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {out.relative_to(ROOT)}: {chosen['test_id']}, baseline passed={payload['baseline']['result']['passed']}, "
          f"{upgraded['label']} passed={payload['upgraded']['result']['passed']}, "
          f"{len(payload['baseline']['frames'])}+{len(payload['upgraded']['frames'])} frames, "
          f"{out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
