const D=1440;
const parse=v=>{const m=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());return m?+m[1]*60+ +m[2]:null;};
const fmt=m=>{const s=((Math.round(m)%D)+D)%D;return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
const open=(o,c,now)=>{if(o===null||c===null)return null;if(o===c)return true;return c>o?(now>=o&&now<c):(now>=o||now<c);};
console.log('  parse/format round-trip:');
for(const t of ['09:00','21:30','00:00','23:59','9:05']) console.log(`     ${t.padEnd(6)} -> ${parse(t)} -> ${fmt(parse(t))}`);
console.log('  rejects bad input      :', ['24:00','12:60','9am','',':'].map(t=>parse(t)===null).every(Boolean));
console.log();
console.log('  normal day 09:00-21:30 (540-1290):');
for(const [h,m] of [[8,59],[9,0],[15,0],[21,29],[21,30],[23,0]])
  console.log(`     ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} -> ${open(540,1290,h*60+m)}`);
console.log('  OVERNIGHT 22:00-02:00 (1320-120):');
for(const [h,m] of [[21,59],[22,0],[23,30],[0,30],[1,59],[2,0],[12,0]])
  console.log(`     ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} -> ${open(1320,120,h*60+m)}`);
console.log('  24h (equal times)      :', open(0,0,0), open(0,0,720));
console.log('  unstated               :', open(null,540,600), open(540,null,600));
