/* ==========================================================================
   F1 2026 — data/sponsors.js
   Real, well-known team partners, used ONLY as stylised text wordmarks on the
   procedurally generated liveries (no logos, no artwork, no images).

   EDIT ME: this file is intentionally plain and per-team. `tier` drives how
   prominently a wordmark is painted:
     title    -> biggest text, always on the rear wing + engine cover
     primary  -> sidepod / nose panels
     partner  -> smaller marks on the floor edge, front wing, halo
   `slot` optionally pins a wordmark to one panel ('rearWing', 'sidepod',
   'nose', 'halo', 'floor', 'frontWing', 'engineCover').

   Entries marked VERIFY are less certain; delete/fix them freely — nothing
   else in the code depends on specific names.
   ========================================================================== */
(function (F1) {
  'use strict';

  var SPONSORS = {
    mclaren: {
      title: null,
      partners: [
        { name: 'Google', tier: 'primary' },
        { name: 'Mastercard', tier: 'primary' },
        { name: 'OKX', tier: 'partner' },
        { name: 'Coca-Cola', tier: 'partner' },
        { name: 'Hilton', tier: 'partner' },
        { name: 'Dell', tier: 'partner', slot: 'frontWing' },
        { name: 'CNBC', tier: 'partner' },
        { name: 'FxPro', tier: 'partner', slot: 'floor' },
        { name: 'Richard Mille', tier: 'partner', slot: 'halo' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    mercedes: {
      title: 'Petronas',
      partners: [
        { name: 'INEOS', tier: 'primary' },
        { name: 'UBS', tier: 'primary' },
        { name: 'CrowdStrike', tier: 'primary' },
        { name: 'Snapdragon', tier: 'partner' },
        { name: 'Tommy Hilfiger', tier: 'partner', slot: 'sidepod' },
        { name: 'IWC', tier: 'partner', slot: 'halo' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    ferrari: {
      title: 'HP',
      partners: [
        { name: 'Shell', tier: 'primary' },
        { name: 'Santander', tier: 'primary' },
        { name: 'AWS', tier: 'partner' },
        { name: 'Richard Mille', tier: 'partner', slot: 'halo' },
        { name: 'Puma', tier: 'partner', slot: 'sidepod' },
        { name: 'Ray-Ban', tier: 'partner' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    redbull: {
      title: 'Oracle',
      partners: [
        { name: 'Mobil 1', tier: 'primary' },
        { name: 'Tag Heuer', tier: 'primary', slot: 'halo' },
        { name: 'Hard Rock', tier: 'partner' },
        { name: 'Siemens', tier: 'partner' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    racingbulls: {
      title: 'Visa Cash App',
      partners: [
        { name: 'Red Bull', tier: 'primary' },
        { name: 'Hugo Boss', tier: 'partner', slot: 'sidepod' },
        { name: 'TUDOR', tier: 'partner', slot: 'halo' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    astonmartin: {
      title: 'Aramco',
      partners: [
        { name: 'Cognizant', tier: 'primary' },
        { name: 'Crypto.com', tier: 'partner' },
        { name: 'NetApp', tier: 'partner' },
        { name: 'Boss', tier: 'partner', slot: 'sidepod' },   // VERIFY
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    alpine: {
      title: 'BWT',
      partners: [
        { name: 'Castrol', tier: 'primary' },
        { name: 'Microsoft', tier: 'partner' },
        { name: 'Kappa', tier: 'partner', slot: 'sidepod' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    williams: {
      title: 'Atlassian',
      partners: [
        { name: 'Gulf Oil', tier: 'primary' },
        { name: 'Santander', tier: 'partner' },
        { name: 'Komatsu', tier: 'partner' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    haas: {
      title: 'TGR',
      partners: [
        { name: 'Toyota Gazoo Racing', tier: 'primary' },
        { name: 'Haas Automation', tier: 'primary' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    audi: {
      title: 'Revolut',
      partners: [
        { name: 'BP', tier: 'primary' },
        { name: 'Castrol', tier: 'partner' },
        { name: 'Capgemini', tier: 'partner' },
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    },
    cadillac: {
      title: 'Cadillac',
      partners: [
        { name: 'General Motors', tier: 'primary' },
        { name: 'TWG Global', tier: 'partner' },       // VERIFY
        { name: 'Pirelli', tier: 'partner', slot: 'frontWing' }
      ]
    }
  };

  F1.DATA = F1.DATA || {};
  F1.DATA.sponsors = SPONSORS;
  F1.DATA.seriesSponsors = ['Pirelli', 'Aramco', 'DHL', 'Rolex', 'Heineken'];

  F1.DATA.sponsorsOf = function (teamId) {
    return (SPONSORS[teamId] && SPONSORS[teamId].partners) ? SPONSORS[teamId].partners : [];
  };
  F1.DATA.titleSponsor = function (teamId) {
    return (SPONSORS[teamId] && SPONSORS[teamId].title) || F1.DATA.getTeam(teamId).short;
  };
  /* wordmarks suitable for a given panel, biggest first */
  F1.DATA.sponsorsFor = function (teamId, slot) {
    var list = F1.DATA.sponsorsOf(teamId).filter(function (s) {
      return !s.slot || !slot || s.slot === slot;
    });
    var order = { title: 0, primary: 1, partner: 2 };
    return list.sort(function (a, b) { return (order[a.tier] || 3) - (order[b.tier] || 3); });
  };

})(window.F1 = window.F1 || {});
