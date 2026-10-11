/* Convert source intraday IEX OHLCV into completed New York regular-session
   5-minute bars and genuine session-wide daily OHLCV. Pure and shared by the
   manual downloader and Netlify's scheduled refresh. */
const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function sessionInfo(time) {
  const parts = Object.fromEntries(etParts.formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function aggregate(source, now = Date.now()) {
  const current = sessionInfo(now);
  const dates = new Map();
  for (const bar of source) {
    const ms = Date.parse(bar.t);
    if (!Number.isFinite(ms) || !['o', 'h', 'l', 'c', 'v'].every(k => Number.isFinite(bar[k])) || bar.v < 0 || Math.min(bar.o, bar.h, bar.l, bar.c) <= 0 || bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c)) continue;
    const { date, minute } = sessionInfo(ms);
    if (minute < 570 || minute >= 960 || date > current.date || (date === current.date && current.minute < 960)) continue;
    let day = dates.get(date);
    if (!day) { day = []; dates.set(date, day); }
    day.push({ ...bar, t: new Date(ms).toISOString() });
  }
  const days = [];
  for (const [date, bars] of dates) {
    bars.sort((a, b) => a.t.localeCompare(b.t));
    if (bars.length < 20) continue;
    const groups = new Map();
    for (const b of bars) {
      const bucket = Math.floor(Date.parse(b.t) / 300000) * 300000;
      let group = groups.get(bucket);
      if (!group) { group = []; groups.set(bucket, group); }
      group.push(b);
    }
    const five = [...groups].sort((a, b) => a[0] - b[0]).map(([bucket, group]) => ({
      t: new Date(bucket).toISOString(), o: group[0].o,
      h: Math.max(...group.map(b => b.h)), l: Math.min(...group.map(b => b.l)),
      c: group.at(-1).c, v: group.reduce((sum, b) => sum + b.v, 0)
    }));
    const daily = { t: five[0].t, o: five[0].o,
      h: Math.max(...five.map(b => b.h)), l: Math.min(...five.map(b => b.l)),
      c: five.at(-1).c, v: five.reduce((sum, b) => sum + b.v, 0) };
    days.push({ date, five, daily });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

function buildPayload(symbol, source, now = Date.now()) {
  const days = aggregate(source, now);
  const recent = days.slice(-3);
  const daily = days.slice(-900).map(day => day.daily);
  return {
    symbol, tf: '5Min', source: 'hfdatalibrary', delayed: true,
    tz: 'America/New_York', tzCoverage: 1,
    sessionDate: recent.at(-1)?.date || null, sessions: recent.length,
    asOf: days.at(-1)?.date || null,
    bars: recent.flatMap(day => day.five), daily,
    note: `${recent.length} completed US regular session(s) of 5-minute IEX bars. Daily bars aggregate each regular session's OHLCV. IEX represents only a fraction of consolidated market volume.`
  };
}

module.exports = { aggregate, buildPayload, sessionInfo };
