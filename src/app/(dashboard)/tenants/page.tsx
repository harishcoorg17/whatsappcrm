'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Building2, CheckCircle, XCircle, Clock, ExternalLink, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast, Toaster } from 'sonner'

interface Tenant {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended' | 'pending'
  plan: string
  waba_id: string | null
  phone_number_id: string | null
  created_at: string
}

const STATUS_COLORS = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  suspended: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}
const STATUS_ICONS = { active: CheckCircle, suspended: XCircle, pending: Clock }

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('crm_tenants')
      .select('id,slug,name,status,plan,waba_id,phone_number_id,created_at')
      .order('created_at', { ascending: false })
    if (error) { toast.error(error.message); setLoading(false); return }
    setTenants(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const createTenant = async () => {
    if (!form.name || !form.slug) { toast.error('Name and slug are required'); return }
    setSaving(true)
    const { error } = await supabase.from('crm_tenants').insert({
      name: form.name,
      slug: form.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      plan: form.plan,
      status: 'pending',
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Tenant created')
    setShowNew(false)
    setForm({ name: '', slug: '', plan: 'starter' })
    load()
  }

  const toggleStatus = async (t: Tenant) => {
    const next = t.status === 'active' ? 'suspended' : 'active'
    const { error } = await supabase.from('crm_tenants').update({ status: next }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success(`Tenant ${next}`)
    load()
  }

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Toaster richColors />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenants</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage all Novacompass WhatsApp CRM tenants</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" />New Tenant
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or slug…"
          className="pl-9 bg-slate-900 border-slate-700 text-white placeholder-slate-500" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
          <Building2 className="h-12 w-12 opacity-30" />
          <p className="text-sm">{search ? 'No tenants match your search' : 'No tenants yet'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => {
            const Icon = STATUS_ICONS[t.status]
            return (
              <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-white">{t.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${STATUS_COLORS[t.status]}`}>
                      <Icon className="h-3 w-3" />{t.status}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{t.plan}</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-0.5 font-mono">/{t.slug}</p>
                  <div className="flex items-center gap-4 mt-1">
                    {t.waba_id
                      ? <span className="text-xs text-slate-500">WABA: {t.waba_id}</span>
                      : <span className="text-xs text-amber-500">WhatsApp not connected</span>}
                    <span className="text-xs text-slate-600">Created {new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={`/onboarding?tenant=${t.slug}`}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />{t.waba_id ? 'Re-connect' : 'Connect WA'}
                  </a>
                  <button onClick={() => toggleStatus(t)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      t.status === 'active'
                        ? 'border-red-800 text-red-400 hover:bg-red-950/40'
                        : 'border-emerald-800 text-emerald-400 hover:bg-emerald-950/40'
                    }`}>
                    {t.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="bg-slate-950 border-slate-800 text-white max-w-md">
          <DialogHeader><DialogTitle>New Tenant</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Amstago Tours" className="bg-slate-900 border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug <span className="text-slate-500 text-xs">(URL identifier)</span></Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="amstago-tours" className="bg-slate-900 border-slate-700 font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full rounded-md bg-slate-900 border border-slate-700 text-white px-3 py-2 text-sm">
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button onClick={createTenant} disabled={saving}>{saving ? 'Creating…' : 'Create Tenant'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
