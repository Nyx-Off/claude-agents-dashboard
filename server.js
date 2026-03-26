const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const DIR = __dirname;
const AGENTS_FILE = path.join(DIR, 'agents.json');
const MAX_BODY = 1024 * 1024;
const MAX_AGENTS = 50;
const DONE_TTL_MS = 30 * 60 * 1000;
const MAX_LOG = 200;
const MAX_TOOL_CALLS = 50;

const EVENT = { START: 'start', DONE: 'done', TOOL: 'tool' };
const STATUS = { WORKING: 'working', DONE: 'done', IDLE: 'idle', ERROR: 'error' };

const AGENT_TYPES = {
  Explore:            { name: 'Explorer',   color: '#00ccff' },
  Plan:               { name: 'Planner',    color: '#cc66ff' },
  Review:             { name: 'Reviewer',   color: '#00ff88' },
  Simplify:           { name: 'Simplifier', color: '#ffcc00' },
  Test:               { name: 'Tester',     color: '#ff4466' },
  'general-purpose':  { name: 'Agent',      color: '#00ccff' },
  general:            { name: 'Agent',      color: '#00ccff' }
};

const DEFAULT_AGENT = { name: 'Agent', color: '#00ccff' };

function resolveAgent(type) {
  return AGENT_TYPES[type] || DEFAULT_AGENT;
}

const indexHtml = fs.readFileSync(path.join(DIR, 'index.html'));

function defaultState() {
  return {
    agents: [],
    log: [],
    startTime: '',
    totalXP: 0,
    version: 0
  };
}

let state = defaultState();

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

function persistAsync() {
  fs.writeFile(AGENTS_FILE, JSON.stringify(state), 'utf8', () => {});
}

function mutate() {
  state.version++;
  persistAsync();
}

state = readState();

