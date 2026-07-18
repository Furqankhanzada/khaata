import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Amount, Confirm, PageHeader } from '@/components/shared'

type Holding = {
  holding_id: string; instrument_id: string; kind: string; symbol: string | null; name: string
  units: number; avg_cost: number | null; zakatable: boolean; note: string | null
  price: number | null; price_as_of: string | null; price_source: string | null
  value: number | null; cost: number | null; gain: number | null
}
type Portfolio = { holdings: Holding[]; total_value: number; total_cost: number; total_gain: number; unpriced_holdings?: number }

export default function PortfolioPage() {
  const qc = useQueryClient()
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: () => api<Portfolio>('/portfolio') })
  const [managing, setManaging] = useState<Holding | null>(null)
  const [adding, setAdding] = useState(false)
  const refresh = useMutation({
    mutationFn: () => api<{ updated: number; errors: string[] }>('/prices/refresh', { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] })
      if (r.errors.length) toast.warning(r.errors.join('; '))
      else toast(`Prices updated (${r.updated})`)
    },
  })

  const p = portfolio.data

  return (
    <div>
      <PageHeader
        title="Investments"
        right={
          <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Refresh prices
          </Button>
        }
      />

      {!p && <Skeleton className="mb-4 h-32 rounded-xl" />}
      {p && (
        <Card className="mb-4">
          <CardContent className="flex flex-col items-center pt-2">
            <span className="text-xs text-muted-foreground">Portfolio value</span>
            <Amount value={p.total_value} className="text-4xl font-semibold" />
            <div className={cn('mt-1 text-sm', p.total_gain >= 0 ? 'text-inflow' : 'text-outflow')}>
              <Amount value={p.total_gain} flow={p.total_gain >= 0 ? 'in' : 'out'} signed className="text-sm" /> vs cost
            </div>
            {p.unpriced_holdings ? (
              <span className="mt-1 text-xs text-muted-foreground">{p.unpriced_holdings} holding(s) awaiting a price</span>
            ) : null}
          </CardContent>
        </Card>
      )}

      {p && p.holdings.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No holdings yet</EmptyTitle>
            <EmptyDescription>Add PSX shares, mutual funds, gold or property to track their value.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {p && p.holdings.length > 0 && (
        <Card className="gap-0 py-0">
          {p.holdings.map((h, i) => (
            <button
              key={h.holding_id}
              onClick={() => setManaging(h)}
              className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-accent', i > 0 && 'border-t')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{h.name}</span>
                  {h.symbol && <Badge variant="secondary" className="amount">{h.symbol}</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {Number(h.units).toLocaleString()} {Number(h.units) === 1 ? 'unit' : 'units'}
                  {h.price != null && <> @ {h.price} · {h.price_source} {h.price_as_of}</>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <Amount value={h.value} className="text-sm" />
                {h.gain != null && <Amount value={h.gain} flow={h.gain >= 0 ? 'in' : 'out'} signed className="text-xs" />}
              </div>
            </button>
          ))}
        </Card>
      )}

      <Button variant="outline" className="mt-4 w-full" onClick={() => setAdding(true)}>
        <Plus data-icon="inline-start" />
        Add holding
      </Button>

      <Drawer open={!!managing} onOpenChange={(open) => !open && setManaging(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{managing?.name}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            {managing && <ManageHolding h={managing} onDone={() => setManaging(null)} />}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={adding} onOpenChange={setAdding}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add holding</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <AddHolding onDone={() => setAdding(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function ManageHolding({ h, onDone }: { h: Holding; onDone: () => void }) {
  const qc = useQueryClient()
  const [units, setUnits] = useState(String(h.units))
  const [price, setPrice] = useState('')
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['portfolio'] }); toast(msg); onDone() }

  return (
    <FieldGroup>
      <form className="flex items-end gap-2" onSubmit={async (e) => {
        e.preventDefault()
        await api(`/holdings/${h.holding_id}`, { method: 'PATCH', json: { units: Number(units) } })
        done('Units updated')
      }}>
        <Field className="flex-1">
          <FieldLabel htmlFor="units">Units held</FieldLabel>
          <Input id="units" type="number" step="any" min="0" required className="amount"
            value={units} onChange={(e) => setUnits(e.target.value)} />
          <FieldDescription>After a buy or sell, set the new total.</FieldDescription>
        </Field>
        <Button type="submit" className="mb-5.5">Save</Button>
      </form>

      <form className="flex items-end gap-2" onSubmit={async (e) => {
        e.preventDefault()
        await api('/prices', { method: 'POST', json: { instrument_id: h.instrument_id, price: Number(price) } })
        done('Price recorded')
      }}>
        <Field className="flex-1">
          <FieldLabel htmlFor="price">Today's price / valuation</FieldLabel>
          <InputGroup>
            <InputGroupAddon>Rs</InputGroupAddon>
            <InputGroupInput id="price" type="number" step="any" min="0.0001" required className="amount"
              placeholder={h.price != null ? String(h.price) : 'per unit'} value={price} onChange={(e) => setPrice(e.target.value)} />
          </InputGroup>
          <FieldDescription>Manual entries win over auto-fetched prices.</FieldDescription>
        </Field>
        <Button type="submit" variant="outline" className="mb-5.5">Set</Button>
      </form>

      <Confirm
        title={`Remove ${h.name}?`}
        description="The holding disappears from your portfolio. Its price history stays."
        actionLabel="Remove"
        onConfirm={async () => {
          await api(`/holdings/${h.holding_id}`, { method: 'DELETE' })
          done('Holding removed')
        }}
        trigger={<Button variant="outline" className="text-destructive">Remove holding</Button>}
      />
    </FieldGroup>
  )
}

const KINDS = [
  { value: 'psx_stock', label: 'PSX stock — price auto-fetched' },
  { value: 'mutual_fund', label: 'Mutual fund — NAV from MUFAP' },
  { value: 'other', label: 'Other asset — manual valuation' },
]

function AddHolding({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'psx_stock' | 'mutual_fund' | 'other'>('psx_stock')
  const [form, setForm] = useState({ symbol: '', fund: '', name: '', units: '', cost: '' })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/holdings', {
        method: 'POST',
        json: {
          instrument: {
            kind,
            symbol: kind === 'psx_stock' ? form.symbol.toUpperCase() : undefined,
            mufap_fund_name: kind === 'mutual_fund' ? form.fund : undefined,
            name: form.name || (kind === 'psx_stock' ? form.symbol.toUpperCase() : form.fund),
          },
          units: Number(form.units),
          avg_cost: form.cost ? Number(form.cost) : undefined,
        },
      })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('Holding added')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the holding')
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel>Type</FieldLabel>
          <Select items={KINDS} value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {kind === 'psx_stock' && (
          <Field>
            <FieldLabel htmlFor="symbol">PSX symbol</FieldLabel>
            <Input id="symbol" placeholder="MEBL" required className="amount uppercase"
              value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          </Field>
        )}
        {kind === 'mutual_fund' && (
          <Field>
            <FieldLabel htmlFor="fund">Fund name on MUFAP</FieldLabel>
            <Input id="fund" placeholder="Mahaana Islamic Cash Fund" required
              value={form.fund} onChange={(e) => setForm({ ...form, fund: e.target.value })} />
            <FieldDescription>Exactly as listed on mufap.com.pk's daily NAV table.</FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="hname">{kind === 'other' ? 'Name' : 'Display name (optional)'}</FieldLabel>
          <Input id="hname" placeholder={kind === 'other' ? 'Gold jewellery (5 tola)' : ''} required={kind === 'other'}
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>

        <FieldSeparator />

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="hunits">Units</FieldLabel>
            <Input id="hunits" type="number" step="any" min="0.000001" required className="amount"
              value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hcost">Avg cost / unit</FieldLabel>
            <Input id="hcost" type="number" step="any" min="0" className="amount"
              value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </Field>
        </div>

        <Button type="submit" className="w-full">Add holding</Button>
      </FieldGroup>
    </form>
  )
}
