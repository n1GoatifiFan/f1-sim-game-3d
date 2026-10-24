/* F1 2026 — data/circuits/monaco.js
   APPROXIMATE · 3.334 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['monaco'] = {
    "id": "monaco",
    "cw": true,
    "length": 3337,
    "width": 10,
    "segs": [
      [
        "s",
        480
      ],
      [
        "l",
        100,
        18
      ],
      [
        "s",
        200
      ],
      [
        "l",
        48,
        70
      ],
      [
        "s",
        70
      ],
      [
        "r",
        62,
        42
      ],
      [
        "s",
        110
      ],
      [
        "r",
        52,
        78
      ],
      [
        "l",
        180,
        7.5
      ],
      [
        "s",
        60
      ],
      [
        "r",
        92,
        18
      ],
      [
        "s",
        190
      ],
      [
        "l",
        28,
        210
      ],
      [
        "s",
        70
      ],
      [
        "k",
        62,
        24,
        58,
        20
      ],
      [
        "s",
        110
      ],
      [
        "r",
        95,
        24
      ],
      [
        "s",
        240
      ],
      [
        "l",
        48,
        68
      ],
      [
        "r",
        42,
        78
      ],
      [
        "s",
        70
      ],
      [
        "r",
        96,
        32
      ],
      [
        "l",
        62,
        68
      ],
      [
        "s",
        110
      ]
    ],
    "elevation": [
      [
        0,
        12
      ],
      [
        0.08,
        20
      ],
      [
        0.16,
        34
      ],
      [
        0.24,
        44
      ],
      [
        0.32,
        38
      ],
      [
        0.42,
        18
      ],
      [
        0.5,
        8
      ],
      [
        0.58,
        6
      ],
      [
        0.66,
        5
      ],
      [
        0.74,
        4
      ],
      [
        0.84,
        8
      ],
      [
        0.92,
        10
      ],
      [
        1,
        12
      ]
    ],
    "drs": [
      [
        0.93,
        0.995
      ]
    ],
    "sectors": [
      0.33,
      0.66
    ],
    "pit": {
      "entry": 0.93,
      "exit": 0.03,
      "offset": 8
    },
    "accuracy": "APPROX"
  };
})(window.F1 = window.F1 || {});
