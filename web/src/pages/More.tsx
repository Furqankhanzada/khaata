import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { Copy, Plus, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, authClient } from '../api'
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
import { Amount, Confirm, PageHeader } from '@/components/shared'
import type { Me } from '../App'

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
      <ApiKeysSection />
      <AccountsSection />
      <LoansSection />
      <RecurringSection />
      <ZakatSection />
      <Button
        variant="outline"
        className="text-destructive"
        onClick={async () => { await authClient.signOut(); qc.invalidateQueries({ queryKey: ['me'] }) }}
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
        <CardDescription>Everyone here shares one ledger; entries show who paid.</CardDescription>
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

type Account = { id: string; name: string; balance: string; zakatable: boolean }
function AccountsSection() {
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
  const [form, setForm] = useState({ name: '', balance: '' })
  const [editing, setEditing] = useState<{ id: string; balance: string } | null>(null)
  const inval = () => qc.invalidateQueries({ queryKey: ['accounts'] })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash & bank accounts</CardTitle>
        <CardDescription>Snapshot balances — tap one to update it. Counted for zakat.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(accounts.data ?? []).map((a) => (
          <div key={a.id} className="flex min-h-9 items-center justify-between gap-2">
            <span className="text-sm">{a.name}</span>
            {editing?.id === a.id ? (
              <form className="flex items-center gap-1.5" onSubmit={async (e) => {
                e.preventDefault()
                await api(`/accounts/${a.id}`, { method: 'PATCH', json: { balance: Number(editing.balance) } })
                setEditing(null); inval(); toast(`${a.name} updated`)
              }}>
                <InputGroup className="w-32">
                  <InputGroupAddon>Rs</InputGroupAddon>
                  <InputGroupInput type="number" autoFocus className="amount text-right" value={editing.balance}
                    onChange={(e) => setEditing({ ...editing, balance: e.target.value })} />
                </InputGroup>
                <Button type="submit" size="sm">Save</Button>
              </form>
            ) : (
              <button className="text-sm" onClick={() => setEditing({ id: a.id, balance: String(Number(a.balance)) })}>
                <Amount value={a.balance} className="text-sm" />
              </button>
            )}
          </div>
        ))}
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault()
          await api('/accounts', { method: 'POST', json: { name: form.name, balance: Number(form.balance || 0) } })
          setForm({ name: '', balance: '' }); inval(); toast('Account added')
        }}>
          <Input placeholder="Account name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input type="number" placeholder="Rs 0" className="amount w-24" value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          <Button type="submit" variant="outline" size="icon" aria-label="Add account"><Plus /></Button>
        </form>
      </CardContent>
    </Card>
  )
}

type Loan = { id: string; counterparty: string; direction: 'lent' | 'borrowed'; principal: string; outstanding: number; status: string }
const DIRECTIONS = [
  { value: 'lent', label: 'I lent' },
  { value: 'borrowed', label: 'I borrowed' },
]
function LoansSection() {
  const qc = useQueryClient()
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => api<Loan[]>('/loans?status=open') })
  const [form, setForm] = useState({ counterparty: '', direction: 'lent', principal: '' })
  const [paying, setPaying] = useState<{ id: string; amount: string } | null>(null)
  const inval = () => qc.invalidateQueries({ queryKey: ['loans'] })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Loans / Qarz</CardTitle>
        <CardDescription>Money lent or borrowed, settled as repayments come in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(loans.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No open loans.</p>}
        {(loans.data ?? []).map((l) => (
          <div key={l.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm">
                {l.counterparty}
                <Badge variant={l.direction === 'borrowed' ? 'destructive' : 'secondary'}>
                  {l.direction === 'lent' ? 'owes us' : 'we owe'}
                </Badge>
              </span>
              <Amount value={l.outstanding} className={cn('text-sm', l.direction === 'borrowed' && 'text-outflow')} />
            </div>
            {paying?.id === l.id ? (
              <form className="flex items-center gap-1.5" onSubmit={async (e) => {
                e.preventDefault()
                await api(`/loans/${l.id}/payments`, { method: 'POST', json: { amount: Number(paying.amount) } })
                setPaying(null); inval(); toast('Repayment recorded')
              }}>
                <InputGroup className="flex-1">
                  <InputGroupAddon>Rs</InputGroupAddon>
                  <InputGroupInput type="number" min="1" autoFocus required placeholder="Repayment amount"
                    className="amount" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} />
                </InputGroup>
                <Button type="submit" size="sm">Record</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPaying(null)}>Cancel</Button>
              </form>
            ) : (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setPaying({ id: l.id, amount: '' })}>
                Record repayment
              </Button>
            )}
          </div>
        ))}
        <form className="flex flex-col gap-2" onSubmit={async (e) => {
          e.preventDefault()
          await api('/loans', { method: 'POST', json: { counterparty: form.counterparty, direction: form.direction, principal: Number(form.principal) } })
          setForm({ counterparty: '', direction: 'lent', principal: '' }); inval(); toast('Loan added')
        }}>
          <div className="flex gap-2">
            <Select items={DIRECTIONS} value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as string })}>
              <SelectTrigger className="w-32 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DIRECTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input placeholder="Person" required value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
            <Input type="number" min="1" placeholder="Rs" required className="amount w-24"
              value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
          </div>
          <Button type="submit" variant="outline" size="sm">Add loan</Button>
        </form>
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
            <Input type="number" min="1" placeholder="Amount Rs" required className="amount"
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
  zakatable_assets: { accounts: { name: string; value: number }[]; investments: { name: string; value: number | null }[] }
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
        <CardDescription>2.5% of zakatable wealth above nisab.</CardDescription>
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
                <div key={a.name} className="flex justify-between border-t py-1.5"><span>{a.name}</span><Amount value={a.value} className="text-sm" /></div>
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
              <InputGroupAddon>Rs</InputGroupAddon>
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
