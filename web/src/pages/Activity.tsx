import { useQuery } from '@tanstack/react-query'
import { api, baseSymbol } from '../api'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Eyebrow, PageHeader } from '@/components/shared'

type AuditRow = {
  at: string
  userId: string | null
  actor: string | null
  channel: 'api' | 'mcp'
  action: string
  detail: Record<string, unknown> | null
}

const VERBS: Record<string, string> = { POST: 'added', PATCH: 'edited', PUT: 'edited', DELETE: 'deleted' }

/** "add_transaction" / "PATCH /api/v1/transactions/<id>" → human phrase */
function describe(r: AuditRow) {
  if (r.channel === 'mcp') return r.action.replaceAll('_', ' ')
  const [method, path] = r.action.split(' ')
  const entity = (path ?? '').replace('/api/v1/', '').split('/')[0].replace(/s$/, '')
  return `${VERBS[method] ?? method.toLowerCase()} ${entity}`
}

function summary(detail: AuditRow['detail']) {
  if (!detail) return null
  const bits = [detail.note, detail.name, detail.category, detail.amount != null && `${baseSymbol()} ${detail.amount}`]
  return bits.filter(Boolean).join(' · ') || null
}

export default function Activity() {
  const list = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<AuditRow[]>('/audit?limit=100'),
  })

  const byDate = new Map<string, AuditRow[]>()
  for (const r of list.data ?? []) {
    const day = new Date(r.at).toLocaleDateString('en-CA')
    byDate.set(day, [...(byDate.get(day) ?? []), r])
  }

  return (
    <div>
      <PageHeader title="Activity" />
      <p className="mb-4 px-1 text-xs text-muted-foreground">
        Who added or changed what, last 30 days. Wealth changes by other members stay private.
      </p>

      {list.isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {list.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No activity yet</EmptyTitle>
            <EmptyDescription>Changes made in the app or by agents will show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex flex-col gap-4">
        {[...byDate.entries()].map(([date, rows]) => (
          <section key={date}>
            <div className="mb-1.5 px-1">
              <Eyebrow>
                {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </Eyebrow>
            </div>
            <Card className="gap-0 py-0">
              {rows.map((r, i) => (
                <div key={`${r.at}-${i}`} className={cn('flex items-start justify-between gap-3 px-4 py-3', i > 0 && 'border-t')}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">
                        {r.actor ?? 'Unknown'} — {describe(r)}
                      </span>
                      {r.channel === 'mcp' && <Badge variant="secondary">agent</Badge>}
                    </div>
                    {summary(r.detail) && (
                      <div className="text-xs break-words text-muted-foreground">{summary(r.detail)}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  )
}
