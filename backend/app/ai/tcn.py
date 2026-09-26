"""Temporal Convolutional Network for simulator-failure forecasting.

Stack of dilated causal 1D convolutions with residual connections (Bai et al.,
2018). The receptive field covers the whole prefix window; the logit is read
from the final time step, so the prediction only uses information up to the
end of the observed telemetry.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import torch
from torch import nn


@dataclass(frozen=True)
class TCNConfig:
    in_channels: int
    hidden: int = 32
    levels: int = 4
    kernel_size: int = 3
    dropout: float = 0.15

    def to_dict(self) -> dict:
        return asdict(self)


class CausalConv1d(nn.Conv1d):
    def __init__(self, cin: int, cout: int, kernel_size: int, dilation: int):
        super().__init__(cin, cout, kernel_size, dilation=dilation)
        self.left_pad = (kernel_size - 1) * dilation

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return super().forward(nn.functional.pad(x, (self.left_pad, 0)))


class TemporalBlock(nn.Module):
    def __init__(self, cin: int, cout: int, kernel_size: int, dilation: int, dropout: float):
        super().__init__()
        self.net = nn.Sequential(
            CausalConv1d(cin, cout, kernel_size, dilation),
            nn.ReLU(),
            nn.Dropout(dropout),
            CausalConv1d(cout, cout, kernel_size, dilation),
            nn.ReLU(),
            nn.Dropout(dropout),
        )
        self.skip = nn.Conv1d(cin, cout, 1) if cin != cout else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.relu(self.net(x) + self.skip(x))


class TCN(nn.Module):
    """Input (batch, time, channels) -> failure logit (batch,)."""

    def __init__(self, cfg: TCNConfig):
        super().__init__()
        self.cfg = cfg
        blocks, cin = [], cfg.in_channels
        for i in range(cfg.levels):
            blocks.append(TemporalBlock(cin, cfg.hidden, cfg.kernel_size, 2**i, cfg.dropout))
            cin = cfg.hidden
        self.blocks = nn.Sequential(*blocks)
        self.head = nn.Linear(cfg.hidden, 1)

    @property
    def receptive_field(self) -> int:
        return 1 + 2 * (self.cfg.kernel_size - 1) * (2**self.cfg.levels - 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.blocks(x.transpose(1, 2))  # (B, C, T)
        return self.head(h[:, :, -1]).squeeze(-1)
