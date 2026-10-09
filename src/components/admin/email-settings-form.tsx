'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  Mail,
  RotateCcw,
  Save,
  Send,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { EmailSettings, EmailSettingsView, SmtpSecurity } from '@/lib/email';

/** One click fills in a provider's server, port and connection security. */
const PRESETS: { name: string; host: string; port: number; security: SmtpSecurity; note: string }[] = [
  {
    name: 'Gmail (587, STARTTLS)',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'STARTTLS',
    note: 'Recommended for Gmail and Google Workspace.',
  },
  {
    name: 'Gmail (465, SSL)',
    host: 'smtp.gmail.com',
    port: 465,
    security: 'SSL_ON_CONNECT',
    note: 'Use this if port 587 is blocked on your network.',
  },
  {
    name: 'Office 365',
    host: 'smtp.office365.com',
    port: 587,
    security: 'STARTTLS',
    note: 'Microsoft 365 / Exchange Online.',
  },
];

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  STARTTLS: 'STARTTLS (port 587)',
  SSL_ON_CONNECT: 'SSL/TLS on connect (port 465)',
  NONE: 'None (trusted internal relay only)',
};

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60';

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A caution under a field. The icon carries the colour so the sentence stays readable. */
function Caution({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 text-xs font-medium">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}

export function EmailSettingsForm({
  initial,
  canUpdate,
}: {
  initial: EmailSettingsView;
  canUpdate: boolean;
}) {
  const { toast } = useToast();
  /** The server's view as of the last load or save: what the status and password rules read. */
  const [loaded, setLoaded] = useState(initial);
  const [form, setForm] = useState<EmailSettings>(initial.settings);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = (view: EmailSettingsView) => {
    setLoaded(view);
    setForm(view.settings);
    setPassword('');
    setClearPassword(false);
  };

  const isSmtp = form.mode === 'SMTP';
  const isGmail = /(^|\.)(gmail|googlemail)\.com$/i.test(form.smtpHost.trim());
  const stored = loaded.passwordState === 'SET';
  const accountChanged =
    !sameText(form.smtpHost, loaded.settings.smtpHost) ||
    !sameText(form.username, loaded.settings.username);
  // The server's rule, mirrored: a username needs a password, and a stored one
  // does not follow the settings to another server or account.
  const needsPassword =
    isSmtp && Boolean(form.username.trim()) && !password && (!stored || accountChanged || clearPassword);
  const appUrlIsLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(form.appUrl);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(loaded.settings) || Boolean(password) || clearPassword;

  // What the API reads: null keeps the stored password, '' removes it, a value replaces it.
  const passwordForApi = password ? password : clearPassword ? '' : null;

  const applyPreset = (preset: (typeof PRESETS)[number]) =>
    setForm((current) => ({
      ...current,
      mode: 'SMTP',
      smtpHost: preset.host,
      smtpPort: preset.port,
      security: preset.security,
      // Gmail sends only as the signed-in account or a verified alias.
      fromAddress:
        preset.host === 'smtp.gmail.com' && current.username && !current.fromAddress
          ? current.username
          : current.fromAddress,
    }));

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: passwordForApi }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Email settings not saved', description: data?.error });
        return;
      }

      reset(data as EmailSettingsView);
      toast({
        title: 'Email settings saved',
        description: 'They apply to the next email; no restart needed.',
      });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/admin/email-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testTo.trim() || null,
          settings: { ...form, password: password || null },
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setTestResult({ ok: false, text: data?.error ?? 'The test email could not be sent.' });
        return;
      }

      setTestResult({
        ok: true,
        text: data.savedTo
          ? `Testing mode: the message for ${data.sentTo} was saved as ${data.savedTo}.`
          : `The mail server accepted the message for ${data.sentTo}. Check that inbox, and its spam folder.`,
      });
    } catch {
      setTestResult({
        ok: false,
        text: 'The request did not reach the server. Check your connection and try again.',
      });
    } finally {
      setTesting(false);
    }
  };

  const saved = loaded.settings;
  const attention = Boolean(loaded.problem) || !saved.enabled;
  const statusTitle = loaded.problem
    ? 'Email delivery needs attention'
    : !saved.enabled
      ? 'Email sending is turned off'
      : saved.mode === 'SMTP'
        ? 'Email delivery is set up'
        : 'Testing mode: emails are saved to a folder';
  const statusDetail =
    loaded.problem ??
    (!saved.enabled
      ? 'New accounts cannot be activated, nor passwords reset, until sending is on.'
      : saved.mode === 'SMTP'
        ? `${saved.username || 'No sign-in'} via ${saved.smtpHost}:${saved.smtpPort}`
        : loaded.resolvedPickupDirectory);

  const passwordStatus =
    loaded.passwordState === 'UNREADABLE'
      ? "The saved password can't be decrypted on this server — enter it again."
      : loaded.passwordState === 'NOT_SET'
        ? 'No password stored.'
        : loaded.passwordFromEnvironment
          ? 'Using SMTP_PASSWORD from the server environment.'
          : clearPassword
            ? 'Will be removed when you save.'
            : 'Stored encrypted; never shown.';

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <fieldset disabled={!canUpdate} className="min-w-0 space-y-6 lg:col-span-8">
        {/* Status */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  attention ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                )}
              >
                {attention ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <p className="font-semibold">{statusTitle}</p>
                <p className="break-words text-xs text-muted-foreground">{statusDetail}</p>
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-3 text-sm font-semibold">
              Sending enabled
              <Switch checked={form.enabled} onCheckedChange={(value) => set('enabled', value)} />
            </label>
          </CardContent>
        </Card>

        {/* Mail server */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-5 w-5 text-primary" />
              Mail server
            </CardTitle>
            <CardDescription>
              Stored in the database and used from the next email on. Until something is saved
              here, the SMTP_* and EMAIL_* environment variables apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="email-mode">Delivery mode</Label>
              <select
                id="email-mode"
                value={form.mode}
                onChange={(event) => set('mode', event.target.value as EmailSettings['mode'])}
                className={SELECT_CLASS}
              >
                <option value="SMTP">Send through an SMTP server</option>
                <option value="PICKUP_FOLDER">Testing: save emails as .eml files in a folder</option>
              </select>
            </div>

            {isSmtp ? (
              <>
                <div className="space-y-1.5">
                  <Label>Quick setup</Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.note}
                        onClick={() => applyPreset(preset)}
                        className={cn(
                          'rounded-md border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60',
                          form.smtpHost === preset.host && form.smtpPort === preset.port
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-secondary/60'
                        )}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="email-host">SMTP server</Label>
                    <Input
                      id="email-host"
                      value={form.smtpHost}
                      onChange={(event) => set('smtpHost', event.target.value)}
                      placeholder="smtp.gmail.com"
                      maxLength={253}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email-port">Port</Label>
                    <Input
                      id="email-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.smtpPort || ''}
                      onChange={(event) => set('smtpPort', parseInt(event.target.value, 10) || 0)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email-security">Connection security</Label>
                  <select
                    id="email-security"
                    value={form.security}
                    onChange={(event) => set('security', event.target.value as SmtpSecurity)}
                    className={SELECT_CLASS}
                  >
                    {(Object.keys(SECURITY_LABELS) as SmtpSecurity[]).map((key) => (
                      <option
                        key={key}
                        value={key}
                        disabled={key === 'NONE' && !loaded.insecureAllowed}
                      >
                        {SECURITY_LABELS[key]}
                        {key === 'NONE' && !loaded.insecureAllowed ? ' — not allowed on this server' : ''}
                      </option>
                    ))}
                  </select>
                  {form.security === 'NONE' && (
                    <p className="text-xs font-medium text-destructive">
                      The password and every message travel unencrypted. Never use this with Gmail
                      or over the internet.
                    </p>
                  )}
                </div>

                {form.security !== 'NONE' && (
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between gap-3 text-sm font-semibold">
                      Accept the server&apos;s certificate without checking it
                      <Switch
                        checked={form.allowInvalidCertificate}
                        // It can always be switched off; switching it on is for
                        // deployments that allow it.
                        disabled={!loaded.insecureAllowed && !form.allowInvalidCertificate}
                        onCheckedChange={(value) => set('allowInvalidCertificate', value)}
                      />
                    </label>
                    {form.allowInvalidCertificate ? (
                      <Caution>
                        Still encrypted, but the server&apos;s identity is not verified. Use this only
                        for an internal mail server on a trusted network.
                      </Caution>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Only for an internal server with a self-signed certificate, or one whose
                        certificate carries a different name from the host.
                      </p>
                    )}
                  </div>
                )}

                {!loaded.insecureAllowed && (
                  <p className="text-xs text-muted-foreground">
                    TLS is required and certificates are checked. Unencrypted connections and
                    unchecked certificates are only offered when the server sets
                    SMTP_ALLOW_INSECURE=true, for an internal mail server that needs them.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-username">Username</Label>
                    <Input
                      id="email-username"
                      value={form.username}
                      onChange={(event) => set('username', event.target.value)}
                      placeholder="you@gmail.com"
                      autoComplete="off"
                      maxLength={256}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email-password">{isGmail ? 'App password' : 'Password'}</Label>
                    <Input
                      id="email-password"
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      maxLength={256}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setClearPassword(false);
                      }}
                      placeholder={
                        stored && !accountChanged && !clearPassword
                          ? '•••••••• stored (leave blank to keep)'
                          : 'Enter password'
                      }
                      className={cn(needsPassword && 'border-warning')}
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={cn(
                          loaded.passwordState === 'UNREADABLE'
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground'
                        )}
                      >
                        {passwordStatus}
                      </span>
                      {stored && !loaded.passwordFromEnvironment && !password && (
                        <button
                          type="button"
                          className="shrink-0 font-semibold text-muted-foreground hover:text-destructive"
                          onClick={() => setClearPassword((current) => !current)}
                        >
                          {clearPassword ? 'Keep stored password' : 'Remove'}
                        </button>
                      )}
                    </div>
                    {accountChanged && stored && !password && form.username.trim() && (
                      <Caution>Server or username changed: enter the password for the new account.</Caution>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="email-folder">Folder for saved emails</Label>
                <Input
                  id="email-folder"
                  value={form.pickupDirectory}
                  onChange={(event) => set('pickupDirectory', event.target.value)}
                  placeholder={loaded.resolvedPickupDirectory}
                  maxLength={260}
                />
                <Caution>
                  Nothing is sent in this mode. Activation and reset emails are saved here, working
                  links and all, so anyone who can read the folder can use them: testing only. Leave
                  it blank for the default folder.
                </Caution>
              </div>
            )}

            <div className="max-w-[200px] space-y-1.5">
              <Label htmlFor="email-timeout">Timeout (seconds)</Label>
              <Input
                id="email-timeout"
                type="number"
                min={5}
                max={120}
                value={form.timeoutSeconds || ''}
                onChange={(event) => set('timeoutSeconds', parseInt(event.target.value, 10) || 0)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Sender and links */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-5 w-5 text-primary" />
              Sender &amp; links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-from">From address</Label>
                <Input
                  id="email-from"
                  type="email"
                  value={form.fromAddress}
                  onChange={(event) => set('fromAddress', event.target.value)}
                  placeholder="no-reply@yourdomain.com"
                  maxLength={254}
                />
                {isGmail &&
                  form.username &&
                  form.fromAddress &&
                  !sameText(form.fromAddress, form.username) && (
                    <Caution>
                      Gmail sends as {form.username} unless this address is a verified &quot;Send mail
                      as&quot; alias.
                    </Caution>
                  )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-from-name">Sender name</Label>
                <Input
                  id="email-from-name"
                  value={form.fromName}
                  onChange={(event) => set('fromName', event.target.value)}
                  placeholder="GuessLow"
                  maxLength={100}
                />
                <p className="text-xs text-muted-foreground">
                  Also the platform name the emails introduce themselves with.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-reply-to">Reply-to address (optional)</Label>
              <Input
                id="email-reply-to"
                type="email"
                value={form.replyToAddress}
                onChange={(event) => set('replyToAddress', event.target.value)}
                placeholder="support@yourdomain.com"
                maxLength={254}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-app-url">Admin console address used in email links</Label>
              <Input
                id="email-app-url"
                value={form.appUrl}
                onChange={(event) => set('appUrl', event.target.value)}
                placeholder="https://guesslow.yourdomain.com"
                maxLength={500}
              />
              {appUrlIsLocal && (
                <Caution>
                  &quot;localhost&quot; only works on this computer. Use an address other people&apos;s
                  browsers can reach.
                </Caution>
              )}
            </div>
          </CardContent>
        </Card>

        {canUpdate && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={save} disabled={saving || needsPassword || !dirty}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Save email settings
            </Button>
            <Button variant="outline" onClick={() => reset(loaded)} disabled={saving || !dirty}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Discard changes
            </Button>
          </div>
        )}
      </fieldset>

      <div className="min-w-0 space-y-6 lg:col-span-4">
        {canUpdate && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-4 w-4 text-primary" />
                Send a test email
              </CardTitle>
              <CardDescription>Uses the values in the form, so you can test before saving.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Input
                type="email"
                aria-label="Test recipient"
                placeholder="Recipient (default: your email)"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={sendTest}
                disabled={testing || needsPassword}
              >
                {testing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                Send test
              </Button>
              {testResult && (
                <p
                  role="status"
                  className={cn(
                    'break-words rounded-md px-3 py-2.5 text-xs font-medium',
                    testResult.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  )}
                >
                  {testResult.text}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" />
              What email is used for
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs text-muted-foreground">
            <p>
              Admin accounts are activated, and their passwords reset, through single-use links
              emailed to the account holder&apos;s own address. Nobody else ever chooses or sees the
              password, and nothing about it goes by SMS.
            </p>
            <p>
              Until email works, new accounts cannot be activated and a forgotten password cannot be
              reset — send a test before adding users.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              Using Gmail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs">
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>
                Turn on <strong>2-Step Verification</strong> for the Gmail account.
              </li>
              <li>
                Create an <strong>App password</strong> at myaccount.google.com → Security → App
                passwords. Google shows 16 letters.
              </li>
              <li>
                Click <strong>Gmail (587, STARTTLS)</strong> above, enter the Gmail address as the
                username and the From address, and paste the app password — spaces don&apos;t
                matter.
              </li>
              <li>
                <strong>Send test</strong>, then <strong>Save</strong>.
              </li>
            </ol>
            <p className="flex gap-1.5 pt-1 text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The normal Gmail password is refused. A free Gmail account can send about 500 emails a
              day.
            </p>
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Open Google App passwords
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">Changes and tests are recorded in the audit log.</p>
      </div>
    </div>
  );
}
