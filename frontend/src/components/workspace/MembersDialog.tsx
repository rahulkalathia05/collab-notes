'use client';

import { useCallback, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Crown,
  Eye,
  Loader2,
  Mail,
  PenLine,
  Shield,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMembers } from '@/hooks/useMembers';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorkspaceMember } from '@/types';

// ── role config ───────────────────────────────────────────────────────────────

type SelectableRole = 'editor' | 'viewer';
type AnyRole = WorkspaceMember['role'];

interface RoleDef {
  value: AnyRole;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  badgeClass: string;
}

const ROLE_DEFS: Record<AnyRole, RoleDef> = {
  owner: {
    value: 'owner',
    label: 'Owner',
    description: 'Full control over workspace and members',
    icon: <Crown className="w-3.5 h-3.5" />,
    color: 'text-violet-600',
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
  },
  admin: {
    value: 'admin',
    label: 'Admin',
    description: 'Can manage members and workspace settings',
    icon: <Shield className="w-3.5 h-3.5" />,
    color: 'text-blue-600',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  },
  editor: {
    value: 'editor',
    label: 'Editor',
    description: 'Can create and edit notes',
    icon: <PenLine className="w-3.5 h-3.5" />,
    color: 'text-emerald-600',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  },
  viewer: {
    value: 'viewer',
    label: 'Viewer',
    description: 'Can read notes only',
    icon: <Eye className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground',
    badgeClass: 'bg-muted text-muted-foreground',
  },
};

const INVITE_ROLES: SelectableRole[] = ['editor', 'viewer'];
const ASSIGNABLE_ROLES: AnyRole[] = ['editor', 'viewer'];

// ── component ─────────────────────────────────────────────────────────────────

