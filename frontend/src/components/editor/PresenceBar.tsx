'use client';

import { Pencil, Eye, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PresenceUser } from '@/types';

interface PresenceBarProps {
  /** Peers in the room — does NOT include the local user. */
  users: PresenceUser[];
  connected: boolean;
  className?: string;
}

const MAX_VISIBLE = 5;

/**
 * Compact presence strip used in the NotePage top bar.
 *
 * Shows:
 *   · Connection status dot
 *   · Stacked user avatars with coloured initials
 *   · Small status badge per avatar (✏ editing | 👁 viewing)
 *   · Overflow chip (+N) when more than MAX_VISIBLE users
 *   · Title tooltip with name + status on each avatar
 */
export function PresenceBar({ users, connected, className }: PresenceBarProps) {
  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - MAX_VISIBLE;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Connection indicator */}
      <ConnectionDot connected={connected} userCount={users.length} />

      {/* Avatars */}
      {users.length > 0 && (
        <div className="flex items-center -space-x-1.5">
          {visible.map((u) => (
            <UserAvatar key={u.clientId} user={u} />
          ))}

          {overflow > 0 && (
            <span
              className="
                flex items-center justify-center
                w-6 h-6 rounded-full text-[10px] font-medium
                bg-muted text-muted-foreground
                ring-2 ring-background
              "
              title={`${overflow} more user${overflow === 1 ? '' : 's'}`}
            >
              +{overflow}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function ConnectionDot({
  connected,
  userCount,
}: {
  connected: boolean;
  userCount: number;
}) {
  return (
    <span
      title={
        connected
          ? userCount > 0
            ? `${userCount} user${userCount === 1 ? '' : 's'} in this note`
            : 'Connected — you are the only one here'
          : 'Connecting…'
      }
      className={cn(
        'flex items-center gap-1 text-xs transition-colors',
        connected ? 'text-green-500' : 'text-muted-foreground/40',
      )}
    >
      {connected ? (
        <Wifi className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
    </span>
  );
}

function UserAvatar({ user }: { user: PresenceUser }) {
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isEditing = user.status === 'editing';
  const statusLabel = isEditing ? 'editing' : 'viewing';
  const StatusIcon = isEditing ? Pencil : Eye;

  return (
    <span
      className="relative flex-shrink-0"
      title={`${user.name} — ${statusLabel}`}
    >
      {/* Avatar circle */}
      <span
        className="
          flex items-center justify-center
          w-6 h-6 rounded-full text-[10px] font-semibold text-white
          ring-2 ring-background select-none
          transition-transform hover:scale-110
        "
        style={{ backgroundColor: user.color }}
      >
        {initials}
      </span>

      {/* Status badge — bottom-right corner */}
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5',
          'flex items-center justify-center',
          'w-3 h-3 rounded-full ring-1 ring-background',
          isEditing
            ? 'bg-amber-400 text-amber-900'
            : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <StatusIcon className="w-1.5 h-1.5" />
      </span>
    </span>
  );
}
