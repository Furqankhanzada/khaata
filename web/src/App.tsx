import { useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { House, NotebookText, ChartNoAxesCombined, Ellipsis, Plus, type LucideIcon } from 'lucide-react'
import { api } from './api'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { TxForm } from './TxForm'
import { HouseholdSetup, Login } from './pages/Login'
import Dashboard from './pages/Dashboard'
import Reports from './pages/Reports'
import Loans from './pages/Loans'
import Transactions from './pages/Transactions'
import Budgets from './pages/Budgets'
import Portfolio from './pages/Portfolio'
import More from './pages/More'
import Activity from './pages/Activity'

export type Me = {
  user: { id: string; name: string; email: string; householdId: string | null }
  household: { id: string; name: string; inviteCode: string; members: { id: string; name: string; email: string }[] } | null
}

function Tab({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'relative flex flex-1 flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium',
          isActive
            ? 'text-primary before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:bg-primary'
            : 'text-muted-foreground',
        )
      }
    >
      <Icon className="size-5" strokeWidth={1.75} />
      {label}
    </NavLink>
  )
}

export default function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), retry: false })
  const [addOpen, setAddOpen] = useState(false)

  if (me.isError) return <Login />
  if (!me.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 p-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (!me.data.user.householdId) return <HouseholdSetup />

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24">
      <main className="p-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/more" element={<More me={me.data} />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-lg items-stretch">
          <Tab to="/" icon={House} label="Home" />
          <Tab to="/transactions" icon={NotebookText} label="Ledger" />
          <div className="flex flex-1 items-center justify-center">
            <button
              aria-label="Add entry"
              onClick={() => setAddOpen(true)}
              className="flex size-11 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md outline-ring/50 active:scale-95"
            >
              <Plus className="size-5" strokeWidth={2.25} />
            </button>
          </div>
          <Tab to="/portfolio" icon={ChartNoAxesCombined} label="Invest" />
          <Tab to="/more" icon={Ellipsis} label="More" />
        </div>
      </nav>

      <Drawer open={addOpen} onOpenChange={setAddOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>New entry</DrawerTitle>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-lg px-4 pb-6">
            <TxForm onDone={() => setAddOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
