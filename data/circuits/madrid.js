/* F1 2026 — data/circuits/madrid.js
   APPROXIMATE · 5.472 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['madrid'] = {
    "id": "madrid",
    "cw": true,
    "length": 5474,
    "width": 12,
    "segs": [
      [
        "s",
        620
      ],
      [
        "r",
        88,
        45
      ],
      [
        "l",
        70,
        55
      ],
      [
        "s",
        140
      ],
      [
        "r",
        60,
        90
      ],
      [
        "l",
        50,
        110
      ],
      [
        "s",
        180
      ],
      [
        "r",
        92,
        40
      ],
      [
        "s",
        120
      ],
      [
        "l",
        64,
        80
      ],
      [
        "r",
        45,
        130
      ],
      [
        "s",
        160
      ],
      [
        "l",
        80,
        60
      ],
      [
        "r",
        55,
        100
      ],
      [
        "s",
        140
      ],
      [
        "l",
        90,
        45
      ],
      [
        "s",
        200
      ],
      [
        "r",
        75,
        70
      ],
      [
        "l",
        65,
        95
      ],
      [
        "s",
        180
      ],
      [
        "r",
        95,
        42
      ],
      [
        "l",
        85,
        60
      ],
      [
        "s",
        220
      ],
      [
        "r",
        46,
        150
      ],
      [
        "l",
        40,
        170
      ],
      [
        "s",
        260
      ],
      [
        "r",
        140,
        55
      ],
      [
        "s",
        200
      ]
    ],
    "elevation": [
      [
        0,
        6
      ],
      [
        0.2,
        10
      ],
      [
        0.4,
        7
      ],
      [
        0.6,
        11
      ],
      [
        0.8,
        8
      ],
      [
        1,
        6
      ]
    ],
    "banking": [
      [
        0.88,
        0.94,
        12
      ]
    ],
    "drs": [
      [
        0.02,
        0.09
      ],
      [
        0.44,
        0.52
      ],
      [
        0.8,
        0.87
      ]
    ],
    "sectors": [
      0.33,
      0.66
    ],
    "pit": {
      "entry": 0.95,
      "exit": 0.05,
      "offset": 11
    },
    "accuracy": "APPROX"
  };
})(window.F1 = window.F1 || {});
