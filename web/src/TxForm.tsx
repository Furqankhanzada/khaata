import { useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, todayLocal } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Spinner } from '@/components/ui/spinner'
import { Confirm } from '@/components/shared'

export type Category = { id: string; name: string; kind: 'expense' | 'income' }
export type Tx = {
  id: string; type: 'expense' | 'income'; amount: string; categoryId: string | null
  category: string | null; note: string | null; occurredOn: string; source: string; userId: string; paidBy: string
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') })
}

export function invalidateLedger(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['transactions'] })
  qc.invalidateQueries({ queryKey: ['report'] })
  qc.invalidateQueries({ queryKey: ['budget-status'] })
}

export function TxForm({ existing, onDone }: { existing?: Tx; onDone?: () => void }) {
  const qc = useQueryClient()
  const categories = useCategories()
  const [type, setType] = useState<'expense' | 'income'>(existing?.type ?? 'expense')
  const [amount, setAmount] = useState(existing ? String(Number(existing.amount)) : '')
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null)
  const [note, setNote] = useState(existing?.note ?? '')
  const [date, setDate] = useState(existing?.occurredOn ?? todayLocal())
  const [busy, setBusy] = useState(false)

  const cats = (categories.data ?? []).filter((c) => c.kind === type)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body = { type, amount: Number(amount), category_id: categoryId || undefined, note: note || undefined, occurred_on: date }
    try {
      if (existing) await api(`/transactions/${existing.id}`, { method: 'PATCH', json: body })
      else await api('/transactions', { method: 'POST', json: body })
      invalidateLedger(qc)
      toast(existing ? 'Entry updated' : `${type === 'expense' ? 'Expense' : 'Income'} added`)
      if (!existing) { setAmount(''); setNote('') }
      onDone?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the entry')
    } finally {
      setBusy(false)
    }
  }

  async function del() {
    if (!existing) return
    await api(`/transactions/${existing.id}`, { method: 'DELETE' })
    invalidateLedger(qc)
    toast('Entry deleted')
    onDone?.()
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <ToggleGroup
          className="w-full"
          variant="outline"
          value={[type]}
          onValueChange={(v: string[]) => {
            const next = v[0] as 'expense' | 'income' | undefined
            if (next && next !== type) { setType(next); setCategoryId(null) }
          }}
        >
          <ToggleGroupItem value="expense" className="flex-1">Expense</ToggleGroupItem>
          <ToggleGroupItem value="income" className="flex-1">Income</ToggleGroupItem>
        </ToggleGroup>

        <Field>
          <FieldLabel htmlFor="tx-amount">Amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>Rs</InputGroupAddon>
            <InputGroupInput
              id="tx-amount" type="number" inputMode="decimal" step="0.01" min="0.01" required
              className="amount" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </InputGroup>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="tx-date">Date</FieldLabel>
            <Input id="tx-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Category</FieldLabel>
            <Select
              items={cats.map((c) => ({ value: c.id, label: c.name }))}
              value={categoryId}
              onValueChange={(v) => setCategoryId(v as string | null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="tx-note">Note</FieldLabel>
          <Textarea id="tx-note" rows={2} placeholder="What was it for?" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">
            {busy && <Spinner data-icon="inline-start" />}
            {existing ? 'Save changes' : `Add ${type}`}
          </Button>
          {existing && (
            <Confirm
              title="Delete this entry?"
              description={`${existing.category ?? 'Uncategorized'} · Rs ${Number(existing.amount)} on ${existing.occurredOn}`}
              actionLabel="Delete"
              onConfirm={del}
              trigger={<Button type="button" variant="outline" className="text-destructive">Delete</Button>}
            />
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
