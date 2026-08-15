'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ImageUploader } from '@/components/admin/image-uploader';
import { useToast } from '@/hooks/use-toast';
import type { SettingDefinition, SettingsMap } from '@/lib/settings';

export function SettingsForm({
  definitions,
  categoryLabels,
  values,
  canUpdate,
}: {
  definitions: SettingDefinition[];
  categoryLabels: Record<string, string>;
  values: SettingsMap;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<SettingsMap>(values);
  const [saving, setSaving] = useState(false);

  const dirtyKeys = useMemo(
    () => Object.keys(draft).filter((key) => draft[key] !== values[key]),
    [draft, values]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, SettingDefinition[]>();
    for (const definition of definitions) {
      const list = map.get(definition.category) ?? [];
      list.push(definition);
      map.set(definition.category, list);
    }
    return Array.from(map.entries());
  }, [definitions]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: payload }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({
        title: `${data.changed} setting(s) saved`,
        description: data.pendingChangeId
          ? `${data.pendingKeys.length} sensitive setting(s) were sent for approval instead of being applied.`
          : undefined,
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const renderField = (definition: SettingDefinition) => {
    const value = draft[definition.key];
    const changed = value !== values[definition.key];

    if (definition.type === 'boolean') {
      return (
        <div
          key={definition.key}
          className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0"
        >
          <div className="min-w-0">
            <Label htmlFor={definition.key} className="flex flex-wrap items-center gap-1.5">
              {definition.label}
              {definition.sensitive && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  Sensitive
                </Badge>
              )}
              {changed && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  Changed
                </Badge>
              )}
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{definition.description}</p>
          </div>
          <Switch
            id={definition.key}
            checked={Boolean(value)}
            disabled={!canUpdate}
            onCheckedChange={(checked) =>
              setDraft((prev) => ({ ...prev, [definition.key]: checked }))
            }
          />
        </div>
      );
    }

    // The uploader draws its own label and description.
    if (definition.type === 'image') {
      return (
        <div key={definition.key} className="border-b border-border py-3 last:border-0">
          <ImageUploader
            label={definition.label}
            description={definition.description}
            value={String(value ?? '')}
            disabled={!canUpdate}
            onChange={(url) => setDraft((prev) => ({ ...prev, [definition.key]: url }))}
          />
          {changed && (
            <Badge variant="secondary" className="mt-1.5 px-1.5 py-0 text-[10px]">
              Changed
            </Badge>
          )}
        </div>
      );
    }

    return (
      <div key={definition.key} className="border-b border-border py-3 last:border-0">
        <Label htmlFor={definition.key} className="flex flex-wrap items-center gap-1.5">
          {definition.label}
          {definition.sensitive && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
              Sensitive
            </Badge>
          )}
          {changed && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              Changed
            </Badge>
          )}
        </Label>
        <p className="mb-1.5 mt-0.5 text-xs text-muted-foreground">{definition.description}</p>

        {definition.type === 'select' ? (
          <select
            id={definition.key}
            value={String(value)}
            disabled={!canUpdate}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, [definition.key]: event.target.value }))
            }
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            {definition.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : definition.type === 'textarea' ? (
          <Textarea
            id={definition.key}
            rows={3}
            value={String(value ?? '')}
            disabled={!canUpdate}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, [definition.key]: event.target.value }))
            }
          />
        ) : (
          <Input
            id={definition.key}
            type={definition.type === 'number' ? 'number' : 'text'}
            step={definition.step}
            min={definition.min}
            max={definition.max}
            value={String(value ?? '')}
            disabled={!canUpdate}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                [definition.key]:
                  definition.type === 'number' ? Number(event.target.value) : event.target.value,
              }))
            }
          />
        )}
      </div>
    );
  };

  return (
    <>
      {dirtyKeys.length > 0 && (
        <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 backdrop-blur">
          <p className="text-sm">
            <strong>{dirtyKeys.length}</strong> unsaved change
            {dirtyKeys.length === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(values)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </div>
        </div>
      )}

      {!canUpdate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" />
          You have read-only access to settings.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {grouped.map(([category, items]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{categoryLabels[category] ?? category}</CardTitle>
              <CardDescription>{items.length} settings</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">{items.map(renderField)}</CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
