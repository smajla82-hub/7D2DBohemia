// v0.3.13
// - Events -> external sync -> time updates (budgeted, active-types only)
// - Unkillable supports deathless_session_* and deathless_start_*
// - CLAMP to per-player reset stamp if present (prevents post-reset instant completion)
// - Backfills targets on time quests
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const LAST_RUN_KEY = 'questTracker_last_run';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_RESET_KEY_PREFIX = 'dailyquests_player_reset_at_'; // dailyquests_player_reset_at_{playerId}_{date}
const EXTERNAL_TYPES = ['vote', 'levelgain'];

const BUDGET_MS = 6000;
const OWN_DAILY_LIMIT = 1000;

function nowPrague(){ return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE })); }
function ymd(d=nowPrague()){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function ymdYesterday(){ const d=nowPrague(); d.setDate(d.getDate()-1); return ymd(d); }
async function pm(gsId,name,text){ try{ await takaro.gameserver.gameServerControllerExecuteCommand(gsId,{command:`pm "${name}" "${text}"`}); }catch{} }

const DISPLAY = {
  timespent: 'TIME SURVIVOR',
  shopquest: 'TRADE BEERS',
  levelgain: 'EXPERIENCE GRINDER',
  zombiekills: 'ZOMBIE HUNTER',
  vote: 'SERVER SUPPORTER',
  unkillable: 'UNKILLABLE',
  feralkills: 'FERAL WHO?',
  vulturekills: 'COME DOWN!',
  dieonce: 'DEATH? I DONT CARE'
};

function cfgGet(path, fallback){
  try{
    const get=data?.config?.get?.bind(data.config); if(!get) return fallback;
    const v=get(path); if(v!==undefined && v!==null && String(v).trim?.()!=='') return v;
    const i=path.indexOf('.'); if(i>0){ const head=path.slice(0,i), tail=path.slice(i+1); const obj=get(head); if(obj && typeof obj==='object' && obj[tail]!==undefined) return obj[tail]; }
  }catch{}
  return fallback;
}
function num(v, def){ const n=Number(v); return Number.isNaN(n)?def:n; }
function minutesOrMs(minKey, msKey, defMs){
  const min=num(cfgGet(minKey,undefined),undefined);
  if(min!==undefined) return Math.max(0,min)*60000;
  const ms=num(cfgGet(msKey,undefined),undefined);
  return ms!==undefined?Math.max(0,ms):defMs;
}
function targetMs(type){
  if(type==='timespent')  return minutesOrMs('targets.timespentMinutes','targets.timespentMs',3600000);
  if(type==='unkillable') return minutesOrMs('targets.unkillableMinutes','targets.unkillableMs',10800000);
  return 0;
}
function targetCount(type){
  const defaults={ vote:1,zombiekills:200,levelgain:5,shopquest:1,feralkills:10,vulturekills:10,dieonce:1 };
  return num(cfgGet(`targets.${type}`,defaults[type]),defaults[type]);
}

async function getActiveTypes(gsId,moduleId,date){
  try{
    const r=await takaro.variable.variableControllerSearch({ filters:{ key:[DAILY_ACTIVE_TYPES_KEY], gameServerId:[gsId], moduleId:[moduleId] }, limit:1 });
    if(r.data.data.length){
      const p=JSON.parse(r.data.data[0].value);
      if(p?.date===date && Array.isArray(p.types)) return p.types;
    }
  }catch{}
  return ['vote','levelgain','zombiekills','feralkills','dieonce'];
}
async function getQuestVar(gsId,moduleId,playerId,date,type){
  const key=`dailyquest_${playerId}_${date}_${type}`;
  const s=await takaro.variable.variableControllerSearch({ filters:{ key:[key], gameServerId:[gsId], playerId:[playerId], moduleId:[moduleId] }, limit:1 });
  return s.data.data.length ? s.data.data[0] : null;
}
async function saveQuestVar(id,payload){ try{ await takaro.variable.variableControllerUpdate(id,{ value: JSON.stringify(payload) }); }catch{} }
async function getPlayerName(gsId,pogId){
  try{ const pog=(await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gsId,pogId)).data.data;
       const p=await takaro.player.playerControllerGetOne(pog.playerId); return p.data.data.name; }catch{ return null; }
}
async function notifyComplete(gsId,pid,type){
  try{ const name=await getPlayerName(gsId,pid); if(!name) return;
       await pm(gsId,name,`✔ ${(DISPLAY[type]||type.toUpperCase())} complete! Reward will be claimed shortly.`); }catch{}
}