interface MembersDialogProps {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MembersDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
}: MembersDialogProps) {
  const currentUser = useAuthStore((s) => s.user);
  const { members, isLoading, invite, updateRole, remove } = useMembers(workspaceId);

  const currentMember = members.find((m) => m.user.id === currentUser?.id);
  const canManage = currentMember?.role === 'owner' || currentMember?.role === 'admin';
  const isOwner = currentMember?.role === 'owner';

  // ── invite form state ─────────────────────────────────────────────────────

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<SelectableRole>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;
      setInviting(true);
      setInviteError(null);
      try {
        await invite.mutateAsync({ email: email.trim().toLowerCase(), role: inviteRole });
        setEmail('');
        toast.success(`Invited ${email.trim()}`);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Failed to invite member';
        setInviteError(msg);
      } finally {
        setInviting(false);
      }
    },
    [email, inviteRole, invite],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <DialogTitle>Members &amp; Sharing</DialogTitle>
          </div>
          <DialogDescription>
            Manage who has access to <strong>{workspaceName}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* ── Invite form ── */}
        {canManage && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Invite member
            </p>
            <form onSubmit={handleInvite} className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setInviteError(null); }}
                    className="pl-8"
                    required
                  />
                </div>
                <RoleSelect
                  value={inviteRole}
                  options={INVITE_ROLES}
                  onChange={(r) => setInviteRole(r as SelectableRole)}
                />
                <Button size="sm" type="submit" disabled={inviting || !email.trim()}>
                  {inviting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  Invite
                </Button>
              </div>

              {inviteError && (
                <div className="flex items-start gap-1.5 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {inviteError}
                </div>
              )}
            </form>

            <Separator />
          </div>
        )}

        {/* ── Member list ── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Members
            </p>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">{members.length}</span>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading…
            </div>
          )}

          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {members.map((member) => (
              <MemberRow
                key={member.user.id}
                member={member}
                currentUserId={currentUser?.id}
                canManage={canManage}
                isOwner={isOwner}
                onRoleChange={(userId, role) =>
                  updateRole.mutateAsync({ userId, role }).catch((err: unknown) => {
                    const msg =
                      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
                      'Failed to update role';
                    toast.error(msg);
                  })
                }
                onRemove={(userId) =>
                  remove.mutateAsync(userId).catch((err: unknown) => {
                    const msg =
                      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
                      'Failed to remove member';
                    toast.error(msg);
                  })
                }
              />
            ))}
          </div>
        </div>

        {/* ── Permission legend ── */}
        {!canManage && (
          <p className="text-xs text-muted-foreground/70 text-center">
            Only owners and admins can manage members.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── MemberRow ─────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  currentUserId,
  canManage,
  isOwner,
  onRoleChange,
  onRemove,
}: {
  member: WorkspaceMember;
  currentUserId?: string;
  canManage: boolean;
  isOwner: boolean;
  onRoleChange: (userId: string, role: WorkspaceMember['role']) => Promise<unknown>;
  onRemove: (userId: string) => Promise<unknown>;
}) {
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const def = ROLE_DEFS[member.role];
  const isSelf = member.user.id === currentUserId;
  const isOwnerRow = member.role === 'owner';
  // Admins can only change editor/viewer roles; owners can change anything except owner
  const canChangeRole = canManage && !isOwnerRow && (!(!isOwner && member.role === 'admin'));
  const canRemove = canManage && !isOwnerRow && (!(!isOwner && member.role === 'admin'));

  const handleRoleChange = async (role: string) => {
    setLoading(true);
    try {
      await onRoleChange(member.user.id, role as WorkspaceMember['role']);
      toast.success(`Role updated to ${ROLE_DEFS[role as AnyRole]?.label ?? role}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setRemoving(true);
    try {
      await onRemove(member.user.id);
      toast.success(`${member.user.name} removed`);
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
        isSelf && 'bg-muted/30',
      )}
    >
      {/* Avatar */}
      <UserAvatar name={member.user.name} />

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{member.user.name}</span>
          {isSelf && (
            <span className="text-[10px] text-muted-foreground shrink-0">(you)</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate">{member.user.email}</span>
      </div>

      {/* Role — editable for admins/owners, badge only for others */}
      {canChangeRole ? (
        <div className="relative">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <RoleSelect
              value={member.role as SelectableRole}
              options={isOwner ? ASSIGNABLE_ROLES : ['editor', 'viewer']}
              onChange={handleRoleChange}
              compact
            />
          )}
        </div>
      ) : (
        <RoleBadge role={member.role} />
      )}

      {/* Remove button */}
      {canRemove && !isSelf && (
        <button
          onClick={handleRemove}
          onBlur={() => setConfirmRemove(false)}
          disabled={removing}
          title={confirmRemove ? 'Click again to confirm removal' : 'Remove member'}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors shrink-0',
            confirmRemove
              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              : 'text-muted-foreground hover:text-destructive hover:bg-muted',
          )}
        >
          {removing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : confirmRemove ? (
            <>
              <Check className="w-3 h-3" />
              Confirm
            </>
          ) : (
            <UserMinus className="w-3 h-3" />
          )}
        </button>
      )}
    </div>
  );
}

// ── RoleBadge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: AnyRole }) {
  const def = ROLE_DEFS[role];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
        def.badgeClass,
      )}
    >
      {def.icon}
      {def.label}
    </span>
  );
}

// ── RoleSelect ────────────────────────────────────────────────────────────────

function RoleSelect({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: AnyRole;
  options: AnyRole[];
  onChange: (role: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const def = ROLE_DEFS[value];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border bg-background text-xs font-medium transition-colors hover:bg-muted',
          compact ? 'px-2 py-1' : 'px-2.5 py-1.5',
          def.color,
        )}
      >
        {def.icon}
        {def.label}
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border bg-popover shadow-md py-1">
            {options.map((r) => {
              const d = ROLE_DEFS[r];
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => { onChange(r); setOpen(false); }}
                  className={cn(
                    'w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors',
                    r === value && 'bg-muted/60',
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', d.color)}>{d.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{d.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {d.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── UserAvatar ────────────────────────────────────────────────────────────────

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
      style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
      title={name}
    >
      {initials}
    </div>
  );
}
