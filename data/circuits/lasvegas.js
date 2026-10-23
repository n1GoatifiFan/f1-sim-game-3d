/* F1 2026 — data/circuits/lasvegas.js
   APPROXIMATE · 6.194 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['lasvegas'] = {
    "id": "lasvegas",
    "cw": false,
    "length": 6201,
    "width": 12,
    "segs": [
      [
        "s",
        500
      ],
      [
        "l",
        90,
        30
      ],
      [
        "l",
        88,
        32
      ],
      [
        "s",
        420
      ],
      [
        "r",
        90,
        28
      ],
      [
        "s",
        700
      ],
      [
        "r",
        88,
        30
      ],
      [
        "l",
        90,
        26
      ],
      [
        "s",
        480
      ],
      [
        "r",
        90,
        28
      ],
      [
        "l",
        88,
        24
      ],
      [
        "s",
        320
      ],
      [
        "r",
        92,
        30
      ],
      [
        "s",
        560
      ],
      [
        "r",
        88,
        26
      ],
      [
        "r",
        90,
        32
      ],
      [
        "l",
        88,
        28
      ],
      [
        "s",
        1500
      ],
      [
        "r",
        90,
        30
      ],
      [
        "s",
        260
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
        4
      ],
      [
        0.4,
        6
      ],
      [
        0.7,
        4
      ],
      [
        1,
        4
      ]
    ],
    "drs": [
      [
        0.06,
        0.14
      ],
      [
        0.52,
        0.6
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
