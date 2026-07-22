import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'
import { Amount, Eyebrow, PageHeader } from '@/components/shared'

type Overview = {
  period: string; offset: number; label: string; granularity: 'day' | 'week' | 'month'
  income: number; expense: number; net: number
  prev: { label: string; income: number; expense: number; net: number }
  trend: { bucket: string; income: number; expense: number }[]
  by_category: { type: string; category: string; total: number }[]
  by_member: { member: string; type: string; total: number }[]
}

const PERIODS = ['week', 'month', 'quarter', 'year', 'custom'] as const
type PeriodChoice = (typeof PERIODS)[number]

const chartConfig = {
  income: { label: 'In', color: 'var(--chart-in)' },
  expense: { label: 'Out', color: 'var(--chart-out)' },
} satisfies ChartConfig

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

function bucketLabel(bucket: string, granularity: Overview['granularity'], period: string) {
  const d = new Date(bucket + 'T00:00:00')
  if (granularity === 'month') return d.toLocaleDateString('en-PK', { month: 'short' })
  if (granularity === 'week') return `${d.getDate()} ${d.toLocaleDateString('en-PK', { month: 'short' })}`
  return period === 'week' ? d.toLocaleDateString('en-PK', { weekday: 'short' }) : String(d.getDate())
}

function DeltaChip({ label, cur, prev, upIsGood }: { label: string; cur: number; prev: number; upIsGood: boolean }) {
  if (!prev) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (!Number.isFinite(pct)) return null
  const up = pct >= 0
  const good = up === upIsGood
  return (
    <span className={cn('text-xs', good ? 'text-inflow' : 'text-outflow')}>
      {label} {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

export default function Reports() {
  const [choice, setChoice] = useState<PeriodChoice>('month')
  const [offset, setOffset] = useState(0)
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null)

  const custom = choice === 'custom'
  const query = custom
    ? applied && `from=${applied.from}&to=${applied.to}`
    : `period=${choice}&offset=${offset}`
  const report = useQuery({
    queryKey: ['overview', query],
    queryFn: () => api<Overview>(`/reports/overview?${query}`),
    enabled: !!query,
  })
  const r = report.data

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" />

      <ToggleGroup
        className="w-full" variant="outline" size="sm"
        value={[choice]}
        onValueChange={(v: string[]) => {
          if (!v[0]) return
          setChoice(v[0] as PeriodChoice)
          setOffset(0)
        }}
      >
        {PERIODS.map((p) => (
          <ToggleGroupItem key={p} value={p} className="flex-1 capitalize">{p}</ToggleGroupItem>
        ))}
      </ToggleGroup>

      {custom ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            let from = fd.get('from') as string
            let to = fd.get('to') as string
            if (!from || !to) return
            if (from > to) [from, to] = [to, from]
            setApplied({ from, to })
          }}
        >
          <Input type="date" name="from" required className="flex-1 basis-32" defaultValue={applied?.from} />
          <span className="text-muted-foreground">–</span>
          <Input type="date" name="to" required className="flex-1 basis-32" defaultValue={applied?.to} />
          <Button type="submit" size="sm">Show</Button>
        </form>
      ) : (
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous period" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft />
          </Button>
          <Eyebrow className="min-w-44 text-center text-foreground">{r?.label ?? '…'}</Eyebrow>
          <Button variant="ghost" size="icon-sm" aria-label="Next period" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
            <ChevronRight />
          </Button>
        </div>
      )}

      {custom && !applied && (
        <p className="text-center text-sm text-muted-foreground">Pick a start and end date, then Show.</p>
      )}
      {report.isLoading && <Skeleton className="h-72 rounded-xl" />}

      {r && (
        <>
          <Card>
            <CardContent className="flex flex-col items-center pt-2">
              <span className="text-xs text-muted-foreground">Net · {r.label}</span>
              <Amount value={r.net} className={cn('text-3xl font-semibold', r.net < 0 && 'text-outflow')} />
              <div className="mt-3 w-full max-w-64">
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-sm text-muted-foreground">In</span>
                  <span className="flex items-baseline gap-2">
                    <DeltaChip label="" cur={r.income} prev={r.prev.income} upIsGood />
                    <Amount value={r.income} flow="in" className="text-sm" />
                  </span>
                </div>
                <Separator />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-sm text-muted-foreground">Out</span>
                  <span className="flex items-baseline gap-2">
                    <DeltaChip label="" cur={r.expense} prev={r.prev.expense} upIsGood={false} />
                    <Amount value={r.expense} flow="out" className="text-sm" />
                  </span>
                </div>
              </div>
              <span className="mt-1 text-[11px] text-muted-foreground">change vs {r.prev.label}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>In vs out</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <BarChart data={r.trend} barGap={2} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="bucket" tickLine={false} axisLine={false} fontSize={10}
                    interval={r.trend.length > 14 ? 'preserveStartEnd' : 0}
                    tickFormatter={(b: string) => bucketLabel(b, r.granularity, r.period)}
                  />
                  <YAxis width={38} tickLine={false} axisLine={false} fontSize={10} tickFormatter={compact} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          const b = payload?.[0]?.payload?.bucket as string | undefined
                          return b ? new Date(b + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
                        }}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="expense" fill="var(--color-expense)" radius={[3, 3, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <CategoryBars title="Spending by category" rows={r.by_category.filter((c) => c.type === 'expense')} tone="out" />
          <CategoryBars title="Income by source" rows={r.by_category.filter((c) => c.type === 'income')} tone="in" />

          {r.by_member.some((m) => m.type === 'expense') && (
            <Card>
              <CardHeader>
                <CardTitle>Who spent what</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {r.by_member.filter((m) => m.type === 'expense').map((m) => (
                  <div key={m.member} className="flex items-center justify-between">
                    <span className="flex items-center gap-2.5 text-sm">
                      <Avatar className="size-7"><AvatarFallback>{m.member.slice(0, 1)}</AvatarFallback></Avatar>
                      {m.member}
                    </span>
                    <Amount value={m.total} className="text-sm" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function CategoryBars({ title, rows, tone }: { title: string; rows: { category: string; total: number }[]; tone: 'in' | 'out' }) {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map((c) => c.total))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map((c) => (
          <div key={c.category} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{c.category}</span>
              <Amount value={c.total} className="text-sm" />
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className={cn('h-1.5 rounded-full', tone === 'out' ? 'bg-chart-out' : 'bg-chart-in')}
                style={{ width: `${Math.max(2, Math.round((c.total / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
