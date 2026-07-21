import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { Copy, Plus, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, authClient, baseSymbol, symbolFor } from '../api'
import { appBase } from '../local/dates'
import { clearLocal } from '../local/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Switch } from '@/components/ui/switch'
import { Amount, CURRENCIES, Confirm, PageHeader, ShareSwitch } from '@/components/shared'
import type { Me } from '../App'
import type { Loan } from './Loans'

function copyText(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`),
  )
}

export default function More({ me }: { me: Me }) {
  const qc = useQueryClient()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="More" />
      <AppearanceSection />
      <HouseholdSection me={me} />
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Who added or changed what, last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link to="/activity">View activity</Link>} />
        </CardContent>
      </Card>
      <ApiKeysSection />
      <AccountsSection />
      <LoansSection />
      <RecurringSection />
      <ZakatSection />
      <Button
        variant="outline"
        className="text-destructive"
        onClick={async () => { await authClient.signOut(); await clearLocal(); qc.invalidateQueries() }}
      >
        Sign out
      </Button>
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          className="w-full" variant="outline"
          value={[theme ?? 'system']}
          onValueChange={(v: string[]) => v[0] && setTheme(v[0])}
        >
          <ToggleGroupItem value="light" className="flex-1">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark" className="flex-1">Dark</ToggleGroupItem>
          <ToggleGroupItem value="system" className="flex-1">System</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}

function HouseholdSection({ me }: { me: Me }) {
  const qc = useQueryClient()
  const h = me.household!
  return (
    <Card>
      <CardHeader>
        <CardTitle>Household · {h.name}</CardTitle>
        <CardDescription>
          The expense ledger and budgets are shared; entries show who paid. Wealth items — accounts,
          investments, loans — are private to each member unless marked shared.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {h.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5 text-sm">
              <Avatar className="size-7"><AvatarFallback>{m.name.slice(0, 1)}</AvatarFallback></Avatar>
              {m.name}{m.id === me.user.id && <Badge variant="secondary">you</Badge>}
            </span>
            <span className="text-xs text-muted-foreground">{m.email}</span>
          </div>
        ))}
        <Field>
          <FieldLabel>Invite code</FieldLabel>
          <InputGroup>
            <InputGroupInput readOnly value={h.inviteCode} className="amount" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Copy invite code" onClick={() => copyText(h.inviteCode, 'Invite code')}>
                <Copy />
              </InputGroupButton>
              <InputGroupButton size="icon-xs" aria-label="Rotate invite code" onClick={async () => {
                await api('/household/rotate-invite', { method: 'POST' })
                qc.invalidateQueries({ queryKey: ['me'] })
                toast('Invite code rotated')
              }}>
                <RotateCw />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="hh-timezone">Timezone</FieldLabel>
          <select
            id="hh-timezone"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={h.timezone}
            onChange={async (e) => {
              await api('/household', { method: 'PATCH', json: { timezone: e.target.value } })
              qc.invalidateQueries()
              toast('Household timezone updated')
            }}
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">Entry dates, budgets and reports follow this clock.</span>
        </Field>
        <Field>
          <FieldLabel>Base currency</FieldLabel>
          <div className="flex min-h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
            {h.baseCurrency} — set at creation; amounts are stored in it, so it can't change.
          </div>
        </Field>
      </CardContent>
    </Card>
  )
}

function ApiKeysSection() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const keys = useQuery({
    queryKey: ['apikeys'],
    queryFn: async () => (await authClient.apiKey.list()).data?.apiKeys ?? [],
  })
  const mcpUrl = `${location.origin}/mcp`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents & API keys</CardTitle>
        <CardDescription>
          Connect Hermes, Claude, ChatGPT or any agent — MCP at{' '}
          <button className="amount text-xs underline decoration-dotted" onClick={() => copyText(mcpUrl, 'MCP URL')}>{mcpUrl}</button>
          {' '}or REST at <code className="amount text-xs">/api/v1</code>, auth header <code className="amount text-xs">x-api-key</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(keys.data ?? []).map((k) => (
          <div key={k.id} className="flex items-center justify-between">
            <span className="text-sm">
              {k.name ?? 'unnamed'} <span className="amount text-xs text-muted-foreground">{k.start}…</span>
            </span>
            <Confirm
              title={`Revoke "${k.name}"?`}
              description="Any agent using this key loses access immediately."
              actionLabel="Revoke"
              onConfirm={async () => {
                await authClient.apiKey.delete({ keyId: k.id })
                qc.invalidateQueries({ queryKey: ['apikeys'] })
                toast('Key revoked')
              }}
              trigger={<Button variant="ghost" size="sm" className="text-destructive">Revoke</Button>}
            />
          </div>
        ))}
        {created && (
          <Alert>
            <AlertTitle>Copy this key now — it won't be shown again</AlertTitle>
            <AlertDescription className="flex items-center gap-2">
              <span className="amount text-xs break-all select-all">{created}</span>
              <Button variant="outline" size="icon-sm" aria-label="Copy key" onClick={() => copyText(created, 'API key')}>
                <Copy />
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault()
          const res = await authClient.apiKey.create({ name })
          if (res.data) { setCreated(res.data.key); setName(''); qc.invalidateQueries({ queryKey: ['apikeys'] }); toast('Key created') }
          else toast.error(res.error?.message ?? 'Could not create the key')
        }}>
          <Input placeholder='Key name, e.g. "hermes"' required value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Create</Button>
        </form>
      </CardContent>
    </Card>
  )
}

type Account = {
  id: string; name: string; balance: number; currency: string; zakatable: boolean
  visibility: 'shared' | 'private'; rate: number | null; base_balance: number | null; rate_as_of: string | null
}
function AccountsSection() {
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
  const [form, setForm] = useState({ name: '', balance: '', currency: appBase() })
  const [shared, setShared] = useState(false)
  const [managing, setManaging] = useState<Account | null>(null)
  const inval = () => { qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['zakat'] }) }
  const total = (accounts.data ?? []).reduce((s, a) => s + (a.base_balance ?? 0), 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash & bank accounts</CardTitle>
        <CardDescription>Snapshot balances — tap one to edit or delete. Counted for zakat. Private to you unless shared.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(accounts.data?.length ?? 0) > 1 && (
          <div className="flex items-center justify-between border-b pb-2 text-xs text-muted-foreground">
            <span>Total</span>
            <Amount value={total} className="text-xs" />
          </div>
        )}
        {(accounts.data ?? []).map((a) => (
          <button key={a.id} className="flex min-h-9 w-full items-center justify-between gap-2 text-left active:opacity-70" onClick={() => setManaging(a)}>
            <span className="flex flex-col">
              <span className="flex items-center gap-1.5 text-sm">
                {a.name}
                {a.currency !== appBase() && <Badge variant="secondary" className="amount">{a.currency}</Badge>}
                {a.visibility === 'shared' && <Badge variant="outline">shared</Badge>}
              </span>
              {a.currency !== appBase() && (
                <span className="text-xs text-muted-foreground">
                  {a.rate != null
                    ? <>@ {a.rate.toFixed(2)} ≈ <Amount value={a.base_balance} className="text-xs" /></>
                    : 'rate unavailable — record one'}
                </span>
              )}
            </span>
            <Amount value={a.balance} currency={a.currency} className="text-sm" />
          </button>
        ))}
        <form className="flex flex-col gap-2" onSubmit={async (e) => {
          e.preventDefault()
          await api('/accounts', {
            method: 'POST',
            json: { name: form.name, balance: Number(form.balance || 0), currency: form.currency, visibility: shared ? 'shared' : 'private' },
          })
          setForm({ name: '', balance: '', currency: appBase() }); setShared(false); inval(); toast('Account added')
        }}>
          <div className="flex gap-2">
            <Input placeholder="Account name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <InputGroup className="w-36 shrink-0">
              <InputGroupAddon>
                <select
                  aria-label="Currency"
                  className="amount bg-transparent text-sm outline-none"
                  value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c === appBase() ? symbolFor(c) : c}</option>)}
                </select>
              </InputGroupAddon>
              <InputGroupInput type="number" inputMode="decimal" step="any" min="0" placeholder="0" aria-label="Opening balance" className="amount"
                value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
            </InputGroup>
            <Button type="submit" variant="outline" size="icon" aria-label="Add account"><Plus /></Button>
          </div>
          <ShareSwitch checked={shared} onChange={setShared} />
        </form>
      </CardContent>

      <Drawer open={!!managing} onOpenChange={(open) => !open && setManaging(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Edit account</DrawerTitle>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-lg px-4 pb-6">
            {managing && <ManageAccount a={managing} onDone={() => { setManaging(null); inval() }} />}
          </div>
        </DrawerContent>
      </Drawer>
    </Card>
  )
}

function ManageAccount({ a, onDone }: { a: Account; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(a.name)
  const [balance, setBalance] = useState(String(a.balance))
  const [currency, setCurrency] = useState(a.currency)
  const [zakatable, setZakatable] = useState(a.zakatable)
  const [sharedV, setSharedV] = useState(a.visibility === 'shared')
  const inval = () => { qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['zakat'] }) }

  return (
    <FieldGroup>
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault()
        await api(`/accounts/${a.id}`, { method: 'PATCH', json: { name, balance: Number(balance), currency } })
        toast(`${name} updated`)
        onDone()
      }}>
        <Field>
          <FieldLabel htmlFor="account-name">Name</FieldLabel>
          <Input id="account-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="account-balance">Balance</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <select
                aria-label="Currency"
                className="amount bg-transparent text-sm outline-none"
                value={currency} onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c === appBase() ? symbolFor(c) : c}</option>)}
              </select>
            </InputGroupAddon>
            <InputGroupInput id="account-balance" type="number" inputMode="decimal" step="any" min="0" required className="amount"
              value={balance} onChange={(e) => setBalance(e.target.value)} />
          </InputGroup>
        </Field>
        <Button type="submit">Save</Button>
      </form>

      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <span className="text-sm">
          Counted for zakat
          <span className="block text-xs text-muted-foreground">Include this balance in the zakat calculation</span>
        </span>
        <Switch checked={zakatable} onCheckedChange={async (v: boolean) => {
          setZakatable(v)
          await api(`/accounts/${a.id}`, { method: 'PATCH', json: { zakatable: v } })
          inval()
          toast(v ? 'Counted for zakat' : 'Excluded from zakat')
        }} />
      </label>

      <ShareSwitch checked={sharedV} onChange={async (v) => {
        setSharedV(v)
        await api(`/accounts/${a.id}`, { method: 'PATCH', json: { visibility: v ? 'shared' : 'private' } })
        inval()
        toast(v ? 'Now visible to the household' : 'Now private to you')
      }} />

      <Confirm
        title={`Delete ${a.name}?`}
        description="The account and its balance disappear; it stops counting toward zakat."
        actionLabel="Delete"
        onConfirm={async () => {
          await api(`/accounts/${a.id}`, { method: 'DELETE' })
          toast('Account deleted')
          onDone()
        }}
        trigger={<Button variant="outline" className="text-destructive">Delete account</Button>}
      />
    </FieldGroup>
  )
}

function LoansSection() {
  const loans = useQuery({ queryKey: ['loans', 'open'], queryFn: () => api<Loan[]>('/loans?status=open') })
  const open = loans.data ?? []
  const owedToUs = open.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.outstanding, 0)
  const weOwe = open.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.outstanding, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Loans / Qarz</CardTitle>
        <CardDescription>
          {open.length === 0 ? 'No open loans.' : `${open.length} open loan${open.length > 1 ? 's' : ''}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {owedToUs > 0 && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">They owe us</span>
            <Amount value={owedToUs} flow="in" className="text-sm" />
          </div>
        )}
        {weOwe > 0 && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">We owe</span>
            <Amount value={weOwe} flow="out" className="text-sm" />
          </div>
        )}
        <Button variant="outline" size="sm" render={<Link to="/loans" />}>
          Open loans page
        </Button>
      </CardContent>
    </Card>
  )
}

