'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { EmptyRow, TableCard } from '@/components/admin/data-shell';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/format';

/**
 * Saved participant lists, managed beside the terms versions.
 *
 * A list is uploaded once here and attached to as many auctions as needed.
 * Attaching copies the numbers onto the auction, so nothing on this page can
 * change who is allowed to bid on an auction that is already running — see
 * src/lib/participant-lists.ts for why that matters.
 */

const ACCEPTED = '.csv,.txt,.tsv,.xlsx,.xlsm';
const PAGE_SIZE = 50;

export interface ParticipantListRow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  entryCount: number;
  auctionCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Entry {
  id: string;
  phoneNumber: string;
  fullName: string | null;
  note: string | null;
  createdAt: string;
  registered: boolean;
  bidderName: string | null;
  bidderStatus: string | null;
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

const blankDetails = { id: '', name: '', description: '' };

export function ParticipantListManager({
  lists,
  canCreate,
  canUpdate,
  canDelete,
}: {
  lists: ParticipantListRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [detailsForm, setDetailsForm] = useState<typeof blankDetails | null>(null);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [managing, setManaging] = useState<ParticipantListRow | null>(null);
  const [deleting, setDeleting] = useState<ParticipantListRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (url: string, options: RequestInit, successTitle: string) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
      return false;
    }
    toast({ title: successTitle });
    router.refresh();
    return true;
  };

  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detailsForm) return;

    setBusy('details');
    try {
      const editing = Boolean(detailsForm.id);

      // A new list can arrive with its numbers already attached, so the operator
      // names it and uploads it in one go rather than making an empty list first.
      if (!editing && createFile) {
        const body = new FormData();
        body.append('name', detailsForm.name);
        body.append('description', detailsForm.description);
        body.append('file', createFile);

        const response = await fetch('/api/admin/participant-lists', { method: 'POST', body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast({ variant: 'destructive', title: 'Could not create the list', description: data?.error });
          return;
        }

        toast({
          title: `"${detailsForm.name}" created`,
          description: `${data.total?.toLocaleString() ?? 0} number(s) imported${
            data.rejectedTotal ? `, ${data.rejectedTotal} row(s) skipped` : ''
          }.`,
        });
        setDetailsForm(null);
        setCreateFile(null);
        router.refresh();
        return;
      }

      const ok = await act(
        editing ? `/api/admin/participant-lists/${detailsForm.id}` : '/api/admin/participant-lists',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: detailsForm.name, description: detailsForm.description }),
        },
        editing ? 'List updated' : 'List created'
      );
      if (ok) {
        setDetailsForm(null);
        setCreateFile(null);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {canCreate && (
        <div className="mb-4">
          <Button
            onClick={() => {
              setDetailsForm({ ...blankDetails });
              setCreateFile(null);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New list
          </Button>
        </div>
      )}

      <Alert className="mb-4">
        <Users className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Upload a roster once here, then pick it when you switch an auction to{' '}
          <strong>Invited participants only</strong>. The numbers are copied onto the auction at
          that moment, so editing a list later never changes who can bid on an auction that is
          already running — the auction offers you a re-sync instead.
        </AlertDescription>
      </Alert>

      <TableCard>
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">List</th>
              <th className="px-4 py-2.5 text-right font-semibold">Numbers</th>
              <th className="px-4 py-2.5 text-right font-semibold">Auctions</th>
              <th className="px-4 py-2.5 font-semibold">Last edited</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lists.length === 0 && (
              <EmptyRow
                colSpan={5}
                message="No saved lists yet. Create one to stop re-uploading the same numbers for every auction."
              />
            )}
            {lists.map((list) => (
              <tr key={list.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5">
                  <div className="font-medium">
                    {list.name}
                    {!list.active && (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </div>
                  {list.description && (
                    <p className="text-xs text-muted-foreground">{list.description}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {list.entryCount === 0 ? (
                    <span className="text-xs text-destructive">Empty</span>
                  ) : (
                    list.entryCount.toLocaleString()
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{list.auctionCount}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {new Date(list.updatedAt).toLocaleDateString('en-GB')}
                  {list.createdBy && <span className="block">by {list.createdBy}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="sm" onClick={() => setManaging(list)}>
                      <Users className="mr-1.5 h-3.5 w-3.5" />
                      {canUpdate ? 'Manage numbers' : 'View numbers'}
                    </Button>
                    {canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Rename"
                        aria-label={`Rename ${list.name}`}
                        onClick={() =>
                          setDetailsForm({
                            id: list.id,
                            name: list.name,
                            description: list.description,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={list.active ? 'Archive' : 'Restore'}
                        aria-label={`${list.active ? 'Archive' : 'Restore'} ${list.name}`}
                        onClick={() =>
                          act(
                            `/api/admin/participant-lists/${list.id}`,
                            {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ active: !list.active }),
                            },
                            list.active ? 'List archived' : 'List restored'
                          )
                        }
                      >
                        {list.active ? (
                          <Archive className="h-3.5 w-3.5" />
                        ) : (
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        title="Delete"
                        aria-label={`Delete ${list.name}`}
                        onClick={() => setDeleting(list)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <Dialog
        open={detailsForm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsForm(null);
            setCreateFile(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailsForm?.id ? 'Edit list' : 'New participant list'}</DialogTitle>
            <DialogDescription>
              {detailsForm?.id
                ? 'Renaming a list does not touch any auction built from it.'
                : 'Name the roster so it is recognisable when you attach it to an auction.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveDetails} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="list-name">Name</Label>
              <Input
                id="list-name"
                required
                value={detailsForm?.name ?? ''}
                onChange={(event) =>
                  setDetailsForm((form) => (form ? { ...form, name: event.target.value } : form))
                }
                placeholder="Head office staff"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-description">Description</Label>
              <Textarea
                id="list-description"
                rows={2}
                value={detailsForm?.description ?? ''}
                onChange={(event) =>
                  setDetailsForm((form) =>
                    form ? { ...form, description: event.target.value } : form
                  )
                }
                placeholder="Optional — who is on this list and where it came from."
              />
            </div>

            {!detailsForm?.id && (
              <div className="space-y-1.5">
                <Label htmlFor="list-file">Numbers (optional)</Label>
                <Input
                  id="list-file"
                  type="file"
                  accept={ACCEPTED}
                  onChange={(event) => setCreateFile(event.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  A .csv, .txt or .xlsx file. You can also create the list empty and upload numbers
                  afterwards.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDetailsForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy === 'details'}>
                {busy === 'details' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {detailsForm?.id ? 'Save' : 'Create list'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {managing && (
        <EntriesDialog
          list={managing}
          canUpdate={canUpdate}
          onClose={() => setManaging(null)}
          onChanged={() => router.refresh()}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleting?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.auctionCount
                ? `${deleting.auctionCount} auction(s) were built from this list. Their own participant lists are copies and are not touched — they simply lose the ability to re-sync from this one.`
                : 'The list and its numbers are removed. No auction is affected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                if (!deleting) return;
                const ok = await act(
                  `/api/admin/participant-lists/${deleting.id}`,
                  { method: 'DELETE' },
                  'List deleted'
                );
                if (ok) setDeleting(null);
              }}
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The numbers on one saved list, with the upload controls that change them. */
function EntriesDialog({
  list,
  canUpdate,
  onClose,
  onChanged,
}: {
  list: ParticipantListRow;
  canUpdate: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [listTotal, setListTotal] = useState(list.entryCount);
  const [matchTotal, setMatchTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { q: search } : {}),
      });
      const response = await fetch(`/api/admin/participant-lists/${list.id}?${query}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not load the list.');

      setEntries(data.entries ?? []);
      setListTotal(data.listTotal ?? 0);
      setMatchTotal(data.total ?? 0);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Load failed', description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [list.id, page, search, toast]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const afterImport = (data: any) => {
    setResult({
      added: data.added ?? 0,
      skipped: data.skipped ?? 0,
      removed: data.removed ?? 0,
      duplicatesInFile: data.duplicatesInFile ?? 0,
      rejected: data.rejected ?? [],
      rejectedTotal: data.rejectedTotal ?? 0,
      total: data.total ?? 0,
    });
    setPage(1);
    load();
    onChanged();
  };

  const send = async (key: string, init: RequestInit) => {
    setBusy(key);
    try {
      const response = await fetch(`/api/admin/participant-lists/${list.id}/entries`, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(null);
        toast({ variant: 'destructive', title: 'Import failed', description: data?.error });
        return;
      }
      toast({
        title: `${data.added?.toLocaleString() ?? 0} number(s) added`,
        description: `${data.total?.toLocaleString() ?? 0} now on "${list.name}".`,
      });
      afterImport(data);
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const upload = (file: File | undefined | null) => {
    if (!file || !canUpdate) return;
    const body = new FormData();
    body.append('file', file);
    body.append('mode', replaceExisting ? 'replace' : 'append');
    return send('upload', { method: 'POST', body });
  };

  const importPasted = () => {
    if (!paste.trim() || !canUpdate) return;
    return send('paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: paste, mode: replaceExisting ? 'replace' : 'append' }),
    }).then(() => setPaste(''));
  };

  const clearAll = async () => {
    setBusy('clear');
    try {
      const response = await fetch(`/api/admin/participant-lists/${list.id}/entries`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not clear', description: data?.error });
        return;
      }
      toast({ title: `${data.removed?.toLocaleString() ?? 0} removed` });
      setClearOpen(false);
      setResult(null);
      setPage(1);
      load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const pages = Math.max(1, Math.ceil(matchTotal / PAGE_SIZE));

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{list.name}</DialogTitle>
            <DialogDescription>
              {listTotal.toLocaleString()} number(s) on this list.
              {list.auctionCount > 0 &&
                ` ${list.auctionCount} auction(s) were built from it — their rosters are copies and do not change when you edit here.`}
            </DialogDescription>
          </DialogHeader>

          {canUpdate && (
            <div className="space-y-3">
              <div
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
                className={cn(
                  'rounded-lg border-2 border-dashed p-6 text-center transition',
                  dragging ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Drop a .csv, .txt or .xlsx file here</p>
                <p className="text-xs text-muted-foreground">
                  A header row is detected automatically; a bare column of numbers works too.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(event) => upload(event.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={busy !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy === 'upload' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Choose a file
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md bg-secondary/50 px-3 py-2.5">
                <div>
                  <Label htmlFor="replace-existing" className="text-sm">
                    Replace what is on the list
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off, the numbers are added to the list; on, they become the whole list.
                  </p>
                </div>
                <Switch
                  id="replace-existing"
                  checked={replaceExisting}
                  onCheckedChange={setReplaceExisting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paste-numbers">Or paste numbers</Label>
                <Textarea
                  id="paste-numbers"
                  rows={3}
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder={'0912345678\n0911223344,Sara Tesfaye'}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!paste.trim() || busy !== null}
                  onClick={importPasted}
                >
                  {busy === 'paste' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add pasted numbers
                </Button>
              </div>
            </div>
          )}

          {result && (
            <Alert variant={result.rejectedTotal > 0 ? 'destructive' : 'default'}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-1 text-xs">
                <p>
                  <strong>{result.added.toLocaleString()}</strong> added,{' '}
                  {result.skipped.toLocaleString()} already there,{' '}
                  {result.removed.toLocaleString()} removed,{' '}
                  {result.duplicatesInFile.toLocaleString()} duplicate row(s) in the file —{' '}
                  <strong>{result.total.toLocaleString()}</strong> on the list now.
                </p>
                {result.rejectedTotal > 0 && (
                  <>
                    <p className="font-semibold">
                      {result.rejectedTotal.toLocaleString()} row(s) could not be read:
                    </p>
                    <ul className="list-disc pl-4">
                      {result.rejected.map((row) => (
                        <li key={row.line}>
                          Line {row.line}: {row.value || '(empty)'} — {row.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search a number or name"
                className="pl-8"
              />
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/admin/participant-lists/${list.id}?format=csv`}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </a>
            </Button>
            {canUpdate && listTotal > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setClearOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          <TableCard>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">In the app</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <EmptyRow colSpan={3} message="Loading…" />}
                {!loading && entries.length === 0 && (
                  <EmptyRow
                    colSpan={3}
                    message={search ? 'Nothing matches that search.' : 'No numbers on this list yet.'}
                  />
                )}
                {!loading &&
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-secondary/30">
                      <td className="px-3 py-2 font-mono text-xs">{maskPhone(entry.phoneNumber)}</td>
                      <td className="px-3 py-2">
                        {entry.fullName || entry.bidderName || (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {entry.note && (
                          <span className="block text-xs text-muted-foreground">{entry.note}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry.registered ? (
                          <Badge variant="success">Registered</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {pages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm">
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
          </TableCard>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear &quot;{list.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              All {listTotal.toLocaleString()} numbers are removed from the saved list. Auctions
              already built from it keep their own copies and are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
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
    </>
  );
}
