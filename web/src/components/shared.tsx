import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { rupees } from '../api'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

/** Ledger amount: IBM Plex Mono, tabular. flow colors it (in = green, out = crimson). */
export function Amount({
  value, flow, signed = false, className,
}: { value: number | string | null | undefined; flow?: 'in' | 'out'; signed?: boolean; className?: string }) {
  if (value == null) return <span className={cn('amount text-muted-foreground', className)}>—</span>
  const n = Number(value)
  const sign = signed ? (flow === 'out' ? '−' : '+') : n < 0 ? '−' : ''
  return (
    <span className={cn('amount', flow === 'in' && 'text-inflow', flow === 'out' && 'text-outflow', className)}>
      {sign}Rs {rupees.format(Math.abs(n))}
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
