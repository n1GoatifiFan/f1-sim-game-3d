/* F1 2026 — data/circuits/qatar.js
   APPROXIMATE · 5.413 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['qatar'] = {
    "id": "qatar",
    "cw": true,
    "length": 5419,
    "width": 12,
    "segs": [
      [
        "s",
        600
      ],
      [
        "r",
        60,
        140
      ],
      [
        "s",
        180
      ],
      [
        "r",
        55,
        110
      ],
      [
        "l",
        40,
        150
      ],
      [
        "s",
        200
      ],
      [
        "r",
        45,
        160
      ],
      [
        "l",
        35,
        180
      ],
      [
        "s",
        240
      ],
      [
        "r",
        75,
        90
      ],
      [
        "s",
        160
      ],
      [
        "l",
        55,
        130
      ],
      [
        "r",
        65,
        100
      ],
      [
        "s",
        200
      ],
      [
        "l",
        40,
        170
      ],
      [
        "r",
        50,
        140
      ],
      [
        "s",
        260
      ],
      [
        "r",
        90,
        60
      ],
      [
        "s",
        220
      ],
      [
        "l",
        80,
        70
      ],
      [
        "s",
        240
      ]
    ],
    "elevation": [
      [
        0,
        3
      ],
      [
        0.3,
        4.5
      ],
      [
        0.7,
        3.5
      ],
      [
        1,
        3
      ]
    ],
    "drs": [
      [
        0.02,
        0.09
      ],
      [
        0.48,
        0.56
      ],
      [
        0.84,
        0.91
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
