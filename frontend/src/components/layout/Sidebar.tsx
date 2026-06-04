'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FileText, LogOut, Plus, Search } from 'lucide-react';
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = async () => {
    await authService.logout();
    router.push('/login');
  };

  const navigate = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    },
    [router],
  );

  // ⌘K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <aside className="flex flex-col w-60 h-full border-r bg-sidebar border-sidebar-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border shrink-0">
        <FileText className="w-4 h-4 text-sidebar-primary" />
        <span className="font-semibold text-sm text-sidebar-foreground">CollabNotes</span>
      </div>

      {/* Search bar */}
      <div className="px-2 py-2 border-b border-sidebar-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sidebar-foreground/40 pointer-events-none" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigate(searchQuery);
                setSearchQuery('');
              }
              if (e.key === 'Escape') {
                setSearchQuery('');
                searchRef.current?.blur();
              }
            }}
            placeholder="Search notes…"
            className="w-full pl-8 pr-10 py-1.5 rounded-md text-xs bg-sidebar-accent/40 border border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-ring transition-colors"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-sidebar-foreground/30 pointer-events-none hidden sm:block">
            ⌘K
          </span>
        </div>
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