type Rule = { id: string; type: string; amount: string; description: string; dayOfMonth: number; active: boolean }
function RecurringSection() {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['recurring'], queryFn: () => api<Rule[]>('/recurring') })
  const [form, setForm] = useState({ description: '', amount: '', day: '', type: 'expense', category: '' })
  const inval = () => qc.invalidateQueries({ queryKey: ['recurring'] })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recurring bills & income</CardTitle>
        <CardDescription>Logged automatically on their due day each month.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(rules.data ?? []).filter((r) => r.active).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm">
              {r.description} <Badge variant="secondary">day {r.dayOfMonth}</Badge>
            </span>
            <span className="flex items-center gap-1">
              <Amount value={r.amount} className="text-sm" />
              <Confirm
                title={`Stop "${r.description}"?`}
                description="No further entries will be logged. Existing entries stay."
                actionLabel="Stop"
                onConfirm={async () => { await api(`/recurring/${r.id}`, { method: 'DELETE' }); inval(); toast('Recurring rule stopped') }}
                trigger={<Button variant="ghost" size="sm" className="text-destructive">Stop</Button>}
              />
            </span>
          </div>
        ))}
        <form className="flex flex-col gap-2" onSubmit={async (e) => {
          e.preventDefault()
          await api('/recurring', {
            method: 'POST',
            json: { type: form.type, amount: Number(form.amount), description: form.description, day_of_month: Number(form.day), category: form.category || undefined },
          })
          setForm({ description: '', amount: '', day: '', type: 'expense', category: '' }); inval(); toast('Recurring rule added')
        }}>
          <div className="flex gap-2">
            <Select items={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
              value={form.type} onValueChange={(v) => setForm({ ...form, type: v as string })}>
              <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input placeholder="Description, e.g. Rent" required value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Input type="number" min="1" placeholder={`Amount ${baseSymbol()}`} required className="amount"
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <InputGroup className="w-28 shrink-0">
              <InputGroupInput type="number" min="1" max="31" placeholder="Day" required
                value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
              <InputGroupAddon align="inline-end"><InputGroupText>of mo.</InputGroupText></InputGroupAddon>
            </InputGroup>
          </div>
          <Button type="submit" variant="outline" size="sm">Add recurring</Button>
        </form>
      </CardContent>
    </Card>
  )
}

