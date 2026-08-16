'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, Pencil, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, TableCard } from '@/components/admin/data-shell';
import { useToast } from '@/hooks/use-toast';
import type { TabPermission } from '@/lib/permissions';

const TAB_ICONS: Record<string, typeof BellRing> = {
  templates: BellRing,
  logs: ScrollText,
};

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  channel: string;
  subject: string;
  bodyEn: string;
  bodyAm: string;
  active: boolean;
}

interface LogRow {
  id: string;
  templateCode: string | null;
  channel: string;
  recipient: string;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Placeholders each template may use, so operators do not have to guess. */
const PLACEHOLDERS: Record<string, string[]> = {
  BID_CONFIRMED: ['amount', 'fee', 'currency', 'code', 'title'],
  BID_FAILED: ['code'],
  AUCTION_ENDING: ['code', 'title', 'hours'],
  AUCTION_SETTLED: ['code', 'title', 'amount', 'currency'],
  WINNER_ANNOUNCED: ['title', 'code', 'amount', 'currency', 'deadline'],
  WINNER_REMINDER: ['code', 'deadline'],
  PRIZE_FULFILLED: ['code', 'title'],
};

export function NotificationsManager({
  templates,
  logs,
  tabs,
}: {
  templates: TemplateRow[];
  logs: LogRow[];
  /** The tabs this role may open, each with its own rights. Order is the registry's. */
  tabs: TabPermission[];
}) {
  const byTab = new Map(tabs.map((tab) => [tab.tab, tab]));
  const canUpdate = Boolean(byTab.get('templates')?.canUpdate);

  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/notifications/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: 'Template updated' });
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (template: TemplateRow, active: boolean) => {
    const response = await fetch(`/api/admin/notifications/${template.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast({ variant: 'destructive', title: 'Update failed', description: data?.error });
      return;
    }
    toast({ title: active ? 'Template enabled' : 'Template disabled' });
    router.refresh();
  };

  if (tabs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Your role opens this page but has no sections on it. Ask an administrator to grant a tab
        under <strong>Notifications</strong> in Access Control.
      </div>
    );
  }

  return (
    <>
      <Tabs defaultValue={tabs[0].tab}>
        <TabsList>
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.tab];
            return (
              <TabsTrigger key={tab.tab} value={tab.tab}>
                {Icon && <Icon className="mr-1.5 h-4 w-4" />}
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {byTab.has('templates') && (
        <TabsContent value="templates" className="mt-4">
          <TableCard>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Code</th>
                  <th className="px-4 py-2.5 font-semibold">Template</th>
                  <th className="px-4 py-2.5 font-semibold">Channel</th>
                  <th className="px-4 py-2.5 font-semibold">Message</th>
                  <th className="px-4 py-2.5 font-semibold">Active</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {templates.length === 0 && (
                  <EmptyRow colSpan={6} message="No templates — run the seed script." />
                )}
                {templates.map((template) => (
                  <tr key={template.id} className="align-top hover:bg-secondary/30">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold">
                      {template.code}
                    </td>
                    <td className="px-4 py-2.5">{template.name}</td>
                    <td className="px-4 py-2.5 text-xs">{template.channel}</td>
                    <td className="max-w-[360px] px-4 py-2.5 text-xs text-muted-foreground">
                      <p className="line-clamp-2">{template.bodyEn}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Switch
                        checked={template.active}
                        disabled={!canUpdate}
                        onCheckedChange={(checked) => toggle(template, checked)}
                        aria-label={`Toggle ${template.code}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canUpdate && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(template)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </TabsContent>
        )}

        {byTab.has('logs') && (
        <TabsContent value="logs" className="mt-4">
          <TableCard>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Sent</th>
                  <th className="px-4 py-2.5 font-semibold">Template</th>
                  <th className="px-4 py-2.5 font-semibold">Recipient</th>
                  <th className="px-4 py-2.5 font-semibold">Message</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.length === 0 && <EmptyRow colSpan={5} message="Nothing has been sent yet." />}
                {logs.map((log) => (
                  <tr key={log.id} className="align-top hover:bg-secondary/30">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(log.sentAt ?? log.createdAt).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{log.templateCode ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{log.recipient}</td>
                    <td className="max-w-[380px] px-4 py-2.5 text-xs text-muted-foreground">
                      <p className="line-clamp-2">{log.body}</p>
                      {log.error && <p className="mt-0.5 text-destructive">{log.error}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={log.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </TabsContent>
        )}
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit template — {editing?.code}</DialogTitle>
            <DialogDescription>
              {editing && PLACEHOLDERS[editing.code]?.length
                ? `Available placeholders: ${PLACEHOLDERS[editing.code]
                    .map((p) => `{${p}}`)
                    .join(', ')}`
                : 'Use {placeholder} syntax for dynamic values.'}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="n-name">Name</Label>
                  <Input
                    id="n-name"
                    required
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="n-channel">Channel</Label>
                  <select
                    id="n-channel"
                    value={editing.channel}
                    onChange={(event) => setEditing({ ...editing, channel: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="SMS">SMS</option>
                    <option value="PUSH">Push</option>
                    <option value="INAPP">In-app</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="n-en">Message (English)</Label>
                <Textarea
                  id="n-en"
                  required
                  rows={4}
                  value={editing.bodyEn}
                  onChange={(event) => setEditing({ ...editing, bodyEn: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {editing.bodyEn.length} characters
                  {editing.channel === 'SMS' &&
                    ` · ~${Math.ceil(editing.bodyEn.length / 160)} SMS part(s)`}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="n-am">Message (Amharic)</Label>
                <Textarea
                  id="n-am"
                  rows={4}
                  value={editing.bodyAm}
                  onChange={(event) => setEditing({ ...editing, bodyAm: event.target.value })}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save template
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
