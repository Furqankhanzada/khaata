import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChartColumn, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, todayLocal } from '../api'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Amount, Eyebrow, PageHeader } from '@/components/shared'

type Report = {
  month: string; income: number; expense: number; net: number
  by_category: { type: string; category: string; total: number }[]
  by_member: { member: string; type: string; total: number }[]
  budgets: { category_id: string; category: string; budget: number; spent: number; remaining: number }[]
  budget_totals: { budget: number; spent: number; remaining: number }
  unbudgeted_spent: number
  month_elapsed_pct: number | null
}

function shiftMonth(m: string, delta: number) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export default function Dashboard() {
  const [month, setMonth] = useState(todayLocal().slice(0, 7))
  const report = useQuery({ queryKey: ['report', month], queryFn: () => api<Report>(`/reports/monthly?month=${month}`) })
  const r = report.data

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Home"
        right={
          <Button variant="outline" size="sm" render={<Link to="/reports" />}>
            <ChartColumn data-icon="inline-start" />
            Reports
          </Button>
        }
      />
      {/* month spread */}
      <Card>
        <CardContent className="flex flex-col items-center pt-2">
          <div className="mb-3 flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </Button>
            <Eyebrow className="min-w-32 text-center text-foreground">{monthLabel(month)}</Eyebrow>
            <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </Button>
          </div>
          {r ? (
            <>
              <span className="text-xs text-muted-foreground">Net this month</span>
              <Amount value={r.net} className={cn('text-4xl font-semibold', r.net >= 0 ? 'text-foreground' : 'text-outflow')} />
              <div className="mt-4 w-full max-w-60">
                <div className="flex items-baseline justify-between py-1.5">
                  <span className="text-sm text-muted-foreground">In</span>
                  <Amount value={r.income} flow="in" className="text-sm" />
                </div>
                <Separator />
                <div className="flex items-baseline justify-between py-1.5">
                  <span className="text-sm text-muted-foreground">Out</span>
                  <Amount value={r.expense} flow="out" className="text-sm" />
                </div>
              </div>
            </>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
        </CardContent>
      </Card>

      {/* budgets */}
      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" render={<Link to="/budgets">Edit</Link>} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {r && r.budgets.length === 0 && (
            <p className="text-sm text-muted-foreground">No caps set yet — add monthly limits per category.</p>
          )}
          {r && r.budgets.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b pb-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-sm">
                  <Amount value={r.budget_totals.spent} className={cn('text-sm', r.budget_totals.remaining < 0 && 'text-outflow')} />
                  <span className="text-muted-foreground"> / </span>
                  <Amount value={r.budget_totals.budget} className="text-sm" />
                </span>
              </div>
              <div className="relative">
                <Progress value={Math.min(100, Math.round((r.budget_totals.spent / r.budget_totals.budget) * 100))} className="h-2" />
                {r.month_elapsed_pct != null && (
                  // pace marker: where in the month we are — spend left of the tick is on track
                  <div className="absolute top-[-2px] h-3 w-0.5 rounded bg-foreground/40" style={{ left: `${r.month_elapsed_pct}%` }} />
                )}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {r.budget_totals.remaining >= 0
                    ? <><Amount value={r.budget_totals.remaining} className="text-xs" /> left</>
                    : <>over by <Amount value={-r.budget_totals.remaining} className="text-xs text-outflow" /></>}
                </span>
                {r.month_elapsed_pct != null && <span>{r.month_elapsed_pct}% of month gone</span>}
              </div>
              {r.unbudgeted_spent > 0 && (
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>Outside any budget</span>
                  <Amount value={r.unbudgeted_spent} className="text-xs" />
                </div>
              )}
            </div>
          )}
          {r?.budgets.map((b) => {
            const pct = Math.min(100, Math.round((b.spent / b.budget) * 100))
            const over = b.remaining < 0
            return (
              <div key={b.category_id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    {b.category}
                    {over && <Badge variant="destructive">over</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Amount value={b.spent} className={cn(over && 'text-outflow')} /> / <Amount value={b.budget} />
                  </span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* spending by category */}
      {r && r.by_category.some((c) => c.type === 'expense') && (
        <Card>
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CardContent>
            {r.by_category.filter((c) => c.type === 'expense').map((c, i) => (
              <div key={c.category} className={cn('flex items-baseline justify-between py-2 text-sm', i > 0 && 'border-t')}>
                <span>{c.category}</span>
                <Amount value={c.total} className="text-sm" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* member split */}
      {r && r.by_member.some((m) => m.type === 'expense') && (
        <Card>
          <CardHeader>
            <CardTitle>Who spent what</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {r.by_member.filter((m) => m.type === 'expense').map((m) => (
              <div key={m.member} className="flex items-center justify-between">
                <span className="flex items-center gap-2.5 text-sm">
                  <Avatar className="size-7">
                    <AvatarFallback>{m.member.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  {m.member}
                </span>
                <Amount value={m.total} className="text-sm" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
