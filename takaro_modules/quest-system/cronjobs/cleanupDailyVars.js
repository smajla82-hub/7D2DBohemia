// v0.1.1
// - Set expiresAt for old daily quest/session variables while preserving value.
// - Safe to run daily; processes up to 1000 per run based on createdAt cutoff.
// - Configure retentionDays in module config (defaults to 7).
import { takaro, data } from '@takaro/helpers';

const DEFAULT_RETENTION_DAYS = 7;

function num(v, def){ const n=Number(v); return Number.isNaN(n)?def:n; }
function cfgGet(path, fallback){
  try{ const get=data?.config?.get?.bind(data.config); if(!get) return fallback; const v=get(path); if(v!==undefined && v!==null && String(v).trim?.()!=='') return v; }catch{}
  return fallback;
}
function retentionDays(){ return num(cfgGet('retentionDays', DEFAULT_RETENTION_DAYS), DEFAULT_RETENTION_DAYS); }
function cutoffISO(days){ const t=Date.now()-days*86400*1000; return new Date(t).toISOString(); }
function expiresSoonISO(){ return new Date(Date.now()+2*86400*1000).toISOString(); }

const PREFIXES = [ 'dailyquest_', 'session_', 'deathless_session_', 'deathless_start_', 'autoclaim_pending_', 'dailyquests_player_reset_at_' ];

await (async function main(){
  const { gameServerId: gsId, module: mod } = data;
  const cut = cutoffISO(retentionDays());
  try{
    const res = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gsId], moduleId: [mod.moduleId] },
      lessThan: { createdAt: cut },
      limit: 1000
    });
    for(const v of res.data.data){
      if(v.expiresAt) continue;
      if(typeof v.key !== 'string') continue;
      if(!PREFIXES.some(p=>v.key.startsWith(p))) continue;
      const currentValue = typeof v.value === 'string' ? v.value : JSON.stringify(v.value ?? '');
      try{ await takaro.variable.variableControllerUpdate(v.id, { value: currentValue, expiresAt: expiresSoonISO() }); }catch{}
    }
  }catch{}
})();
