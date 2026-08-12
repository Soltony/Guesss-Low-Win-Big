'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCard } from '@/components/admin/data-shell';
import { useToast } from '@/hooks/use-toast';
import { PERMISSION_ACTIONS, type PermissionAction, type Permissions } from '@/lib/types';

interface ModuleRow {
  key: string;
  label: string;
  group: string;
}

interface RoleRow {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissions: Permissions;
}

const SUPER_ADMIN = 'Super Admin';

function emptyMatrix(modules: ModuleRow[]): Permissions {
  const out: Permissions = {};
  for (const module of modules) {
    out[module.key] = { read: false, create: false, update: false, delete: false, approve: false };
  }
  return out;
}

export function RoleBuilder({
  roles,
  modules,
  canCreate,
  canUpdate,
  canDelete,
}: {
  roles: RoleRow[];
  modules: ModuleRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];
  const isSuperAdmin = selected?.name === SUPER_ADMIN;
  const locked = !canUpdate || isSuperAdmin;

  const [draft, setDraft] = useState<Permissions>(
    selected ? { ...emptyMatrix(modules), ...selected.permissions } : emptyMatrix(modules)
  );
  const [draftRoleId, setDraftRoleId] = useState(selected?.id ?? '');

  // Switching roles re-seeds the draft from the newly selected role.
  if (selected && selected.id !== draftRoleId) {
    setDraftRoleId(selected.id);
    setDraft({ ...emptyMatrix(modules), ...selected.permissions });
  }

  const toggle = (moduleKey: string, action: PermissionAction, value: boolean) => {
    setDraft((prev) => {
      const next = { ...prev, [moduleKey]: { ...prev[moduleKey], [action]: value } };
      // Any action implies being able to open the module at all.
      if (value && action !== 'read') next[moduleKey].read = true;
      // Losing read means losing everything for that module.
      if (!value && action === 'read') {
        next[moduleKey] = {
          read: false,
          create: false,
          update: false,
          delete: false,
          approve: false,
        };
      }
      return next;
    });
  };

  const toggleModuleAll = (moduleKey: string, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      [moduleKey]: {
        read: value,
        create: value,
        update: value,
        delete: value,
        approve: value,
      },
    }));
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/roles/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: draft }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: `${selected.name} permissions saved` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const createRole = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, permissions: emptyMatrix(modules) }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not create role', description: data?.error });
        return;
      }

      toast({ title: 'Role created', description: 'Now grant it the modules it needs.' });
      setCreating(false);
      setNewName('');
      setSelectedId(data.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (role: RoleRow) => {
    const response = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Cannot delete', description: data?.error });
      return;
    }
    toast({ title: 'Role deleted' });
    setSelectedId(roles.find((r) => r.id !== role.id)?.id ?? '');
    router.refresh();
  };

  const groups = Array.from(new Set(modules.map((module) => module.group)));

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="space-y-3 lg:col-span-1">
        {canCreate && (
          <>
            {creating ? (
              <form
                onSubmit={createRole}
                className="space-y-2 rounded-xl border border-border bg-card p-3"
              >
                <Label htmlFor="role-name">New role name</Label>
                <Input
                  id="role-name"
                  required
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Auction Operator"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
                    {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Create
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCreating(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button className="w-full" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New role
              </Button>
            )}
          </>
        )}

        <ul className="space-y-1.5">
          {roles.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition',
                  role.id === selected?.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-secondary/40'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{role.name}</span>
                  {role.name === SUPER_ADMIN && (
                    <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                      Full
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {role.userCount} user{role.userCount === 1 ? '' : 's'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lg:col-span-3">
        {!selected ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Create a role to get started.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  {selected.name}
                </h2>
                {isSuperAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Super Admin bypasses every permission check — this matrix is read-only.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {canDelete && !selected.isSystem && !isSuperAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeRole(selected)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete role
                  </Button>
                )}
                {!locked && (
                  <Button size="sm" onClick={save} disabled={busy}>
                    {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Save permissions
                  </Button>
                )}
              </div>
            </div>

            <TableCard>
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Module</th>
                    {PERMISSION_ACTIONS.map((action) => (
                      <th key={action} className="px-3 py-2.5 text-center font-semibold capitalize">
                        {action}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center font-semibold">All</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((group) => (
                    <Fragment key={group}>
                      <tr className="bg-secondary/30">
                        <td
                          colSpan={PERMISSION_ACTIONS.length + 2}
                          className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {group}
                        </td>
                      </tr>
                      {modules
                        .filter((module) => module.group === group)
                        .map((module) => {
                          const perms = draft[module.key] ?? {};
                          const allOn =
                            isSuperAdmin || PERMISSION_ACTIONS.every((a) => perms[a]);

                          return (
                            <tr key={module.key} className="hover:bg-secondary/20">
                              <td className="px-4 py-2 font-medium">{module.label}</td>
                              {PERMISSION_ACTIONS.map((action) => (
                                <td key={action} className="px-3 py-2 text-center">
                                  <Checkbox
                                    checked={isSuperAdmin || Boolean(perms[action])}
                                    disabled={locked}
                                    onCheckedChange={(checked) =>
                                      toggle(module.key, action, Boolean(checked))
                                    }
                                    aria-label={`${action} ${module.label}`}
                                  />
                                </td>
                              ))}
                              <td className="px-3 py-2 text-center">
                                <Checkbox
                                  checked={allOn}
                                  disabled={locked}
                                  onCheckedChange={(checked) =>
                                    toggleModuleAll(module.key, Boolean(checked))
                                  }
                                  aria-label={`Grant all on ${module.label}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </TableCard>

            <p className="mt-3 text-xs text-muted-foreground">
              <strong>Read</strong> opens the module. <strong>Approve</strong> is the second-pair-of-eyes
              right: settling auctions, deciding pending changes and confirming payments manually.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
