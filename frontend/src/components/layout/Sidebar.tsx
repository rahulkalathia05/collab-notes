'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FileText, LogOut, Plus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { authService } from '@/services/authService';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const handleLogout = async () => {
    await authService.logout();
    router.push('/login');
  };

  return (
    <aside className="flex flex-col w-60 h-full border-r bg-sidebar border-sidebar-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border shrink-0">
        <FileText className="w-4 h-4 text-sidebar-primary" />
        <span className="font-semibold text-sm text-sidebar-foreground">CollabNotes</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <p className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/40 uppercase tracking-wider">
          Workspaces
        </p>

        {workspaces.map((ws) => (
          <Link
            key={ws.id}
            href={`/workspaces/${ws.id}`}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              pathname.startsWith(`/workspaces/${ws.id}`)
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
            }`}
          >
            <span className="text-base leading-none">{ws.icon ?? '📁'}</span>
            <span className="truncate">{ws.name}</span>
          </Link>
        ))}

        <Link
          href="/workspaces"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New workspace</span>
        </Link>
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* User */}
      <div className="p-2 shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
          <Avatar className="w-6 h-6 shrink-0">
            <AvatarImage src={user?.avatar_url} />
            <AvatarFallback className="text-[10px]">
              {user?.name?.slice(0, 2).toUpperCase() ?? 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-sidebar-foreground">{user?.name}</p>
            <p className="text-[11px] truncate text-sidebar-foreground/40">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground"
            onClick={handleLogout}
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
