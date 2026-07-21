import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, baseSymbol } from '../api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, PageHeader } from '@/components/shared'
import { useCategories } from '../TxForm'

type Status = {
  month: string
  budgets: { category_id: string; category: string; budget: number; spent: number }[]
  totals: { budget: number; spent: number; remaining: number }
  unbudgeted_spent: number
}

export default function Budgets() {
  const qc = useQueryClient()
  const categories = useCategories()
  const status = useQuery({ queryKey: ['budget-status'], queryFn: () => api<Status>('/budgets/status') })
  const [draft, setDraft] = useState<Record<string, string>>({})

  const byCat = new Map(status.data?.budgets.map((b) => [b.category_id, b]))
  const expenseCats = (categories.data ?? []).filter((c) => c.kind === 'expense')

  async function save(categoryId: string, name: string) {
    const val = draft[categoryId]
    if (val === undefined) return
    await api(`/budgets/${categoryId}`, { method: 'PUT', json: { monthly_amount: Number(val || 0) } })
    qc.invalidateQueries({ queryKey: ['budget-status'] })
    qc.invalidateQueries({ queryKey: ['report'] })
    setDraft((d) => { const { [categoryId]: _, ...rest } = d; return rest })
    toast(Number(val) > 0 ? `${name} capped at ${baseSymbol()} ${Number(val).toLocaleString()}` : `${name} budget removed`)
  }

  return (
    <div>
      <PageHeader title="Budgets" />
      <Card>
        <CardHeader>
          <CardTitle>Monthly caps</CardTitle>
          <CardDescription>Per expense category. Set 0 to remove a cap.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {(categories.isLoading || status.isLoading) && <Skeleton className="h-40" />}
          {expenseCats.map((c, i) => {
            const b = byCat.get(c.id)
            const dirty = draft[c.id] !== undefined
            return (
              <form
                key={c.id}
                className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`}
                onSubmit={(e) => { e.preventDefault(); void save(c.id, c.name) }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  {b && (
                    <div className="text-xs text-muted-foreground">
                      spent <Amount value={b.spent} className="text-xs" />
                    </div>
                  )}
                </div>
                <InputGroup className="w-36">
                  <InputGroupAddon>{baseSymbol()}</InputGroupAddon>
                  <InputGroupInput
                    type="number" inputMode="numeric" min="0" placeholder="—"
                    className="amount text-right"
                    value={draft[c.id] ?? (b ? String(b.budget) : '')}
                    onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })}
                  />
                  {dirty && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton type="submit" size="xs">Save</InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              </form>
            )
          })}
          {status.data && status.data.totals.budget > 0 && (
            <div className="mt-1 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold">Total budgeted</span>
              <span className="text-sm">
                <Amount value={status.data.totals.spent} className="text-sm" />
                <span className="text-muted-foreground"> / </span>
                <Amount value={status.data.totals.budget} className="text-sm" />
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
