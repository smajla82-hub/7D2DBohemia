// v0.3.4
// - Properly resets time quests (unkillable: overwrite deathless_start today to now)
// - Records per-player reset stamp for today
// - Sets expiresAt for all created/updated variables (retentionDays, default 7)
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';
const PLAYER_RESET_KEY_PREFIX = 'dailyquests_player_reset_at_'; // + playerId + _ + date
const DEFAULT_RETENTION_DAYS = 7;

const ALWAYS = ['vote','levelgain'];
const POOL   = ['timespent','zombiekills','shopquest','unkillable','feralkills','vulturekills','dieonce'];
const TOTAL  = 5;

function nowPrague(){ return new Date(new Date().toLocaleString('en-US',{ timeZone: TIME_ZONE })); }
function ymd(d=nowPrague()){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function addDaysISO(d, days){ const x=new Date(d.getTime()+days*86400*1000); return x.toISOString(); }
function mulberry32(seed){return function(){let t=(seed+=0x6D2B79F5);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function pickTypes(dateStr, serverId){
  const need=Math.max(0, TOTAL-ALWAYS.length);
  const rng=mulberry32(hash(`${dateStr}#${serverId}`));
  const arr=[...POOL];
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return [...ALWAYS, ...arr.slice(0,need)];
}
function cfgGet(path, fallback){
  try{ const get=data?.config?.get?.bind(data.config); if(!get) return fallback; const v=get(path); if(v!==undefined && v!==null && String(v).trim?.()!=='') return v; }catch{}
  return fallback;
}
function num(v, def){ const n=Number(v); return Number.isNaN(n)?def:n; }
function minutesOrMs(minKey, msKey, defMs){
  const min=num(cfgGet(minKey,undefined),undefined); if(min!==undefined) return Math.max(0,min)*60000;
  const ms=num(cfgGet(msKey,undefined),undefined);   return ms!==undefined?Math.max(0,ms):defMs;
}
function targetFor(type){
  switch(type){
    case 'timespent':  return minutesOrMs('targets.timespentMinutes','targets.timespentMs',3600000);
    case 'unkillable': return minutesOrMs('targets.unkillableMinutes','targets.unkillableMs',10800000);
    case 'zombiekills': return num(cfgGet('targets.zombiekills',200),200);
    case 'levelgain':   return num(cfgGet('targets.levelgain',5),5);
    case 'shopquest':   return num(cfgGet('targets.shopquest',1),1);
    case 'feralkills':  return num(cfgGet('targets.feralkills',10),10);
    case 'vulturekills':return num(cfgGet('targets.vulturekills',10),10);
    case 'dieonce':     return num(cfgGet('targets.dieonce',1),1);
    case 'vote':        return num(cfgGet('targets.vote',1),1);
    default: return 1;
  }
}
function retentionDays(){ return num(cfgGet('retentionDays', DEFAULT_RETENTION_DAYS), DEFAULT_RETENTION_DAYS); }

async function upsertVar(gsId,moduleId,playerId,key,payload,expiresAtISO){
  const s=await takaro.variable.variableControllerSearch({ filters:{ key:[key], gameServerId:[gsId], playerId: playerId ? [playerId] : undefined, moduleId:[moduleId] }, limit:1 });
  if(s.data.data.length){ await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(payload), expiresAt: expiresAtISO }); }
  else{ await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(payload), gameServerId: gsId, playerId, moduleId, expiresAt: expiresAtISO }); }
}
async function upsertRaw(gsId,moduleId,playerId,key,value,expiresAtISO){
  const s=await takaro.variable.variableControllerSearch({ filters:{ key:[key], gameServerId:[gsId], playerId: playerId ? [playerId] : undefined, moduleId:[moduleId] }, limit:1 });
  if(s.data.data.length){ await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: String(value), expiresAt: expiresAtISO }); }
  else{ await takaro.variable.variableControllerCreate({ key, value: String(value), gameServerId: gsId, playerId, moduleId, expiresAt: expiresAtISO }); }
}
async function pm(gsId,name,text){ try{ await takaro.gameserver.gameServerControllerExecuteCommand(gsId,{command:`pm "${name}" "${text}"`}); }catch{} }

async function main(){
  const { gameServerId: gsId, player, module: mod } = data;
  const pogId=player.id, name=player.name;
  const today=ymd(); const now=nowPrague(); const exp=addDaysISO(now, retentionDays());

  try{
    const s=await takaro.variable.variableControllerSearch({ filters:{ key:[LAST_RESET_KEY], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
    if(s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id,{ value: today });
    else await takaro.variable.variableControllerCreate({ key: LAST_RESET_KEY, value: today, gameServerId: gsId, moduleId: mod.moduleId });
  }catch{}

  const types=pickTypes(today, gsId);
  try{
    const s=await takaro.variable.variableControllerSearch({ filters:{ key:[DAILY_ACTIVE_TYPES_KEY], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
    const payload=JSON.stringify({ date: today, types });
    if(s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id,{ value: payload });
    else await takaro.variable.variableControllerCreate({ key: DAILY_ACTIVE_TYPES_KEY, value: payload, gameServerId: gsId, moduleId: mod.moduleId });
  }catch{}

  const resetKey = `${PLAYER_RESET_KEY_PREFIX}${pogId}_${today}`;
  await upsertRaw(gsId, mod.moduleId, pogId, resetKey, String(Date.now()), exp);

  const ensure=new Set([...types, ...ALWAYS]);
  for(const t of ensure){
    const key=`dailyquest_${pogId}_${today}_${t}`;
    const payload={ type:t, target: targetFor(t), progress:0, completed:false, claimed:false, date: today, createdAt: new Date().toISOString() };
    await upsertVar(gsId, mod.moduleId, pogId, key, payload, exp);
  }

  if(ensure.has('unkillable')){
    const startKey=`deathless_start_${pogId}_${today}`;
    await upsertRaw(gsId, mod.moduleId, pogId, startKey, String(Date.now()), exp);
  }

  await pm(gsId, name, 'Daily quests reset. 5 quests created. Use /daily to view.');
}
await main();