type Zakat = {
  zakatable_base: number; nisab_amount: number | null; above_nisab: boolean | null
  zakat_due: number; next_due_date: string | null
  zakatable_assets: {
    accounts: { name: string; value: number | null; currency?: string; native_balance?: number }[]
    investments: { name: string; value: number | null }[]
  }
  deductible_debts: { counterparty: string; value: number }[]
}
function ZakatSection() {
  const qc = useQueryClient()
  const zakat = useQuery({ queryKey: ['zakat'], queryFn: () => api<Zakat>('/zakat') })
  const [form, setForm] = useState({ nisab: '', due: '' })
  const z = zakat.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zakat</CardTitle>
        <CardDescription>2.5% of zakatable wealth above nisab — computed from assets visible to you.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {z && (
          <div className="flex flex-col items-center">
            <span className="text-xs text-muted-foreground">Zakatable wealth</span>
            <Amount value={z.zakatable_base} className="text-3xl font-semibold" />
            {z.nisab_amount != null ? (
              z.above_nisab
                ? <span className="mt-1 text-sm font-medium text-primary">Zakat due: <Amount value={z.zakat_due} className="text-sm" /></span>
                : <span className="mt-1 text-sm text-muted-foreground">Below nisab (<Amount value={z.nisab_amount} className="text-sm" />) — none due</span>
            ) : (
              <span className="mt-1 text-sm text-muted-foreground">Set the nisab amount below to compute zakat.</span>
            )}
            {z.next_due_date && <span className="text-xs text-muted-foreground">Next due: {z.next_due_date}</span>}
          </div>
        )}
        {z && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">Breakdown</summary>
            <div className="mt-1 flex flex-col">
              {z.zakatable_assets.accounts.map((a) => (
                <div key={a.name} className="flex justify-between border-t py-1.5">
                  <span>
                    {a.name}
                    {a.currency && a.currency !== appBase() && (
                      <span className="text-muted-foreground"> (<Amount value={a.native_balance} currency={a.currency} className="text-xs" />)</span>
                    )}
                  </span>
                  <Amount value={a.value} className="text-sm" />
                </div>
              ))}
              {z.zakatable_assets.investments.map((a) => (
                <div key={a.name} className="flex justify-between border-t py-1.5"><span>{a.name}</span><Amount value={a.value} className="text-sm" /></div>
              ))}
              {z.deductible_debts.map((d) => (
                <div key={d.counterparty} className="flex justify-between border-t py-1.5 text-outflow">
                  <span>owed to {d.counterparty}</span><Amount value={d.value} flow="out" signed className="text-sm" />
                </div>
              ))}
            </div>
          </details>
        )}
        <form className="flex items-end gap-2" onSubmit={async (e) => {
          e.preventDefault()
          await api('/zakat/settings', { method: 'PUT', json: { nisab_amount: Number(form.nisab), next_due_date: form.due || undefined } })
          qc.invalidateQueries({ queryKey: ['zakat'] }); toast('Zakat settings saved')
        }}>
          <Field className="flex-1">
            <FieldLabel htmlFor="nisab">Nisab</FieldLabel>
            <InputGroup>
              <InputGroupAddon>{baseSymbol()}</InputGroupAddon>
              <InputGroupInput id="nisab" type="number" min="1" required className="amount"
                placeholder={z?.nisab_amount ? String(z.nisab_amount) : ''} value={form.nisab}
                onChange={(e) => setForm({ ...form, nisab: e.target.value })} />
            </InputGroup>
          </Field>
          <Field className="flex-1">
            <FieldLabel htmlFor="zdue">Due date</FieldLabel>
            <Input id="zdue" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
          </Field>
          <Button type="submit">Save</Button>
        </form>
      </CardContent>
    </Card>
  )
}
