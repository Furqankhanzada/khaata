import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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
import type { Me } from '../App'

const PAGE = 50

function MemberChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full px-4 py-1.5 text-sm whitespace-nowrap transition-colors',
        active ? 'bg-foreground font-medium text-background' : 'border border-line bg-card text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export default function Transactions() {
  const [q, setQ] = useState('')
  const [member, setMember] = useState<string | null>(null)
  const [editing, setEditing] = useState<Tx | null>(null)
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  const members = me.data?.household?.members ?? []
  const list = useInfiniteQuery({
    queryKey: ['transactions', q, member],
    queryFn: ({ pageParam }) =>
      api<Tx[]>(`/transactions?limit=${PAGE}&offset=${pageParam}${q ? `&q=${encodeURIComponent(q)}` : ''}${member ? `&user_id=${member}` : ''}`),
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
        <InputGroupInput placeholder="Search notes, items, people…" value={q} onChange={(e) => setQ(e.target.value)} />
      </InputGroup>

      {members.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto px-0.5 pb-0.5">
          <MemberChip active={member === null} onClick={() => setMember(null)}>All</MemberChip>
          {members.map((m) => (
            <MemberChip key={m.id} active={member === m.id} onClick={() => setMember(m.id)}>
              {m.name.split(' ')[0]}
            </MemberChip>
          ))}
        </div>
      )}

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
                <Eyebrow className="text-xs font-semibold tracking-[0.06em]">
                  {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </Eyebrow>
                {dayOut > 0 && <Amount value={dayOut} flow="out" className="text-xs font-semibold" />}
              </div>
              {cards.map(({ cat, list, total, type }) => (
                <Card key={cat} className="gap-0 rounded-2xl border-line py-0">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
                    <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                      <span className="truncate">{cat}</span>
                      <span className="shrink-0 rounded-md bg-chip px-[7px] py-[2px] text-[11px] font-normal text-muted-foreground">
                        {list.length} item{list.length > 1 ? 's' : ''}
                      </span>
                    </span>
                    <Amount value={total} flow={type === 'income' ? 'in' : 'out'} className="shrink-0 text-sm" />
                  </div>
                  {list.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => setEditing(t)}
                      className={cn('flex w-full items-start justify-between gap-3 px-4 pt-2.5 pb-3 text-left active:bg-accent', i > 0 && 'border-t border-line')}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[13px]">
                          <span className="break-words">{t.note || cat}</span>
                          {t.source === 'recurring' && <Badge variant="secondary">auto</Badge>}
                        </div>
                        {t.tags?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-[5px]">
                            {t.tags.map((tag) => (
                              <span key={tag} className="rounded-[5px] border border-line px-[7px] py-px text-[10px] font-medium whitespace-nowrap text-inflow">
                                {tag}
                              </span>
                            ))}
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
                        <Amount
                          value={t.amount}
                          flow={t.type === 'income' ? 'in' : undefined}
                          className={cn('text-[13px]', t.type === 'expense' && 'text-muted-foreground')}
                        />
                        <span className="text-[10px] text-faint">{t.paidBy}</span>
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
