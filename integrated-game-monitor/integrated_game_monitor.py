#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
integrated_game_monitor.py - v17

Features:
- Stable telnet connection with single-flight listplayers (no concurrent runs)
- Cooldown to avoid listplayers spam / collisions
- Robust listplayers read window
- Optional retry queue for quest updates
- Supports Steam + XBL + EOS players for quest updates
- Handles PrismaCore "[PrismaCore]playerLeveled" directly (reliable)
- ALSO keeps listplayers diff as a fallback, but now with DEDUPLICATION so levelgain won't double increment

v17 changes (from v16):
- Fixed multi-word messages being truncated to the first word: the server now
  requires the whole text argument to be wrapped in double quotes whenever it
  contains a space, both for "pm2 <channel> <player> "<text>"" and "say "<text>"".
  Single-word messages are sent without quotes (matches confirmed working example).

v16 changes (from v15):
- Updated send_pm to use the new pm2 syntax required by server v3.1+:
  pm2 <channel> <player_or_id> <text>  (no quotes around the text)
  Example: pm2 Brewer BohemianBrewer zkouska

v15 changes (from v14):
- Add levelgain dedupe cache so PrismaCore + listplayers won't double-count the same level-up.
"""

import telnetlib
import time
import threading
import re
import os
import json
import logging
import requests
from collections import deque

# --------------------- logging ---------------------

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("/home/steam/7D2DBohemia/integrated-game-monitor/integrated_monitor.log"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

# --------------------- config ---------------------

HOST = "91.99.236.133"
PORT = 8081
PASSWORD = "ferPa932"

# Private message channel name required by pm2 syntax: pm2 <channel> <player> <text>
PM_CHANNEL = "Brewer"

LEVELS_FILE = "/home/steam/7D2DBohemia/runtime-state-backups/players_levels.json"

# listplayers polling interval
LISTPLAYERS_POLL_SECONDS = 60

# prevent XP-triggered refresh from racing with periodic poll / startup scan
LISTPLAYERS_COOLDOWN_SECONDS = 8.0

# how long to collect telnet output after issuing listplayers
LISTPLAYERS_READ_WINDOW_SECONDS = 2.2
LISTPLAYERS_READ_SLEEP_SECONDS = 0.12

# treat very small outputs as noise/echo
LISTPLAYERS_MIN_USEFUL_CHARS = 120

# dedupe window for levelgain updates (PrismaCore handler + listplayers diff)
LEVELGAIN_DEDUPE_TTL_SECONDS = 180

# --- optional retry queue for quest updates ---
ENABLE_RETRY_QUEUE = True
RETRY_QUEUE_FILE = "/home/steam/7D2DBohemia/runtime-state-backups/quest_retry_queue.json"
RETRY_FLUSH_INTERVAL_SECONDS = 60
RETRY_MAX_ITEMS = 500
RETRY_MAX_AGE_SECONDS = 6 * 60 * 60  # 6h

CATCHUP_MATRIX = [
    {"min": 100, "max": 150, "target": 60},
    {"min": 151, "max": 200, "target": 80},
    {"min": 201, "max": 250, "target": 120},
    {"min": 251, "max": 300, "target": 180},
    {"min": 301, "max": 350, "target": 240},
    {"min": 351, "max": 400, "target": 280},
    {"min": 401, "max": 450, "target": 320},
]


# ===================== TAKARO QUEST INTEGRATION =====================


class TakaroQuestIntegration:
    """Handles communication with the Node.js Takaro quest server"""

    def __init__(self, quest_server_url="http://localhost:3000"):
        self.quest_server_url = quest_server_url
        self.session = requests.Session()

    def check_server_health(self):
        try:
            response = self.session.get(f"{self.quest_server_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                logger.info(
                    "Quest server: %s, authenticated: %s",
                    data.get("status"),
                    data.get("authenticated"),
                )
                return bool(data.get("authenticated", False))
            return False
        except Exception as e:
            logger.error("Quest server health check failed: %s", e)
            return False

    def update_quest(
        self,
        player_name,
        quest_type,
        increment=1,
        steam_id=None,
        platform=None,
        platform_id=None,
    ):
        """
        Backwards compatible:
        - Steam players: provide steam_id
        - Non-steam players: provide platform in {"xbl","eos"} and platform_id
        """
        try:
            payload = {
                "playerName": player_name,
                "questType": quest_type,
                "increment": int(increment),
            }

            if steam_id:
                payload["steamId"] = str(steam_id)
            elif platform and platform_id:
                payload["platform"] = str(platform)
                payload["platformId"] = str(platform_id)

            logger.debug("Sending quest update: %s", payload)
            response = self.session.post(
                f"{self.quest_server_url}/update-quest",
                json=payload,
                timeout=12,
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    quest_data = data.get("questData", {}) or {}
                    progress = quest_data.get("progress", 0)
                    target = quest_data.get("target", 0)
                    logger.info("Quest update success for %s: %s/%s", player_name, progress, target)
                    return True
                logger.error("Quest update failed: %s", data.get("error", "Unknown error"))
                return False

            try:
                data = response.json()
                logger.error("Quest update failed: status=%s body=%s", response.status_code, data)
            except Exception:
                logger.error("Quest server returned status %s", response.status_code)
            return False

        except requests.exceptions.RequestException as e:
            logger.error("Network error updating quest: %s", e)
            return False
        except Exception as e:
            logger.error("Unexpected error updating quest: %s", e)
            return False


# ===================== MAIN MONITOR =====================


class IntegratedMonitor:
    def __init__(self, host, port, password):
        self.host = host
        self.port = port
        self.password = password
        self.tn = None

        # Telnet access lock (prevents concurrent write/read)
        self.tn_lock = threading.Lock()

        # Additional lock so update_player_levels() cannot run concurrently
        self.listplayers_lock = threading.Lock()

        self.reconnect_delay = 30
        self.max_reconnect_delay = 480
        self.command_delay = 0.4

        self.players_levels = self.load_player_levels()

        self.quest_integration = TakaroQuestIntegration()
        self.quest_server_healthy = False

        # legacy: playerName -> steamId64
        self.player_steam_ids = {}

        # playerName -> identity dict: {"kind": "steam"|"xbl"|"eos", "value": "..."}
        self.player_identity = {}

        self.last_listplayers_ts = 0.0

        # Dedupe cache for levelgain increments
        self.levelgain_dedupe = {}  # key -> ts
        self.levelgain_dedupe_ttl = LEVELGAIN_DEDUPE_TTL_SECONDS

        # retry queue
        self.retry_queue = deque()
        if ENABLE_RETRY_QUEUE:
            self._load_retry_queue()

    # ---------- Dedupe helpers ----------

    def _dedupe_key_levelgain(self, player_name, old_level, new_level):
        return f"{player_name}|{old_level}->{new_level}"

    def _dedupe_purge(self):
        now = time.time()
        for k, ts in list(self.levelgain_dedupe.items()):
            if (now - ts) > self.levelgain_dedupe_ttl:
                self.levelgain_dedupe.pop(k, None)

    def _dedupe_seen_recently(self, key):
        self._dedupe_purge()
        ts = self.levelgain_dedupe.get(key)
        if ts is None:
            return False
        return (time.time() - ts) <= self.levelgain_dedupe_ttl

    def _dedupe_mark(self, key):
        self.levelgain_dedupe[key] = time.time()

    # ---------- Identity helpers ----------

    def remember_identity(self, player_name, kind, value):
        if not player_name or not kind or not value:
            return
        player_name = str(player_name).strip()
        kind = str(kind).strip().lower()
        value = str(value).strip()

        if not player_name or not value:
            return
        if kind not in ("steam", "xbl", "eos"):
            return

        # normalize common prefixes
        if kind == "steam":
            value = value.replace("Steam_", "").strip()
        elif kind == "xbl":
            value = value.replace("XBL_", "").strip()
        elif kind == "eos":
            value = value.replace("EOS_", "").strip()

        if not value:
            return

        self.player_identity[player_name] = {"kind": kind, "value": value}

        # keep legacy steam map too
        if kind == "steam" and value.isdigit():
            self.player_steam_ids[player_name] = value

    def remember_steam_id(self, player_name, steam_id):
        if not player_name or not steam_id:
            return
        sid = str(steam_id).strip()
        if not sid.isdigit():
            return
        self.player_steam_ids[player_name] = sid
        self.player_identity[player_name] = {"kind": "steam", "value": sid}

    def get_identity(self, player_name):
        return self.player_identity.get(player_name)

    def get_steam_id(self, player_name):
        return self.player_steam_ids.get(player_name)

    # ---------- Retry queue ----------

    def _load_retry_queue(self):
        try:
            if not os.path.exists(RETRY_QUEUE_FILE):
                return
            with open(RETRY_QUEUE_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)
            now = time.time()
            kept = 0
            for it in items:
                if (now - float(it.get("ts", 0))) <= RETRY_MAX_AGE_SECONDS:
                    self.retry_queue.append(it)
                    kept += 1
            logger.info("Loaded retry queue items: %s", kept)
        except Exception as e:
            logger.error("Failed to load retry queue: %s", e)

    def _save_retry_queue(self):
        try:
            if not ENABLE_RETRY_QUEUE:
                return
            items = list(self.retry_queue)[-RETRY_MAX_ITEMS:]
            with open(RETRY_QUEUE_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=2)
        except Exception as e:
            logger.error("Failed to save retry queue: %s", e)

    def _enqueue_retry(self, payload):
        if not ENABLE_RETRY_QUEUE:
            return
        payload = dict(payload)
        payload["ts"] = time.time()

        if len(self.retry_queue) >= RETRY_MAX_ITEMS:
            self.retry_queue.popleft()
        self.retry_queue.append(payload)
        self._save_retry_queue()
        logger.warning("Queued quest update for retry: %s", payload)

    def _flush_retry_queue_once(self):
        if not ENABLE_RETRY_QUEUE or not self.retry_queue:
            return
        if not self.quest_server_healthy:
            return

        max_to_try = 10
        tried = 0
        now = time.time()

        new_q = deque()

        while self.retry_queue and tried < max_to_try:
            item = self.retry_queue.popleft()
            tried += 1

            if (now - float(item.get("ts", 0))) > RETRY_MAX_AGE_SECONDS:
                logger.warning("Dropping expired retry item: %s", item)
                continue

            ok = self.quest_integration.update_quest(
                item["playerName"],
                item["questType"],
                item.get("increment", 1),
                steam_id=item.get("steamId"),
                platform=item.get("platform"),
                platform_id=item.get("platformId"),
            )
            if not ok:
                new_q.append(item)

        while self.retry_queue:
            new_q.append(self.retry_queue.popleft())

        self.retry_queue = new_q
        self._save_retry_queue()
        if tried:
            logger.info("Retry flush attempted: %s, remaining queued: %s", tried, len(self.retry_queue))

    # ---------- Levels file ----------

    def load_player_levels(self):
        if os.path.exists(LEVELS_FILE):
            try:
                with open(LEVELS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.info("Loaded %s player levels from file", len(data))
                return data
            except Exception as e:
                logger.error("Error loading levels file: %s", e)
        return {}

    def save_player_levels(self):
        try:
            with open(LEVELS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.players_levels, f, indent=2, ensure_ascii=False)
            logger.debug("Saved %s player levels to file", len(self.players_levels))
        except Exception as e:
            logger.error("Error saving levels file: %s", e)

    # ---------- Telnet connect/send ----------

    def connect(self):
        try:
            logger.info("Connecting to %s:%s", self.host, self.port)
            self.tn = telnetlib.Telnet(self.host, self.port, timeout=10)

            with self.tn_lock:
                self.tn.read_until(b"Please enter password:", timeout=5)
                self.tn.write(self.password.encode("utf-8") + b"\n")
            time.sleep(0.7)

            with self.tn_lock:
                self.tn.read_very_eager()
                logger.debug("Warming up telnet connection...")
                self.tn.write(b"version\n")
            time.sleep(0.4)
            with self.tn_lock:
                self.tn.read_very_eager()

            logger.info("Connected to telnet OK")
            self.reconnect_delay = 30

            logger.info("Checking Takaro quest server...")
            self.quest_server_healthy = self.quest_integration.check_server_health()
            if self.quest_server_healthy:
                logger.info("Quest server is healthy and authenticated")
            else:
                logger.warning("Quest server is NOT healthy/authenticated (quest updates will be skipped)")

            self.update_player_levels(force=True)
            return True

        except Exception as e:
            logger.error("Connection failed: %s", e)
            return False

    def send_command(self, command):
        try:
            with self.tn_lock:
                logger.debug("Sending command: %s", command)
                self.tn.write(f"{command}\n".encode("utf-8"))
                time.sleep(self.command_delay)
                self.tn.read_very_eager()
            return True
        except Exception as e:
            logger.error("Error sending command: %s", e)
            return False

    @staticmethod
    def _quote_if_needed(text):
        """Wrap text in double quotes if it contains whitespace.
        The server only reads the first word of an unquoted multi-word argument,
        so any message with more than one word must be quoted. Single-word
        messages are sent unquoted (matches the confirmed working examples).
        """
        text = str(text)
        if re.search(r"\s", text):
            escaped = text.replace('"', '\\"')
            return f'"{escaped}"'
        return text

    def send_pm(self, player_name, message):
        """Send a private message using the pm2 syntax:
        pm2 <channel> <player_or_id> <text>
        Multi-word text must be quoted, e.g.:
        pm2 Brewer 171 "test delsi vety kde jsou mezery"
        """
        quoted_message = self._quote_if_needed(message)
        for _ in range(2):
            if self.send_command(f"pm2 {PM_CHANNEL} {player_name} {quoted_message}"):
                return True
            time.sleep(0.7)
        return False

    # ---------- listplayers helpers ----------

    def _read_listplayers_output(self):
        chunks = []
        end = time.time() + LISTPLAYERS_READ_WINDOW_SECONDS
        while time.time() < end:
            with self.tn_lock:
                data = self.tn.read_very_eager()
            if data:
                chunks.append(data.decode("utf-8", errors="ignore"))
            time.sleep(LISTPLAYERS_READ_SLEEP_SECONDS)
        return "".join(chunks)

    # ---------- Level polling + quest trigger ----------

    def update_player_levels(self, force=False):
        if not self.listplayers_lock.acquire(blocking=False):
            logger.debug("Skipping update_player_levels (already running)")
            return

        try:
            now = time.time()
            if (not force) and (now - self.last_listplayers_ts) < LISTPLAYERS_COOLDOWN_SECONDS:
                logger.debug("Skipping listplayers (cooldown)")
                return

            logger.info("Updating player levels...")

            with self.tn_lock:
                self.tn.read_very_eager()
                self.tn.write(b"listplayers\n")

            response = self._read_listplayers_output()
            logger.debug("Listplayers response length: %s", len(response))

            if not response.strip() or len(response) < LISTPLAYERS_MIN_USEFUL_CHARS:
                return

            leveled_up = []
            seen_names = set()

            pattern_b = r"id=(\d+),\s*([^,]+),.*?level=(\d+).*?pltfmid=Steam_(\d+)"
            matches_b = re.findall(pattern_b, response)

            for _eid, player_name, lvl, sid in matches_b:
                player_name = player_name.strip()
                level = int(lvl)
                seen_names.add(player_name)

                self.remember_identity(player_name, "steam", sid)

                old_level = int(self.players_levels.get(player_name, 0) or 0)
                self.players_levels[player_name] = level

                if old_level != level:
                    logger.info("Updated %s level: %s -> %s", player_name, old_level, level)
                if level > old_level:
                    leveled_up.append((player_name, old_level, level))

            pattern_a = r"id=(\d+),\s*([^,]+),.*?level=(\d+)"
            matches_a = re.findall(pattern_a, response)
            for _eid, player_name, lvl in matches_a:
                player_name = player_name.strip()
                if player_name in seen_names:
                    continue
                level = int(lvl)

                old_level = int(self.players_levels.get(player_name, 0) or 0)
                self.players_levels[player_name] = level

                if old_level != level:
                    logger.info("Updated %s level: %s -> %s", player_name, old_level, level)
                if level > old_level:
                    leveled_up.append((player_name, old_level, level))

            self.save_player_levels()
            self.last_listplayers_ts = time.time()
            logger.info("Player levels updated. Total players tracked: %s", len(self.players_levels))

            if not leveled_up:
                return

            if not self.quest_server_healthy:
                logger.warning("Quest server not available for level updates right now")
                return

            for player_name, old_level, new_level in leveled_up:
                inc = max(1, new_level - old_level)
                dedupe_key = self._dedupe_key_levelgain(player_name, old_level, new_level)
                if self._dedupe_seen_recently(dedupe_key):
                    logger.info(
                        "Skipping duplicate levelgain (listplayers) for %s %s->%s",
                        player_name,
                        old_level,
                        new_level,
                    )
                    continue

                ident = self.get_identity(player_name) or {}
                kind = ident.get("kind")
                val = ident.get("value")

                if kind == "steam" and val and str(val).isdigit():
                    logger.info(
                        "Level up detected via listplayers: %s %s->%s (+%s); updating levelgain quest (steam)",
                        player_name,
                        old_level,
                        new_level,
                        inc,
                    )
                    self._dedupe_mark(dedupe_key)
                    ok = self.quest_integration.update_quest(
                        player_name,
                        "levelgain",
                        inc,
                        steam_id=val,
                    )
                    if not ok:
                        logger.error("Failed to update levelgain quest for %s", player_name)
                        self._enqueue_retry(
                            {"playerName": player_name, "steamId": val, "questType": "levelgain", "increment": inc}
                        )
                    continue

                if kind in ("xbl", "eos") and val:
                    logger.info(
                        "Level up detected via listplayers: %s %s->%s (+%s); updating levelgain quest (%s)",
                        player_name,
                        old_level,
                        new_level,
                        inc,
                        kind,
                    )
                    self._dedupe_mark(dedupe_key)
                    ok = self.quest_integration.update_quest(
                        player_name,
                        "levelgain",
                        inc,
                        platform=kind,
                        platform_id=val,
                    )
                    if not ok:
                        logger.error("Failed to update levelgain quest for %s (%s)", player_name, kind)
                        self._enqueue_retry(
                            {
                                "playerName": player_name,
                                "platform": kind,
                                "platformId": val,
                                "questType": "levelgain",
                                "increment": inc,
                            }
                        )
                    continue

                logger.error(
                    "Cannot update levelgain for %s (%s->%s): no identity known (steam/xbl/eos)",
                    player_name,
                    old_level,
                    new_level,
                )

        except Exception as e:
            logger.error("Error updating player levels: %s", e)
        finally:
            try:
                self.listplayers_lock.release()
            except Exception:
                pass

    # ---------- Catchup ----------

    def get_highest_level(self):
        if not self.players_levels:
            return 1
        return max(int(v or 0) for v in self.players_levels.values())

    def xp_for_level(self, level):
        if level <= 60:
            return 3702082
        return 3702082 + (level - 60) * 186791

    def target_level_from_highest(self, highest):
        for entry in CATCHUP_MATRIX:
            if entry["min"] <= highest <= entry["max"]:
                return entry["target"]
        return None

    def handle_catchup_command(self, player_name, steam_id=None):
        player_level = int(self.players_levels.get(player_name, 1) or 1)
        if player_level > 1:
            self.send_pm(player_name, "You cannot use /catchup because you are above level 1.")
            return

        highest = self.get_highest_level()
        target_level = self.target_level_from_highest(highest)
        if not target_level:
            self.send_pm(player_name, "Catchup not available yet. Server highest level too low.")
            return

        xp = self.xp_for_level(target_level)
        self.send_command(f"givexp {player_name} {xp}")
        self.send_pm(player_name, f"Catchup applied! You are now level {target_level}.")
        self.players_levels[player_name] = target_level
        self.save_player_levels()

    # ---------- Threads ----------

    def periodic_updates(self):
        while self.tn:
            try:
                self.update_player_levels(force=False)
                time.sleep(LISTPLAYERS_POLL_SECONDS)
            except Exception as e:
                logger.error("Periodic update error: %s", e)
                time.sleep(10)

    def periodic_quest_health_check(self):
        while self.tn:
            try:
                time.sleep(300)
                old = self.quest_server_healthy
                self.quest_server_healthy = self.quest_integration.check_server_health()
                if old != self.quest_server_healthy:
                    logger.info("Quest server health changed: %s -> %s", old, self.quest_server_healthy)
            except Exception as e:
                logger.error("Health check error: %s", e)

    def periodic_retry_flush(self):
        if not ENABLE_RETRY_QUEUE:
            return
        while self.tn:
            try:
                time.sleep(RETRY_FLUSH_INTERVAL_SECONDS)
                self._flush_retry_queue_once()
            except Exception as e:
                logger.error("Retry flush error: %s", e)

    # ---------- Main loop ----------

    def monitor_chat(self):
        logger.info("Starting enhanced chat monitor with Takaro quest integration")

        threading.Thread(target=self.periodic_updates, daemon=True).start()
        threading.Thread(target=self.periodic_quest_health_check, daemon=True).start()
        if ENABLE_RETRY_QUEUE:
            threading.Thread(target=self.periodic_retry_flush, daemon=True).start()

        while self.tn:
            try:
                with self.tn_lock:
                    line = self.tn.read_until(b"\n", timeout=1)

                if not line:
                    continue

                line_str = line.decode("utf-8", errors="ignore").strip()
                if not line_str:
                    continue

                if any(
                    k in line_str
                    for k in [
                        "Chat",
                        "catchup",
                        "vote",
                        "XP gained",
                        "playerLeveled",
                        "listplayers",
                        "voting reward",
                        "[PrismaCore]playerLeveled",
                    ]
                ):
                    logger.debug("Received: %s", line_str)

                # Learn platform identity from any chat line (Steam/XBL/EOS)
                chat_any = re.search(r"Chat \(from '([^']+)',.*?\): '(.+?)':", line_str)
                if chat_any:
                    from_id = chat_any.group(1)
                    pname = chat_any.group(2)

                    if from_id.startswith("Steam_"):
                        sid = from_id.replace("Steam_", "").strip()
                        self.remember_identity(pname, "steam", sid)
                    elif from_id.startswith("XBL_"):
                        xid = from_id.replace("XBL_", "").strip()
                        self.remember_identity(pname, "xbl", xid)
                    elif from_id.startswith("EOS_"):
                        eid = from_id.replace("EOS_", "").strip()
                        self.remember_identity(pname, "eos", eid)

                # /catchup (steam-only)
                catchup_match = re.search(
                    r"Chat \(from 'Steam_(\d+)', entity id '(\d+)', to 'Global'\): '(.+?)':/catchup",
                    line_str,
                )
                if catchup_match:
                    sid = catchup_match.group(1)
                    pname = catchup_match.group(3)
                    self.remember_identity(pname, "steam", sid)
                    logger.info("Detected /catchup from %s", pname)
                    time.sleep(0.2)
                    self.handle_catchup_command(pname, sid)

                # PrismaCore level-up line (reliable for Steam + XBL)
                lvl_match = re.search(
                    r"\[PrismaCore\]playerLeveled:\s*([^(]+)\s*\(([^)]+)\)\s*made level\s*(\d+)\s*\(was\s*(\d+)\)",
                    line_str,
                )
                if lvl_match:
                    pname = lvl_match.group(1).strip()
                    plat_raw = lvl_match.group(2).strip()  # Steam_... / XBL_... / EOS_...
                    new_level = int(lvl_match.group(3))
                    old_level = int(lvl_match.group(4))
                    inc = max(1, new_level - old_level)

                    dedupe_key = self._dedupe_key_levelgain(pname, old_level, new_level)

                    # Learn identity from this line too
                    if plat_raw.startswith("Steam_"):
                        self.remember_identity(pname, "steam", plat_raw.replace("Steam_", "").strip())
                    elif plat_raw.startswith("XBL_"):
                        self.remember_identity(pname, "xbl", plat_raw.replace("XBL_", "").strip())
                    elif plat_raw.startswith("EOS_"):
                        self.remember_identity(pname, "eos", plat_raw.replace("EOS_", "").strip())

                    if self._dedupe_seen_recently(dedupe_key):
                        logger.info(
                            "Skipping duplicate levelgain (PrismaCore) for %s %s->%s",
                            pname,
                            old_level,
                            new_level,
                        )
                    else:
                        if self.quest_server_healthy:
                            ident = self.get_identity(pname) or {}
                            kind = ident.get("kind")
                            val = ident.get("value")

                            logger.info("PrismaCore level-up detected: %s %s->%s (+%s)", pname, old_level, new_level, inc)

                            ok = False
                            self._dedupe_mark(dedupe_key)

                            if kind == "steam" and val:
                                ok = self.quest_integration.update_quest(pname, "levelgain", inc, steam_id=val)
                            elif kind in ("xbl", "eos") and val:
                                ok = self.quest_integration.update_quest(pname, "levelgain", inc, platform=kind, platform_id=val)
                            else:
                                logger.error("Level-up for %s but no identity known (steam/xbl/eos)", pname)

                            if not ok:
                                payload = {"playerName": pname, "questType": "levelgain", "increment": inc}
                                if kind == "steam" and val:
                                    payload["steamId"] = val
                                elif kind in ("xbl", "eos") and val:
                                    payload["platform"] = kind
                                    payload["platformId"] = val
                                self._enqueue_retry(payload)
                        else:
                            logger.warning("Quest server not available for level updates right now")

                    # Refresh listplayers to keep local cache accurate
                    time.sleep(0.4)
                    self.update_player_levels(force=False)

                # XP message: trigger refresh but guarded by lock + cooldown
                if "XP gained during the last level:" in line_str:
                    logger.info("XP level message detected - refreshing player levels...")
                    time.sleep(0.4)
                    self.update_player_levels(force=False)

            except Exception as e:
                if "connection closed" in str(e).lower():
                    logger.warning("Connection lost")
                    break
                logger.error("Monitor error: %s", e)

    def run(self):
        while True:
            try:
                if not self.connect():
                    logger.info("Waiting %s seconds before retry...", self.reconnect_delay)
                    time.sleep(self.reconnect_delay)
                    self.reconnect_delay = min(self.reconnect_delay * 2, self.max_reconnect_delay)
                    continue

                self.monitor_chat()

            except KeyboardInterrupt:
                logger.info("Shutting down...")
                break
            except Exception as e:
                logger.error("Unexpected error: %s", e)
                time.sleep(self.reconnect_delay)

        if self.tn:
            self.tn.close()


def main():
    logger.info("Integrated Game Monitor Starting")
    logger.info("IMPORTANT: Make sure 'node working_server.js' is running for quest updates!")
    monitor = IntegratedMonitor(HOST, PORT, PASSWORD)
    monitor.run()


if __name__ == "__main__":
    main()
