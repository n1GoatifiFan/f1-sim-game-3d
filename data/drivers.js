/* ==========================================================================
   F1 2026 — data/drivers.js
   22 drivers on the 2026 grid with hidden rating stats used by the AI,
   career mode and car development.

   stats (0-100, higher = better, calibrated to real-world reputation):
     pace          raw single-lap speed
     racecraft     overtaking / defending / race intelligence
     wet           wet-weather ability
     consistency   mistake frequency under pressure
     tyres         tyre management / degradation control
     starts        launch + first-lap ability
     aggression    how hard the AI fights (affects contact risk + defending)

   age affects progression in career mode (see peakAge). Career totals are
   "up to the start of 2026" and only used for the profile / awards screen.

   ---------------------------------------------------------------------------
   2026 MID-SEASON EDITS — how to swap a driver
   ---------------------------------------------------------------------------
   Drivers are linked to teams by `team` (id from data/teams.js). To perform a
   mid-season swap:
     1. Find the two drivers in the DRIVERS array below.
     2. Swap their `team` strings AND their `number` stays with the driver.
     3. Update `team.drivers` in data/teams.js to match (array of driver ids).
     4. (Optional) add an entry to F1.DATA.driverChanges so the news feed and
        the career save migration know about it, e.g.
          { date: '2026-07-01', driver: 'perez', from: 'cadillac', to: 'alpine' }
   To replace a driver with a NEW one: copy an existing entry, change id,
   name, code, number, team, helmet + stats, then append the id to the team's
   `drivers` array. Nothing else references drivers by index.
   ========================================================================== */
