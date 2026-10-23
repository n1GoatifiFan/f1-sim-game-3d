/* F1 2026 — data/circuits/miami.js
   APPROXIMATE · 5.413 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['miami'] = {
    "id": "miami",
    "cw": true,
    "length": 5412,
    "width": 13,
    "segs": [
      [
        "s",
        600
      ],
      [
        "r",
        90,
        40
      ],
      [
        "l",
        80,
        45
      ],
      [
        "s",
        160
      ],
      [
        "r",
        55,
        90
      ],
      [
        "s",
        140
      ],
      [
        "l",
        60,
        80
      ],
      [
        "r",
        45,
        110
      ],
      [
        "s",
        180
      ],
      [
        "l",
        40,
        90
      ],
      [
        "s",
        150
      ],
      [
        "r",
        85,
        45
      ],
      [
        "s",
        120
      ],
      [
        "l",
        75,
        55
      ],
      [
        "r",
        50,
        100
      ],
      [
        "s",
        200
      ],
      [
        "l",
        45,
        120
      ],
      [
        "s",
        160
      ],
      [
        "r",
        95,
        38
      ],
      [
        "s",
        140
      ],
      [
        "l",
        60,
        85
      ],
      [
        "r",
        40,
        130
      ],
      [
        "s",
        260
      ],
      [
        "r",
        110,
        45
      ],
      [
        "s",
        300
      ]
    ],
    "elevation": [
      [
        0,
        2
      ],
      [
        0.3,
        4
      ],
      [
        0.6,
        2.5
      ],
      [
        1,
        2
      ]
    ],
    "drs": [
      [
        0.02,
        0.09
      ],
      [
        0.46,
        0.54
      ],
      [
        0.83,
        0.9
      ]
    ],
    "sectors": [
      0.32,
      0.65
    ],
    "pit": {
      "entry": 0.95,
      "exit": 0.05,
      "offset": 11
    },
    "accuracy": "APPROX"
  };
})(window.F1 = window.F1 || {});
