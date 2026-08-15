'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/format';

const ACCEPTED = '.csv,.txt,.tsv,.xlsx,.xlsm';
const PAGE_SIZE = 50;

interface Participant {
  id: string;
  phoneNumber: string;
  fullName: string | null;
  note: string | null;
  source: string;
  addedBy: string | null;
  createdAt: string;
  registered: boolean;
  bidderId: string | null;
  bidderName: string | null;
  bidderStatus: string | null;
  bidsPlaced: number;
}

interface RejectedRow {
  line: number;
  value: string;
  reason: string;
}

interface ImportResult {
  added: number;
  skipped: number;
  removed: number;
  duplicatesInFile: number;
  rejected: RejectedRow[];
  rejectedTotal: number;
  total: number;
}

export function ParticipantManager({
  auction,
  canUpdate,
}: {
  auction: { id: string; code: string; title: string; status: string; restricted: boolean };
  canUpdate: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [restricted, setRestricted] = useState(auction.restricted);
  const [listTotal, setListTotal] = useState(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const [unlisted, setUnlisted] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const locked = auction.status === 'SETTLED' || auction.status === 'CANCELLED';
  const editable = canUpdate && !locked;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { q: search } : {}),
      });
      const response = await fetch(
        `/api/admin/auctions/${auction.id}/participants?${query}`,
        { cache: 'no-store' }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not load the list.');

      setParticipants(data.participants ?? []);
      setListTotal(data.listTotal ?? 0);
      setMatchTotal(data.total ?? 0);
      setUnlisted(data.unlistedBidders ?? 0);
      setRestricted(Boolean(data.restricted));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Load failed', description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [auction.id, page, search, toast]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const afterChange = (data: any) => {
    setResult(
      'added' in data
        ? {
            added: data.added ?? 0,
            skipped: data.skipped ?? 0,
            removed: data.removed ?? 0,
            duplicatesInFile: data.duplicatesInFile ?? 0,
            rejected: data.rejected ?? [],
            rejectedTotal: data.rejectedTotal ?? 0,
            total: data.total ?? 0,
          }
        : null
    );
    setPage(1);
    load();
    router.refresh();
  };

  const upload = async (file: File | undefined | null) => {
    if (!file || !editable) return;

    setBusy('upload');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('mode', replaceExisting ? 'replace' : 'append');

      const response = await fetch(`/api/admin/auctions/${auction.id}/participants`, {
        method: 'POST',
        body,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setResult(null);
        toast({ variant: 'destructive', title: 'Import failed', description: data?.error });
        return;
      }

      toast({
        title: `${data.added} participant(s) added`,
        description: `${data.total} on the list for #${auction.code}.`,
      });
      afterChange(data);
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importPasted = async () => {
    if (!paste.trim() || !editable) return;

    setBusy('paste');
    try {
      const response = await fetch(`/api/admin/auctions/${auction.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: paste, mode: replaceExisting ? 'replace' : 'append' }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setResult(null);
        toast({ variant: 'destructive', title: 'Import failed', description: data?.error });
        return;
      }

      toast({ title: `${data.added} participant(s) added` });
      setPaste('');
      afterChange(data);
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  const removeOne = async (participant: Participant) => {
    setBusy(participant.id);
    try {
      const response = await fetch(
        `/api/admin/auctions/${auction.id}/participants/${participant.id}`,
        { method: 'DELETE' }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not remove', description: data?.error });
        return;
      }
      toast({ title: `${maskPhone(participant.phoneNumber)} removed` });
      load();
      router.refresh();
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  const clearAll = async () => {
    setBusy('clear');
    try {
      const response = await fetch(`/api/admin/auctions/${auction.id}/participants`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not clear', description: data?.error });
        return;
      }
      toast({
        title: 'List cleared',
        description: `${data.removed} removed — the auction is open to everyone again.`,
      });
      setClearOpen(false);
      setResult(null);
      afterChange({});
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (next: boolean) => {
    setBusy('mode');
    try {
      const response = await fetch(`/api/admin/auctions/${auction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eligibilityMode: next ? 'RESTRICTED' : 'OPEN' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not change', description: data?.error });
        return;
      }
      setRestricted(next);
      toast({
        title: next ? 'Restricted to the invited list' : 'Open to every bidder',
      });
      load();
      router.refresh();
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  const pages = Math.max(1, Math.ceil(matchTotal / PAGE_SIZE));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {locked && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This auction is {auction.status.toLowerCase()}, so its list is read-only.
            </AlertDescription>
          </Alert>
        )}

        {editable && (
          <Card>
            <CardHeader>
              <CardTitle>Upload a list</CardTitle>
              <CardDescription>
                A CSV, text or Excel file. The first column is the phone number; optional{' '}
                <code className="rounded bg-secondary px-1">name</code> and{' '}
                <code className="rounded bg-secondary px-1">note</code> columns are kept alongside
                it. Numbers are matched however they are written — 0912…, +251912… and 251912… are
                the same person.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  upload(event.dataTransfer.files?.[0]);
                }}
                disabled={busy !== null}
                className={cn(
                  'flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-8 text-center transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/50',
                  busy === 'upload' && 'opacity-60'
                )}
              >
                {busy === 'upload' ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {busy === 'upload' ? 'Importing…' : 'Choose a file or drop it here'}
                </span>
                <span className="text-xs text-muted-foreground">
                  CSV, TXT or XLSX · up to 2 MB
                </span>
              </button>

              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                onChange={(event) => upload(event.target.files?.[0])}
              />

              <div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5">
                <div>
                  <Label htmlFor="replaceExisting">Replace the current list</Label>
                  <p className="text-xs text-muted-foreground">
                    {replaceExisting
                      ? `Everyone currently on the list is removed first — ${listTotal} entry(ies).`
                      : 'New numbers are added; anyone already on the list stays and is not duplicated.'}
                  </p>
                </div>
                <Switch
                  id="replaceExisting"
                  checked={replaceExisting}
                  onCheckedChange={setReplaceExisting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paste">…or paste numbers</Label>
                <Textarea
                  id="paste"
                  rows={4}
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder={'0912345678\n0911223344, Sara Tesfaye\n251700112233'}
                  className="font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!paste.trim() || busy !== null}
                    onClick={importPasted}
                  >
                    {busy === 'paste' ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-1.5 h-4 w-4" />
                    )}
                    Add these
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <Alert>
            <FileSpreadsheet className="h-4 w-4" />
            <AlertDescription className="space-y-1.5 text-xs">
              <p className="text-sm font-semibold text-foreground">
                {result.added} added · {result.total} on the list
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {result.removed > 0 && <li>{result.removed} removed by the replace.</li>}
                {result.skipped > 0 && <li>{result.skipped} were already on the list.</li>}
                {result.duplicatesInFile > 0 && (
                  <li>{result.duplicatesInFile} repeated within the file.</li>
                )}
                {result.rejectedTotal > 0 && (
                  <li className="text-destructive">
                    {result.rejectedTotal} row(s) could not be read and were skipped.
                  </li>
                )}
              </ul>
              {result.rejected.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border">
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-border">
                      {result.rejected.map((row) => (
                        <tr key={`${row.line}-${row.value}`}>
                          <td className="px-2 py-1 text-muted-foreground">Row {row.line}</td>
                          <td className="px-2 py-1 font-mono">{row.value || '—'}</td>
                          <td className="px-2 py-1 text-muted-foreground">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Eligible participants</CardTitle>
              <CardDescription>
                {listTotal === 0
                  ? 'Nobody has been added yet.'
                  : `${listTotal.toLocaleString()} number(s) may bid on #${auction.code}.`}
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              {listTotal > 0 && (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/admin/auctions/${auction.id}/participants?format=csv`}>
                    <Download className="mr-1.5 h-4 w-4" />
                    Export
                  </a>
                </Button>
              )}
              {editable && listTotal > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setClearOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {listTotal > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by number or name"
                  className="pl-9"
                />
              </div>
            )}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Phone</th>
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">In the app</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Bids</th>
                    <th className="px-3 py-2.5 font-semibold">Note</th>
                    {editable && <th className="w-10 px-3 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      </td>
                    </tr>
                  )}

                  {!loading && participants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        {search
                          ? 'No participant matches that search.'
                          : 'No participants yet — upload a list to restrict this auction.'}
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    participants.map((participant) => (
                      <tr key={participant.id}>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {participant.bidderId ? (
                            <Link
                              href={`/admin/bidders/${participant.bidderId}`}
                              className="hover:text-primary"
                            >
                              {participant.phoneNumber}
                            </Link>
                          ) : (
                            participant.phoneNumber
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {participant.fullName || participant.bidderName || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {participant.registered ? (
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                participant.bidderStatus === 'ACTIVE'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-destructive/15 text-destructive'
                              )}
                            >
                              {participant.bidderStatus === 'ACTIVE'
                                ? 'Registered'
                                : (participant.bidderStatus ?? '').toLowerCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not yet</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {participant.bidsPlaced || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {participant.note || '—'}
                        </td>
                        {editable && (
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              aria-label={`Remove ${participant.phoneNumber}`}
                              disabled={busy !== null}
                              onClick={() => removeOne(participant)}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                            >
                              {busy === participant.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Who may bid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="restricted">Invited participants only</Label>
                <p className="text-xs text-muted-foreground">
                  {restricted
                    ? 'Only the numbers on this list can place a bid. Everyone else still sees the auction, but the bid form is closed to them.'
                    : 'Any bidder in the app can take part.'}
                </p>
              </div>
              <Switch
                id="restricted"
                checked={restricted}
                disabled={!editable || busy !== null}
                onCheckedChange={setMode}
              />
            </div>

            {restricted && listTotal === 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  The list is empty, so nobody can bid. Upload participants, or switch this off.
                </AlertDescription>
              </Alert>
            )}

            {restricted && unlisted > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {unlisted} bidder(s) have already bid on this auction but are not on the list.
                  Their existing bids still count towards the result — they simply cannot place any
                  more. Add them, or settle knowing they are locked out.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-2.5 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold tabular-nums">{listTotal.toLocaleString()}</span>
              <span className="text-muted-foreground">on the list</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>File format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <pre className="overflow-x-auto rounded-md bg-secondary/60 p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {'phone,name,note\n0912345678,Abebe Bekele,Gold tier\n251911223344,Sara Tesfaye,\n0700112233,,Branch referral'}
            </pre>
            <p>
              A header row is detected automatically. A file that is nothing but a column of numbers
              works just as well.
            </p>
            <p>
              Rows without a usable number are skipped and reported back, so a stray total row or a
              blank cell never silently drops someone.
            </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the participant list?</AlertDialogTitle>
            <AlertDialogDescription>
              All {listTotal.toLocaleString()} entries are removed and #{auction.code} goes back to
              being open to every bidder. Bids already placed are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the list</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                clearAll();
              }}
            >
              {busy === 'clear' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