function classifyKill(e){
  const meta=e?.meta||{}, payload=e?.payload||e?.data||{};
  const msg=String(meta.msg||'').toLowerCase(), entity=String(meta.entity||'').toLowerCase();
  const ent2=String(payload.entityName||payload.entity||payload.target||payload.entityClass||'').toLowerCase();
  const t=`${msg} ${entity} ${ent2}`; const isVulture=t.includes('vulture'), isFeral=t.includes('feral');
  const isZombieWord=t.includes('zombie')||t.includes('zomb'); return { isZombie: isZombieWord||isFeral, isFeral, isVulture };
}
function isCompletedShop(e){ const s=(e?.meta?.status||e?.payload?.status||'').toUpperCase(); return s==='COMPLETED'; }

async function fetchEvents(gsId,eventName,sinceISO,limit=300){
  try{
    const r=await takaro.event.eventControllerSearch({ filters:{ eventName:[eventName], gameserverId:[gsId] }, greaterThan:{ createdAt: sinceISO }, limit });
    return r.data.data||[];
  }catch{ return []; }
}

async function readTodayOwnDaily(gsId,moduleId,date){
  const r=await takaro.variable.variableControllerSearch({ filters:{ gameServerId:[gsId], moduleId:[moduleId] }, limit: OWN_DAILY_LIMIT });
  const m=new Map();
  for(const v of r.data.data){
    if(typeof v.key!=='string') continue;
    if(!v.key.startsWith('dailyquest_')) continue;
    if(!v.key.includes(`_${date}_`)) continue;
    m.set(v.key,v);
  }
  return m;
}

async function getResetStamp(gsId,moduleId,playerId,date){
  const key = `${PLAYER_RESET_KEY_PREFIX}${playerId}_${date}`;
  try{
    const r=await takaro.variable.variableControllerSearch({ filters:{ key:[key], gameServerId:[gsId], moduleId:[moduleId] }, limit:1 });
    if(!r.data.data.length) return 0;
    const raw=r.data.data[0].value;
    const n=Number(raw); if(!Number.isNaN(n) && n>0) return n;
    const t=Date.parse(raw); return Number.isFinite(t)?t:0;
  }catch{ return 0; }
}

