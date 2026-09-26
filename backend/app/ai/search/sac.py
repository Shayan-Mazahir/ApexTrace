"""Soft Actor-Critic adversary over scenario parameters.

Each "episode" is one step: the state is the track (one-hot), the action is a
point in the scenario space (tanh-squashed Gaussian, mapped into the shared
bounds, so it can never produce an out-of-range scenario), and the reward is
the simulator-based score from ``app.ai.reward`` plus a novelty bonus for
failures unlike ones already found. With one-step episodes the critic target
is simply the reward (no bootstrapping), which keeps training stable and
cheap: SAC here is an entropy-regularised policy search, not a driving agent.

The agent searches the simulator. Nothing it finds is a real-world crash
probability.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
import torch
from torch import nn

from app.ai.reward import scenario_reward
from app.ai.search.base import ScenarioSearchStrategy
from app.schemas import Scenario, SimulationResult
from app.sim.scenario_space import DIM, TRACKS, ScenarioSpace

STATE_DIM = len(TRACKS)
LOG_STD_MIN, LOG_STD_MAX = -5.0, 1.0
DEFAULT_SAC_DIR = Path(__file__).resolve().parents[3] / "models" / "sac"


@dataclass
class SACConfig:
    hidden: int = 128
    lr: float = 3e-4
    batch_size: int = 128
    warmup_steps: int = 256
    total_steps: int = 2048
    steps_per_iter: int = 32
    updates_per_iter: int = 64
    init_alpha: float = 0.05
    # Per-dimension target entropy. Higher keeps the policy broader (more diverse failures).
    target_entropy_per_dim: float = 0.5
    alpha_lr: float = 1e-3
    novelty_weight: float = 0.3
    novelty_radius: float = 0.35
    seed: int = 0


def _mlp(i: int, o: int, h: int) -> nn.Sequential:
    return nn.Sequential(nn.Linear(i, h), nn.ReLU(), nn.Linear(h, h), nn.ReLU(), nn.Linear(h, o))


class Actor(nn.Module):
    def __init__(self, hidden: int):
        super().__init__()
        self.net = _mlp(STATE_DIM, 2 * DIM, hidden)

    def forward(self, s: torch.Tensor, deterministic: bool = False) -> tuple[torch.Tensor, torch.Tensor]:
        mu, log_std = self.net(s).chunk(2, dim=-1)
        std = log_std.clamp(LOG_STD_MIN, LOG_STD_MAX).exp()
        dist = torch.distributions.Normal(mu, std)
        z = mu if deterministic else dist.rsample()
        a = torch.tanh(z)
        # log-prob with tanh change of variables
        logp = (dist.log_prob(z) - torch.log(1 - a.pow(2) + 1e-6)).sum(-1)
        return a, logp


class Critic(nn.Module):
    def __init__(self, hidden: int):
        super().__init__()
        self.q1 = _mlp(STATE_DIM + DIM, 1, hidden)
        self.q2 = _mlp(STATE_DIM + DIM, 1, hidden)

    def forward(self, s: torch.Tensor, a: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = torch.cat([s, a], dim=-1)
        return self.q1(x).squeeze(-1), self.q2(x).squeeze(-1)


def track_state(track: str) -> np.ndarray:
    return np.array([float(track == t) for t in TRACKS], dtype=np.float32)


def action_to_unit(a: np.ndarray) -> np.ndarray:
    return (np.asarray(a) + 1.0) / 2.0


class SACAgent:
    def __init__(self, cfg: SACConfig | None = None):
        self.cfg = cfg or SACConfig()
        torch.manual_seed(self.cfg.seed)
        self.actor = Actor(self.cfg.hidden)
        self.critic = Critic(self.cfg.hidden)
        self.log_alpha = torch.full((1,), float(np.log(self.cfg.init_alpha)), requires_grad=True)
        self.target_entropy = self.cfg.target_entropy_per_dim * DIM
        self.opt_actor = torch.optim.Adam(self.actor.parameters(), lr=self.cfg.lr)
        self.opt_critic = torch.optim.Adam(self.critic.parameters(), lr=self.cfg.lr)
        self.opt_alpha = torch.optim.Adam([self.log_alpha], lr=self.cfg.alpha_lr)

    def act(self, states: np.ndarray, deterministic: bool = False) -> np.ndarray:
        with torch.no_grad():
            a, _ = self.actor(torch.from_numpy(np.asarray(states, dtype=np.float32)), deterministic)
        return a.numpy()

    def update(self, s: np.ndarray, a: np.ndarray, r: np.ndarray) -> dict:
        st, at, rt = (torch.from_numpy(np.asarray(v, dtype=np.float32)) for v in (s, a, r))
        q1, q2 = self.critic(st, at)
        critic_loss = ((q1 - rt) ** 2).mean() + ((q2 - rt) ** 2).mean()  # one-step: target = reward
        self.opt_critic.zero_grad()
        critic_loss.backward()
        self.opt_critic.step()

        alpha = self.log_alpha.exp().detach()
        new_a, logp = self.actor(st)
        q_new = torch.min(*self.critic(st, new_a))
        actor_loss = (alpha * logp - q_new).mean()
        self.opt_actor.zero_grad()
        actor_loss.backward()
        self.opt_actor.step()

        alpha_loss = -(self.log_alpha * (logp.detach() + self.target_entropy)).mean()
        self.opt_alpha.zero_grad()
        alpha_loss.backward()
        self.opt_alpha.step()
        return {"critic_loss": float(critic_loss), "actor_loss": float(actor_loss), "alpha": float(alpha)}

    def save(self, out_dir: str | Path, meta: dict) -> Path:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        torch.save({"actor": self.actor.state_dict(), "critic": self.critic.state_dict(),
                    "log_alpha": self.log_alpha.detach()}, out / "sac.pt")
        (out / "config.json").write_text(json.dumps(asdict(self.cfg), indent=2))
        (out / "training_metadata.json").write_text(json.dumps(meta, indent=2, default=float))
        return out

    @classmethod
    def load(cls, model_dir: str | Path = DEFAULT_SAC_DIR) -> "SACAgent":
        d = Path(model_dir)
        agent = cls(SACConfig(**json.loads((d / "config.json").read_text())))
        state = torch.load(d / "sac.pt", weights_only=True)
        agent.actor.load_state_dict(state["actor"])
        agent.critic.load_state_dict(state["critic"])
        agent.log_alpha.data.copy_(state["log_alpha"])
        return agent


def sac_available(model_dir: str | Path = DEFAULT_SAC_DIR) -> bool:
    return (Path(model_dir) / "sac.pt").exists()


class _Novelty:
    """Bonus for failures far (in normalised parameter space) from earlier failures."""

    def __init__(self, radius: float):
        self.radius = radius
        self.archive: list[np.ndarray] = []

    def bonus(self, unit: np.ndarray, failed: bool) -> float:
        if not failed:
            return 0.0
        if not self.archive:
            b = 1.0
        else:
            d = float(np.min(np.linalg.norm(np.asarray(self.archive) - unit, axis=1)) / np.sqrt(len(unit)))
            b = min(1.0, d / self.radius)
        self.archive.append(unit)
        return b


def train_sac(
    simulate: Callable[[list[Scenario]], list[SimulationResult]],
    cfg: SACConfig | None = None,
    space: ScenarioSpace | None = None,
    log=print,
) -> tuple[SACAgent, dict]:
    """Train against the real simulator. ``simulate`` runs a batch (e.g. run_batch with a process pool)."""
    cfg = cfg or SACConfig()
    space = space or ScenarioSpace()
    rng = np.random.default_rng(cfg.seed)
    agent = SACAgent(cfg)
    novelty = _Novelty(cfg.novelty_radius)
    S, A, R = [], [], []
    history = []
    step = 0
    t0 = time.perf_counter()
    while step < cfg.total_steps:
        n = min(cfg.steps_per_iter, cfg.total_steps - step)
        tracks = [space.tracks[int(i)] for i in rng.integers(len(space.tracks), size=n)]
        states = np.stack([track_state(t) for t in tracks])
        if step < cfg.warmup_steps:
            actions = rng.uniform(-1, 1, size=(n, DIM)).astype(np.float32)
        else:
            actions = agent.act(states)
        scenarios = [
            space.to_scenario(t, action_to_unit(a), f"sac-train-{step + i:05d}", int(rng.integers(0, 2**31 - 1)))
            for i, (t, a) in enumerate(zip(tracks, actions))
        ]
        results = simulate(scenarios)
        for s_, a_, sc, r in zip(states, actions, scenarios, results):
            unit = space.to_unit(sc)
            reward = scenario_reward(r) + cfg.novelty_weight * novelty.bonus(unit, r.failed)
            S.append(s_), A.append(a_), R.append(reward)
        step += n
        stats = {}
        if step >= cfg.warmup_steps:
            for _ in range(cfg.updates_per_iter):
                b = rng.integers(len(R), size=min(cfg.batch_size, len(R)))
                stats = agent.update(np.asarray(S)[b], np.asarray(A)[b], np.asarray(R)[b])
        fail_rate = float(np.mean([r.failed for r in results]))
        history.append({"step": step, "batch_failure_rate": fail_rate, "mean_reward": float(np.mean(R[-n:])), **stats})
        log(f"step {step:5d}  batch failures {fail_rate:.2f}  mean reward {np.mean(R[-n:]):+.3f}  "
            f"alpha {stats.get('alpha', float('nan')):.3f}")
    meta = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "train_seconds": round(time.perf_counter() - t0, 1),
        "simulations_used": step,
        "failures_during_training": len(novelty.archive),
        "history": history,
    }
    return agent, meta


class SACSearch(ScenarioSearchStrategy):
    """Samples scenarios from a trained SAC policy (stochastic, so proposals stay diverse)."""

    name = "sac"

    def __init__(self, agent: SACAgent, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.agent = agent
        self.rng = np.random.default_rng(self.seed)
        torch.manual_seed(self.seed)

    @classmethod
    def from_disk(cls, model_dir: str | Path = DEFAULT_SAC_DIR, **kwargs) -> "SACSearch":
        return cls(SACAgent.load(model_dir), **kwargs)

    def propose(self, n: int) -> list[Scenario]:
        tracks = [self.space.tracks[int(i)] for i in self.rng.integers(len(self.space.tracks), size=n)]
        actions = self.agent.act(np.stack([track_state(t) for t in tracks]))
        return [
            self.space.to_scenario(t, action_to_unit(a), self._next_id(), int(self.rng.integers(0, 2**31 - 1)))
            for t, a in zip(tracks, actions)
        ]

    def observe(self, scenarios: Sequence[Scenario], results: Sequence[SimulationResult]) -> None:
        """The deployed policy is fixed; online fine-tuning is deliberately not done during evaluation."""
