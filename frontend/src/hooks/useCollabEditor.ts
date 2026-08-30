'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import Cookies from 'js-cookie';
import type { AwarenessState, PresenceUser, UserStatus } from '@/types';

// ── SimpleAwareness ───────────────────────────────────────────────────────────

class SimpleAwareness {
  states: Map<number, AwarenessState> = new Map();
  private _clientId: number;
  private _local: AwarenessState = {};
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(clientId: number) {
    this._clientId = clientId;
  }

  on(event: string, cb: (...args: unknown[]) => void) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(cb);
  }
  off(event: string, cb: (...args: unknown[]) => void) {
    this._listeners.get(event)?.delete(cb);
  }
  emit(event: string, ...args: unknown[]) {
    this._listeners.get(event)?.forEach((cb) => cb(...args));
  }

  // Required by @tiptap/y-tiptap's yCursorPlugin
  getStates(): Map<number, AwarenessState> {
    return this.states;
  }

  setLocalStateField(key: string, value: unknown) {
    this._local = { ...this._local, [key]: value };
    this.states.set(this._clientId, this._local);
    // Emit both 'change' (our internal) and 'update' (expected by TipTap cursor extension)
    this.emit('change', { updated: [this._clientId] }, 'local');
    this.emit('update', { updated: [this._clientId] }, 'local');
  }

  applyRemoteState(clientId: number, state: AwarenessState | null) {
    if (state === null) {
      this.states.delete(clientId);
    } else {
      this.states.set(clientId, state);
    }
    this.emit('change', { updated: [clientId] }, 'remote');
    this.emit('update', { updated: [clientId] }, 'remote');
  }

  get localClientId() { return this._clientId; }
  getLocalState() { return this._local; }
}

// ── colour palette ────────────────────────────────────────────────────────────

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

export function pickColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = userId.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

// ── types ─────────────────────────────────────────────────────────────────────

interface UseCollabEditorOptions {
  noteId: string;
  currentUser: { id: string; name: string } | null;
}

interface UseCollabEditorReturn {
  ydoc: Y.Doc;
  provider: { awareness: SimpleAwareness };
  connected: boolean;
  activeUsers: PresenceUser[];
  onEditing: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages Y.Doc + Awareness + WebSocket for one note room.
 *
 * Performance design
 * ──────────────────
 * Awareness sends are throttled at 50 ms (20 fps):
 *   • First change in a window  → send immediately (leading edge)
 *   • Subsequent changes        → schedule trailing send, capturing latest state
 *   • Remote peer updates       → NEVER re-broadcast (origin === 'remote')
 *   • Each send contains only OUR local state (not all peer states)
 *
 * At 50 ms throttle with 10 users editing simultaneously:
 *   20 msgs/sec/user × 10 users × 9 relay targets = 1 800 sends/sec (server)
 */
export function useCollabEditor({
  noteId,
  currentUser,
}: UseCollabEditorOptions): UseCollabEditorReturn {
  const [connected, setConnected] = useState(false);
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  const ydocRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<SimpleAwareness | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Uint8Array[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttle state for awareness sends
  const lastSendTimeRef = useRef<number>(0);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedup: skip the WebSocket write if our state hasn't changed
  const lastSentRef = useRef<string>('');

  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc();
    awarenessRef.current = new SimpleAwareness(ydocRef.current.clientID);
  }

  const ydoc = ydocRef.current;
  const awareness = awarenessRef.current!;

  // ── active user list ──────────────────────────────────────────────────────

  const refreshActiveUsers = useCallback(() => {
    const users: PresenceUser[] = [];
    awareness.states.forEach((state, clientId) => {
      if (state?.user && clientId !== ydoc.clientID) {
        users.push({
          id: state.user.id,
          name: state.user.name,
          color: state.user.color,
          clientId,
          status: state.status ?? 'viewing',
        });
      }
    });
    setActiveUsers(users);
  }, [awareness, ydoc.clientID]);

  // ── status management ─────────────────────────────────────────────────────

  const _setStatus = useCallback(
    (status: UserStatus) => awareness.setLocalStateField('status', status),
    [awareness],
  );

  const onEditing = useCallback(() => {
    _setStatus('editing');
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => _setStatus('viewing'), 3_000);
  }, [_setStatus]);

  // ── WebSocket connection ──────────────────────────────────────────────────

