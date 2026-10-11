import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';
import { shellState } from '@/lib/loop/state';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Agent Learning Loop',
  description: 'Failing traces become approved evals, a prompt fix, a gated experiment and a reversible rollout.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const shell = await shellState();
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Sidebar steps={shell.steps} live={shell.live.id} candidate={shell.candidate?.id ?? null} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