function ts() {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(new Error('body too large')); return; }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonOk(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function findWorkingAgent(agents, id, name) {
  for (let i = agents.length - 1; i >= 0; i--) {
    if (agents[i].status === STATUS.WORKING && (agents[i].id === id || agents[i].name === name)) {
      return i;
    }
  }
  for (let i = agents.length - 1; i >= 0; i--) {
    if (agents[i].status === STATUS.WORKING) return i;
  }
  return -1;
}

function pruneAgents(agents) {
  const now = Date.now();
  const filtered = agents.filter(a => {
    if (a.status !== STATUS.DONE) return true;
    const age = now - (a.startEpoch ? a.startEpoch * 1000 : now);
    return age < DONE_TTL_MS;
  });
  if (filtered.length > MAX_AGENTS) return filtered.slice(-MAX_AGENTS);
  return filtered;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const url = parsed.pathname;

  if (url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
    return;
  }

  if (url === '/api/agents' && req.method === 'GET') {
    const clientVersion = parseInt(parsed.searchParams.get('v'), 10);
    if (!isNaN(clientVersion) && clientVersion === state.version) {
      res.writeHead(304);
      res.end();
      return;
    }
    jsonOk(res, state);
    return;
  }

  if (url === '/api/agents' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { res.writeHead(413); res.end(); return; }
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('{"error":"bad json"}'); return; }
    state = { ...defaultState(), ...parsed, version: state.version };
    mutate();
    jsonOk(res, { ok: true });
    return;
  }

  if (url === '/api/event' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { res.writeHead(413); res.end(); return; }

    let evt;
    try { evt = JSON.parse(body); } catch {
      res.writeHead(400);
      res.end('{"error":"bad json"}');
      return;
    }

    const t = ts();
    const epoch = Math.floor(Date.now() / 1000);

    if (evt.event === EVENT.START) {
      const { name: aName, color: aColor } = resolveAgent(evt.agent_type);
      const aid = evt.id || `agent_${Date.now()}`;
      // Count existing agents with the same base name to create unique label
      const sameNameCount = state.agents.filter(a => a.name === aName).length;
      const label = sameNameCount > 0 ? `${aName} #${sameNameCount + 1}` : aName;
      // Retroactively label the first one if this is the second
      if (sameNameCount === 1) {
        const first = state.agents.find(a => a.name === aName && !a.label.includes('#'));
        if (first) first.label = `${aName} #1`;
      }
      state.agents.push({
        id: aid, name: aName, label: label, type: evt.agent_type || 'general',
        color: aColor, status: STATUS.WORKING, task: evt.description || 'Working...',
        prompt: evt.prompt || '', toolCalls: [],
        startedAt: t, startEpoch: epoch
      });
      state.log.push({ time: t, agent: label, msg: `Started: ${evt.description || '?'}`, color: aColor });
      console.log(`  \x1b[36m+ ${label}\x1b[0m: ${evt.description}`);
    } else if (evt.event === EVENT.DONE) {
      const { name: aName, color: aColor } = resolveAgent(evt.agent_type);
      const aid = evt.id || `agent_${Date.now()}`;
      const idx = findWorkingAgent(state.agents, aid, aName);
      if (idx >= 0) {
        const agent = state.agents[idx];
        agent.status = STATUS.DONE;
        agent.endedAt = t;
        // Mark all remaining "running" tool calls as done
        for (const tc of agent.toolCalls) {
          if (tc.status === 'running') { tc.status = 'done'; tc.endTime = t; }
        }
        state.log.push({ time: t, agent: agent.label || aName, msg: `Done (${agent.toolCalls.length} tool calls)`, color: aColor });
      } else {
        state.log.push({ time: t, agent: aName, msg: `Done: ${evt.description || '?'}`, color: aColor });
      }
      state.totalXP += 25;
      console.log(`  \x1b[32mv ${aName}\x1b[0m: done`);
    } else if (evt.event === EVENT.TOOL) {
      // Find the target agent by agent_id from Claude Code
      let target = null;
      if (evt.agent_id) {
        // First: exact match on real agent_id
        target = state.agents.find(a => a.id === evt.agent_id);
        // Second: this is the first tool call — find a working agent without
        // a real agent_id yet and adopt it (update its ID)
        if (!target) {
          const pending = state.agents.find(a =>
            a.status === STATUS.WORKING && !a.realAgentId
          );
          if (pending) {
            pending.realAgentId = evt.agent_id;
            pending.id = evt.agent_id;
            target = pending;
            console.log(`  \x1b[33m~ ${target.label}\x1b[0m: bound to ${evt.agent_id}`);
          }
        }
      }
      // Fallback: find most recent working agent
      if (!target) {
        const working = state.agents.filter(a => a.status === STATUS.WORKING);
        target = working.length > 0 ? working[working.length - 1] : null;
      }
      if (!target) { jsonOk(res, { ok: true }); return; }
      const targets = [target];

      if (evt.phase === 'pre') {
        for (const agent of targets) {
          agent.lastToolTime = Date.now();
          agent.toolCalls.push({
            id: evt.tool_use_id,
            tool: evt.tool_name,
            summary: evt.summary || evt.tool_name,
            status: 'running',
            startTime: t
          });
          if (agent.toolCalls.length > MAX_TOOL_CALLS) {
            agent.toolCalls = agent.toolCalls.slice(-MAX_TOOL_CALLS);
          }
        }
        // Log once with the first target's label
        state.log.push({
          time: t, agent: targets[0].label || targets[0].name,
          msg: `${evt.tool_name}: ${evt.summary || ''}`,
          color: targets[0].color
        });
      } else if (evt.phase === 'post') {
        for (const agent of targets) {
          agent.lastToolTime = Date.now();
          const tc = agent.toolCalls.find(c => c.id === evt.tool_use_id);
          if (tc) {
            tc.status = evt.result_status === 'error' ? 'error' : 'done';
            tc.endTime = t;
          }
        }
      }
    }

    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    state.agents = pruneAgents(state.agents);
    mutate();
    jsonOk(res, { ok: true });
    return;
  }

  if (url === '/api/reset' && req.method === 'POST') {
    state = { ...defaultState(), startTime: ts(), version: state.version };
    mutate();
    console.log('  \x1b[33m~ Reset\x1b[0m');
    jsonOk(res, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// Auto-mark agents as "done" after IDLE_TIMEOUT_MS of no tool calls.
// This is necessary because PostToolUse(Agent) fires when the agent is
// dispatched, not when it finishes — so we never get a "done" event from hooks.
const IDLE_TIMEOUT_MS = 15_000;

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const agent of state.agents) {
    if (agent.status !== STATUS.WORKING) continue;
    // Use last tool call time, or agent start time
    const lastActivity = agent.lastToolTime || (agent.startEpoch ? agent.startEpoch * 1000 : now);
    if (now - lastActivity > IDLE_TIMEOUT_MS) {
      agent.status = STATUS.DONE;
      agent.endedAt = ts();
      for (const tc of agent.toolCalls) {
        if (tc.status === 'running') { tc.status = 'done'; tc.endTime = ts(); }
      }
      state.log.push({
        time: ts(), agent: agent.label || agent.name,
        msg: `Done (${agent.toolCalls.length} tool calls)`,
        color: agent.color
      });
      state.totalXP += 25;
      console.log(`  \x1b[32mv ${agent.label || agent.name}\x1b[0m: auto-done (idle ${IDLE_TIMEOUT_MS/1000}s)`);
      changed = true;
    }
  }
  if (changed) mutate();
}, 5000);

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  \x1b[36m+======================================+\x1b[0m');
  console.log('  \x1b[36m|  CLAUDE AGENTS DASHBOARD SERVER      |\x1b[0m');
  console.log(`  \x1b[36m|  http://localhost:${PORT}              |\x1b[0m`);
  console.log('  \x1b[36m|  Press Ctrl+C to stop                |\x1b[0m');
  console.log('  \x1b[36m+======================================+\x1b[0m');
  console.log('');
});
