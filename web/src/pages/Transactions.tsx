import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Amount, Eyebrow, PageHeader } from '@/components/shared'
import { TxForm, type Tx } from '../TxForm'

const PAGE = 50

export default function Transactions() {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Tx | null>(null)
  const list = useInfiniteQuery({
    queryKey: ['transactions', q],
    queryFn: ({ pageParam }) => api<Tx[]>(`/transactions?limit=${PAGE}&offset=${pageParam}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  })
  const rows = list.data?.pages.flat() ?? []

  // sentinel below the list: entering the viewport pulls the next page from local SQLite
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage])

  const byDate = new Map<string, Tx[]>()
  for (const t of rows) byDate.set(t.occurredOn, [...(byDate.get(t.occurredOn) ?? []), t])

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

      {!list.isLoading && rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{q ? 'No entries match' : 'The ledger is empty'}</EmptyTitle>
            <EmptyDescription>
              {q ? 'Try a different search.' : 'Add your first entry with the + button below.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex flex-col gap-5">
        {[...byDate.entries()].map(([date, txs]) => {
          const dayOut = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
          // one card per category, largest subtotal first (categories are kind-scoped, so a card is all-expense or all-income)
          const byCat = new Map<string, Tx[]>()
          for (const t of txs) {
            const key = t.category ?? 'Uncategorized'
            byCat.set(key, [...(byCat.get(key) ?? []), t])
          }
          const cards = [...byCat.entries()]
            .map(([cat, list]) => ({ cat, list, total: list.reduce((s, t) => s + Number(t.amount), 0), type: list[0].type }))
            .sort((a, b) => b.total - a.total)
          return (
            <section key={date} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between px-1">
                <Eyebrow>
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Eyebrow>
                {dayOut > 0 && <Amount value={dayOut} flow="out" className="text-xs font-semibold" />}
              </div>
              {cards.map(({ cat, list, total, type }) => (
                <Card key={cat} className="gap-0 py-0">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <span className="truncate">{cat}</span>
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {list.length} item{list.length > 1 ? 's' : ''}
                      </Badge>
                    </span>
                    <Amount value={total} flow={type === 'income' ? 'in' : 'out'} className="shrink-0 text-sm" />
                  </div>
                  {list.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => setEditing(t)}
                      className={cn('flex w-full items-start justify-between gap-3 px-4 py-3 text-left active:bg-accent', i > 0 && 'border-t')}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="break-words">{t.note || cat}</span>
                          {t.source === 'recurring' && <Badge variant="secondary">auto</Badge>}
                        </div>
                        {t.tags?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.tags.map((tag) => <Badge key={tag} variant="outline" className="font-normal">{tag}</Badge>)}
                          </div>
                        )}
                        {t.originalCurrency && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            <Amount value={t.originalAmount} currency={t.originalCurrency} className="text-xs" />
                            {' @ '}{Number(t.fxRate).toFixed(2)}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <Amount value={t.amount} flow={t.type === 'income' ? 'in' : 'out'} className="text-sm" />
                        <span className="text-xs text-muted-foreground">{t.paidBy}</span>
                      </div>
                    </button>
                  ))}
                </Card>
              ))}
            </section>
          )
        })}
      </div>

      <div ref={sentinel} data-testid="ledger-sentinel" className="h-8">
        {list.isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Spinner />
          </div>
        )}
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
