import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground/20">404</h1>
      <p className="text-lg font-medium">Page not found</p>
      <p className="text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/workspaces">
        <Button variant="outline" size="sm">Go to workspaces</Button>
      </Link>
    </div>
  );
}
