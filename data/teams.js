/* ==========================================================================
   F1 2026 — data/teams.js
   The 2026 grid: 11 teams / 22 drivers (new-era regulations).

   Every team has:
     id / name / short        identifiers shown in the UI
     powerUnit                engine supplier (2026: ~50/50 ICE + electric)
     principal, hq, country   team boss + factory location + HQ nation
     colors                   primary / secondary / accent / text (livery + UI)
     car                      car model tag used by the procedural car builder
     performance              aero / power / reliability / development seed values
                              (0-100, used by AI + career R&D; edit freely)

   HOW TO EDIT LINE-UPS: see the "2026 mid-season edits" block at the bottom
   of data/drivers.js. Driver <-> team links live in BOTH files only via the
   `driver.team` and `team.drivers` arrays — update both.

   NOTE ON TRADEMARKS: this is a personal, non-commercial project. Team and
   sponsor names are used as plain text; no logos or official artwork are
   embedded. Liveries are procedurally generated from the colours below.
   ========================================================================== */
(function (F1) {
  'use strict';

  var TEAMS = [
    {
      id: 'mclaren', name: 'McLaren Formula 1 Team', short: 'McLaren', code: 'MCL',
      powerUnit: 'Mercedes', puShort: 'MER',
      principal: 'Andrea Stella', hq: 'Woking', country: 'United Kingdom', countryCode: 'GB',
      colors: { primary: '#FF8000', secondary: '#1B1B1B', accent: '#47C7FC', text: '#FFFFFF' },
      car: 'mclaren',
      performance: { aero: 96, power: 93, chassis: 94, reliability: 90, development: 88 },
      tier: 1
    },
    {
      id: 'mercedes', name: 'Mercedes-AMG Petronas F1 Team', short: 'Mercedes', code: 'MER',
      powerUnit: 'Mercedes', puShort: 'MER',
      principal: 'Toto Wolff', hq: 'Brackley', country: 'United Kingdom', countryCode: 'GB',
      colors: { primary: '#C7CBD1', secondary: '#0E1418', accent: '#00A19B', text: '#FFFFFF' },
      car: 'mercedes',
      performance: { aero: 92, power: 95, chassis: 91, reliability: 88, development: 90 },
      tier: 1
    },
    {
      id: 'ferrari', name: 'Scuderia Ferrari HP', short: 'Ferrari', code: 'FER',
      powerUnit: 'Ferrari', puShort: 'FER',
      principal: 'Frédéric Vasseur', hq: 'Maranello', country: 'Italy', countryCode: 'IT',
      colors: { primary: '#E10600', secondary: '#1A1A1A', accent: '#FFF200', text: '#FFFFFF' },
      car: 'ferrari',
      performance: { aero: 92, power: 96, chassis: 90, reliability: 85, development: 89 },
      tier: 1
    },
    {
      id: 'redbull', name: 'Oracle Red Bull Racing', short: 'Red Bull Racing', code: 'RBR',
      powerUnit: 'Red Bull Ford', puShort: 'RBF',
      principal: 'Laurent Mekies', hq: 'Milton Keynes', country: 'United Kingdom', countryCode: 'AT',
      colors: { primary: '#122A6B', secondary: '#C8102E', accent: '#FFC906', text: '#FFFFFF' },
      car: 'redbull',
      performance: { aero: 93, power: 89, chassis: 92, reliability: 84, development: 86 },
      tier: 1
    },
    {
      id: 'racingbulls', name: 'Visa Cash App Racing Bulls F1 Team', short: 'Racing Bulls', code: 'VCB',
      powerUnit: 'Red Bull Ford', puShort: 'RBF',
      principal: 'Alan Permane', hq: 'Faenza', country: 'Italy', countryCode: 'IT',
      colors: { primary: '#F2F2F2', secondary: '#1C2E63', accent: '#D8232A', text: '#121212' },
      car: 'racingbulls',
      performance: { aero: 79, power: 85, chassis: 80, reliability: 82, development: 78 },
      tier: 3
    },
    {
      id: 'astonmartin', name: 'Aston Martin Aramco F1 Team', short: 'Aston Martin', code: 'AMR',
      powerUnit: 'Honda', puShort: 'HON',
      principal: 'Andy Cowell', hq: 'Silverstone', country: 'United Kingdom', countryCode: 'GB',
      colors: { primary: '#00594F', secondary: '#0B0F0E', accent: '#CEDC00', text: '#FFFFFF' },
      car: 'astonmartin',
      performance: { aero: 84, power: 84, chassis: 82, reliability: 80, development: 90 },
      tier: 2
    },
    {
      id: 'alpine', name: 'BWT Alpine F1 Team', short: 'Alpine', code: 'ALP',
      powerUnit: 'Mercedes', puShort: 'MER',
      principal: 'Flavio Briatore', // VERIFY: team principal after the 2025 reshuffle
      hq: 'Enstone', country: 'France', countryCode: 'FR',
      colors: { primary: '#0090FF', secondary: '#F26BA3', accent: '#001A3A', text: '#FFFFFF' },
      car: 'alpine',
      performance: { aero: 76, power: 86, chassis: 77, reliability: 78, development: 74 },
      tier: 3
    },
    {
      id: 'williams', name: 'Atlassian Williams Racing', short: 'Williams', code: 'WIL',
      powerUnit: 'Mercedes', puShort: 'MER',
      principal: 'James Vowles', hq: 'Grove', country: 'United Kingdom', countryCode: 'GB',
      colors: { primary: '#1868DB', secondary: '#0B1A3A', accent: '#FFFFFF', text: '#FFFFFF' },
      car: 'williams',
      performance: { aero: 84, power: 90, chassis: 82, reliability: 83, development: 86 },
      tier: 2
    },
    {
      id: 'haas', name: 'TGR Haas F1 Team', short: 'Haas', code: 'HAA',
      powerUnit: 'Ferrari', puShort: 'FER',
      principal: 'Ayao Komatsu', hq: 'Kannapolis', country: 'United States', countryCode: 'US',
      colors: { primary: '#F0F0F0', secondary: '#1A1A1A', accent: '#E4002B', text: '#121212' },
      car: 'haas',
      performance: { aero: 78, power: 84, chassis: 78, reliability: 81, development: 79 },
      tier: 3
    },
    {
      id: 'audi', name: 'Audi Revolut F1 Team', short: 'Audi', code: 'AUD',
      powerUnit: 'Audi', puShort: 'AUD',
      principal: 'Jonathan Wheatley', hq: 'Hinwil', country: 'Switzerland', countryCode: 'CH',
      colors: { primary: '#9BA3AC', secondary: '#0D0D0F', accent: '#F50537', text: '#FFFFFF' },
      car: 'audi',
      performance: { aero: 76, power: 82, chassis: 75, reliability: 74, development: 84 },
      tier: 3
    },
    {
      id: 'cadillac', name: 'Cadillac Formula 1 Team', short: 'Cadillac', code: 'CAD',
      powerUnit: 'Ferrari', puShort: 'FER',  // VERIFY: customer Ferrari PU for the first seasons
      principal: 'Graeme Lowdon', hq: 'Charlotte', country: 'United States', countryCode: 'US',
      colors: { primary: '#17171A', secondary: '#E3E3E3', accent: '#B79B5B', text: '#FFFFFF' },
      car: 'cadillac',
      performance: { aero: 68, power: 80, chassis: 66, reliability: 70, development: 80 },
      tier: 4
    }
  ];

  var byId = {};
  TEAMS.forEach(function (t) { byId[t.id] = t; });

  /* 2026 regulation notes used by the physics + UI copy (single source of truth) */
  var REGULATIONS_2026 = {
    name: '2026 Power Unit & Chassis Regulations',
    fuelSplit: '50/50 combustion / electric',
    fuel: '100% sustainable fuel',
    activeAero: {
      xMode: { label: 'X-Mode', desc: 'Low drag: front + rear wing open on straights', dragMul: 0.62, downforceMul: 0.55 },
      zMode: { label: 'Z-Mode', desc: 'High downforce: wings closed for corners', dragMul: 1.0, downforceMul: 1.0 }
    },
    boost: { label: 'Boost', desc: 'Overtake electrical deployment, replaces DRS', extraKW: 350, maxSeconds: 12 },
    car: { massKg: 768, widthMm: 1900, wheelbaseMm: 3400, lengthMm: 5000, fuelKg: 70 }
  };

  F1.DATA = F1.DATA || {};
  F1.DATA.teams = TEAMS;
  F1.DATA.teamById = byId;
  F1.DATA.regulations2026 = REGULATIONS_2026;

  F1.DATA.getTeam = function (id) { return byId[id] || TEAMS[0]; };
  F1.DATA.teamColor = function (id) { return (byId[id] || TEAMS[0]).colors.primary; };

})(window.F1 = window.F1 || {});
