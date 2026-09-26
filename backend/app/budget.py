"""Upgrade catalog, effects, and enumeration (Person B: budget/upgrade side).

Prices and effect parameters live in config/upgrades.json — they are
declared demo assumptions, not measured or real-world figures.
"""

from __future__ import annotations

import json
from itertools import product
from pathlib import Path

from app.schemas import (
    BudgetDefaults,
    UpgradeCatalog,
    UpgradeConfig,
    UpgradeOption,
    UpgradeSpec,
)

CATALOG_PATH = Path(__file__).resolve().parents[2] / "config" / "upgrades.json"

UPGRADE_IDS = ("brake_servicing", "comms_improvement", "local_fallback")


def load_catalog_specs(path: Path = CATALOG_PATH) -> tuple[BudgetDefaults, dict[str, UpgradeSpec]]:
    data = json.loads(path.read_text())
    defaults = BudgetDefaults.model_validate(data["budget_defaults"])
    specs = {u["id"]: UpgradeSpec.model_validate(u) for u in data["upgrades"]}
    missing = set(UPGRADE_IDS) - set(specs)
    if missing:
        raise ValueError(f"upgrade catalog is missing {sorted(missing)}")
    return defaults, specs


BUDGET_DEFAULTS, SPECS = load_catalog_specs()


def selected_ids(config: UpgradeConfig) -> list[str]:
    return [uid for uid in UPGRADE_IDS if getattr(config, uid)]


def config_key(config: UpgradeConfig) -> str:
    ids = selected_ids(config)
    return "+".join(ids) if ids else "baseline"


def config_label(config: UpgradeConfig) -> str:
    ids = selected_ids(config)
    return " + ".join(SPECS[i].name for i in ids) if ids else "Baseline (no upgrades)"


def config_cost(config: UpgradeConfig) -> int:
    return sum(SPECS[i].price_cad for i in selected_ids(config))


def enumerate_configs() -> list[UpgradeOption]:
    """All 2^3 combinations, cheapest-first (ties by canonical order)."""
    options = []
    for flags in product([False, True], repeat=len(UPGRADE_IDS)):
        config = UpgradeConfig(**dict(zip(UPGRADE_IDS, flags)))
        options.append(
            UpgradeOption(
                key=config_key(config),
                label=config_label(config),
                upgrades=config,
                cost_cad=config_cost(config),
            )
        )
    return sorted(options, key=lambda o: (o.cost_cad, len(selected_ids(o.upgrades))))


def catalog() -> UpgradeCatalog:
    return UpgradeCatalog(
        budget_defaults=BUDGET_DEFAULTS,
        upgrades=list(SPECS[i] for i in UPGRADE_IDS),
        configs=enumerate_configs(),
    )


# --- effects applied by the simulator ------------------------------------


def persistent_brake_wear(config: UpgradeConfig) -> float:
    params = SPECS["brake_servicing"].params
    return params["wear_after"] if config.brake_servicing else params["wear_before"]


def warning_delay_scale(config: UpgradeConfig) -> float:
    return SPECS["comms_improvement"].params["delay_scale"] if config.comms_improvement else 1.0


def local_fallback_age_ms(config: UpgradeConfig) -> float | None:
    return SPECS["local_fallback"].params["fallback_age_ms"] if config.local_fallback else None


# --- budget math ----------------------------------------------------------


def available_upgrade_money(cash: float, commitments: float, reserve: float) -> float:
    return cash - commitments - reserve
