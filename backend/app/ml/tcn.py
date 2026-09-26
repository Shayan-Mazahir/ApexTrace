"""Causal residual TCN: 4 blocks x 32 channels, kernel 3, dilations 1/2/4/8.
Receptive field at the last step = 1 + 2*(3-1)*(1+2+4+8) = 61 samples, which
covers the 50-sample window. Left padding + trimming means no step ever sees
the future. Two heads read the final step: exit logit, future min clearance."""

from __future__ import annotations

import torch
from torch import nn

DILATIONS = (1, 2, 4, 8)
KERNEL = 3
CHANNELS = 32


class CausalConv(nn.Module):
    def __init__(self, c_in: int, c_out: int, dilation: int) -> None:
        super().__init__()
        self.pad = (KERNEL - 1) * dilation
        self.conv = nn.Conv1d(c_in, c_out, KERNEL, dilation=dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(nn.functional.pad(x, (self.pad, 0)))  # pad the past only


class ResidualBlock(nn.Module):
    def __init__(self, c_in: int, c_out: int, dilation: int, dropout: float) -> None:
        super().__init__()
        self.net = nn.Sequential(
            CausalConv(c_in, c_out, dilation), nn.ReLU(), nn.Dropout(dropout),
            CausalConv(c_out, c_out, dilation), nn.ReLU(), nn.Dropout(dropout),
        )
        self.skip = nn.Conv1d(c_in, c_out, 1) if c_in != c_out else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.relu(self.net(x) + self.skip(x))


class RiskTCN(nn.Module):
    def __init__(self, n_inputs: int, dropout: float = 0.1) -> None:
        super().__init__()
        blocks, c = [], n_inputs
        for d in DILATIONS:
            blocks.append(ResidualBlock(c, CHANNELS, d, dropout))
            c = CHANNELS
        self.tcn = nn.Sequential(*blocks)
        self.exit_head = nn.Linear(CHANNELS, 1)
        self.clearance_head = nn.Linear(CHANNELS, 1)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """x: (batch, time, channels) -> (exit_logit, clearance_standardized)."""
        h = self.tcn(x.transpose(1, 2))[:, :, -1]
        return self.exit_head(h).squeeze(-1), self.clearance_head(h).squeeze(-1)


def receptive_field() -> int:
    return 1 + 2 * (KERNEL - 1) * sum(DILATIONS)
