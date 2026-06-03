'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Cookies from 'js-cookie';
import type { PresenceUser } from '@/types';

interface UseCollabWSOptions {
  noteId: string;
  enabled?: boolean;
}

export function useCollabWS({ noteId, enabled = true }: UseCollabWSOptions) {
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !noteId) return;

    const token = Cookies.get('access_token');
    const base = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8002';
    const ws = new WebSocket(`${base}/ws/notes/${noteId}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setActiveUsers([]);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; users?: PresenceUser[] };
        if (msg.type === 'presence' && msg.users) setActiveUsers(msg.users);
      } catch {
        // binary Yjs frames — handled by Yjs provider in Week 3
      }
    };

    return () => ws.close();
  }, [noteId, enabled]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { activeUsers, connected, send, ws: wsRef };
}
