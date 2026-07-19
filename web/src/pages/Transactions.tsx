import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Amount, Eyebrow, PageHeader } from '@/components/shared'
import { TxForm, type Tx } from '../TxForm'

export default function Transactions() {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Tx | null>(null)
  const list = useQuery({
    queryKey: ['transactions', q],
    queryFn: () => api<Tx[]>(`/transactions?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  })

  const byDate = new Map<string, Tx[]>()
  for (const t of list.data ?? []) byDate.set(t.occurredOn, [...(byDate.get(t.occurredOn) ?? []), t])

  return (
    <div>
      <PageHeader title="Ledger" />
      <InputGroup className="mb-4">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
      </InputGroup>

      {list.isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {list.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{q ? 'No entries match' : 'The ledger is empty'}</EmptyTitle>
            <EmptyDescription>
              {q ? 'Try a different search.' : 'Add your first entry with the + button below.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex flex-col gap-4">
        {[...byDate.entries()].map(([date, txs]) => {
          const dayOut = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
          return (
            <section key={date}>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <Eyebrow>
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Eyebrow>
                {dayOut > 0 && <Amount value={dayOut} flow="out" className="text-[11px]" signed />}
              </div>
              <Card className="gap-0 py-0">
                {txs.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => setEditing(t)}
                    className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-accent', i > 0 && 'border-t')}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{t.category ?? 'Uncategorized'}</span>
                        {t.source === 'recurring' && <Badge variant="secondary">auto</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.originalCurrency && (
                          <>
                            <Amount value={t.originalAmount} currency={t.originalCurrency} className="text-xs" />
                            {' @ '}{Number(t.fxRate).toFixed(2)}{' · '}
                          </>
                        )}
                        {t.note ? `${t.note} · ` : ''}{t.paidBy}
                      </div>
                    </div>
                    <Amount value={t.amount} flow={t.type === 'income' ? 'in' : 'out'} signed className="shrink-0 text-sm" />
                  </button>
                ))}
              </Card>
            </section>
          )
        })}
      </div>

      <Drawer open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Edit entry</DrawerTitle>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-lg px-4 pb-6">
            {editing && <TxForm existing={editing} onDone={() => setEditing(null)} />}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
