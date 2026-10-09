'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, KeyRound, Loader2, LockOpen, Pencil, Plus, Send } from 'lucide-react';
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
import { describeMinutes } from '@/lib/email-templates';
import type { AccountLinkPurpose, AccountLinkReport } from '@/lib/account-links';

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
  /** False while the account waits on an emailed link — its invitation, or an administrator's reset. */
  hasPassword: boolean;
  /** The link such an account is waiting on, when it has one. */
  pendingLink: { purpose: AccountLinkPurpose; expiresAt: string; expired: boolean } | null;
}

/** Whether email can carry the links: working, in testing mode, or off or not set up. */
export type EmailStatus = 'ready' | 'testing' | 'unavailable';

/** The server names the input its complaint belongs to; this puts it there. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

/** Marks an input as rejected, for the browser and for the eye. */
function invalidProps(id: string, message?: string) {
  if (!message) return {};
  return {
    'aria-invalid': true,
    'aria-describedby': id,
    className: 'border-destructive focus-visible:ring-destructive',
  };
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** What an account without a password is waiting on, at a glance. */
function LinkBadge({ link }: { link: UserRow['pendingLink'] }) {
  const reset = link?.purpose === 'PASSWORD_RESET';
  if (link?.expired) {
    return (
      <Badge variant="destructive" className="mt-1">
        {reset ? 'Reset link expired' : 'Invitation expired'}
      </Badge>
    );
  }
  return (
    <Badge
      variant="warning"
      className="mt-1"
      title={link ? `The link works until ${formatWhen(link.expiresAt)}` : undefined}
    >
      {reset ? 'Reset pending' : 'Awaiting activation'}
    </Badge>
  );
}

/** Said wherever a link is about to be sent while email cannot deliver it to a mailbox. */
function EmailNotice({ status }: { status: EmailStatus }) {
  if (status === 'ready') return null;
  return (
    <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>
        {status === 'unavailable'
          ? 'Email is off or not set up, so the link cannot be sent until it is — see the Email tab.'
          : 'Email is in testing mode: the message is saved to a folder on the server instead of being sent.'}
      </span>
    </p>
  );
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
  emailStatus,
  linkLifetimes,
}: {
  users: UserRow[];
  roles: { id: string; name: string }[];
  currentUserId: string;
  canCreate: boolean;
  canUpdate: boolean;
  emailStatus: EmailStatus;
  linkLifetimes: { activationMinutes: number; resetMinutes: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  /** Server-side rejections, keyed by the input they belong to. */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof blank, string>>>(
    {}
  );

  /** Opening, switching or closing the form drops the errors of the last one. */
  const openForm = (value: typeof blank | null) => {
    setForm(value);
    setFieldErrors({});
  };

  /** Editing a field withdraws the complaint made about it. */
  const updateForm = (patch: Partial<typeof blank>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof typeof blank];
      return next;
    });
  };

  /**
   * Nobody's password passes through this screen: accounts are activated, and
   * passwords reset, through links emailed to their holders. All it learns is
   * whether the email went, and this holds the cases where it did not.
   */
  const [linkFailure, setLinkFailure] = useState<{
    id: string;
    name: string;
    link: AccountLinkReport;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmReset, setConfirmReset] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState(false);

  /** Returns whether the email went, so callers can react to a repeat failure. */
  const reportLink = (
    account: { id: string; fullName: string },
    title: string,
    link: AccountLinkReport
  ) => {
    if (link.sent) {
      toast({
        title,
        description: link.savedTo
          ? `Email is in testing mode, so the message was saved to ${link.savedTo} instead of being sent.`
          : `${link.purpose === 'ACTIVATION' ? 'The activation' : 'A password reset'} link was ` +
            `emailed to ${link.email}. It works until ${formatWhen(link.expiresAt)}.`,
      });
      setLinkFailure(null);
      return true;
    }
    setLinkFailure({ id: account.id, name: account.fullName, link });
    return false;
  };

  /**
   * Sends an account without a password the link it is waiting on — a fresh
   * one, which also stops any earlier link from working.
   */
  const sendLinkAgain = async (account: { id: string; fullName: string }) => {
    setSending(true);
    try {
      const response = await fetch(`/api/admin/users/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend-link' }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Link not sent', description: data?.error });
        return;
      }

      const sent = reportLink(account, 'Link sent', data.link);
      if (!sent) {
        toast({ variant: 'destructive', title: 'Still not sent', description: data.link?.error });
      }
      router.refresh();
    } finally {
      setSending(false);
    }
  };

  const resetPassword = async () => {
    if (!confirmReset) return;
    const account = confirmReset;
    setResetting(true);
    try {
      const response = await fetch(`/api/admin/users/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password' }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Reset failed', description: data?.error });
        return;
      }

      setConfirmReset(null);
      reportLink(account, 'Password reset', data.link);
      router.refresh();
    } finally {
      setResetting(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const editing = Boolean(form.id);
      const response = await fetch(editing ? `/api/admin/users/${form.id}` : '/api/admin/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // A rejection that names a field belongs under that field. Everything
        // else - a permission refusal, a body that never arrived - has no
        // input to sit under and stays a toast.
        if (data?.field && data.field in blank) {
          setFieldErrors({ [data.field as keyof typeof blank]: String(data.error) });
        } else {
          toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        }
        return;
      }

      if (data.link) {
        reportLink({ id: data.id, fullName: form.fullName }, 'User created', data.link);
      } else if (data.linkWithdrawn) {
        toast({
          title: 'User updated',
          description:
            "The link already emailed to this account no longer works. Send a new one from the user's row.",
        });
      } else {
        toast({ title: 'User updated' });
      }

      openForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const unlock = async (user: UserRow) => {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock' }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
      return;
    }
    toast({ title: 'Account unlocked' });
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
    toast({
      title: `Account is now ${status.toLowerCase()}`,
      description: data.linkWithdrawn
        ? 'The link it was waiting on no longer works. Send a new one after enabling it.'
        : undefined,
    });
    router.refresh();
  };

  const failedPurpose = linkFailure?.link.purpose;

  return (
    <>
      {canCreate && (
        <div className="mb-4">
          <Button onClick={() => openForm({ ...blank, roleId: roles[0]?.id ?? '' })}>
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
                  {!user.hasPassword && <LinkBadge link={user.pendingLink} />}
                  {user.hasPassword && user.passwordChangeRequired && (
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
                        aria-label={`Edit ${user.fullName}`}
                        onClick={() =>
                          openForm({
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
                      {user.hasPassword && user.id !== currentUserId && user.status === 'ACTIVE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Reset password"
                          aria-label={`Reset password for ${user.fullName}`}
                          onClick={() => setConfirmReset(user)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!user.hasPassword && user.status === 'ACTIVE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Send the link again"
                          aria-label={`Send ${user.fullName} the link again`}
                          disabled={sending}
                          onClick={() => sendLinkAgain(user)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {user.locked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Unlock"
                          aria-label={`Unlock ${user.fullName}`}
                          onClick={() => unlock(user)}
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

      <Dialog open={form !== null} onOpenChange={(open) => !open && openForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? 'Changing the role takes effect on the next request. Changing the email address withdraws any link already sent to the old one.'
                : 'An activation link is emailed to the new user, and they choose their own password — ' +
                  `nobody else ever sees it. The link works for ${describeMinutes(
                    linkLifetimes.activationMinutes
                  )}.`}
            </DialogDescription>
          </DialogHeader>

          {form && (
            <form onSubmit={save} className="space-y-3">
              {!form.id && <EmailNotice status={emailStatus} />}

              <div className="space-y-1.5">
                <Label htmlFor="u-name">Full name</Label>
                <Input
                  id="u-name"
                  required
                  value={form.fullName}
                  onChange={(event) => updateForm({ fullName: event.target.value })}
                  {...invalidProps('u-name-error', fieldErrors.fullName)}
                />
                <FieldError id="u-name-error" message={fieldErrors.fullName} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-email">Email</Label>
                <Input
                  id="u-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => updateForm({ email: event.target.value })}
                  {...invalidProps('u-email-error', fieldErrors.email)}
                />
                <FieldError id="u-email-error" message={fieldErrors.email} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-phone">Phone number</Label>
                <Input
                  id="u-phone"
                  required
                  value={form.phoneNumber}
                  onChange={(event) => updateForm({ phoneNumber: event.target.value })}
                  placeholder="0911223344"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  // Long enough for +251912345678 and not a character more,
                  // so an over-length entry cannot be typed in the first place.
                  maxLength={13}
                  {...invalidProps('u-phone-error', fieldErrors.phoneNumber)}
                />
                <FieldError id="u-phone-error" message={fieldErrors.phoneNumber} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-role">Role</Label>
                <select
                  id="u-role"
                  required
                  value={form.roleId}
                  onChange={(event) => updateForm({ roleId: event.target.value })}
                  aria-invalid={Boolean(fieldErrors.roleId)}
                  aria-describedby={fieldErrors.roleId ? 'u-role-error' : undefined}
                  className={
                    'h-10 w-full rounded-md border bg-background px-3 text-sm ' +
                    (fieldErrors.roleId ? 'border-destructive' : 'border-input')
                  }
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <FieldError id="u-role-error" message={fieldErrors.roleId} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => openForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {form.id ? 'Save' : 'Create and send invitation'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmReset !== null}
        onOpenChange={(open) => !open && !resetting && setConfirmReset(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the password for {confirmReset?.fullName}?</DialogTitle>
            <DialogDescription>
              Their current password stops working straight away and every session they have is
              signed out. A link to choose a new one is emailed to {confirmReset?.email}, and works
              for {describeMinutes(linkLifetimes.resetMinutes)}.
            </DialogDescription>
          </DialogHeader>

          <EmailNotice status={emailStatus} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={resetPassword} disabled={resetting}>
              {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset and email link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={linkFailure !== null}
        onOpenChange={(open) => !open && !sending && setLinkFailure(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {failedPurpose === 'PASSWORD_RESET' ? 'Reset email not sent' : 'Activation email not sent'}
            </DialogTitle>
            <DialogDescription>
              The {failedPurpose === 'PASSWORD_RESET' ? 'password reset' : 'activation'} link for{' '}
              {linkFailure?.name} could not be emailed to {linkFailure?.link.email}.{' '}
              {failedPurpose === 'PASSWORD_RESET'
                ? 'Their old password has already stopped working.'
                : 'The account exists, and cannot be signed in to until its holder uses a link.'}
            </DialogDescription>
          </DialogHeader>

          {linkFailure?.link.error && (
            <p className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {linkFailure.link.error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Put email right under the Email tab — a test message there confirms it works — then send
            the link again.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkFailure(null)} disabled={sending}>
              Close
            </Button>
            {/* Sending again goes through the update endpoint, so an operator
                who may create accounts but not update them is not offered a
                button the server would refuse. */}
            {canUpdate && linkFailure && (
              <Button
                onClick={() => sendLinkAgain({ id: linkFailure.id, fullName: linkFailure.name })}
                disabled={sending}
              >
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send again
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
