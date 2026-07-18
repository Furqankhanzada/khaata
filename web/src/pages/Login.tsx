import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, authClient } from '../api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'

function Brand() {
  return (
    <div className="mb-6 flex flex-col items-center gap-3">
      <div className="amount flex size-14 items-center justify-center rounded-2xl bg-primary text-3xl font-semibold text-primary-foreground">₨</div>
      <div className="text-center">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Khaata</h1>
        <p className="text-sm text-muted-foreground">Ghar ka hisaab, ek jagah — expenses, budgets & investments</p>
      </div>
    </div>
  )
}

export function Login() {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res =
      mode === 'login'
        ? await authClient.signIn.email({ email: form.email, password: form.password })
        : await authClient.signUp.email({ name: form.name, email: form.email, password: form.password })
    setBusy(false)
    if (res.error) toast.error(res.error.message ?? 'Could not sign in')
    else qc.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <Brand />
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'login' ? 'Sign in' : 'Create your account'}</CardTitle>
          <CardDescription>
            {mode === 'login' ? 'Pick up where your ledger left off.' : 'Your household ledger starts here.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              {mode === 'register' && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" required autoComplete="name" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" required autoComplete="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" type="password" required minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Spinner data-icon="inline-start" />}
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Button variant="link" className="mt-3" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
      </Button>
    </div>
  )
}

export function HouseholdSetup() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  async function go(body: { name?: string; invite_code?: string }) {
    try {
      await api('/household', { method: 'POST', json: body })
      toast(body.name ? 'Household created' : 'Joined household')
      qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set up the household')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <Brand />
      <Card>
        <CardHeader>
          <CardTitle>Set up your household</CardTitle>
          <CardDescription>One shared ledger for both of you — every entry shows who paid.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void go({ name }) }}>
              <Input placeholder='Household name, e.g. "Our Home"' required value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit">Create</Button>
            </form>
            <FieldSeparator>or join your spouse's</FieldSeparator>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void go({ invite_code: code.trim() }) }}>
              <Input placeholder="Invite code" required className="amount" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="submit" variant="outline">Join</Button>
            </form>
          </FieldGroup>
        </CardContent>
      </Card>
      <Button variant="link" className="mt-3"
        onClick={async () => { await authClient.signOut(); qc.invalidateQueries({ queryKey: ['me'] }) }}>
        Sign out
      </Button>
    </div>
  )
}
