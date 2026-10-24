/* F1 2026 — data/circuits/singapore.js
   APPROXIMATE · 4.937 km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['singapore'] = {
    "id": "singapore",
    "cw": false,
    "length": 4940,
    "width": 11,
    "segs": [
      [
        "s",
        400
      ],
      [
        "l",
        90,
        30
      ],
      [
        "r",
        60,
        70
      ],
      [
        "s",
        160
      ],
      [
        "l",
        85,
        32
      ],
      [
        "s",
        140
      ],
      [
        "r",
        70,
        60
      ],
      [
        "l",
        55,
        85
      ],
      [
        "s",
        180
      ],
      [
        "l",
        90,
        28
      ],
      [
        "s",
        220
      ],
      [
        "r",
        85,
        40
      ],
      [
        "l",
        75,
        55
      ],
      [
        "s",
        300
      ],
      [
        "l",
        90,
        30
      ],
      [
        "s",
        200
      ],
      [
        "l",
        60,
        80
      ],
      [
        "r",
        55,
        90
      ],
      [
        "s",
        240
      ],
      [
        "l",
        90,
        32
      ],
      [
        "s",
        160
      ],
      [
        "r",
        70,
        65
      ],
      [
        "s",
        250
      ],
      [
        "l",
        85,
        35
      ],
      [
        "s",
        200
      ]
    ],
    "elevation": [
      [
        0,
        2
      ],
      [
        0.5,
        3
      ],
      [
        1,
        2
      ]
    ],
    "drs": [
      [
        0.02,
        0.07
      ],
      [
        0.46,
        0.53
      ],
      [
        0.84,
        0.9
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
    "accuracy": "APPROX"
  };
})(window.F1 = window.F1 || {});
