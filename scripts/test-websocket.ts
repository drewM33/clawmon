#!/usr/bin/env tsx
/**
 * Trusted ClawMon — WebSocket Integration Tests (Phase 7)
 *
 * Tests the WebSocket server, event broadcasting, and reconnection.
 * Requires the API server to be running on port 3001 (or PORT env).
 *
 * Usage:
 *   npx tsx scripts/test-websocket.ts
 */

import WebSocket from 'ws';

const API_BASE = process.env.API_URL ?? 'http://localhost:3001';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        reject(new Error('Failed to parse message'));
      }
    });
  });
}

function collectMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const handler = (data: WebSocket.Data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { /* skip */ }
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

async function submitFeedback(agentId: string, clientAddress: string, value: number): Promise<any> {
  const res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, clientAddress, value }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Test 1: Connection & Init Event
// ---------------------------------------------------------------------------

async function testConnection(): Promise<void> {
  console.log('\nTest 1: WebSocket Connection & Init Event');
  console.log('─'.repeat(50));

  const ws = await connectWS();
  assert(ws.readyState === WebSocket.OPEN, 'WebSocket connects successfully');

  const initMsg = await waitForMessage(ws);
  assert(initMsg.type === 'connection:init', 'Receives connection:init event');
  assert(typeof initMsg.payload.serverTime === 'number', 'Init payload has serverTime');
  assert(typeof initMsg.payload.connectedClients === 'number', 'Init payload has connectedClients');
  assert(initMsg.payload.connectedClients >= 1, 'At least 1 client connected');

  ws.close();
}

// ---------------------------------------------------------------------------
// Test 2: Feedback Submission Broadcasts Events
// ---------------------------------------------------------------------------

async function testFeedbackBroadcast(): Promise<void> {
  console.log('\nTest 2: Feedback Submission Broadcasts Events');
  console.log('─'.repeat(50));

  const ws = await connectWS();
  // Consume init message
  await waitForMessage(ws);

  // Start collecting messages
  const msgPromise = collectMessages(ws, 3000);

  // Submit feedback
  await sleep(200);
  const result = await submitFeedback('gmail-integration', '0xtest_reviewer_ws', 85);
  assert(result.id !== undefined, 'Feedback submission returns an ID');
  assert(result.feedback?.agentId === 'gmail-integration', 'Feedback response has correct agentId');

  const messages = await msgPromise;
  const eventTypes = messages.map((m: any) => m.type);

  assert(eventTypes.includes('feedback:new'), 'Broadcasts feedback:new event');
  assert(eventTypes.includes('score:updated'), 'Broadcasts score:updated event');
  assert(eventTypes.includes('stats:updated'), 'Broadcasts stats:updated event');
  assert(eventTypes.includes('leaderboard:updated'), 'Broadcasts leaderboard:updated event');
  assert(eventTypes.includes('graph:updated'), 'Broadcasts graph:updated event');

  // Verify feedback:new payload
  const fbEvent = messages.find((m: any) => m.type === 'feedback:new');
  if (fbEvent) {
    assert(fbEvent.payload.agentId === 'gmail-integration', 'feedback:new has correct agentId');
    assert(fbEvent.payload.value === 85, 'feedback:new has correct value');
    assert(fbEvent.payload.clientAddress === '0xtest_reviewer_ws', 'feedback:new has correct clientAddress');
    assert(typeof fbEvent.payload.timestamp === 'number', 'feedback:new has timestamp');
  }

  // Verify score:updated payload
  const scoreEvent = messages.find((m: any) => m.type === 'score:updated');
  if (scoreEvent) {
    assert(scoreEvent.payload.agentId === 'gmail-integration', 'score:updated has correct agentId');
    assert(typeof scoreEvent.payload.naiveScore === 'number', 'score:updated has naiveScore');
    assert(typeof scoreEvent.payload.hardenedScore === 'number', 'score:updated has hardenedScore');
    assert(typeof scoreEvent.payload.naiveTier === 'string', 'score:updated has naiveTier');
    assert(typeof scoreEvent.payload.feedbackCount === 'number', 'score:updated has feedbackCount');
  }

  // Verify leaderboard:updated
  const lbEvent = messages.find((m: any) => m.type === 'leaderboard:updated');
  if (lbEvent) {
    assert(Array.isArray(lbEvent.payload.agents), 'leaderboard:updated has agents array');
    assert(lbEvent.payload.agents.length > 0, 'leaderboard has at least 1 agent');
  }

  ws.close();
}

// ---------------------------------------------------------------------------
// Test 3: Invalid Feedback Returns Error
// ---------------------------------------------------------------------------

async function testInvalidFeedback(): Promise<void> {
  console.log('\nTest 3: Invalid Feedback Validation');
  console.log('─'.repeat(50));

  // Missing fields
  let res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'gmail-integration' }),
  });
  assert(res.status === 400, 'Missing fields returns 400');

  // Invalid value
  res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'gmail-integration', clientAddress: '0xtest', value: 150 }),
  });
  assert(res.status === 400, 'Value > 100 returns 400');

  // Unknown agent
  res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'nonexistent-agent', clientAddress: '0xtest', value: 50 }),
  });
  assert(res.status === 404, 'Unknown agent returns 404');
}

