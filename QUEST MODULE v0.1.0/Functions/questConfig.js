// =====================================
// Quest Configuration Loader
// =====================================
// Loads quest configuration from module userConfig with sensible fallback defaults

/**
 * Get quest configuration with fallback defaults
 * @param {Object} mod - Module object from data.module
 * @returns {Object} Configuration object with all quest settings
 */
export function getQuestConfig(mod) {
    const userConfig = mod?.userConfig || {};
    
    return {
        // Reset time configuration (HH:mm format for Europe/Prague timezone)
        quest_reset_time_hhmm: userConfig.quest_reset_time_hhmm || "00:15",
        
        // Reward amounts (in beers/currency)
        reward_default_beers: userConfig.reward_default_beers ?? 25,
        reward_vote_beers: userConfig.reward_vote_beers ?? 50,
        reward_unkillable_beers: userConfig.reward_unkillable_beers ?? 50,
        reward_dieonce_beers: userConfig.reward_dieonce_beers ?? 50,
        reward_feralkills_beers: userConfig.reward_feralkills_beers ?? 25,
        reward_vulturekills_beers: userConfig.reward_vulturekills_beers ?? 25,
        
        // Quest targets
        target_timespent_ms: userConfig.target_timespent_ms ?? 3600000,      // 1 hour default
        target_unkillable_ms: userConfig.target_unkillable_ms ?? 10800000,   // 3 hours default
        target_feralkills: userConfig.target_feralkills ?? 10,
        target_vulturekills: userConfig.target_vulturekills ?? 10,
        target_dieonce: userConfig.target_dieonce ?? 1,
        target_zombiekills: userConfig.target_zombiekills ?? 200,
        target_levelgain: userConfig.target_levelgain ?? 5,
        target_shopquest: userConfig.target_shopquest ?? 1,
        
        // Optional time tracking toggle
        enable_time_tracking: userConfig.enable_time_tracking ?? true
    };
}

/**
 * Get target for a specific quest type
 * @param {Object} config - Config object from getQuestConfig()
 * @param {string} questType - Quest type name
 * @returns {number} Target value for the quest type
 */
export function getTargetFor(config, questType) {
    const targetMap = {
        'timespent': config.target_timespent_ms,
        'unkillable': config.target_unkillable_ms,
        'feralkills': config.target_feralkills,
        'vulturekills': config.target_vulturekills,
        'dieonce': config.target_dieonce,
        'zombiekills': config.target_zombiekills,
        'levelgain': config.target_levelgain,
        'shopquest': config.target_shopquest,
        'vote': 1  // Vote always has target of 1
    };
    
    return targetMap[questType] ?? 1;
}

/**
 * Get reward amount for a specific quest type
 * @param {Object} config - Config object from getQuestConfig()
 * @param {string} questType - Quest type name
 * @returns {number} Reward amount in currency
 */
export function getRewardFor(config, questType) {
    const rewardMap = {
        'vote': config.reward_vote_beers,
        'unkillable': config.reward_unkillable_beers,
        'dieonce': config.reward_dieonce_beers,
        'feralkills': config.reward_feralkills_beers,
        'vulturekills': config.reward_vulturekills_beers,
        'timespent': config.reward_default_beers,
        'zombiekills': config.reward_default_beers,
        'levelgain': config.reward_default_beers,
        'shopquest': config.reward_default_beers
    };
    
    return rewardMap[questType] ?? config.reward_default_beers;
}

/**
 * Get Prague time in HH:mm format
 * @returns {string} Current Prague time in HH:mm format
 */
export function getPragueTimeHHMM() {
    const now = new Date();
    const pragueOffset = 1; // CET is UTC+1
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pragueTime = new Date(utc + (3600000 * pragueOffset));
    
    const hours = String(pragueTime.getHours()).padStart(2, '0');
    const minutes = String(pragueTime.getMinutes()).padStart(2, '0');
    
    return `${hours}:${minutes}`;
}

/**
 * Get Prague date in YYYY-MM-DD format
 * @returns {string} Current Prague date
 */
export function getPragueDate() {
    const now = new Date();
    const pragueOffset = 1; // CET is UTC+1
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pragueTime = new Date(utc + (3600000 * pragueOffset));
    return pragueTime.toISOString().split('T')[0];
}
