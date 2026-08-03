/**
 * HOPPER — API. REST + WS surface defined in contracts/src/api.ts.
 */
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  API_PORT,
  DEFAULT_APPROVER,
  type ClientMessage,
  type ServerMessage,
} from '@hopper/contracts';
import { runArc, runBeat } from './demo.js';
import { Store } from './store.js';
import { boot } from './wire.js';

const hopper = await boot();
const store = new Store(hopper);

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: hopper.mock, graph: hopper.graphConnected });
});

app.get('/api/state', async (_req, res) => {
  res.json(await store.state());
});

app.get('/api/advisories', async (_req, res) => {
  const s = await store.state();
  res.json(s.feed);
});

app.get('/api/advisory/:id', async (req, res) => {
  const focus = await store.focus(req.params.id);
  if (!focus) {
    res.status(404).json({ error: 'unknown advisory' });
    return;
  }
  res.json(focus);
});

app.post('/api/approve', async (req, res) => {
  const { approval_id, approver } = req.body ?? {};
  try {
    const approval = await hopper.agents.approve(approval_id, approver ?? DEFAULT_APPROVER);
    store.emit({ type: 'approval', approval });
    // the approval is what unblocks the customer notice; execute it now
    const pending = hopper.orchestrator as unknown as {
      executeApproved?: (id: string) => Promise<unknown>;
    };
    if (typeof pending.executeApproved === 'function') {
      await pending.executeApproved(approval_id).catch(() => {});
    }
    res.json(approval);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/reject', async (req, res) => {
  const { approval_id, approver } = req.body ?? {};
  try {
    const approval = await hopper.agents.reject(approval_id, approver ?? DEFAULT_APPROVER);
    store.emit({ type: 'approval', approval });
    res.json(approval);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/demo', async (req, res) => {
  const step = req.body?.step;
  res.json({ ok: true });
  try {
    if (step) await runBeat(hopper, store, Number(step));
    else await runArc(hopper, store);
  } catch (err) {
    store.emit({ type: 'log', level: 'error', message: (err as Error).message });
  }
});

app.post('/api/pull-live', async (req, res) => {
  try {
    const advisories = await hopper.ingest.pullLive({ limit: req.body?.limit ?? 30 });
    res.json({ pulled: advisories.length });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get('/api/pipelines', (_req, res) => {
  res.json(hopper.meta.specs());
});

app.get('/api/runs', (_req, res) => {
  res.json(hopper.orchestrator.runs());
});

app.get('/api/audit/:id', async (req, res) => {
  res.json(await hopper.graph.auditTrail(req.params.id));
});

app.post('/api/cypher', async (req, res) => {
  const cypher = String(req.body?.cypher ?? '');
  if (/\b(DELETE|DETACH|DROP|MERGE|CREATE|SET|REMOVE)\b/i.test(cypher)) {
    res.status(400).json({ error: 'read-only console' });
    return;
  }
  try {
    res.json({ rows: await hopper.graph.query(cypher) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws: WebSocket) => {
  const send = (m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const off = store.onMessage(send);
  send({ type: 'state', state: await store.state() });

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'subscribe':
        send({ type: 'state', state: await store.state() });
        break;
      case 'focus': {
        const focus = await store.focus(msg.ghsa_id);
        if (focus) send({ type: 'focus', focus });
        break;
      }
      case 'approve': {
        const approval = await hopper.agents
          .approve(msg.approval_id, msg.approver ?? DEFAULT_APPROVER)
          .catch(() => null);
        if (approval) store.emit({ type: 'approval', approval });
        break;
      }
      case 'reject': {
        const approval = await hopper.agents
          .reject(msg.approval_id, msg.approver ?? DEFAULT_APPROVER)
          .catch(() => null);
        if (approval) store.emit({ type: 'approval', approval });
        break;
      }
      case 'demo':
        if (msg.step) await runBeat(hopper, store, msg.step).catch(() => {});
        else await runArc(hopper, store).catch(() => {});
        break;
    }
  });

  ws.on('close', off);
});

server.listen(API_PORT, () => {
  console.log(`api        http://localhost:${API_PORT}  ws://localhost:${API_PORT}/ws`);
  console.log(`falkordb   http://localhost:3000`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await hopper.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
