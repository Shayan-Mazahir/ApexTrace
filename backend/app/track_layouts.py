"""
Real circuit shapes, traced by hand from reference track maps, in driving
order starting at the start/finish line. Coordinates are map pixels
(x right, y down); the builder scales them so the lap length matches the
real circuit, smooths them with a closed Catmull-Rom spline and resamples.

`corner` marks where a named corner is; hazard zones are detected from the
smoothed curvature and named after the nearest marked corner. `narrow`
marks the start/end of a narrow section (Baku's old-town castle section).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Waypoint:
    x: float
    y: float
    corner: str | None = None
    narrow: bool = False


@dataclass(frozen=True)
class Layout:
    track_id: str
    name: str
    length_m: float
    width_m: float
    narrow_width_m: float
    waypoints: tuple[Waypoint, ...]


W = Waypoint

# Baku City Circuit — 6.003 km, anticlockwise. Reference: official-style map
# with turns 1-20; start/finish on the long straight heading north-east.
BAKU = Layout(
    track_id="baku",
    name="Baku City Circuit",
    length_m=6003,
    width_m=12,
    narrow_width_m=7.6,
    waypoints=(
        W(1700, 441),
        W(1860, 370),
        W(1916, 338, "Turn 1"),
        W(1897, 270),
        W(1845, 135),
        W(1806, 58, "Turn 2"),
        W(1730, 88),
        W(1500, 182),
        W(1250, 290),
        W(1068, 362, "Turn 3"),
        W(1092, 460),
        W(1134, 566, "Turn 4"),
        W(1040, 604),
        W(960, 640),
        W(880, 684, "Turn 5"),
        W(866, 712),
        W(876, 742, "Turn 6"),
        W(830, 782),
        W(720, 862),
        W(640, 926),
        W(588, 968, "Turn 7"),
        W(570, 915),
        W(548, 855),
        W(522, 800, "Turn 8", narrow=True),
        W(495, 790, "Turn 9", narrow=True),
        W(466, 790, "Turn 10", narrow=True),
        W(438, 790, "Turn 11", narrow=True),
        W(422, 766, narrow=True),
        W(410, 732, "Turn 12", narrow=True),
        W(360, 745),
        W(260, 788),
        W(170, 836),
        W(86, 882, "Turn 13"),
        W(46, 980),
        W(20, 1075, "Turn 14"),
        W(24, 1190),
        W(32, 1292, "Turn 15"),
        W(130, 1345),
        W(240, 1392),
        W(318, 1428, "Turn 16"),
        W(362, 1358),
        W(426, 1275, "Turn 17"),
        W(500, 1202),
        W(580, 1130, "Turn 18"),
        W(598, 1062),
        W(612, 996, "Turn 19"),
        W(680, 938),
        W(800, 846),
        W(905, 772, "Turn 20"),
        W(1060, 700),
        W(1250, 626),
        W(1450, 546),
    ),
)

# Autodromo Nazionale Monza — 5.793 km, clockwise. Reference: map with
# sectors and turns 01-11; start/finish on the main straight heading west.
MONZA = Layout(
    track_id="monza",
    name="Autodromo Nazionale Monza",
    length_m=5793,
    width_m=14,
    narrow_width_m=14,
    waypoints=(
        W(1490, 842),
        W(1250, 842),
        W(1000, 841),
        W(830, 839),
        W(790, 836, "Rettifilo (T1)"),
        W(776, 812, "Rettifilo (T2)"),
        W(745, 812),
        W(680, 832),
        W(600, 848),
        W(510, 842),
        W(430, 812, "Curva Grande (T3)"),
        W(372, 738),
        W(345, 640),
        W(326, 520),
        W(312, 412),
        W(306, 372, "Roggia (T4)"),
        W(282, 358, "Roggia (T5)"),
        W(270, 330),
        W(252, 285),
        W(220, 205),
        W(203, 148, "Lesmo 1 (T6)"),
        W(222, 100),
        W(275, 80),
        W(350, 67),
        W(405, 60, "Lesmo 2 (T7)"),
        W(440, 88),
        W(520, 205),
        W(580, 292),
        W(700, 408),
        W(840, 548),
        W(900, 612, "Ascari (T8)"),
        W(945, 603, "Ascari (T9)"),
        W(985, 618),
        W(1015, 652, "Ascari (T10)"),
        W(1100, 664),
        W(1400, 668),
        W(1660, 672),
        W(1718, 686, "Parabolica (T11)"),
        W(1745, 728),
        W(1728, 772),
        W(1672, 806),
        W(1590, 828),
    ),
)

LAYOUTS = {"baku": BAKU, "monza": MONZA}
