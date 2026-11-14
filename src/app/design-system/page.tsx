'use client'

import { useState } from 'react'
import { Bell, Plus, Search, Sparkles } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionCard } from '@/components/ui/section-card'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export default function DesignSystemPage() {
  const [enabled, setEnabled] = useState(true)

  return (
    <div className="min-h-screen bg-[#F5F9F8] text-slate-900">
      <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5">
          <BrandLogo height={36} priority />
          <Badge variant="success">ConverMesh Design System</Badge>
        </div>

        <PageHeader
          eyebrow="Foundations"
          title="ConverMesh design system"
          description="Brand tokens and reusable React components used across the CRM."
        />

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Brand</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 size-12 rounded-lg bg-[#01C392]" />
              <p className="font-medium">Brand Teal</p>
              <p className="text-sm text-slate-500">#01C392</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 size-12 rounded-lg bg-[#01203B]" />
              <p className="font-medium">Navy</p>
              <p className="text-sm text-slate-500">#01203B</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 size-12 rounded-lg bg-[#F5F9F8] ring-1 ring-slate-200" />
              <p className="font-medium">Surface</p>
              <p className="text-sm text-slate-500">#F5F9F8</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Buttons</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button><Plus className="size-4" /> Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="lg">Large</Button>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Badges</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="destructive">Error</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Metrics</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active chats" value="128" icon={Bell} delta={{ sign: 1, label: '+12 vs yesterday' }} />
            <StatCard label="New contacts" value="42" icon={Sparkles} hint="Today" />
            <StatCard label="Open deals" value="18" icon={Search} delta={{ sign: -1, label: '-3 vs yesterday' }} />
            <StatCard label="Messages sent" value="2.4k" icon={Plus} hint="Last 24 hours" />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Form controls" description="Inputs, switches and progress">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ds-email">Email</Label>
                <Input id="ds-email" placeholder="you@example.com" />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ds-switch">Notifications</Label>
                <Switch id="ds-switch" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Campaign progress</span>
                  <span className="text-slate-500">68%</span>
                </div>
                <Progress value={68} />
              </div>
              <Spinner label="Loading workspace" />
            </div>
          </SectionCard>

          <SectionCard title="Feedback" description="Alerts and loading states">
            <div className="space-y-4">
              <Alert>
                <AlertTitle>Heads up</AlertTitle>
                <AlertDescription>Use the design system components for a consistent product.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Something went wrong while saving.</AlertDescription>
              </Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <SkeletonCard />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          </SectionCard>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Data display</h2>
          <SectionCard title="Recent conversations" description="Table and empty state">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Asha Patel</TableCell>
                  <TableCell>WhatsApp</TableCell>
                  <TableCell><Badge variant="success">Resolved</Badge></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Rahul Verma</TableCell>
                  <TableCell>Instagram</TableCell>
                  <TableCell><Badge variant="warning">Pending</Badge></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </SectionCard>
          <EmptyState
            icon={Search}
            title="No results"
            description="Try a different search term."
            action={<Button variant="outline">Clear search</Button>}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Tabs and avatars</h2>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                  <CardDescription>Everything is running smoothly.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>CM</AvatarFallback>
                  </Avatar>
                  <p className="text-sm">ConverMesh workspace</p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="activity" className="pt-4">
              <EmptyState title="No activity yet" description="Events will appear here." />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  )
}