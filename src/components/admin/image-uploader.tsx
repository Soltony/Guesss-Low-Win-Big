'use client';

import { useId, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export const MAX_UPLOAD_MB = 5;
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/** Posts one file to the upload endpoint and returns its served URL. */
export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/admin/uploads', { method: 'POST', body });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data?.error || 'Upload failed.');
  return data.url as string;
}

/**
 * Single-image field: upload from the device, or paste a URL for artwork that
 * already lives on a CDN. Both paths end up as the same string value.
 */
export function ImageUploader({
  value,
  onChange,
  label = 'Image',
  description,
  required,
  disabled,
  className,
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  description?: string;
  required?: boolean;
  /** Read-only: the artwork still shows, nothing can be changed. */
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The URL that failed to load, rather than a boolean, so pointing the field
  // at a different image clears the warning without an effect to reset it.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const broken = Boolean(value) && brokenUrl === value;

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Image too large',
        description: `Maximum size is ${MAX_UPLOAD_MB} MB.`,
      });
      return;
    }

    setUploading(true);
    try {
      onChange(await uploadImage(file));
      toast({ title: 'Image uploaded' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: error?.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowUrl((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />
            {showUrl ? 'Hide URL field' : 'Use a URL instead'}
          </button>
        )}
      </div>

      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      {value ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              className={cn(
                'h-16 w-16 shrink-0 rounded bg-card object-contain',
                broken && 'opacity-30'
              )}
              onError={() => setBrokenUrl(value)}
              onLoad={() => setBrokenUrl((current) => (current === value ? null : current))}
            />
            {/* `break-all` rather than `truncate`: a URL has no spaces to wrap on,
                so leaving it on one line made it the widest thing in the dialog
                and stretched every other field to match. Clamped so a long one
                still cannot push the buttons out of reach. */}
            <p className="line-clamp-2 min-w-0 flex-1 break-all text-xs text-muted-foreground">
              {value}
            </p>
            {!disabled && (
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => onChange('')}
                  aria-label="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* A pasted URL that the browser refuses to load looks identical to one
              that simply has not arrived yet, so say what happened. The usual
              cause is the content security policy: it only allows images from
              this site and a short list of known hosts, so artwork linked from
              anywhere else is blocked before it is ever fetched. */}
          {broken && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              This image could not be loaded. If it is hosted somewhere else, the site&apos;s
              security policy is most likely blocking that host — upload the file instead, or ask
              an administrator to add the host to the allowed list.
            </p>
          )}
        </div>
      ) : disabled ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No image set.
        </p>
      ) : (
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
            handleFile(event.dataTransfer.files?.[0]);
          }}
          disabled={uploading}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/50',
            uploading && 'opacity-60'
          )}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Choose a file or drop it here'}
          </span>
          <span className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, GIF or AVIF · up to {MAX_UPLOAD_MB} MB
          </span>
        </button>
      )}

      <input
        id={inputId}
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {showUrl && !disabled && (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://…/image.png"
          className="text-sm"
        />
      )}
    </div>
  );
}

/** Upload button for flows that manage their own list of images. */
export function ImageUploadButton({
  onUploaded,
  disabled,
  label = 'Upload',
}: {
  onUploaded: (url: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          toast({
            variant: 'destructive',
            title: `${file.name} is too large`,
            description: `Maximum size is ${MAX_UPLOAD_MB} MB.`,
          });
          continue;
        }
        onUploaded(await uploadImage(file));
      }
      toast({ title: 'Upload complete' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: error?.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-1.5 h-4 w-4" />
        )}
        {label}
      </Button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </>
  );
}
