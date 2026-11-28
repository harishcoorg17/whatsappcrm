'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate, ParallelBroadcastConfig } from '@/types';
import { BroadcastSettings } from '@/components/broadcasts/broadcast-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { SchedulePicker, localInputToIso } from '@/components/broadcasts/schedule-picker';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  /** `scheduledAt` (ISO) is set when the user chose to send later. */
  onSend: (scheduledAt?: string) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [sendLater, setSendLater] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');
  const [scheduledIso, setScheduledIso] = useState<string | undefined>();
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);
  const [parallelConfig, setParallelConfig] = useState<ParallelBroadcastConfig>({
    concurrent_workers: 3,
    delay_between_sends_ms: 500,
    max_retries: 1,
  });

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .not('phone', 'like', 'group:%');
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  function handleOpenConfirm() {
    if (!sendLater) {
      setScheduledIso(undefined);
      setShowConfirm(true);
      return;
    }
    const checked = localInputToIso(scheduleValue);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    setScheduledIso(checked.iso);
    setShowConfirm(true);
  }

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'csv'
          ? 'CSV Upload'
          : 'Custom';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Review & Send</h2>
        <p className="mt-1 text-sm text-slate-400">
          Name your broadcast, review the details, and send.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-white">Broadcast Name</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-white">Summary</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Template</p>
            <p className="text-white">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Audience</p>
            <p className="text-white">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Estimated Reach</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-white">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400">Language</p>
            <p className="text-white">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Broadcast Parallel Settings */}
      <BroadcastSettings
        config={parallelConfig}
        onChange={setParallelConfig}
      />

      {/* When to send */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-white">When to send</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={sendLater ? 'outline' : 'default'}
            onClick={() => setSendLater(false)}
            disabled={isProcessing}
            className={sendLater ? 'border-slate-700 text-slate-300' : ''}
          >
            Send now
          </Button>
          <Button
            type="button"
            variant={sendLater ? 'default' : 'outline'}
            onClick={() => setSendLater(true)}
            disabled={isProcessing}
            className={sendLater ? '' : 'border-slate-700 text-slate-300'}
          >
            <CalendarClock className="h-4 w-4" />
            Schedule for later
          </Button>
        </div>
        {sendLater && (
          <div className="space-y-1">
            <SchedulePicker
              value={scheduleValue}
              onChange={setScheduleValue}
              disabled={isProcessing}
            />
            <p className="text-xs text-slate-500">
              Uses your local time. You can change or cancel until it starts sending.
            </p>
          </div>
        )}
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-white">Sending broadcast...</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save as Draft
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <Button
            onClick={handleOpenConfirm}
            disabled={!name.trim() || isProcessing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sendLater ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {sendLater ? 'Schedule Broadcast' : 'Send Broadcast'}
          </Button>
          <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">
                {scheduledIso ? 'Confirm Schedule' : 'Confirm Broadcast'}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                You are about to {scheduledIso ? 'schedule' : 'send'} this broadcast to{' '}
                <span className="font-medium text-white">{estimatedReach.toLocaleString()}</span>{' '}
                contacts using the{' '}
                <span className="font-medium text-white">{template.name}</span> template.
                {scheduledIso
                  ? `It will send automatically on ${new Date(scheduledIso).toLocaleString()}. You can cancel or reschedule it until then. Contacts who opt out before then are skipped.`
                  : 'This action cannot be undone.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend(scheduledIso);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {scheduledIso ? 'Confirm & Schedule' : 'Confirm & Send'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
