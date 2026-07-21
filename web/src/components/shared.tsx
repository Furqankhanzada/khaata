import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { baseSymbol } from '../api'
import { appBase } from '../local/dates'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export const CURRENCIES = ['PKR', 'USD', 'AED', 'MYR', 'TRY', 'SAR', 'EUR', 'GBP']

const foreignFmt = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 })

/** Ledger amount: IBM Plex Mono, tabular. flow colors it; currency ≠ household base uses Intl symbols ($1,000). */
export function Amount({
  value, flow, signed = false, currency, className,
}: { value: number | string | null | undefined; flow?: 'in' | 'out'; signed?: boolean; currency?: string; className?: string }) {
  if (value == null) return <span className={cn('amount text-muted-foreground', className)}>—</span>
  const n = Number(value)
  const sign = signed ? (flow === 'out' ? '−' : '+') : n < 0 ? '−' : ''
  const body = currency && currency !== appBase()
    ? foreignFmt(currency).format(Math.abs(n))
    : `${baseSymbol()} ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.abs(n))}`
  return (
    <span className={cn('amount', flow === 'in' && 'text-inflow', flow === 'out' && 'text-outflow', className)}>
      {sign}{body}
    </span>
  )
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      {right}
    </div>
  )
}

/** Uppercase ledger eyebrow — used for date group headers and section labels. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase', className)}>
      {children}
    </div>
  )
}

/** Wealth-item visibility toggle: private (default) vs shared with the household. */
export function ShareSwitch({ checked, onChange, busy }: { checked: boolean; onChange: (shared: boolean) => void; busy?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
      <span className="text-sm">
        Share with household
        <span className="block text-xs text-muted-foreground">
          {checked ? 'Visible to every member' : 'Only you can see this'}
        </span>
      </span>
      <Switch checked={checked} disabled={busy} onCheckedChange={(v: boolean) => onChange(v)} />
    </label>
  )
}

/** Destructive confirmation via AlertDialog (replaces window.confirm). */
export function Confirm({
  title, description, actionLabel = 'Confirm', onConfirm, trigger,
}: { title: string; description?: string; actionLabel?: string; onConfirm: () => void | Promise<void>; trigger: ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={trigger as React.ReactElement} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>{actionLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