async function main(){
  const start=Date.now(); const within=()=> (Date.now()-start)<BUDGET_MS;
  const { gameServerId: gsId, module: mod } = data;

  const today=ymd();
  let lastReset=null; try{
    const r=await takaro.variable.variableControllerSearch({ filters:{ key:[LAST_RESET_KEY], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
    if(r.data.data.length) lastReset=r.data.data[0].value;
  }catch{}
  const date=(lastReset===today)?today:ymdYesterday();

  const active=new Set(await getActiveTypes(gsId,mod.moduleId,date));

  let lastRun=new Date(Date.now()-5*60*1000);
  try{
    const r=await takaro.variable.variableControllerSearch({ filters:{ key:[LAST_RUN_KEY], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
    if(r.data.data.length){ const v=r.data.data[0].value; if(v) lastRun=new Date(v); }
  }catch{}
  const sinceISO=lastRun.toISOString();

  const ownDaily = await readTodayOwnDaily(gsId,mod.moduleId,date);

  // 1) Events
  if(within()){
    const kills=await fetchEvents(gsId,'entity-killed',sinceISO,300);
    for(const e of kills){
      if(!within()) break;
      const pid=e.playerId; if(!pid) continue;
      const { isZombie,isFeral,isVulture }=classifyKill(e);
      if(isZombie && active.has('zombiekills')){
        const v=await getQuestVar(gsId,mod.moduleId,pid,date,'zombiekills');
        if(v){ let q; try{ q=JSON.parse(v.value);}catch{q=null;} if(q){
          const tgt=targetCount('zombiekills'); const was=!!q.completed;
          q.progress=(q.progress||0)+1; q.completed=q.progress>=tgt || q.completed; q.target ||= tgt;
          if(!was && q.completed && !q.notified){ await notifyComplete(gsId,pid,'zombiekills'); q.notified=true; }
          await saveQuestVar(v.id,q);
        }}
      }
      if(isFeral && active.has('feralkills')){
        const v=await getQuestVar(gsId,mod.moduleId,pid,date,'feralkills');
        if(v){ let q; try{ q=JSON.parse(v.value);}catch{q=null;} if(q){
          const tgt=targetCount('feralkills'); const was=!!q.completed;
          q.progress=(q.progress||0)+1; q.completed=q.progress>=tgt || q.completed; q.target ||= tgt;
          if(!was && q.completed && !q.notified){ await notifyComplete(gsId,pid,'feralkills'); q.notified=true; }
          await saveQuestVar(v.id,q);
        }}
      }
      if(isVulture && active.has('vulturekills')){
        const v=await getQuestVar(gsId,mod.moduleId,pid,date,'vulturekills');
        if(v){ let q; try{ q=JSON.parse(v.value);}catch{q=null;} if(q){
          const tgt=targetCount('vulturekills'); const was=!!q.completed;
          q.progress=(q.progress||0)+1; q.completed=q.progress>=tgt || q.completed; q.target ||= tgt;
          if(!was && q.completed && !q.notified){ await notifyComplete(gsId,pid,'vulturekills'); q.notified=true; }
          await saveQuestVar(v.id,q);
        }}
      }
    }

    if(within() && active.has('shopquest')){
      const shops=await fetchEvents(gsId,'shop-order-status-changed',sinceISO,300);
      for(const e of shops){
        if(!within()) break;
        if(!isCompletedShop(e) || !e.playerId) continue;
        const v=await getQuestVar(gsId,mod.moduleId,e.playerId,date,'shopquest');
        if(!v) continue; let q; try{ q=JSON.parse(v.value);}catch{q=null;} if(!q) continue;
        const tgt=targetCount('shopquest'); const was=!!q.completed;
        q.progress=(q.progress||0)+1; q.completed=q.progress>=tgt || q.completed; q.target ||= tgt;
        if(!was && q.completed && !q.notified){ await notifyComplete(gsId,e.playerId,'shopquest'); q.notified=true; }
        await saveQuestVar(v.id,q);
      }
    }
  }

  // 2) External sync
  if(within()){
    const want=new Set(EXTERNAL_TYPES.filter(t=>active.has(t)));
    if(want.size){
      for(const [key,vOwn] of ownDaily){
        if(!within()) break;
        const type=key.split('_')[3]||'';
        if(!want.has(type)) continue;
        let qOwn; try{ qOwn=JSON.parse(vOwn.value);}catch{qOwn=null;} if(!qOwn) continue;

        const any=await takaro.variable.variableControllerSearch({ filters:{ key:[key], gameServerId:[gsId] }, limit:2 });
        let best=null;
        for(const cand of any.data.data){
          try{
            const p=JSON.parse(cand.value);
            if(!best) best={v:cand,p};
            else{
              const better=(Number(p.progress||0)>Number(best.p.progress||0)) || (!best.p.completed && p.completed===true);
              if(better) best={v:cand,p};
            }
          }catch{}
        }
        if(!best) continue;

        const ext=best.p;
        const tgt=(type==='timespent'||type==='unkillable')?targetMs(type):targetCount(type);
        const extProg=Number(ext.progress||0), ownProg=Number(qOwn.progress||0);
        const extDone=!!ext.completed, ownDone=!!qOwn.completed;
        if(extProg>ownProg || (extDone && !ownDone)){
          qOwn.progress=Math.max(ownProg,extProg);
          qOwn.completed=ownDone||extDone;
          qOwn.claimed=!!(qOwn.claimed||ext.claimed);
          qOwn.target ||= tgt;
          await saveQuestVar(vOwn.id,qOwn);
        }
      }
    }
  }

  // 3) Time updates
  if(within()){
    const timespentPlayers=new Set(); const unkillPlayers=new Set();
    for(const [k,v] of ownDaily){ if(k.endsWith('_timespent')) timespentPlayers.add(v.playerId); if(k.endsWith('_unkillable')) unkillPlayers.add(v.playerId); }

    if(active.has('timespent')){
      const tgt=targetMs('timespent');
      for(const pid of timespentPlayers){ if(!within()) break;
        const qVar=await getQuestVar(gsId,mod.moduleId,pid,date,'timespent'); if(!qVar) continue;
        let q; try{ q=JSON.parse(qVar.value);}catch{q=null;} if(!q) continue;
        const sessKey=`session_${pid}_${date}`;
        const s=await takaro.variable.variableControllerSearch({ filters:{ key:[sessKey], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
        if(!s.data.data.length) continue; let sess; try{ sess=JSON.parse(s.data.data[0].value);}catch{sess=null;} if(!sess) continue;
        const now=Date.now(); if(sess.startTime){ const d=Math.max(0, now - (sess.lastUpdate || sess.startTime)); sess.totalTime=(sess.totalTime||0)+d; sess.lastUpdate=now; }
        const was=!!q.completed; q.progress=sess.totalTime||0; q.target ||= tgt; q.completed=q.progress>=tgt || q.completed;
        if(q.claimed || q.completed){ q.progress=Math.min(q.progress,tgt); sess.totalTime=Math.min(sess.totalTime||0,tgt); sess.startTime=null; sess.lastUpdate=now; }
        else if(!was && q.completed && !q.notified){ await notifyComplete(gsId,pid,'timespent'); q.notified=true; }
        try{ await takaro.variable.variableControllerUpdate(s.data.data[0].id,{ value: JSON.stringify(sess) }); }catch{}
        await saveQuestVar(qVar.id,q);
      }
    }

    if(active.has('unkillable')){
      const tgt=targetMs('unkillable');
      for(const pid of unkillPlayers){ if(!within()) break;
        const qVar=await getQuestVar(gsId,mod.moduleId,pid,date,'unkillable'); if(!qVar) continue;
        let q; try{ q=JSON.parse(qVar.value);}catch{q=null;} if(!q) continue;
        const resetTs=await getResetStamp(gsId,mod.moduleId,pid,date);
        const sessKey=`deathless_session_${pid}_${date}`; const sessRes=await takaro.variable.variableControllerSearch({ filters:{ key:[sessKey], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
        let progress=0;
        if(sessRes.data.data.length){
          let sess; try{ sess=JSON.parse(sessRes.data.data[0].value);}catch{sess=null;}
          const now=Date.now(); if(sess && typeof sess==='object'){
            const effStart=Math.max(Number(sess.startTime||0)||0, resetTs||0);
            const running=effStart?Math.max(0, now - effStart):0;
            progress = resetTs ? running : (Number(sess.totalTime||0)+running);
            if(q.claimed || q.completed){ progress=Math.min(progress,tgt); sess.totalTime=Math.min(Number(sess.totalTime||0),tgt); sess.startTime=null; sess.lastUpdate=now; try{ await takaro.variable.variableControllerUpdate(sessRes.data.data[0].id,{ value: JSON.stringify(sess) }); }catch{} }
            else { sess.lastUpdate=now; try{ await takaro.variable.variableControllerUpdate(sessRes.data.data[0].id,{ value: JSON.stringify(sess) }); }catch{} }
          }
        } else {
          const startKey=`deathless_start_${pid}_${date}`;
          const startRes=await takaro.variable.variableControllerSearch({ filters:{ key:[startKey], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
          if(startRes.data.data.length){
            const raw=startRes.data.data[0].value; let startTs=0;
            try{ const parsed=JSON.parse(raw); if(typeof parsed==='number') startTs=parsed; else if(typeof parsed==='string') startTs=Date.parse(parsed)||Number(parsed)||0; }
            catch{ if(typeof raw==='string') startTs=Date.parse(raw)||Number(raw)||0; else if(typeof raw==='number') startTs=raw; }
            const effStart=Math.max(startTs||0, resetTs||0); if(effStart>0) progress=Math.max(0, Date.now()-effStart);
          }
        }
        const was=!!q.completed; q.progress=progress; q.target ||= tgt; q.completed=q.progress>=tgt || q.completed;
        if(!was && q.completed && !q.notified){ await notifyComplete(gsId,pid,'unkillable'); q.notified=true; }
        await saveQuestVar(qVar.id,q);
      }
    }
  }

  try{
    const nowISO=new Date().toISOString();
    const s=await takaro.variable.variableControllerSearch({ filters:{ key:[LAST_RUN_KEY], gameServerId:[gsId], moduleId:[mod.moduleId] }, limit:1 });
    if(s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id,{ value: nowISO });
    else await takaro.variable.variableControllerCreate({ key: LAST_RUN_KEY, value: nowISO, gameServerId: gsId, moduleId: mod.moduleId });
  }catch{}
}

await main();
