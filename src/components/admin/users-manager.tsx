'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, Loader2, LockOpen, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  status: string;
  roleId: string;
  roleName: string;
  passwordChangeRequired: boolean;
  lastLoginAt: string | null;
  locked: boolean;
}

const blank = {
  id: '',
  fullName: '',
  email: '',
  phoneNumber: '',
  roleId: '',
  status: 'ACTIVE',
};

export function UsersManager({
  users,
  roles,
  currentUserId,
  canCreate,
  canUpdate,
}: {
  users: UserRow[];
  roles: { id: string; name: string }[];
  currentUserId: string;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const editing = Boolean(form.id);
      const response = await fetch(editing ? `/api/admin/users/${form.id}` : '/api/admin/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      if (data.tempPassword) {
        setTempPassword({ email: form.email, password: data.tempPassword });
      } else {
        toast({ title: 'User updated' });
      }

      setForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const act = async (user: UserRow, action: string) => {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
      return;
    }

    if (data.tempPassword) {
      setTempPassword({ email: user.email, password: data.tempPassword });
    } else {
      toast({ title: 'Done' });
    }
    router.refresh();
  };

  const changeStatus = async (user: UserRow, status: string) => {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Update failed', description: data?.error });
      return;
    }
    toast({ title: `Account is now ${status.toLowerCase()}` });
    router.refresh();
  };

  return (
    <>
      {canCreate && (
        <div className="mb-4">
          <Button onClick={() => setForm({ ...blank, roleId: roles[0]?.id ?? '' })}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add user
          </Button>
        </div>
      )}

      <TableCard>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Contact</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Last sign-in</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 && <EmptyRow colSpan={6} message="No users yet." />}
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5">
                  <p className="font-medium">
                    {user.fullName}
                    {user.id === currentUserId && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  {user.passwordChangeRequired && (
                    <Badge variant="warning" className="mt-1">
                      Temp password
                    </Badge>
                  )}
                  {user.locked && (
                    <Badge variant="destructive" className="ml-1 mt-1">
                      Locked
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <p className="text-xs">{user.email}</p>
                  <p className="font-mono text-xs text-muted-foreground">{user.phoneNumber}</p>
                </td>
                <td className="px-4 py-2.5">{user.roleName}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={user.status} />
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('en-GB')
                    : 'Never'}
                </td>
                <td className="px-4 py-2.5">
                  {canUpdate && (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit"
                        onClick={() =>
                          setForm({
                            id: user.id,
                            fullName: user.fullName,
                            email: user.email,
                            phoneNumber: user.phoneNumber,
                            roleId: user.roleId,
                            status: user.status,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {user.id !== currentUserId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Reset password"
                          onClick={() => act(user, 'reset-password')}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {user.locked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Unlock"
                          onClick={() => act(user, 'unlock')}
                        >
                          <LockOpen className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {/* Offered on every row, including the operator's own.
                          The rules that stop an account being disabled — your
                          own, and the last active Super Admin — live on the
                          server, and hiding the control here meant the only
                          person who can open this page had no way to reach the
                          Super Admin rule at all: it never fired and never
                          explained itself. The refusal is what should be seen. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={user.status === 'ACTIVE' ? 'text-destructive' : ''}
                        onClick={() =>
                          changeStatus(user, user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')
                        }
                      >
                        {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? 'Changing the role takes effect on the next request.'
                : 'A one-time password is generated and shown once after saving.'}
            </DialogDescription>
          </DialogHeader>

          {form && (
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-name">Full name</Label>
                <Input
                  id="u-name"
                  required
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-email">Email</Label>
                <Input
                  id="u-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-phone">Phone number</Label>
                <Input
                  id="u-phone"
                  required
                  value={form.phoneNumber}
                  onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
                  placeholder="0911223344"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-role">Role</Label>
                <select
                  id="u-role"
                  required
                  value={form.roleId}
                  onChange={(event) => setForm({ ...form, roleId: event.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={tempPassword !== null} onOpenChange={() => setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>One-time password</DialogTitle>
            <DialogDescription>
              Share this with {tempPassword?.email} through a secure channel. It is shown once and
              must be changed at first sign-in.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 p-3">
            <code className="flex-1 font-mono text-sm">{tempPassword?.password}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(tempPassword?.password ?? '');
                toast({ title: 'Copied to clipboard' });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
