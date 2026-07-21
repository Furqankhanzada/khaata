import { useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, baseSymbol, symbolFor, todayLocal } from './api'
import { appBase } from './local/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Spinner } from '@/components/ui/spinner'
import { CURRENCIES, Confirm } from '@/components/shared'

export type Category = { id: string; name: string; kind: 'expense' | 'income' }
export type Tag = { id: string; name: string }
export type Tx = {
  id: string; type: 'expense' | 'income'; amount: string; categoryId: string | null
  originalAmount: string | null; originalCurrency: string | null; fxRate: string | null
  category: string | null; tags: string[]; note: string | null; occurredOn: string
  source: string; userId: string; paidBy: string
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') })
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') })
}

export function invalidateLedger(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['transactions'] })
  qc.invalidateQueries({ queryKey: ['report'] })
  qc.invalidateQueries({ queryKey: ['budget-status'] })
}

export function TxForm({ existing, onDone }: { existing?: Tx; onDone?: () => void }) {
  const qc = useQueryClient()
  const categories = useCategories()
  const tags = useTags()
  const [type, setType] = useState<'expense' | 'income'>(existing?.type ?? 'expense')
  const [amount, setAmount] = useState(existing ? String(Number(existing.originalAmount ?? existing.amount)) : '')
  const [currency, setCurrency] = useState(existing?.originalCurrency ?? appBase())
  const [rate, setRate] = useState(existing?.fxRate ? String(Number(existing.fxRate)) : '')
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null)
  const [picked, setPicked] = useState<string[]>(existing?.tags ?? [])
  const [newTag, setNewTag] = useState('')
  const [note, setNote] = useState(existing?.note ?? '')
  const [date, setDate] = useState(existing?.occurredOn ?? todayLocal())
  const [busy, setBusy] = useState(false)

  const cats = (categories.data ?? []).filter((c) => c.kind === type)

  /** Adding to the vocabulary stays a deliberate act — that's what keeps tags exact. */
  async function addTag() {
    const name = newTag.trim()
    if (!name) return
    setNewTag('')
    const tag = await api<Tag>('/tags', { method: 'POST', json: { name } })
    qc.invalidateQueries({ queryKey: ['tags'] })
    setPicked((p) => (p.includes(tag.name) ? p : [...p, tag.name]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body = {
      type, amount: Number(amount), category_id: categoryId || undefined, tags: picked,
      note: note || undefined, occurred_on: date,
      currency: currency !== appBase() ? currency : undefined,
      fx_rate: currency !== appBase() && rate ? Number(rate) : undefined,
    }
    try {
      if (existing) await api(`/transactions/${existing.id}`, { method: 'PATCH', json: body })
      else await api('/transactions', { method: 'POST', json: body })
      invalidateLedger(qc)
      toast(existing ? 'Entry updated' : `${type === 'expense' ? 'Expense' : 'Income'} added`)
      if (!existing) { setAmount(''); setNote(''); setPicked([]) }
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
            <InputGroupAddon>
              <select
                aria-label="Currency"
                className="amount bg-transparent text-sm outline-none"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c === appBase() ? symbolFor(c) : c}</option>)}
              </select>
            </InputGroupAddon>
            <InputGroupInput
              id="tx-amount" type="number" inputMode="decimal" step="0.01" min="0.01" required
              className="amount" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </InputGroup>
          {currency !== appBase() && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">1 {currency} =</span>
              {/* flex, not fixed width: base-per-quote rates can be long either way (280 or 0.00359871) */}
              <InputGroup className="min-w-28 flex-1">
                <InputGroupAddon>{baseSymbol()}</InputGroupAddon>
                <InputGroupInput type="number" step="any" min="0.00000001" placeholder="auto"
                  className="amount" value={rate} onChange={(e) => setRate(e.target.value)} />
              </InputGroup>
              <span className="shrink-0">blank = today's rate</span>
            </div>
          )}
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
              <SelectTrigger className="w-full" aria-label="Category">
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

        {/* ponytail: a flat chip row — swap in a searchable combobox past ~25 tags */}
        <Field>
          <FieldLabel>Tags</FieldLabel>
          {(tags.data ?? []).length > 0 && (
            <ToggleGroup
              multiple
              className="w-full flex-wrap"
              variant="outline"
              size="sm"
              value={picked}
              onValueChange={(v: string[]) => setPicked(v)}
            >
              {(tags.data ?? []).map((t) => (
                <ToggleGroupItem key={t.id} value={t.name}>{t.name}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <Input
            aria-label="New tag"
            placeholder="New tag — press Enter"
            className="mt-1.5"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            // Enter would submit the whole form otherwise
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTag() } }}
          />
        </Field>

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
              description={`${existing.category ?? 'Uncategorized'} · ${baseSymbol()} ${Number(existing.amount)} on ${existing.occurredOn}`}
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
