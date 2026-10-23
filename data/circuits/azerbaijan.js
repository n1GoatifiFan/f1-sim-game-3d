/* F1 2026 — data/circuits/azerbaijan.js
   APPROXIMATE · 6.001 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['azerbaijan'] = {
    "id": "azerbaijan",
    "cw": false,
    "length": 6003,
    "width": 11,
    "segs": [
      [
        "s",
        600
      ],
      [
        "l",
        85,
        35
      ],
      [
        "s",
        120
      ],
      [
        "l",
        90,
        28
      ],
      [
        "s",
        180
      ],
      [
        "r",
        75,
        60
      ],
      [
        "s",
        140
      ],
      [
        "l",
        55,
        90
      ],
      [
        "s",
        200
      ],
      [
        "r",
        90,
        30
      ],
      [
        "s",
        160
      ],
      [
        "l",
        80,
        45
      ],
      [
        "s",
        300
      ],
      [
        "r",
        95,
        25
      ],
      [
        "l",
        85,
        30
      ],
      [
        "s",
        500
      ],
      [
        "r",
        60,
        110
      ],
      [
        "l",
        70,
        80
      ],
      [
        "s",
        1400
      ],
      [
        "l",
        90,
        30
      ],
      [
        "s",
        250
      ],
      [
        "r",
        85,
        35
      ],
      [
        "l",
        90,
        28
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
        5
      ],
      [
        0.45,
        3
      ],
      [
        0.6,
        6
      ],
      [
        1,
        2
      ]
    ],
    "drs": [
      [
        0.02,
        0.06
      ],
      [
        0.62,
        0.7
      ],
      [
        0.86,
        0.93
      ]
    ],
    "sectors": [
      0.33,
      0.66
    ],
    "pit": {
      "entry": 0.95,
      "exit": 0.05,
      "offset": 10
    },
    "accuracy": "ACCURATE"
  };
})(window.F1 = window.F1 || {});