  useEffect(() => {
    const token = Cookies.get('access_token');
    if (!token) return;

    const base = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8002';
    const ws = new WebSocket(`${base}/ws/notes/${noteId}?token=${token}`);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    if (currentUser) {
      awareness.setLocalStateField('user', {
        id: currentUser.id,
        name: currentUser.name,
        color: pickColor(currentUser.id),
      });
    }
    _setStatus('viewing');

    ws.onopen = () => {
      setConnected(true);
      pendingRef.current.splice(0).forEach((u) => ws.send(u));
      _flushAwareness(ws); // announce ourselves immediately on connect
    };

    ws.onclose = () => {
      setConnected(false);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      const remote: number[] = [];
      awareness.states.forEach((_, cid) => {
        if (cid !== ydoc.clientID) remote.push(cid);
      });
      remote.forEach((cid) => awareness.applyRemoteState(cid, null));
      setActiveUsers([]);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Pass 'remote' as origin so onDocUpdate skips re-broadcasting this update
        Y.applyUpdate(ydoc, new Uint8Array(event.data), 'remote');
        return;
      }
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'presence_sync' && msg.states) {
          (
            Object.values(msg.states) as Array<{
              clientId: number;
              state: AwarenessState;
            }>
          ).forEach(({ clientId, state }) => {
            if (clientId !== ydoc.clientID) awareness.applyRemoteState(clientId, state);
          });
          refreshActiveUsers();
        }

        if (msg.type === 'awareness' && Array.isArray(msg.states)) {
          (
            msg.states as Array<{ clientId: number; state: AwarenessState | null }>
          ).forEach(({ clientId, state }) => {
            if (clientId !== ydoc.clientID) awareness.applyRemoteState(clientId, state);
          });
          refreshActiveUsers();
        }

        if (msg.type === 'presence' && Array.isArray(msg.users)) {
          const live = new Set<string>(msg.users);
          const gone: number[] = [];
          awareness.states.forEach((state, cid) => {
            if (cid !== ydoc.clientID && state?.user?.id && !live.has(state.user.id))
              gone.push(cid);
          });
          gone.forEach((cid) => awareness.applyRemoteState(cid, null));
          if (gone.length > 0) refreshActiveUsers();
        }
      } catch {
        // ignore
      }
    };

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return; // don't echo back updates received from server
      if (ws.readyState === WebSocket.OPEN) ws.send(update);
      else pendingRef.current.push(update);
    };
    ydoc.on('update', onDocUpdate);

    // ── Awareness change handler ──────────────────────────────────────────
    // Only send when WE changed (origin === 'local').
    // Remote updates must NOT be echoed back to the server.
    const onAwarenessChange = (_changed: unknown, origin: unknown) => {
      if (origin !== 'local') return;
      if (ws.readyState === WebSocket.OPEN) _scheduleAwarenessSend(ws);
    };
    awareness.on('change', onAwarenessChange);

    return () => {
      ydoc.off('update', onDocUpdate);
      awareness.off('change', onAwarenessChange);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // ── Awareness send helpers ────────────────────────────────────────────────

  /**
   * Throttle-with-trailing-call: send immediately if the last send was
   * ≥ 50 ms ago, otherwise schedule one trailing send.
   * Subsequent calls within the window are collapsed — the trailing send
   * captures the latest state (cursor position, status, etc.).
   */
  function _scheduleAwarenessSend(ws: WebSocket) {
    const THROTTLE = 50; // ms → 20 fps max
    const now = Date.now();
    const elapsed = now - lastSendTimeRef.current;

    if (elapsed >= THROTTLE) {
      _flushAwareness(ws);
      lastSendTimeRef.current = now;
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    } else if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          _flushAwareness(ws);
          lastSendTimeRef.current = Date.now();
        }
        throttleTimerRef.current = null;
      }, THROTTLE - elapsed);
    }
    // If a trailing timer is already scheduled, it will capture latest state
    // when it fires — no action needed.
  }

  /**
   * Send ONLY our local awareness state to peers.
   * Sending all peer states back would be redundant (the server already has them)
   * and scales O(n) with room size for each cursor move.
   */
  function _flushAwareness(ws: WebSocket) {
    const msg = JSON.stringify({
      type: 'awareness',
      states: [{ clientId: ydoc.clientID, state: awareness.getLocalState() }],
    });
    if (msg === lastSentRef.current) return; // nothing changed, skip write
    lastSentRef.current = msg;
    ws.send(msg);
  }

  useEffect(() => {
    awareness.on('change', refreshActiveUsers);
    return () => awareness.off('change', refreshActiveUsers);
  }, [awareness, refreshActiveUsers]);

  return { ydoc, provider: { awareness }, connected, activeUsers, onEditing };
}