// ---------------------------------------------------------------------------
// Test 4: Multiple Clients Receive Same Events
// ---------------------------------------------------------------------------

async function testMultipleClients(): Promise<void> {
  console.log('\nTest 4: Multiple Clients Receive Same Events');
  console.log('─'.repeat(50));

  const ws1 = await connectWS();
  // Start listening for init on ws1 before connecting ws2
  const init1 = waitForMessage(ws1);
  const ws2 = await connectWS();
  const init2 = waitForMessage(ws2);
  await init1;
  await init2;

  // Collect messages from both clients
  const msgs1Promise = collectMessages(ws1, 3000);
  const msgs2Promise = collectMessages(ws2, 3000);

  await sleep(200);
  await submitFeedback('github-token', '0xmulti_client_test', 90);

  const msgs1 = await msgs1Promise;
  const msgs2 = await msgs2Promise;

  const types1 = msgs1.map((m: any) => m.type);
  const types2 = msgs2.map((m: any) => m.type);

  assert(types1.includes('feedback:new'), 'Client 1 receives feedback:new');
  assert(types2.includes('feedback:new'), 'Client 2 receives feedback:new');
  assert(types1.includes('score:updated'), 'Client 1 receives score:updated');
  assert(types2.includes('score:updated'), 'Client 2 receives score:updated');

  ws1.close();
  ws2.close();
}

// ---------------------------------------------------------------------------
// Test 5: Reconnection (close & reopen)
// ---------------------------------------------------------------------------

async function testReconnection(): Promise<void> {
  console.log('\nTest 5: Reconnection Handling');
  console.log('─'.repeat(50));

  const ws1 = await connectWS();
  await waitForMessage(ws1);
  assert(ws1.readyState === WebSocket.OPEN, 'Initial connection is open');

  ws1.close();
  await sleep(500);
  assert(ws1.readyState === WebSocket.CLOSED, 'Connection closed successfully');

  // Reconnect
  const ws2 = await connectWS();
  const initMsg = await waitForMessage(ws2);
  assert(ws2.readyState === WebSocket.OPEN, 'Reconnection successful');
  assert(initMsg.type === 'connection:init', 'Receives init on reconnect');

  // Verify still receives events after reconnect
  const msgPromise = collectMessages(ws2, 3000);
  await sleep(200);
  await submitFeedback('slack-bridge', '0xreconnect_test', 75);

  const msgs = await msgPromise;
  const hasEvents = msgs.some((m: any) => m.type === 'feedback:new');
  assert(hasEvents, 'Receives events after reconnection');

  ws2.close();
}

// ---------------------------------------------------------------------------
// Test 6: Rapid Feedback Stream
// ---------------------------------------------------------------------------

async function testRapidStream(): Promise<void> {
  console.log('\nTest 6: Rapid Feedback Stream');
  console.log('─'.repeat(50));

  const ws = await connectWS();
  await waitForMessage(ws);

  const msgPromise = collectMessages(ws, 5000);

  // Send 10 rapid feedback items
  await sleep(200);
  const agents = ['gmail-integration', 'github-token', 'deep-research-agent', 'postgres-connector', 'slack-bridge'];
  for (let i = 0; i < 10; i++) {
    const agentId = agents[i % agents.length];
    await submitFeedback(agentId, `0xrapid_test_${i}`, 70 + (i * 3));
    await sleep(100);
  }

  const msgs = await msgPromise;
  const feedbackEvents = msgs.filter((m: any) => m.type === 'feedback:new');
  const scoreEvents = msgs.filter((m: any) => m.type === 'score:updated');

  assert(feedbackEvents.length === 10, `Received all 10 feedback:new events (got ${feedbackEvents.length})`);
  assert(scoreEvents.length === 10, `Received all 10 score:updated events (got ${scoreEvents.length})`);

  // Verify different agents were updated
  const updatedAgents = new Set(scoreEvents.map((m: any) => m.payload.agentId));
  assert(updatedAgents.size === 5, `Score updates for all 5 distinct agents (got ${updatedAgents.size})`);

  ws.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Trusted ClawMon — WebSocket Tests (Phase 7)            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Server: ${API_BASE.padEnd(50)}║`);
  console.log(`║  WS URL: ${WS_URL.padEnd(50)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Verify server is running
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
  } catch (err) {
    console.error('\n[ERROR] Server is not running at', API_BASE);
    console.error('        Start it first: npm run dev:server\n');
    process.exit(1);
  }

  try {
    await testConnection();
    await testFeedbackBroadcast();
    await testInvalidFeedback();
    await testMultipleClients();
    await testReconnection();
    await testRapidStream();
  } catch (err) {
    console.error('\n[FATAL]', err);
    failed++;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
