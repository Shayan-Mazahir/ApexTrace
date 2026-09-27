"""Guard against drift between backend/app/schemas.py and frontend/src/types/schemas.ts."""

import inspect
import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from app import schemas

TS_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "schemas.ts"


def ts_interfaces() -> dict[str, set[str]]:
    src = TS_FILE.read_text()
    out = {}
    for m in re.finditer(r"export interface (\w+) \{(.*?)\n\}", src, re.S):
        fields = set(re.findall(r"^\s+(\w+)\??:", m.group(2), re.M))
        out[m.group(1)] = fields
    return out


# Only the lap-simulator models (defined after the "Lap simulator" banner) are
# held to an exact interface-per-model mirror; the session models express
# their WebSocket messages as TS unions and are checked by the frontend tests.
_LAP_SECTION_START = next(
    i for i, line in enumerate(inspect.getsource(schemas).splitlines(), 1) if "# Lap simulator" in line
)
MODELS = {
    name: cls for name, cls in inspect.getmembers(schemas, inspect.isclass)
    if issubclass(cls, BaseModel) and cls.__module__ == schemas.__name__
    and inspect.getsourcelines(cls)[1] > _LAP_SECTION_START
}
# WebSocket message wrappers are expressed as a TS union type instead of interfaces.
TS_UNION_ONLY = {"LiveTrackMessage", "LiveStateMessage", "LiveResultMessage", "LiveErrorMessage"}


@pytest.mark.skipif(not TS_FILE.exists(), reason="frontend not present")
@pytest.mark.parametrize("name", sorted(set(MODELS) - TS_UNION_ONLY))
def test_every_model_is_mirrored(name):
    ts = ts_interfaces()
    assert name in ts, f"{name} missing from {TS_FILE.name}"
    assert ts[name] == set(MODELS[name].model_fields), name


def test_enums_match():
    src = TS_FILE.read_text()
    for enum, ts_name in ((schemas.WarningLevel, "WarningLevel"), (schemas.WarningSource, "WarningSource"),
                          (schemas.ConfigurationName, "ConfigurationName")):
        m = re.search(rf"export type {ts_name} =(.*?)\n(?=\S|\n)", src, re.S)
        assert set(re.findall(r"'(\w+)'", m.group(1))) == {e.value for e in enum}
