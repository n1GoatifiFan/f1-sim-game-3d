/* ==========================================================================
   F1 2026 — ui/hud.js
   Broadcast-style race HUD drawn as plain DOM over the canvas: position,
   timing tower, tyres, fuel, ERS, aero, gear/speed/RPM, minimap, radio
   messages and the start lights.

   F1.hud.create(rootEl) -> { update(data), cycle(), destroy() }
   ========================================================================== */
(function (F1) {
  'use strict';

  var T = F1.util;

  function node(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* compound colour chips: white text on the compound colour, F1 style */
  var COMPOUND_COLORS = {
    soft: '#e10600', medium: '#ffd400', hard: '#f4f4f4',
    inter: '#19c37d', wet: '#2d6fe0'
  };

  F1.hud = {
    create: function (root) {
      var wrap = node('div', 'hud');
      root.appendChild(wrap);

      /* ------------------------------- top left */
      var posBox = node('div', 'hud-pos');
      var posNum = node('div', 'pos-num', '1');
      var posMeta = node('div', 'pos-meta',
        '<div class="pos-lap"><b id="hud-lap">1</b><span>/<i id="hud-laps">57</i></span></div>' +
        '<div class="pos-time mono" id="hud-laptime">0:00.000</div>');
      posBox.appendChild(posNum);
      posBox.appendChild(posMeta);
      wrap.appendChild(posBox);
      var lapEl = posMeta.querySelector('#hud-lap');
      var lapsEl = posMeta.querySelector('#hud-laps');
      var lapTimeEl = posMeta.querySelector('#hud-laptime');

      /* ------------------------------- top centre: start lights + radio */
      var lights = node('div', 'hud-lights');
      for (var i = 0; i < 5; i++) lights.appendChild(node('i', 'light'));
      wrap.appendChild(lights);

      var radio = node('div', 'hud-radio');
      wrap.appendChild(radio);

      /* the race engineer talks in typed text: a fresh line cancels whatever
         was still being typed, then the line sits for a few seconds */
      var sayTimer = null, sayTick = null;
      function say(text, who) {
        if (!radio) return;
        clearTimeout(sayTimer); clearInterval(sayTick); sayTick = null;
        radio._last = text;
        radio.classList.add('show', 'typing');
        radio.innerHTML = '<b>' + (who || 'ENGINEER') + '</b><span></span>';
        var span = radio.querySelector('span');
        var i = 0;
        sayTick = setInterval(function () {
          i += 1;
          span.textContent = text.slice(0, i);
          if (i >= text.length) {
            clearInterval(sayTick); sayTick = null;
            radio.classList.remove('typing');
            sayTimer = setTimeout(function () { radio.classList.remove('show'); }, 4000);
          }
        }, Math.max(12, Math.min(42, 700 / Math.max(12, text.length))));
      }
      function onRadio(text) { say(String(text), 'ENGINEER'); }
      F1.bus.on('radio-message', onRadio);

      var flag = node('div', 'hud-flag');
      wrap.appendChild(flag);

      var muteChip = node('div', 'hud-mute', 'SOUND OFF \u00b7 M');
      wrap.appendChild(muteChip);

      /* ------------------------------- top right: tower */
      var tower = node('div', 'hud-tower');
      tower.innerHTML = '<div class="tower-head"><span>POS</span><span>DRIVER</span><span>GAP</span></div><div class="tower-body"></div>';
      wrap.appendChild(tower);
      var towerBody = tower.querySelector('.tower-body');

      /* ------------------------------- left: minimap */
      var mapBox = node('div', 'hud-map');
      var canvas = document.createElement('canvas');
      canvas.width = 210; canvas.height = 210;
      mapBox.appendChild(canvas);
      var mapLabel = node('div', 'map-label', '');
      mapBox.appendChild(mapLabel);
      wrap.appendChild(mapBox);
      var ctx2 = canvas.getContext('2d');
      var mapTrack = null, mapPath = null;

      function drawMap(d, carPct) {
        if (!mapTrack) return;
        if (!mapPath) mapPath = F1.world.minimapPath(mapTrack, 210, 210, 16);
        ctx2.clearRect(0, 0, 210, 210);
        ctx2.lineJoin = 'round';
        ctx2.lineCap = 'round';
        // base line
        ctx2.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx2.lineWidth = 3.2;
        ctx2.beginPath();
        mapPath.pts.forEach(function (p, i) { i ? ctx2.lineTo(p[0], p[1]) : ctx2.moveTo(p[0], p[1]); });
        ctx2.closePath();
        ctx2.stroke();
        // DRS zones (geometry cached: only the dots move each frame)
        ctx2.strokeStyle = 'rgba(0,224,199,0.85)';
        ctx2.lineWidth = 3.4;
        if (!mapPath._drs) {
          mapPath._drs = mapTrack.drs.map(function (z) {
            var line = [];
            for (var k = 0; k <= 12; k++) {
              var s = mapTrack.length * (z[0] + (z[1] - z[0]) * (k / 12));
              line.push(mapPath.toScreen(mapTrack.x[mapTrack.indexAt(s)], mapTrack.z[mapTrack.indexAt(s)]));
            }
            return line;
          });
          var sf0 = mapTrack.at(0, {});
          mapPath._sf = mapPath.toScreen(sf0.x, sf0.z);
        }
        mapPath._drs.forEach(function (line) {
          ctx2.beginPath();
          line.forEach(function (p, k) { k ? ctx2.lineTo(p[0], p[1]) : ctx2.moveTo(p[0], p[1]); });
          ctx2.stroke();
        });
        // start/finish
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(mapPath._sf[0] - 1.5, mapPath._sf[1] - 6, 3, 12);
        // car
        if (d) {
          var at = mapTrack.at(carPct * mapTrack.length, {});
          var cp = mapPath.toScreen(at.x, at.z);
          ctx2.fillStyle = d.drs ? '#00e0c7' : '#e10600';
          ctx2.beginPath();
          ctx2.arc(cp[0], cp[1], 4.6, 0, Math.PI * 2);
          ctx2.fill();
          ctx2.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx2.lineWidth = 1.2;
          ctx2.stroke();
        }
      }

      /* ------------------------------- bottom left: tyres + fuel */
      var tyres = node('div', 'hud-tyres');
      tyres.innerHTML =
        '<div class="tyre-grid">' +
        '<div class="tyre" data-w="fl"><span class="t-temp">--</span><i class="t-bar"></i></div>' +
        '<div class="tyre" data-w="fr"><span class="t-temp">--</span><i class="t-bar"></i></div>' +
        '<div class="tyre" data-w="rl"><span class="t-temp">--</span><i class="t-bar"></i></div>' +
        '<div class="tyre" data-w="rr"><span class="t-temp">--</span><i class="t-bar"></i></div>' +
        '</div>' +
        '<div class="tyre-foot"><span class="compound-chip" id="hud-compound">M</span>' +
        '<span class="fuel-wrap"><i class="fuel-bar" id="hud-fuel"></i></span>' +
        '<span class="mono fuel-val" id="hud-fuelval">0.0</span></div>';
      wrap.appendChild(tyres);
      var tyreEls = {};
      Array.prototype.forEach.call(tyres.querySelectorAll('.tyre'), function (el) {
        tyreEls[el.getAttribute('data-w')] = { el: el, temp: el.querySelector('.t-temp'), bar: el.querySelector('.t-bar') };
      });
      var compoundEl = tyres.querySelector('#hud-compound');
      var fuelEl = tyres.querySelector('#hud-fuel');
      var fuelValEl = tyres.querySelector('#hud-fuelval');

      /* ------------------------------- bottom centre: speed cluster */
      var cluster = node('div', 'hud-cluster');
      cluster.innerHTML =
        '<div class="rpm-leds" id="hud-leds"></div>' +
        '<div class="cluster-row">' +
        '<div class="gear" id="hud-gear">1</div>' +
        '<div class="speed"><b id="hud-speed">0</b><span>KM/H</span></div>' +
        '</div>' +
        '<div class="pipes"><i id="hud-thr"></i><i id="hud-brk"></i></div>' +
        '<div class="aero-row">' +
        '<span class="pill" id="hud-ers">ERS 0%</span>' +
        '<span class="pill" id="hud-aero">AERO Z</span>' +
        '<span class="pill drs" id="hud-drs">DRS</span>' +
        '<span class="pill" id="hud-surface">TRACK</span>' +
        '</div>';
      wrap.appendChild(cluster);
      var ledWrap = cluster.querySelector('#hud-leds');
      var ledEls = [];
      for (var l = 0; l < 15; l++) {
        var led = node('i', 'led');
        ledWrap.appendChild(led);
        ledEls.push(led);
      }
      var gearEl = cluster.querySelector('#hud-gear');
      var speedEl = cluster.querySelector('#hud-speed');
      var thrEl = cluster.querySelector('#hud-thr');
      var brkEl = cluster.querySelector('#hud-brk');
      var ersEl = cluster.querySelector('#hud-ers');
      var aeroEl = cluster.querySelector('#hud-aero');
      var drsEl = cluster.querySelector('#hud-drs');
      var surfEl = cluster.querySelector('#hud-surface');

      /* ------------------------------- bottom right: timing */
      var timing = node('div', 'hud-timing');
      timing.innerHTML =
        '<div class="t-row"><span>LAST</span><b class="mono" id="hud-last">-:--.---</b></div>' +
        '<div class="t-row best"><span>BEST</span><b class="mono" id="hud-best">-:--.---</b></div>' +
        '<div class="t-sectors" id="hud-sectors">' +
        '<span>S1</span><span>S2</span><span>S3</span>' +
        '</div>';
      wrap.appendChild(timing);
      var penEl = node('div', 'hud-pen');
      timing.appendChild(penEl);
      var lastEl = timing.querySelector('#hud-last');
      var bestEl = timing.querySelector('#hud-best');
      var sectorEls = Array.prototype.slice.call(timing.querySelectorAll('.t-sectors span'));

      /* ------------------------------- centre overlays */
      var big = node('div', 'hud-big');
      wrap.appendChild(big);

      var weatherEl = node('div', 'hud-weather');
      weatherEl.innerHTML = '<i class="wx-icon"></i><span class="wx-label"></span><span class="wx-wet"><b></b></span>';
      wrap.appendChild(weatherEl);

      var replayEl = node('div', 'hud-replay', 'REPLAY');
      wrap.appendChild(replayEl);

      var photoEl = node('div', 'hud-photo',
        '<b>PHOTO MODE</b><span>drag to orbit \u00b7 wheel to zoom \u00b7 J to save \u00b7 V to exit</span>');
      wrap.appendChild(photoEl);

      var pitEl = node('div', 'hud-pit');
      wrap.appendChild(pitEl);

      var paused = node('div', 'hud-paused', '<b>PAUSED</b><span>Esc to resume</span>');
      wrap.appendChild(paused);

      var finish = node('div', 'hud-finish');
      wrap.appendChild(finish);

      /* ------------------------------- state */
      var lastHud = null;
      var vis = ['full', 'minimal', 'off'];
      var visIndex = 0;
      var lastLightCount = -1;
      var bestSectorShown = [0, 0, 0];

      function setVis(mode) {
        wrap.className = 'hud hud-' + mode;
      }

      F1.bus.on('replay', function (info) {
        replayEl.classList.toggle('show', !!(info && info.playing));
      });
      F1.bus.on('photo-mode', function (on) {
        wrap.classList.toggle('photo', !!on);
        var root2 = document.getElementById('hud-root');
        if (root2) root2.classList.toggle('photo', !!on);
      });

      var api = {
        update: function (d) {
          if (!d) return;
          lastHud = d;
          if (!mapTrack && d.trackId) {
            try {
              mapTrack = F1.getTrack(d.trackId);
              mapLabel.textContent = d.trackName || '';
            } catch (e) {}
          }

          /* position + lap */
          posNum.textContent = d.position;
          lapEl.textContent = d.lap;
          lapsEl.textContent = d.lapsTotal;
          lapTimeEl.textContent = d.flying ? T.fmtTime(d.lapTime) : '0:00.000';

          /* start lights */
          var lit = 0;
          if (d.state === 'countdown') lit = Math.min(5, Math.max(1, 6 - Math.ceil(d.countdown)));
          if (lit !== lastLightCount) {
            lastLightCount = lit;
            Array.prototype.forEach.call(lights.children, function (el, i) {
              el.classList.toggle('on', i < lit);
            });
            lights.classList.toggle('show', d.state === 'countdown');
          }
          if (d.state === 'formation') {
            big.textContent = 'FORMATION LAP';
            big.className = 'hud-big show';
          } else if (d.state === 'countdown' && d.countdown > 0) {
            big.textContent = Math.ceil(d.countdown);
            big.className = 'hud-big show count';
          } else if (d.state === 'countdown') {
            big.textContent = 'LIGHTS OUT';
            big.className = 'hud-big show go';
          } else if (big.classList.contains('count')) {
            big.className = 'hud-big';
          }

          /* radio message */
          if (d.message && d.message !== radio._last) {
            radio._last = d.message;
            radio.textContent = d.message;
            radio.classList.add('show');
            clearTimeout(radio._t);
            radio._t = setTimeout(function () { radio.classList.remove('show'); }, 2600);
          }

          if (muteChip) muteChip.classList.toggle('on', !!(F1.audio && F1.audio.muted));

          /* flags */
          var flagText = '';
          if (d.blueFlag) flagText = 'BLUE FLAG';
          else if (d.flag === 'sc') flagText = 'SAFETY CAR';
          else if (d.flag === 'vsc') flagText = 'VIRTUAL SAFETY CAR';
          else if (d.flag === 'red') flagText = 'RED FLAG';
          else if (d.flag === 'yellow') flagText = 'YELLOW FLAG';
          if (flag._txt !== flagText || flag._flag !== d.flag) {
            flag._txt = flagText;
            flag._flag = d.flag;
            flag.textContent = flagText;
            flag.className = 'hud-flag' + (flagText ? ' show f-' + (d.blueFlag ? 'blue' : d.flag) : '');
          }

          /* weather */
          if (d.weather) {
            weatherEl.querySelector('.wx-icon').textContent = d.weather.icon || '';
            weatherEl.querySelector('.wx-label').textContent = d.weather.label || '';
            var wetBar = weatherEl.querySelector('.wx-wet b');
            wetBar.style.width = Math.round(T.clamp(d.trackWet || 0, 0, 1) * 100) + '%';
            weatherEl.classList.toggle('wet', (d.trackWet || 0) > 0.2);
          }

          /* pit lane */
          if (d.pitting) {
            pitEl.textContent = d.pitPhase === 'box' ? 'PIT STOP' : 'PIT LANE \u00b7 80';
            pitEl.className = 'hud-pit show boxed';
          } else if (d.pitRequested) {
            pitEl.textContent = 'PIT IN THIS LAP';
            pitEl.className = 'hud-pit show';
          } else if (pitEl.className.indexOf('show') >= 0) {
            pitEl.className = 'hud-pit';
          }

          /* penalties */
          if (d.penalty > 0) {
            penEl.textContent = '+' + d.penalty + 's';
            penEl.className = 'hud-pen show';
          } else {
            penEl.className = 'hud-pen';
          }

          /* tower */
          var rows = d.standings && d.standings.length ? d.standings : [{
            pos: d.position, code: 'YOU', name: 'You', gap: 0, me: true
          }];
          /* the rows are rebuilt only when the shape changes, but the numbers
             are written every frame so the gaps actually count down */
          var rowEls = towerBody._rows;
          var structure = rows.map(function (r) { return r.code + (r.me ? '*' : ''); }).join(',');
          if (towerBody._key !== structure) {
            towerBody._key = structure;
            towerBody.innerHTML = rows.map(function (r, i) {
              return '<div class="tower-row' + (r.me ? ' me' : '') + '" data-i="' + i + '">' +
                '<span class="p"></span><span class="n"></span><span class="g mono"></span></div>';
            }).join('');
            rowEls = towerBody._rows = Array.prototype.map.call(towerBody.children, function (el) {
              return { el: el, p: el.children[0], n: el.children[1], g: el.children[2] };
            });
          }
          for (var ri = 0; ri < rows.length && ri < rowEls.length; ri++) {
            var rr = rows[ri], re = rowEls[ri];
            if (re.p.textContent !== String(rr.pos)) re.p.textContent = rr.pos;
            var code = rr.code || '';
            if (re.n.textContent !== code) re.n.textContent = code;
            var gapTxt = '';
            if (rr.gap) {
              gapTxt = rr.unit === 'L' ? '+' + rr.gap + ' LAP' + (rr.gap > 1 ? 'S' : '')
                : '+' + rr.gap.toFixed(rr.unit === 's' ? 1 : 0) + (rr.unit || '');
            }
            if (re.g.textContent !== gapTxt) re.g.textContent = gapTxt;
          }

          /* tyres */
          ['fl', 'fr', 'rl', 'rr'].forEach(function (k) {
            var t = d.tyre[k], el = tyreEls[k];
            if (!t) return;
            el.temp.textContent = Math.round(t.tempC || 0) + '\u00b0';
            var g = F1.tyres.compound(d.compound);
            var cold = t.tempC < g.peakTemp - 30, hot = t.tempC > g.peakTemp + 18;
            el.el.classList.toggle('cold', cold);
            el.el.classList.toggle('hot', hot);
            el.bar.style.width = Math.round(T.clamp(t.wear, 0, 1) * 100) + '%';
            el.bar.style.background = t.wear > 0.7 ? '#e10600' : (t.wear > 0.45 ? '#ffd400' : '#19c37d');
          });
          compoundEl.textContent = F1.tyres.compound(d.compound).code;
          compoundEl.style.background = COMPOUND_COLORS[d.compound] || '#888';
          compoundEl.style.color = d.compound === 'medium' || d.compound === 'hard' ? '#111' : '#fff';
          var fuelPct = T.clamp((d.fuel - 1.2) / Math.max(1, d.fuelStart - 1.2), 0, 1);
          fuelEl.style.width = Math.round(fuelPct * 100) + '%';
          fuelValEl.textContent = d.fuel.toFixed(1);

          /* cluster */
          gearEl.textContent = d.gear;
          speedEl.textContent = Math.round(d.speed);
          var litCount = Math.round(T.clamp(d.rpm / 15000, 0, 1) * ledEls.length);
          for (var q = 0; q < ledEls.length; q++) {
            ledEls[q].className = 'led' + (q < litCount ? (q > litEls() - 4 ? ' red' : ' on') : '');
          }
          thrEl.style.transform = 'scaleX(' + T.clamp(d.throttle, 0, 1).toFixed(3) + ')';
          brkEl.style.transform = 'scaleX(' + T.clamp(d.brake, 0, 1).toFixed(3) + ')';
          ersEl.textContent = 'ERS ' + Math.round(d.ers * 100) + '%';
          ersEl.className = 'pill' + (d.ers < 0.15 ? ' warn' : (d.ersMode === 'overtake' ? ' hot' : ''));
          aeroEl.textContent = 'AERO ' + d.aeroMode;
          aeroEl.className = 'pill' + (d.aeroMode === 'X' ? ' open' : '');
          drsEl.className = 'pill drs' + (d.drs ? ' on' : '');
          surfEl.textContent = d.surface === 'asphalt' ? 'TRACK' : d.surface.toUpperCase();
          surfEl.className = 'pill' + (d.surface === 'asphalt' ? '' : ' warn');

          /* timing */
          lastEl.textContent = d.lastLap ? T.fmtTime(d.lastLap) : '-:--.---';
          bestEl.textContent = d.bestLap ? T.fmtTime(d.bestLap) : '-:--.---';
          for (var s = 0; s < 3; s++) {
            var el2 = sectorEls[s];
            var val = d.sectorTimes[s] || 0;
            if (val && s < 2) {
              var b = d.bestSectors[s];
              el2.textContent = (s + 1) + ' ' + val.toFixed(1);
              el2.className = b && Math.abs(val - b) < 1e-6 ? 'purple' : (b && val > b ? 'slow' : '');
            } else if (d.lastSectors[s] && s < 2) {
              el2.textContent = (s + 1) + ' ' + d.lastSectors[s].toFixed(1);
              el2.className = '';
            } else {
              el2.textContent = 'S' + (s + 1);
              el2.className = '';
            }
          }

          /* paused / finished */
          paused.classList.toggle('show', !!d.paused);
          if (d.state === 'finished') {
            finish.innerHTML = '<span class="chip-check">CHEQUERED FLAG</span>' +
              '<h2>P' + d.position + '</h2>' +
              '<p>Best lap <b class="mono">' + (d.bestLap ? T.fmtTime(d.bestLap) : '—') + '</b> \u00b7 ' +
              d.lapsTotal + ' laps</p>' +
              '<p class="muted">Enter for the results</p>';
            finish.classList.add('show');
          } else {
            finish.classList.remove('show');
          }

          /* minimap */
          if (mapTrack) drawMap(d, d.trackLength ? (d.s / d.trackLength) : 0);
        },

        cycle: function () {
          visIndex = (visIndex + 1) % vis.length;
          setVis(vis[visIndex]);
          return vis[visIndex];
        },

        destroy: function () {
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          radio._last = null;
          clearTimeout(radio._t);
          clearTimeout(sayTimer);
          clearInterval(sayTick);
          F1.bus.off('radio-message', onRadio);
          F1.bus.off('hud-cycle', onCycle);
        }
      };

      function litEls() { return ledEls.length; }

      setVis('full');
      function onCycle() { api.cycle(); }
      F1.bus.on('hud-cycle', onCycle);
      api._el = wrap;
      return api;
    }
  };
})(window.F1 = window.F1 || {});