(function (F1) {
  'use strict';

  var D = [
    {
      id: 'norris', name: 'Lando Norris', firstName: 'Lando', lastName: 'Norris', code: 'NOR',
      number: 1, team: 'mclaren', country: 'United Kingdom', countryCode: 'GB', age: 26,
      helmet: { base: '#D7FF00', accent: '#00A19C', visor: '#101010', design: 'flash' },
      stats: { pace: 96, racecraft: 94, wet: 92, consistency: 88, tyres: 91, starts: 86, aggression: 72 },
      style: 'smooth', peakAge: 30, reputation: 92, marketValue: 96,
      career: { titles: 1, wins: 20, poles: 17, podiums: 55, fastestLaps: 12, starts: 160, debut: 2019 },
      champion: true // 2025 world champion — runs number 1
    },
    {
      id: 'piastri', name: 'Oscar Piastri', firstName: 'Oscar', lastName: 'Piastri', code: 'PIA',
      number: 81, team: 'mclaren', country: 'Australia', countryCode: 'AU', age: 25,
      helmet: { base: '#FFFFFF', accent: '#FF8000', visor: '#1A1A1A', design: 'split' },
      stats: { pace: 95, racecraft: 91, wet: 89, consistency: 91, tyres: 92, starts: 84, aggression: 70 },
      style: 'smooth', peakAge: 29, reputation: 88, marketValue: 90,
      career: { titles: 0, wins: 9, poles: 6, podiums: 32, fastestLaps: 6, starts: 70, debut: 2023 }
    },
    {
      id: 'russell', name: 'George Russell', firstName: 'George', lastName: 'Russell', code: 'RUS',
      number: 63, team: 'mercedes', country: 'United Kingdom', countryCode: 'GB', age: 28,
      helmet: { base: '#E8E8E8', accent: '#00A19B', visor: '#111111', design: 'chevron' },
      stats: { pace: 94, racecraft: 89, wet: 90, consistency: 88, tyres: 87, starts: 90, aggression: 76 },
      style: 'technical', peakAge: 30, reputation: 84, marketValue: 84,
      career: { titles: 0, wins: 4, poles: 6, podiums: 22, fastestLaps: 8, starts: 145, debut: 2019 }
    },
    {
      id: 'antonelli', name: 'Kimi Antonelli', firstName: 'Kimi', lastName: 'Antonelli', code: 'ANT',
      number: 12, team: 'mercedes', country: 'Italy', countryCode: 'IT', age: 19,
      helmet: { base: '#101010', accent: '#00A19B', visor: '#F5F5F5', design: 'flash' },
      stats: { pace: 88, racecraft: 82, wet: 85, consistency: 78, tyres: 80, starts: 84, aggression: 86 },
      style: 'aggressive', peakAge: 28, reputation: 74, marketValue: 88, rookieSeason: 2025,
      career: { titles: 0, wins: 0, poles: 0, podiums: 1, fastestLaps: 1, starts: 24, debut: 2025 }
    },
    {
      id: 'leclerc', name: 'Charles Leclerc', firstName: 'Charles', lastName: 'Leclerc', code: 'LEC',
      number: 16, team: 'ferrari', country: 'Monaco', countryCode: 'MC', age: 28,
      helmet: { base: '#E10600', accent: '#FFFFFF', visor: '#0A0A0A', design: 'stripes' },
      stats: { pace: 97, racecraft: 91, wet: 92, consistency: 85, tyres: 86, starts: 88, aggression: 79 },
      style: 'quali-monster', peakAge: 30, reputation: 88, marketValue: 90,
      career: { titles: 0, wins: 8, poles: 28, podiums: 49, fastestLaps: 10, starts: 155, debut: 2018 }
    },
    {
      id: 'hamilton', name: 'Lewis Hamilton', firstName: 'Lewis', lastName: 'Hamilton', code: 'HAM',
      number: 44, team: 'ferrari', country: 'United Kingdom', countryCode: 'GB', age: 41,
      helmet: { base: '#FFD400', accent: '#7A00FF', visor: '#0C0C0C', design: 'chevron' },
      stats: { pace: 93, racecraft: 97, wet: 97, consistency: 89, tyres: 94, starts: 91, aggression: 74 },
      style: 'smooth', peakAge: 31, reputation: 98, marketValue: 92,
      career: { titles: 7, wins: 105, poles: 104, podiums: 202, fastestLaps: 67, starts: 370, debut: 2007 }
    },
    {
      id: 'verstappen', name: 'Max Verstappen', firstName: 'Max', lastName: 'Verstappen', code: 'VER',
      number: 3, team: 'redbull', country: 'Netherlands', countryCode: 'NL', age: 28,
      helmet: { base: '#0B1E5C', accent: '#E4002B', visor: '#111111', design: 'blocks' },
      stats: { pace: 99, racecraft: 98, wet: 97, consistency: 96, tyres: 96, starts: 93, aggression: 88 },
      style: 'aggressive', peakAge: 30, reputation: 99, marketValue: 99,
      career: { titles: 4, wins: 65, poles: 47, podiums: 121, fastestLaps: 35, starts: 220, debut: 2015 }
    },
    {
      id: 'hadjar', name: 'Isack Hadjar', firstName: 'Isack', lastName: 'Hadjar', code: 'HAD',
      number: 6, team: 'redbull', country: 'France', countryCode: 'FR', age: 21,
      helmet: { base: '#FFFFFF', accent: '#122A6B', visor: '#101010', design: 'split' },
      stats: { pace: 86, racecraft: 81, wet: 83, consistency: 79, tyres: 81, starts: 84, aggression: 85 },
      style: 'aggressive', peakAge: 28, reputation: 72, marketValue: 80, rookieSeason: 2025,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 0, starts: 24, debut: 2025 }
    },
    {
      id: 'lawson', name: 'Liam Lawson', firstName: 'Liam', lastName: 'Lawson', code: 'LAW',
      number: 30, team: 'racingbulls', country: 'New Zealand', countryCode: 'NZ', age: 24,
      helmet: { base: '#1C2E63', accent: '#F2F2F2', visor: '#0E0E0E', design: 'streak' },
      stats: { pace: 84, racecraft: 82, wet: 84, consistency: 80, tyres: 80, starts: 85, aggression: 87 },
      style: 'aggressive', peakAge: 28, reputation: 66, marketValue: 70,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 0, starts: 30, debut: 2023 }
    },
    {
      id: 'lindblad', name: 'Arvid Lindblad', firstName: 'Arvid', lastName: 'Lindblad', code: 'LIN',
      number: 41, team: 'racingbulls', country: 'United Kingdom', countryCode: 'GB', age: 18,
      helmet: { base: '#F2F2F2', accent: '#D8232A', visor: '#141414', design: 'chevron' },
      stats: { pace: 80, racecraft: 73, wet: 77, consistency: 72, tyres: 73, starts: 80, aggression: 82 },
      style: 'aggressive', peakAge: 27, reputation: 55, marketValue: 74, rookieSeason: 2026,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 0, starts: 0, debut: 2026 }
    },
    {
      id: 'alonso', name: 'Fernando Alonso', firstName: 'Fernando', lastName: 'Alonso', code: 'ALO',
      number: 14, team: 'astonmartin', country: 'Spain', countryCode: 'ES', age: 44,
      helmet: { base: '#00594F', accent: '#CEDC00', visor: '#0D0D0D', design: 'flash' },
      stats: { pace: 90, racecraft: 96, wet: 94, consistency: 90, tyres: 93, starts: 89, aggression: 76 },
      style: 'technical', peakAge: 32, reputation: 95, marketValue: 80,
      career: { titles: 2, wins: 32, poles: 22, podiums: 106, fastestLaps: 26, starts: 410, debut: 2001 }
    },
    {
      id: 'stroll', name: 'Lance Stroll', firstName: 'Lance', lastName: 'Stroll', code: 'STR',
      number: 18, team: 'astonmartin', country: 'Canada', countryCode: 'CA', age: 27,
      helmet: { base: '#0B0F0E', accent: '#CEDC00', visor: '#F2F2F2', design: 'split' },
      stats: { pace: 79, racecraft: 76, wet: 79, consistency: 74, tyres: 75, starts: 76, aggression: 70 },
      style: 'smooth', peakAge: 29, reputation: 58, marketValue: 62,
      career: { titles: 0, wins: 0, poles: 1, podiums: 3, fastestLaps: 0, starts: 185, debut: 2017 }
    },
    {
      id: 'gasly', name: 'Pierre Gasly', firstName: 'Pierre', lastName: 'Gasly', code: 'GAS',
      number: 10, team: 'alpine', country: 'France', countryCode: 'FR', age: 30,
      helmet: { base: '#F26BA3', accent: '#0090FF', visor: '#111111', design: 'streak' },
      stats: { pace: 86, racecraft: 85, wet: 88, consistency: 83, tyres: 84, starts: 85, aggression: 78 },
      style: 'technical', peakAge: 30, reputation: 70, marketValue: 68,
      career: { titles: 0, wins: 1, poles: 0, podiums: 6, fastestLaps: 2, starts: 155, debut: 2017 }
    },
    {
      id: 'colapinto', name: 'Franco Colapinto', firstName: 'Franco', lastName: 'Colapinto', code: 'COL',
      number: 43, team: 'alpine', country: 'Argentina', countryCode: 'AR', age: 22,
      helmet: { base: '#0090FF', accent: '#FFFFFF', visor: '#0F0F0F', design: 'blocks' },
      stats: { pace: 81, racecraft: 77, wet: 80, consistency: 73, tyres: 74, starts: 82, aggression: 84 },
      style: 'aggressive', peakAge: 27, reputation: 60, marketValue: 66,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 0, starts: 18, debut: 2024 }
    },
    {
      id: 'albon', name: 'Alexander Albon', firstName: 'Alexander', lastName: 'Albon', code: 'ALB',
      number: 23, team: 'williams', country: 'Thailand', countryCode: 'TH', age: 30,
      helmet: { base: '#1868DB', accent: '#FFFFFF', visor: '#101010', design: 'chevron' },
      stats: { pace: 88, racecraft: 87, wet: 86, consistency: 85, tyres: 87, starts: 82, aggression: 75 },
      style: 'technical', peakAge: 30, reputation: 76, marketValue: 76,
      career: { titles: 0, wins: 0, poles: 0, podiums: 2, fastestLaps: 1, starts: 130, debut: 2019 }
    },
    {
      id: 'sainz', name: 'Carlos Sainz', firstName: 'Carlos', lastName: 'Sainz', code: 'SAI',
      number: 55, team: 'williams', country: 'Spain', countryCode: 'ES', age: 31,
      helmet: { base: '#E10600', accent: '#FFD400', visor: '#111111', design: 'stripes' },
      stats: { pace: 90, racecraft: 90, wet: 88, consistency: 88, tyres: 90, starts: 87, aggression: 75 },
      style: 'technical', peakAge: 31, reputation: 82, marketValue: 80,
      career: { titles: 0, wins: 4, poles: 6, podiums: 29, fastestLaps: 6, starts: 225, debut: 2015 }
    },
    {
      id: 'ocon', name: 'Esteban Ocon', firstName: 'Esteban', lastName: 'Ocon', code: 'OCO',
      number: 31, team: 'haas', country: 'France', countryCode: 'FR', age: 29,
      helmet: { base: '#1A1A1A', accent: '#E4002B', visor: '#F2F2F2', design: 'split' },
      stats: { pace: 84, racecraft: 83, wet: 85, consistency: 80, tyres: 83, starts: 81, aggression: 78 },
      style: 'defensive', peakAge: 30, reputation: 66, marketValue: 62,
      career: { titles: 0, wins: 1, poles: 0, podiums: 4, fastestLaps: 0, starts: 175, debut: 2016 }
    },
    {
      id: 'bearman', name: 'Oliver Bearman', firstName: 'Oliver', lastName: 'Bearman', code: 'BEA',
      number: 87, team: 'haas', country: 'United Kingdom', countryCode: 'GB', age: 20,
      helmet: { base: '#F0F0F0', accent: '#E4002B', visor: '#101010', design: 'flash' },
      stats: { pace: 83, racecraft: 80, wet: 82, consistency: 77, tyres: 78, starts: 84, aggression: 83 },
      style: 'aggressive', peakAge: 27, reputation: 64, marketValue: 72, rookieSeason: 2025,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 1, starts: 26, debut: 2024 }
    },
    {
      id: 'hulkenberg', name: 'Nico Hülkenberg', firstName: 'Nico', lastName: 'Hülkenberg', code: 'HUL',
      number: 27, team: 'audi', country: 'Germany', countryCode: 'DE', age: 38,
      helmet: { base: '#F50537', accent: '#0D0D0F', visor: '#F2F2F2', design: 'blocks' },
      stats: { pace: 83, racecraft: 85, wet: 88, consistency: 85, tyres: 84, starts: 80, aggression: 70 },
      style: 'technical', peakAge: 31, reputation: 68, marketValue: 54,
      career: { titles: 0, wins: 0, poles: 1, podiums: 1, fastestLaps: 2, starts: 240, debut: 2010 }
    },
    {
      id: 'bortoleto', name: 'Gabriel Bortoleto', firstName: 'Gabriel', lastName: 'Bortoleto', code: 'BOR',
      number: 5, team: 'audi', country: 'Brazil', countryCode: 'BR', age: 21,
      helmet: { base: '#0D0D0F', accent: '#F50537', visor: '#FFD400', design: 'streak' },
      stats: { pace: 81, racecraft: 78, wet: 80, consistency: 76, tyres: 78, starts: 80, aggression: 80 },
      style: 'smooth', peakAge: 27, reputation: 60, marketValue: 70, rookieSeason: 2025,
      career: { titles: 0, wins: 0, poles: 0, podiums: 0, fastestLaps: 0, starts: 24, debut: 2025 }
    },
    {
      id: 'perez', name: 'Sergio Pérez', firstName: 'Sergio', lastName: 'Pérez', code: 'PER',
      number: 11, team: 'cadillac', country: 'Mexico', countryCode: 'MX', age: 36,
      helmet: { base: '#E3E3E3', accent: '#B79B5B', visor: '#141414', design: 'chevron' },
      stats: { pace: 82, racecraft: 87, wet: 84, consistency: 80, tyres: 88, starts: 76, aggression: 72 },
      style: 'tyre-whisperer', peakAge: 31, reputation: 74, marketValue: 60,
      career: { titles: 0, wins: 6, poles: 3, podiums: 39, fastestLaps: 12, starts: 285, debut: 2011 }
    },
    {
      id: 'bottas', name: 'Valtteri Bottas', firstName: 'Valtteri', lastName: 'Bottas', code: 'BOT',
      number: 77, team: 'cadillac', country: 'Finland', countryCode: 'FI', age: 36,
      helmet: { base: '#17171A', accent: '#E3E3E3', visor: '#0F0F0F', design: 'split' },
      stats: { pace: 82, racecraft: 81, wet: 83, consistency: 83, tyres: 82, starts: 88, aggression: 62 },
      style: 'smooth', peakAge: 30, reputation: 70, marketValue: 52,
      career: { titles: 0, wins: 10, poles: 20, podiums: 67, fastestLaps: 19, starts: 250, debut: 2013 }
    }
  ];

  /* team.drivers is derived here so line-ups cannot drift between files */
  D.forEach(function (d) {
    var team = F1.DATA.getTeam(d.team);
    team.drivers = team.drivers || [];
    if (team.drivers.indexOf(d.id) < 0) team.drivers.push(d.id);
  });

  var byId = {};
  D.forEach(function (d) { byId[d.id] = d; });

  F1.DATA.drivers = D;
  F1.DATA.driverById = byId;
  F1.DATA.driverChanges = [];   // filled by career mode / mid-season edits

  F1.DATA.getDriver = function (id) { return byId[id] || D[0]; };
  F1.DATA.driversOf = function (teamId) {
    return (F1.DATA.getTeam(teamId).drivers || []).map(function (id) { return byId[id]; }).filter(Boolean);
  };
  F1.DATA.teamOf = function (driverId) { return F1.DATA.getTeam(F1.DATA.getDriver(driverId).team); };

  /* overall rating used for grids, market value and career AI */
  F1.DATA.driverOverall = function (d) {
    var s = d.stats;
    return Math.round(s.pace * 0.32 + s.racecraft * 0.22 + s.consistency * 0.16 +
      s.tyres * 0.12 + s.wet * 0.1 + s.starts * 0.04 + s.aggression * 0.04);
  };

  /* flag emoji from ISO-2 (falls back to the code when the font lacks flags) */
  F1.DATA.flag = function (iso2) {
    if (!iso2 || iso2.length !== 2) return '';
    var A = 0x1F1E6;
    return String.fromCharCode(A + iso2.charCodeAt(0) - 65, A + iso2.charCodeAt(1) - 65);
  };

  /* small derived palette for the car builder: stripes accent per team */
  F1.DATA.liveryAccent = function (teamId) {
    var t = F1.DATA.getTeam(teamId);
    return t.colors.accent || t.colors.secondary;
  };

})(window.F1 = window.F1 || {});
