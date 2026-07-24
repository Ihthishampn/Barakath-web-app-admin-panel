import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** Two-pane admin shell: fixed sidebar + (top bar over scrollable content). */
export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-app">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
