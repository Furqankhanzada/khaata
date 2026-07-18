import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Amount, Confirm, Eyebrow, PageHeader } from '@/components/shared'

export type Loan = {
  id: string; counterparty: string; direction: 'lent' | 'borrowed'; principal: string
  start_date: string; note: string | null; status: 'open' | 'settled'; paid: number; outstanding: number
}
type LoanDetail = Loan & { payments: { id: string; amount: string; paidOn: string; note: string | null }[] }

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Loans() {
  const [status, setStatus] = useState<'open' | 'settled'>('open')
  const [adding, setAdding] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const loans = useQuery({ queryKey: ['loans', status], queryFn: () => api<Loan[]>(`/loans?status=${status}`) })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Loans / Qarz"
        right={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add loan
          </Button>
        }
      />

      <ToggleGroup className="w-full" variant="outline" size="sm" value={[status]}
        onValueChange={(v: string[]) => v[0] && setStatus(v[0] as 'open' | 'settled')}>
        <ToggleGroupItem value="open" className="flex-1">Open</ToggleGroupItem>
        <ToggleGroupItem value="settled" className="flex-1">Settled</ToggleGroupItem>
      </ToggleGroup>

      {loans.isLoading && <Skeleton className="h-40 rounded-xl" />}

      {loans.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{status === 'open' ? 'No open loans' : 'No settled loans yet'}</EmptyTitle>
            <EmptyDescription>
              {status === 'open' ? 'Money you lend or borrow shows up here with its full repayment history.' : 'Loans you close appear here.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {loans.data && loans.data.length > 0 && (
        <Card className="gap-0 py-0">
          {loans.data.map((l, i) => {
            const forgiven = l.status === 'settled' && l.outstanding > 0
            return (
              <button key={l.id} onClick={() => setViewingId(l.id)}
                className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-accent', i > 0 && 'border-t')}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{l.counterparty}</span>
                    <Badge variant={l.direction === 'borrowed' ? 'destructive' : 'secondary'}>
                      {l.direction === 'lent' ? 'owes us' : 'we owe'}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    since {fmtDate(l.start_date)}
                    {forgiven && <> · forgave <Amount value={l.outstanding} className="text-xs" /></>}
                  </div>
                </div>
                {l.status === 'open'
                  ? <Amount value={l.outstanding} className={cn('shrink-0 text-sm', l.direction === 'borrowed' && 'text-outflow')} />
                  : <Badge variant="secondary">settled</Badge>}
              </button>
            )
          })}
        </Card>
      )}

      <Drawer open={adding} onOpenChange={setAdding}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>New loan</DrawerTitle></DrawerHeader>
          <div className="px-4 pb-6"><AddLoan onDone={() => setAdding(false)} /></div>
        </DrawerContent>
      </Drawer>

      <Drawer open={!!viewingId} onOpenChange={(open) => !open && setViewingId(null)}>
        <DrawerContent>
          {viewingId && <LoanStatement id={viewingId} onDone={() => setViewingId(null)} />}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

const DIRECTIONS = [
  { value: 'lent', label: 'I lent' },
  { value: 'borrowed', label: 'I borrowed' },
]

function AddLoan({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ direction: 'lent', counterparty: '', principal: '', note: '' })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/loans', {
        method: 'POST',
        json: { direction: form.direction, counterparty: form.counterparty, principal: Number(form.principal), note: form.note || undefined },
      })
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['zakat'] })
      toast('Loan added')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the loan')
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>Direction</FieldLabel>
            <Select items={DIRECTIONS} value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as string })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DIRECTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="l-amount">Amount</FieldLabel>
            <InputGroup>
              <InputGroupAddon>Rs</InputGroupAddon>
              <InputGroupInput id="l-amount" type="number" min="1" required className="amount"
                value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
            </InputGroup>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="l-person">Person</FieldLabel>
          <Input id="l-person" placeholder='e.g. "Ahmed bhai"' required
            value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="l-note">Note</FieldLabel>
          <Input id="l-note" placeholder="Optional — what was it for?" value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <Button type="submit" className="w-full">Add loan</Button>
      </FieldGroup>
    </form>
  )
}

function LoanStatement({ id, onDone }: { id: string; onDone: () => void }) {
  const qc = useQueryClient()
  const loan = useQuery({ queryKey: ['loan', id], queryFn: () => api<LoanDetail>(`/loans/${id}`) })
  const [amount, setAmount] = useState('')
  const l = loan.data

  function refresh() {
    qc.invalidateQueries({ queryKey: ['loans'] })
    qc.invalidateQueries({ queryKey: ['loan', id] })
    qc.invalidateQueries({ queryKey: ['zakat'] })
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    await api(`/loans/${id}/payments`, { method: 'POST', json: { amount: Number(amount) } })
    setAmount('')
    refresh()
    toast('Repayment recorded')
  }

  async function setStatus(status: 'open' | 'settled') {
    await api(`/loans/${id}`, { method: 'PATCH', json: { status } })
    refresh()
    toast(status === 'settled' ? 'Loan settled' : 'Loan reopened')
    onDone()
  }

  if (!l) return <div className="p-6"><Skeleton className="h-48" /></div>
  const lent = l.direction === 'lent'

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{l.counterparty} · {lent ? 'owes us' : 'we owe'}</DrawerTitle>
      </DrawerHeader>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div>
          <Eyebrow className="mb-1">Statement</Eyebrow>
          <div className="flex items-baseline justify-between py-1.5 text-sm">
            <span>
              {fmtDate(l.start_date)} · {lent ? 'Lent' : 'Borrowed'}
              {l.note && <span className="text-muted-foreground"> — {l.note}</span>}
            </span>
            <Amount value={l.principal} className="text-sm" />
          </div>
          {l.payments.map((p) => (
            <div key={p.id} className="flex items-baseline justify-between border-t py-1.5 text-sm">
              <span className="text-muted-foreground">
                {fmtDate(p.paidOn)} · {lent ? 'Received' : 'Repaid'}
                {p.note && <> — {p.note}</>}
              </span>
              <Amount value={p.amount} flow={lent ? 'in' : 'out'} signed className="text-sm" />
            </div>
          ))}
          <Separator />
          <div className="flex items-baseline justify-between py-2 text-sm font-semibold">
            <span>{l.status === 'settled' ? (l.outstanding > 0 ? 'Forgiven' : 'Settled') : 'Outstanding'}</span>
            <Amount value={l.outstanding} className={cn('text-sm', l.status === 'open' && !lent && 'text-outflow')} />
          </div>
        </div>

        {l.status === 'open' ? (
          <>
            <form className="flex items-center gap-2" onSubmit={pay}>
              <InputGroup className="flex-1">
                <InputGroupAddon>Rs</InputGroupAddon>
                <InputGroupInput type="number" min="1" required placeholder="Repayment amount"
                  className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </InputGroup>
              <Button type="submit">Record</Button>
            </form>
            <Confirm
              title="Settle this loan?"
              description={l.outstanding > 0
                ? `The remaining Rs ${l.outstanding.toLocaleString()} will be marked as forgiven.`
                : 'The loan is fully repaid and will move to Settled.'}
              actionLabel="Settle"
              onConfirm={() => setStatus('settled')}
              trigger={<Button variant="outline" className="text-destructive">Settle loan</Button>}
            />
          </>
        ) : (
          <Button variant="outline" onClick={() => setStatus('open')}>Reopen loan</Button>
        )}
      </div>
    </>
  )
}
