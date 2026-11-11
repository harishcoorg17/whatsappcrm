'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Settings,
  MessageSquare,
  Tag,
  User,
  Palette,
  Mail,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { EmailConfig } from '@/components/settings/email-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';

const TAB_VALUES = [
  'profile',
  'whatsapp',
  'email',
  'templates',
  'tags',
  'appearance',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const searchParams = useSearchParams();

  const queryTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabValue>(
    isTabValue(queryTab) ? queryTab : 'profile'
  );

  // Follow the URL when it changes from outside (a link to /settings?tab=whatsapp, back/forward).
  useEffect(() => {
    if (isTabValue(queryTab)) setTab(queryTab);
  }, [queryTab]);

  const onChange = (next: TabValue) => {
    // Switch immediately. The tab used to be derived from the URL and changed only after a
    // router.replace navigation (middleware auth + server render) finished, so a slow or
    // superseded navigation made clicks look dead. The URL is updated in the background;
    // Next syncs history.replaceState with useSearchParams.
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `/settings?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your profile, WhatsApp® API, Email Gateway, message templates,
          and tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="border border-slate-700 bg-slate-900">
          <TabsTrigger
            value="profile"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <User className="size-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <Settings className="size-4" />
            WhatsApp Config
          </TabsTrigger>
          <TabsTrigger
            value="email"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <Mail className="size-4" />
            Email Gateway
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <MessageSquare className="size-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <Tag className="size-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
          >
            <Palette className="size-4" />
            Appearance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppConfig />
        </TabsContent>

        <TabsContent value="email">
          <EmailConfig />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
